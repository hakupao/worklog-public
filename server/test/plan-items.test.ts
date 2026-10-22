import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";
import { addDays, isoWeekOf, jstNow } from "../src/jst";

const post = (body: unknown) => api("/api/plan-items", { method: "POST", body: JSON.stringify(body) });
const patch = (id: string, body: unknown) => api(`/api/plan-items/${id}`, { method: "PATCH", body: JSON.stringify(body) });
const list = async (q = "") => (await (await api(`/api/plan-items${q}`)).json()) as any[];
const task = async (title = "案件") =>
  (await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "田中", title }) })).json()) as any;

describe("/api/plan-items", () => {
  beforeEach(resetDb);

  it("creates an item in each horizon; week items carry the current ISO week", async () => {
    for (const horizon of ["daily", "week", "near", "far"]) {
      const r = await post({ horizon, text: `${horizon} item` });
      expect(r.status).toBe(201);
    }
    const items = await list();
    expect(items.map((i) => i.horizon).sort()).toEqual(["daily", "far", "near", "week"]);
    const week = items.find((i) => i.horizon === "week");
    expect(week.week).toBe(isoWeekOf(jstNow().date));
    expect(items.find((i) => i.horizon === "daily").week).toBeNull();
    expect(week.id).toMatch(/^P\d{8}-\d{6}-[0-9a-f]{8}$/);
  });

  it("rejects an unknown task and a bad horizon", async () => {
    const bad = await post({ horizon: "daily", text: "x", task_ids: ["T19990101-01"] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).issues).toEqual([{ path: "task_ids", message: "unknown task" }]);
    expect((await post({ horizon: "someday", text: "x" })).status).toBe(400);
    expect((await post({ horizon: "daily", text: "" })).status).toBe(400);
  });

  it("a daily item stops being effective when its task is done, and comes back when reopened", async () => {
    const t = await task();
    await post({ horizon: "daily", text: "毎日進める", task_ids: [t.id] });
    const first = (await list())[0];
    expect(first).toMatchObject({ effective: true, tasks: [{ id: t.id, title: "案件", status: "open" }] });
    expect(first).not.toHaveProperty("task_id");
    expect(first).not.toHaveProperty("task_title");
    expect(first).not.toHaveProperty("task_status");
    expect(first).not.toHaveProperty("tasks_json");
    const done = await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: t.updated_at, status: "done", done_at: jstNow().date }) });
    expect(done.status).toBe(200);
    expect((await list())[0].effective).toBe(false);
    const d = (await done.json()) as any;
    await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: d.updated_at, status: "open", done_at: null }) });
    expect((await list())[0].effective).toBe(true);
  });

  it("a daily item past its until_date is not effective", async () => {
    const today = jstNow().date;
    await post({ horizon: "daily", text: "期限切れ", until_date: addDays(today, -1) });
    await post({ horizon: "daily", text: "今日まで", until_date: today });
    const byText = Object.fromEntries((await list()).map((i) => [i.text, i.effective]));
    expect(byText).toEqual({ 期限切れ: false, 今日まで: true });
  });

  it("a week item from a past week is stale until re-planned", async () => {
    const created = (await (await post({ horizon: "week", text: "先週の" })).json()) as any;
    const r = await patch(created.id, { updated_at: created.updated_at, week: "2020-W01" });
    expect(((await r.json()) as any).stale).toBe(true);
    const back = (await (await patch(created.id, { updated_at: ((await list())[0]).updated_at, week: isoWeekOf(jstNow().date) })).json()) as any;
    expect(back.stale).toBe(false);
  });

  it("moving horizons sets/clears week; finishing sets done_at; closed lists done and dropped", async () => {
    const a = (await (await post({ horizon: "near", text: "a" })).json()) as any;
    const toWeek = (await (await patch(a.id, { updated_at: a.updated_at, horizon: "week" })).json()) as any;
    expect(toWeek.week).toBe(isoWeekOf(jstNow().date));
    const toFar = (await (await patch(a.id, { updated_at: toWeek.updated_at, horizon: "far" })).json()) as any;
    expect(toFar.week).toBeNull();
    const done = (await (await patch(a.id, { updated_at: toFar.updated_at, status: "done" })).json()) as any;
    expect(done.done_at).not.toBeNull();
    expect(await list()).toEqual([]);
    expect((await list("?status=closed")).map((i) => i.id)).toEqual([a.id]);
    const reopened = (await (await patch(a.id, { updated_at: done.updated_at, status: "active" })).json()) as any;
    expect(reopened.done_at).toBeNull();
  });

  it("PATCH: stale updated_at -> 409 with current; unknown -> 404; empty -> 400", async () => {
    const a = (await (await post({ horizon: "near", text: "a" })).json()) as any;
    await patch(a.id, { updated_at: a.updated_at, text: "b" });
    const stale = await patch(a.id, { updated_at: a.updated_at, text: "c" });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as any).current.text).toBe("b");
    expect((await patch("P-none", { updated_at: "x", text: "c" })).status).toBe(404);
    expect((await patch(a.id, { updated_at: a.updated_at })).status).toBe(400);
  });

  it("orders by horizon, then sort, then created_at", async () => {
    const b = (await (await post({ horizon: "near", text: "b" })).json()) as any;
    await post({ horizon: "near", text: "c" });
    await patch(b.id, { updated_at: b.updated_at, sort: 5 });
    await post({ horizon: "daily", text: "a" });
    expect((await list()).map((i) => i.text)).toEqual(["a", "c", "b"]);
  });

  it("many tasks: sorted by id; effective while any one is not done", async () => {
    const a = await task("A");
    const b = await task("B");
    const created = (await (await post({ horizon: "daily", text: "両方", task_ids: [b.id, a.id] })).json()) as any;
    expect(created.tasks.map((t: any) => t.id)).toEqual([a.id, b.id].sort());
    const setStatus = async (t: any, status: string) => {
      const cur = ((await (await api(`/api/tasks/${t.id}`)).json()) as any).task;
      const r = await api(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, status, done_at: status === "done" ? jstNow().date : null }) });
      expect(r.status).toBe(200);
    };
    await setStatus(a, "done");
    expect((await list())[0].effective).toBe(true);
    await setStatus(b, "done");
    expect((await list())[0].effective).toBe(false);
    await setStatus(b, "open");
    expect((await list())[0].effective).toBe(true);
  });

  it("PATCH task_ids replaces the set; a stale PATCH leaves the links alone; ids deduped; unknown -> 400", async () => {
    const a = await task("A");
    const b = await task("B");
    const item = (await (await post({ horizon: "near", text: "x", task_ids: [a.id] })).json()) as any;
    const r = await patch(item.id, { updated_at: item.updated_at, task_ids: [b.id] });
    expect(r.status).toBe(200);
    const replaced = (await r.json()) as any;
    expect(replaced.tasks.map((t: any) => t.id)).toEqual([b.id]);
    expect(replaced.updated_at).not.toBe(item.updated_at);

    const stale = await patch(item.id, { updated_at: item.updated_at, task_ids: [a.id, b.id] });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as any;
    expect(body.current.tasks.map((t: any) => t.id)).toEqual([b.id]);
    expect(body.current).toHaveProperty("effective");
    expect(body.current).not.toHaveProperty("tasks_json");
    expect((await list())[0].tasks.map((t: any) => t.id)).toEqual([b.id]);

    const dup = (await (await patch(item.id, { updated_at: replaced.updated_at, task_ids: [a.id, a.id] })).json()) as any;
    expect(dup.tasks.map((t: any) => t.id)).toEqual([a.id]);
    const unknown = await patch(item.id, { updated_at: dup.updated_at, task_ids: ["T19990101-01"] });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as any).issues[0].path).toBe("task_ids");
    const cleared = (await (await patch(item.id, { updated_at: dup.updated_at, task_ids: [] })).json()) as any;
    expect(cleared.tasks).toEqual([]);
    expect((await patch("P-none", { updated_at: "x", task_ids: [] })).status).toBe(404);
  });

  it("POST dedupes task_ids", async () => {
    const a = await task("A");
    const r = (await (await post({ horizon: "far", text: "x", task_ids: [a.id, a.id] })).json()) as any;
    expect(r.tasks.map((t: any) => t.id)).toEqual([a.id]);
  });
});
