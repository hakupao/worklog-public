import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { allocateBadge, emptyUsage } from "../src/badge/alloc";
import { ASSIGN_SQL, assignMissingBadges } from "../src/badge/assign";
import { BADGE_OBJECT_NAMES } from "../src/badge/names.gen";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const create = async (title: string, received_at = "2026-10-14") =>
  (await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "r", title, received_at }) })).json()) as any;
const row = (id: string) => db().prepare("SELECT * FROM tasks WHERE id = ?1").bind(id).first<any>();
const putTask = (id: string, over: Record<string, unknown> = {}) => api(`/api/tasks/${id}`, {
  method: "PUT",
  body: JSON.stringify({ requester: "r", title: "t", status: "open", received_at: "2026-10-14", machine: "m", ts: "2026-10-14T10:00:00", ...over }),
});
const insertBare = (id: string, status: string, received_at: string) => db().prepare(
  `INSERT INTO tasks (id, requester, title, status, received_at, machine, ts, updated_at)
   VALUES (?1, 'r', 't', ?2, ?3, 'm', 'x', '2026-10-14T00:00:00Z')`).bind(id, status, received_at).run();

describe("task badges", () => {
  beforeEach(resetDb);

  it("POST returns a listed object and a palette colour, also in GET list and detail", async () => {
    const t = await create("a");
    expect(BADGE_OBJECT_NAMES).toContain(t.badge_obj);
    expect(Number.isInteger(t.badge_color) && t.badge_color >= 0 && t.badge_color < 12).toBe(true);
    const list = (await (await api("/api/tasks")).json()) as any[];
    expect(list[0]).toMatchObject({ badge_obj: t.badge_obj, badge_color: t.badge_color });
    const detail = (await (await api(`/api/tasks/${t.id}`)).json()) as any;
    expect(detail.task).toMatchObject({ badge_obj: t.badge_obj, badge_color: t.badge_color });
  });

  it("14 open 案件: 12 distinct colours first, then repeats; all objects distinct", async () => {
    const made = [];
    for (let i = 0; i < 14; i++) made.push(await create(`t${i}`));
    expect(new Set(made.slice(0, 12).map((t) => t.badge_color)).size).toBe(12);
    expect(new Set(made.map((t) => t.badge_obj)).size).toBe(14);
    const counts = Array(12).fill(0);
    for (const t of made) counts[t.badge_color]++;
    expect(Math.max(...counts)).toBe(2);
  });

  it("done 案件 do not block: a done 案件's colour is free again", async () => {
    const made = [];
    for (let i = 0; i < 12; i++) made.push(await create(`t${i}`));
    const first = made[0];
    await api(`/api/tasks/${first.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: first.updated_at, status: "done" }) });
    expect((await create("next")).badge_color).toBe(first.badge_color);
  });

  it("PUT update keeps the stored badge; PUT insert gets one", async () => {
    const t = await create("a");
    expect((await putTask(t.id, { title: "renamed" })).status).toBe(200);
    expect(await row(t.id)).toMatchObject({ title: "renamed", badge_obj: t.badge_obj, badge_color: t.badge_color });
    expect((await putTask("T20261014-77")).status).toBe(200);
    expect(BADGE_OBJECT_NAMES).toContain((await row("T20261014-77")).badge_obj);
  });

  it("PATCH with badge fields is a 400 and changes nothing", async () => {
    const t = await create("a");
    const r = await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: t.updated_at, badge_obj: "phosphor:cat" }) });
    expect(r.status).toBe(400);
    expect((await row(t.id)).badge_obj).toBe(t.badge_obj);
  });

  it("delete then recreate the same id: allocated afresh, not inherited", async () => {
    const t = await create("a");
    const fresh = allocateBadge(t.id, emptyUsage());
    const other = BADGE_OBJECT_NAMES.find((n) => n !== fresh.obj)!, otherColor = (fresh.color + 1) % 12;
    await db().prepare("UPDATE tasks SET badge_obj = ?1, badge_color = ?2 WHERE id = ?3").bind(other, otherColor, t.id).run();
    expect((await api(`/api/tasks/${t.id}?updated_at=${encodeURIComponent((await row(t.id)).updated_at)}`, { method: "DELETE" })).status).toBe(204);
    const again = await create("b");
    expect(again.id).toBe(t.id);
    expect(again).toMatchObject({ badge_obj: fresh.obj, badge_color: fresh.color });
  });

  it("backfill: fills NULL rows in received_at, id order against usage so far, never overwrites", async () => {
    await insertBare("T20261002-01", "open", "2026-10-02");
    await insertBare("T20261001-01", "open", "2026-10-01");
    await insertBare("T20261003-01", "done", "2026-10-03");
    expect(await assignMissingBadges(db(), 40)).toBe(3);
    const a = await row("T20261001-01"), b = await row("T20261002-01");
    expect(b.badge_color).not.toBe(a.badge_color);       // b allocated after a, against a's usage
    expect(await assignMissingBadges(db(), 40)).toBe(0);     // idempotent
    await db().prepare("UPDATE tasks SET badge_obj = 'fluent:panda' WHERE id = 'T20261001-01'").run();
    await assignMissingBadges(db(), 40);
    expect((await row("T20261001-01")).badge_obj).toBe("fluent:panda");
  });

  it("one backfill call over 12 open NULL rows gives 12 distinct colours and 12 distinct objects", async () => {
    for (let i = 1; i <= 12; i++) await insertBare(`T20261001-${String(i).padStart(2, "0")}`, "open", "2026-10-01");
    expect(await assignMissingBadges(db(), 40)).toBe(12);
    const { results } = await db().prepare("SELECT badge_obj, badge_color FROM tasks").all<any>();
    expect(new Set(results.map((r) => r.badge_color)).size).toBe(12);
    expect(new Set(results.map((r) => r.badge_obj)).size).toBe(12);
  });

  it("respects the limit, oldest first; the next call continues", async () => {
    for (let i = 1; i <= 5; i++) await insertBare(`T2026100${i}-01`, "done", `2026-10-0${i}`);
    expect(await assignMissingBadges(db(), 3)).toBe(3);
    const { results } = await db().prepare("SELECT id FROM tasks WHERE badge_obj IS NULL ORDER BY id").all<any>();
    expect(results.map((r) => r.id)).toEqual(["T20261004-01", "T20261005-01"]);
    expect(await assignMissingBadges(db(), 3)).toBe(2);
    expect(await assignMissingBadges(db(), 3)).toBe(0);
  });

  it("the guarded UPDATE never overwrites a stored badge (concurrent-writer guard)", async () => {
    await insertBare("T20261001-01", "open", "2026-10-01");
    await db().prepare("UPDATE tasks SET badge_obj = 'fluent:panda', badge_color = 4 WHERE id = 'T20261001-01'").run();
    const r = await db().prepare(ASSIGN_SQL).bind(BADGE_OBJECT_NAMES[0], 0, "T20261001-01").run();
    expect(r.meta.changes).toBe(0);
    expect(await row("T20261001-01")).toMatchObject({ badge_obj: "fluent:panda", badge_color: 4 });
  });

  it("a culled / unknown stored object is not counted as in use", async () => {
    await insertBare("T20261001-01", "open", "2026-10-01");
    await db().prepare("UPDATE tasks SET badge_obj = 'cat', badge_color = 99 WHERE id = 'T20261001-01'").run();
    await insertBare("T20261001-02", "open", "2026-10-01");
    await assignMissingBadges(db(), 40);
    const fresh = allocateBadge("T20261001-02", emptyUsage());
    expect(await row("T20261001-02")).toMatchObject({ badge_obj: fresh.obj, badge_color: fresh.color });
  });

  it("POST and PUT badge the just-written 案件 first, even behind a backlog of older unassigned rows", async () => {
    for (let i = 1; i <= 5; i++) await insertBare(`T20261001-0${i}`, "done", "2026-10-01");
    const t = await create("a");
    expect(BADGE_OBJECT_NAMES).toContain(t.badge_obj);
    expect(Number.isInteger(t.badge_color)).toBe(true);
    expect((await putTask("T20261014-77")).status).toBe(200);
    const r = await row("T20261014-77");
    expect(BADGE_OBJECT_NAMES).toContain(r.badge_obj);
    expect(Number.isInteger(r.badge_color)).toBe(true);
  });

  it("an assign failure does not fail POST; the next GET /api/tasks fills it", async () => {
    // A real D1 failure: with the column renamed, the INSERT (which never names it) works and the probe SELECT in assignMissingBadges throws.
    await db().prepare("ALTER TABLE tasks RENAME COLUMN badge_obj TO badge_obj_off").run();
    let t: any;
    try {
      const r = await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "r", title: "x" }) });
      expect(r.status).toBe(201);
      t = await r.json();
    } finally { await db().prepare("ALTER TABLE tasks RENAME COLUMN badge_obj_off TO badge_obj").run(); }
    expect((await row(t.id)).badge_obj).toBeNull();
    const list = (await (await api("/api/tasks")).json()) as any[];
    expect(BADGE_OBJECT_NAMES).toContain(list.find((x) => x.id === t.id).badge_obj);
    expect(BADGE_OBJECT_NAMES).toContain((await row(t.id)).badge_obj);
  });

  it("GET /api/tasks fills up to 20 unassigned rows (oldest first) before answering; a second GET fills the rest", async () => {
    for (let i = 1; i <= 25; i++) await insertBare(`T202610${String(i).padStart(2, "0")}-01`, "open", `2026-10-${String(i).padStart(2, "0")}`);
    const r = await api("/api/tasks");
    expect(r.status).toBe(200);
    const list = (await r.json()) as any[];
    expect(list).toHaveLength(25);
    const filled = list.filter((x) => x.badge_obj !== null);
    expect(filled).toHaveLength(20);
    for (const x of filled) expect(BADGE_OBJECT_NAMES).toContain(x.badge_obj);
    expect(filled.map((x) => x.id)).toEqual(list.slice(0, 20).map((x) => x.id));   // the 20 oldest by received_at (ids sort the same here)
    const left = await db().prepare("SELECT id FROM tasks WHERE badge_obj IS NULL ORDER BY id").all<any>();
    expect(left.results).toHaveLength(5);
    expect(left.results[0].id).toBe("T20261021-01");
    const again = (await (await api("/api/tasks")).json()) as any[];
    expect(again.every((x) => BADGE_OBJECT_NAMES.includes(x.badge_obj))).toBe(true);
  });

  it("GET /api/tasks?status=done also fills rows outside the filter (any unassigned row, not only the returned ones)", async () => {
    await insertBare("T20261001-01", "open", "2026-10-01");
    await insertBare("T20261002-01", "done", "2026-10-02");
    const list = (await (await api("/api/tasks?status=done")).json()) as any[];
    expect(list.map((x) => x.id)).toEqual(["T20261002-01"]);
    expect(BADGE_OBJECT_NAMES).toContain(list[0].badge_obj);
    expect(BADGE_OBJECT_NAMES).toContain((await row("T20261001-01")).badge_obj);
  });

  it("an assign failure during GET /api/tasks still answers 200 with the list", async () => {
    await insertBare("T20261001-01", "open", "2026-10-01");
    await db().prepare("ALTER TABLE tasks RENAME COLUMN badge_obj TO badge_obj_off").run();
    try {
      const r = await api("/api/tasks");
      expect(r.status).toBe(200);
      expect(((await r.json()) as any[]).map((x) => x.id)).toEqual(["T20261001-01"]);
    } finally { await db().prepare("ALTER TABLE tasks RENAME COLUMN badge_obj_off TO badge_obj").run(); }
  });
});
