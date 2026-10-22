import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";
import { jstNow } from "../src/jst";

const db = () => (env as any).DB as D1Database;
const D = "2026-10-02";
const start = (date = D) => api(`/api/day-plans/${date}/start`, { method: "POST" });
const get = async (date = D) => (await (await api(`/api/day-plans/${date}`)).json()) as any;
const addPlan = async (body: unknown) =>
  (await (await api("/api/plan-items", { method: "POST", body: JSON.stringify(body) })).json()) as any;
const addItem = (body: unknown, date = D) =>
  api(`/api/day-plans/${date}/items`, { method: "POST", body: JSON.stringify(body) });
const patchItem = (id: string, body: unknown) =>
  api(`/api/day-plan-items/${id}`, { method: "PATCH", body: JSON.stringify(body) });

describe("/api/day-plans", () => {
  beforeEach(resetDb);

  it("404 before start; 400 for a malformed date", async () => {
    const r = await api(`/api/day-plans/${D}`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no plan" });
    expect((await api("/api/day-plans/2026-13-40")).status).toBe(400);
  });

  it("start copies the effective daily items (not week/near/far, not dropped)", async () => {
    const a = await addPlan({ horizon: "daily", text: "毎日A" });
    await addPlan({ horizon: "week", text: "週" });
    const dropped = await addPlan({ horizon: "daily", text: "やめた" });
    await api(`/api/plan-items/${dropped.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: dropped.updated_at, status: "dropped" }) });
    const r = await start();
    expect(r.status).toBe(201);
    const plan = (await r.json()) as any;
    expect(plan.items.map((i: any) => [i.text, i.plan_item_id, i.detail, i.final_status])).toEqual([["毎日A", a.id, "", "none"]]);
  });

  it("start twice -> 409 and no duplicate rows", async () => {
    await addPlan({ horizon: "daily", text: "A" });
    expect((await start()).status).toBe(201);
    const again = await start();
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "exists" });
    expect((await get()).items).toHaveLength(1);
  });

  it("carries over unfinished items of the latest earlier plan, detail included, deduped by plan item", async () => {
    const daily = await addPlan({ horizon: "daily", text: "毎日" });
    const prev = "2026-09-30";
    await start(prev);
    const prevPlan = await get(prev);
    const dailyRow = prevPlan.items[0];
    await patchItem(dailyRow.id, { updated_at: dailyRow.updated_at, detail: "2 轮以上" });
    const extra = (await (await addItem({ text: "臨時の作業", detail: "見積" }, prev)).json()) as any;
    const finished = (await (await addItem({ text: "終わった" }, prev)).json()) as any;
    await patchItem(finished.id, { updated_at: finished.updated_at, manual_status: "done" });

    const plan = (await (await start()).json()) as any;
    expect(plan.items.map((i: any) => [i.text, i.plan_item_id, i.detail])).toEqual([
      ["毎日", daily.id, "2 轮以上"],
      ["臨時の作業", null, "見積"],
    ]);
    expect(extra.id).not.toBe(plan.items[1].id);
  });

  it("does not carry over an item whose plan item has since been finished", async () => {
    const p = await addPlan({ horizon: "near", text: "近い" });
    await start("2026-09-30");
    await addItem({ plan_item_id: p.id }, "2026-09-30");
    const cur = (await (await api("/api/plan-items")).json() as any[])[0];
    await api(`/api/plan-items/${p.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, status: "done" }) });
    expect((await (await start()).json() as any).items).toEqual([]);
  });

  it("does not carry over a daily item that is no longer in effect (its task is done)", async () => {
    const t = (await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "田中", title: "案件Y" }) })).json()) as any;
    await addPlan({ horizon: "daily", text: "毎日Y", task_ids: [t.id] });
    await start("2026-09-30");
    expect((await get("2026-09-30")).items.map((i: any) => i.text)).toEqual(["毎日Y"]);
    const done = await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: t.updated_at, status: "done", done_at: "2026-10-01" }) });
    expect(done.status).toBe(200);
    expect((await (await start()).json() as any).items).toEqual([]);
  });

  it("add inherits text and task from a plan item; rejects unknown plan item and task", async () => {
    const t = (await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "田中", title: "案件X" }) })).json()) as any;
    const p = await addPlan({ horizon: "week", text: "週の作業", task_ids: [t.id] });
    await start();
    const r = await addItem({ plan_item_id: p.id, detail: "設計まで" });
    expect(r.status).toBe(201);
    const added = (await r.json()) as any;
    expect(added).toMatchObject({ text: "週の作業", tasks: [{ id: t.id, title: "案件X", status: "open" }], detail: "設計まで" });
    expect(added).not.toHaveProperty("task_id");
    expect(added).not.toHaveProperty("task_title");
    expect(added).not.toHaveProperty("tasks_json");
    expect((await addItem({ plan_item_id: "P-none" })).status).toBe(400);
    const bad = await addItem({ text: "x", task_ids: ["T19990101-01"] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).issues[0].path).toBe("task_ids");
    expect((await addItem({ detail: "no text" })).status).toBe(400);
    expect((await addItem({ text: "x" }, "2026-01-01")).status).toBe(404);
  });

  it("manual_status overrides ai_status in final_status, and can be cleared", async () => {
    await start();
    const it0 = (await (await addItem({ text: "x" })).json()) as any;
    await db().prepare("UPDATE day_plan_items SET ai_status='partial' WHERE id=?1").bind(it0.id).run();
    expect((await get()).items[0].final_status).toBe("partial");
    const cur = (await get()).items[0];
    const set = (await (await patchItem(it0.id, { updated_at: cur.updated_at, manual_status: "done" })).json()) as any;
    expect(set.final_status).toBe("done");
    const cleared = (await (await patchItem(it0.id, { updated_at: set.updated_at, manual_status: null })).json()) as any;
    expect(cleared.final_status).toBe("partial");
  });

  it("PATCH 409 on stale; DELETE needs updated_at and removes", async () => {
    await start();
    const a = (await (await addItem({ text: "x" })).json()) as any;
    const ok = (await (await patchItem(a.id, { updated_at: a.updated_at, detail: "d" })).json()) as any;
    expect((await patchItem(a.id, { updated_at: a.updated_at, detail: "e" })).status).toBe(409);
    expect((await api(`/api/day-plan-items/${a.id}`, { method: "DELETE" })).status).toBe(400);
    expect((await api(`/api/day-plan-items/${a.id}?updated_at=${encodeURIComponent(ok.updated_at)}`, { method: "DELETE" })).status).toBe(204);
    expect((await get()).items).toEqual([]);
  });

  it("start is atomic: a failing item insert leaves no day_plans row, and a retry succeeds", async () => {
    await addPlan({ horizon: "daily", text: "A" });
    await db().exec("CREATE TRIGGER fail_item BEFORE INSERT ON day_plan_items BEGIN SELECT RAISE(ABORT, 'boom'); END");
    try {
      expect((await start()).status).toBe(500);
    } finally {
      await db().exec("DROP TRIGGER fail_item");
    }
    expect((await api(`/api/day-plans/${D}`)).status).toBe(404);
    expect((await start()).status).toBe(201);
  });

  it("today's date is accepted (JST)", async () => {
    expect((await start(jstNow().date)).status).toBe(201);
  });

  const mkTask = async (title: string) =>
    (await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "田中", title }) })).json()) as any;
  const ids = (item: any) => item.tasks.map((t: any) => t.id);
  const links = async (table: "plan_item_tasks" | "day_plan_item_tasks", col: string, id: string) =>
    ((await db().prepare(`SELECT task_id FROM ${table} WHERE ${col} = ?1 ORDER BY task_id`).bind(id).all()).results as any[]).map((r) => r.task_id);

  it("start: today's item inherits all the plan item's tasks; add-from-plan inherits; task_ids: [] means none", async () => {
    const a = await mkTask("A");
    const b = await mkTask("B");
    const both = [a.id, b.id].sort();
    const daily = await addPlan({ horizon: "daily", text: "毎日AB", task_ids: [a.id, b.id] });
    const week = await addPlan({ horizon: "week", text: "週AB", task_ids: [a.id, b.id] });
    const plan = (await (await start()).json()) as any;
    expect(plan.items).toHaveLength(1);
    expect(ids(plan.items[0])).toEqual(both);
    expect(plan.items[0].ai_evidence_sessions).toEqual([]);
    expect(plan.items[0].plan_item_id).toBe(daily.id);

    const inherited = (await (await addItem({ plan_item_id: week.id })).json()) as any;
    expect(ids(inherited)).toEqual(both);
    const none = (await (await addItem({ plan_item_id: week.id, task_ids: [] })).json()) as any;
    expect(none.tasks).toEqual([]);
    const own = (await (await addItem({ text: "自分", task_ids: [b.id, b.id] })).json()) as any;
    expect(ids(own)).toEqual([b.id]);
  });

  it("PATCH today's task_ids does not touch the plan item's links; stale PATCH keeps links", async () => {
    const a = await mkTask("A");
    const b = await mkTask("B");
    const p = await addPlan({ horizon: "daily", text: "毎日", task_ids: [a.id, b.id] });
    const item = ((await (await start()).json()) as any).items[0];
    const r = await patchItem(item.id, { updated_at: item.updated_at, task_ids: [a.id] });
    expect(r.status).toBe(200);
    const patched = (await r.json()) as any;
    expect(ids(patched)).toEqual([a.id]);
    expect(await links("plan_item_tasks", "plan_item_id", p.id)).toEqual([a.id, b.id].sort());
    expect(((await (await api("/api/plan-items")).json()) as any[])[0].tasks).toHaveLength(2);

    const stale = await patchItem(item.id, { updated_at: item.updated_at, task_ids: [b.id] });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as any;
    expect(ids(body.current)).toEqual([a.id]);
    expect(body.current).toHaveProperty("final_status");
    expect(body.current.ai_evidence).toEqual([]);
    expect(await links("day_plan_item_tasks", "day_plan_item_id", item.id)).toEqual([a.id]);
    expect((await patchItem(item.id, { updated_at: patched.updated_at, task_ids: ["T19990101-01"] })).status).toBe(400);
  });

  it("carry-over keeps the item's own task set; a daily item whose tasks are all done is not carried", async () => {
    const a = await mkTask("A");
    const b = await mkTask("B");
    const c = await mkTask("C");
    const prev = "2026-09-30";
    await addPlan({ horizon: "daily", text: "毎日AB", task_ids: [a.id, b.id] });
    await start(prev);
    const free = (await (await addItem({ text: "臨時", task_ids: [c.id] }, prev)).json()) as any;
    expect(ids(free)).toEqual([c.id]);
    const setStatus = async (t: any, status: string) => {
      const cur = ((await (await api(`/api/tasks/${t.id}`)).json()) as any).task;
      expect((await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, status, done_at: status === "done" ? "2026-10-01" : null }) })).status).toBe(200);
    };
    await setStatus(a, "done");
    await setStatus(b, "done");
    const plan = (await (await start()).json()) as any;
    expect(plan.items.map((i: any) => [i.text, ids(i)])).toEqual([["臨時", [c.id]]]);
  });

  it("carry-over keeps the previous day item's own task set, not the plan item's", async () => {
    const a = await mkTask("A");
    const b = await mkTask("B");
    const prev = "2026-09-30";
    await addPlan({ horizon: "near", text: "近いAB", task_ids: [a.id, b.id] });
    await start(prev);
    const near = ((await (await api("/api/plan-items")).json()) as any[])[0];
    const item = (await (await addItem({ plan_item_id: near.id }, prev)).json()) as any;
    await patchItem(item.id, { updated_at: item.updated_at, task_ids: [b.id] });
    const plan = (await (await start()).json()) as any;
    expect(plan.items.map((i: any) => [i.text, ids(i)])).toEqual([["近いAB", [b.id]]]);
  });

  it("deleting today's item removes its link rows", async () => {
    const a = await mkTask("A");
    await start();
    const item = (await (await addItem({ text: "x", task_ids: [a.id] })).json()) as any;
    expect(await links("day_plan_item_tasks", "day_plan_item_id", item.id)).toEqual([a.id]);
    expect((await api(`/api/day-plan-items/${item.id}?updated_at=stale`, { method: "DELETE" })).status).toBe(409);
    expect(await links("day_plan_item_tasks", "day_plan_item_id", item.id)).toEqual([a.id]);
    expect((await api(`/api/day-plan-items/${item.id}?updated_at=${encodeURIComponent(item.updated_at)}`, { method: "DELETE" })).status).toBe(204);
    expect(await links("day_plan_item_tasks", "day_plan_item_id", item.id)).toEqual([]);
  });
});
