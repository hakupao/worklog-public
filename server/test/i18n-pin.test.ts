import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { runSweep } from "../src/i18n/sweep";
import { fakeAnthropic } from "./fake-anthropic";
import { api, resetDb } from "./helpers";

const E = env as any;
const db = () => E.DB as D1Database;
const textOf = (u: string) => u.split("<text>\n")[1].split("\n</text>")[0];
const reply = (u: string, b: any) => b.output_config.format.schema.required.includes("polished")
  ? { source: "ja", polished: `P(${textOf(u)})`, zh: "z", ja: "j", en: "e" }
  : { source: "ja", zh: `zh:${textOf(u)}`, ja: textOf(u), en: `en:${textOf(u)}` };
let last: any;
const client = () => fakeAnthropic((u) => reply(u, last), [], (b) => { last = b; });
const sweep = () => runSweep({ ...E, ANTHROPIC_API_KEY: "k" }, { client: client(), only: { entity: "task", entity_id: "T1" } });
const pin = (body: object) => api("/api/i18n/pin", { method: "POST", body: JSON.stringify(body) });
const tr = () => db().prepare("SELECT * FROM translations WHERE entity='task' AND entity_id='T1' AND field='title'").first<any>();

beforeEach(async () => {
  await resetDb();
  await db().prepare(`INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
    VALUES ('T1', 'r', 'PRJ', '帳票なおす', 'open', '2026-10-01', '', '[]', 'm', 'x', 'u0')`).run();
  await sweep();
});

describe("POST /api/i18n/pin", () => {
  it("pins the raw text: the next round translates it unpolished; the base and updated_at are untouched", async () => {
    expect(await tr()).toMatchObject({ polished_from: "帳票なおす", ja: "P(帳票なおす)" });
    const res = await pin({ entity: "task", entity_id: "T1", field: "title", pinned: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entity: "task", entity_id: "T1", field: "title", pinned: true, raw: "帳票なおす" });
    await sweep();
    expect(await tr()).toMatchObject({ source_text: "帳票なおす", pinned_raw: "帳票なおす", polished_from: null, ja: "帳票なおす" });
    expect(await db().prepare("SELECT title, updated_at FROM tasks WHERE id='T1'").first<any>()).toEqual({ title: "帳票なおす", updated_at: "u0" });
  });

  it("unpinning polishes the same text again", async () => {
    await pin({ entity: "task", entity_id: "T1", field: "title", pinned: true }); await sweep();
    await pin({ entity: "task", entity_id: "T1", field: "title", pinned: false }); await sweep();
    expect(await tr()).toMatchObject({ pinned_raw: null, polished_from: "帳票なおす", ja: "P(帳票なおす)" });
  });

  it("a new edit after a pin is polished again", async () => {
    await pin({ entity: "task", entity_id: "T1", field: "title", pinned: true }); await sweep();
    await db().prepare("UPDATE tasks SET title='帳票ぜんぶなおす' WHERE id='T1'").run();
    await sweep();
    expect(await tr()).toMatchObject({ source_text: "帳票ぜんぶなおす", polished_from: "帳票ぜんぶなおす", pinned_raw: "帳票なおす" });
  });

  it("refuses a translate-only field, an unknown field and a missing row", async () => {
    expect((await pin({ entity: "task", entity_id: "T1", field: "project", pinned: true })).status).toBe(400);
    expect((await pin({ entity: "task", entity_id: "T1", field: "nope", pinned: true })).status).toBe(400);
    expect((await pin({ entity: "task", entity_id: "T9", field: "title", pinned: true })).status).toBe(404);
  });
});
