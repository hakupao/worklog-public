import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers";
import sql from "../migrations/0008_plan_tasks.sql?raw";

const db = () => (env as any).DB as D1Database;

// The test DB has every migration applied before any test runs, so 0008's data steps are replayed
// here against rows written the 0007 way (task_id on the item itself).
const dataSteps = sql
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => /^(INSERT INTO plan_item_tasks|INSERT INTO day_plan_item_tasks|UPDATE)\b/.test(s));

describe("migration 0008", () => {
  beforeEach(resetDb);

  it("has the four data steps", () => {
    expect(dataSteps).toHaveLength(4);
  });

  it("copies each old task_id into the link table and empties the old column", async () => {
    const now = new Date().toISOString();
    await db().batch([
      db().prepare("INSERT INTO tasks (id, requester, title, status, received_at, machine, ts, updated_at) VALUES ('T1','田中','A','open','2026-10-01','m','2026-10-01T09:00:00',?1)").bind(now),
      db().prepare("INSERT INTO plan_items (id, horizon, text, task_id, status, created_at, updated_at) VALUES ('P1','daily','x','T1','active',?1,?1)").bind(now),
      db().prepare("INSERT INTO plan_items (id, horizon, text, task_id, status, created_at, updated_at) VALUES ('P2','near','y',NULL,'active',?1,?1)").bind(now),
      db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-10-01', ?1, ?1)").bind(now),
      db().prepare("INSERT INTO day_plan_items (id, date, task_id, text, updated_at) VALUES ('D1','2026-10-01','T1','x',?1)").bind(now),
      db().prepare("INSERT INTO day_plan_items (id, date, task_id, text, updated_at) VALUES ('D2','2026-10-01',NULL,'y',?1)").bind(now),
    ]);
    await db().batch(dataSteps.map((s) => db().prepare(s)));
    expect((await db().prepare("SELECT plan_item_id, task_id FROM plan_item_tasks").all()).results).toEqual([{ plan_item_id: "P1", task_id: "T1" }]);
    expect((await db().prepare("SELECT day_plan_item_id, task_id FROM day_plan_item_tasks").all()).results).toEqual([{ day_plan_item_id: "D1", task_id: "T1" }]);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM plan_items WHERE task_id IS NOT NULL").first<{ n: number }>())!.n).toBe(0);
    expect((await db().prepare("SELECT COUNT(*) AS n FROM day_plan_items WHERE task_id IS NOT NULL").first<{ n: number }>())!.n).toBe(0);
  });
});
