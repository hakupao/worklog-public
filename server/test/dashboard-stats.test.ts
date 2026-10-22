import { describe, expect, it } from "vitest";
import { outputStats, overview, timeStats } from "../src/dashboard/stats";
import { counts, input, note, sess, task, tokens } from "./dashboard-fixtures";

const W39 = { from: "2026-09-21", to: "2026-09-27" };

describe("overview", () => {
  it("is all zeros for an empty range", () => {
    expect(overview(input(), W39)).toEqual({
      minutes: 0, active_days: 0, sessions: 0, tasks_done: 0, tokens: 0, cost_usd: 0, cost_partial: false,
    });
  });

  it("assigns sessions to their Tokyo day at both range edges", () => {
    const i = input({ sessions: [
      sess("in-first", "2026-09-20T15:10:00Z"),   // Mon 00:10 JST -> in
      sess("before", "2026-09-20T14:50:00Z"),     // Sun 23:50 JST (W38) -> out
      sess("in-last", "2026-09-27T14:30:00Z"),    // Sun 23:30 JST -> in
      sess("after", "2026-09-27T15:10:00Z"),      // Mon 00:10 JST (W40) -> out
    ] });
    expect(overview(i, W39).sessions).toBe(2);
    expect(overview(i, W39).active_days).toBe(2);
  });

  it("excludes hidden sessions, uses effective minutes and adds note minutes", () => {
    const i = input({
      sessions: [sess("a", "2026-09-22T01:00:00Z", { minutes: 45 }), sess("h", "2026-09-22T02:00:00Z", { hidden: true })],
      notes: [note("n", "2026-09-23T10:00:00", { minutes: 15 }), note("n0", "2026-09-24T10:00:00", { minutes: null })],
    });
    const o = overview(i, W39);
    expect(o.minutes).toBe(60);
    expect(o.sessions).toBe(1);
    expect(o.active_days).toBe(2);
  });

  it("sums tokens and cost, and marks cost partial for unpriced or uncollected sessions", () => {
    const priced = tokens({ by_model: { m: counts({ input: 10, output: 5, cache_read: 100 }) }, cost_usd: 1.5 });
    const unpriced = tokens({ by_model: { g: counts({ output: 7 }) }, cost_usd: null, cost_partial: true });
    const o = overview(input({ sessions: [
      sess("a", "2026-09-22T01:00:00Z", { tokens: priced }),
      sess("b", "2026-09-22T03:00:00Z", { tokens: unpriced }),
    ] }), W39);
    expect(o.tokens).toBe(122);
    expect(o.cost_usd).toBe(1.5);
    expect(o.cost_partial).toBe(true);
    expect(overview(input({ sessions: [sess("c", "2026-09-22T01:00:00Z")] }), W39).cost_partial).toBe(true);
  });

  it("counts tasks done inside the range", () => {
    const o = overview(input({ tasks: [
      task("T1", { status: "done", done_at: "2026-09-25" }),
      task("T2", { status: "done", done_at: "2026-09-10" }),
      task("T3", { status: "open" }),
    ] }), W39);
    expect(o.tasks_done).toBe(1);
  });
});

describe("timeStats", () => {
  it("splits minutes by project, requester and task; unlinked separately", () => {
    const i = input({
      tasks: [task("T1", { project: "ATLAS", requester: "A" }), task("T2", { project: "", requester: "B" })],
      sessions: [
        sess("a", "2026-09-22T01:00:00Z", { task_id: "T1", minutes: 90 }),
        sess("b", "2026-09-23T01:00:00Z", { task_id: "T2", minutes: 30 }),
        sess("c", "2026-09-23T02:00:00Z", { task_id: null, minutes: 20 }),
        sess("d", "2026-09-23T03:00:00Z", { task_id: "GONE", minutes: 5 }),
      ],
      notes: [note("n", "2026-09-24T09:00:00", { task_id: "T1", minutes: 10 })],
    });
    const t = timeStats(i, W39);
    expect(t.by_project).toEqual([{ key: "ATLAS", minutes: 100 }, { key: "（无项目）", minutes: 30 }]);
    expect(t.by_requester).toEqual([{ key: "A", minutes: 100 }, { key: "B", minutes: 30 }]);
    expect(t.by_task.map((r) => [r.task_id, r.minutes])).toEqual([["T1", 100], ["T2", 30]]);
    expect(t.unlinked_minutes).toBe(25);
    expect(t.weekly).toEqual([{ week: "2026-W39", by_project: [
      { key: "ATLAS", minutes: 100 }, { key: "（无项目）", minutes: 30 }, { key: "未关联", minutes: 25 },
    ] }]);
  });

  it("keeps the top 10 keys and merges the rest into 其他", () => {
    const tasks = Array.from({ length: 12 }, (_, k) => task(`T${k}`, { project: `P${k}` }));
    const sessions = tasks.map((t, k) => sess(`s${k}`, "2026-09-22T01:00:00Z", { task_id: t.id, minutes: 100 - k }));
    const t = timeStats(input({ tasks, sessions }), W39);
    expect(t.by_project).toHaveLength(11);
    expect(t.by_project[10]).toEqual({ key: "其他", minutes: 90 + 89 });
  });

  it("lists every ISO week the range touches", () => {
    const t = timeStats(input(), { from: "2026-09-27", to: "2026-10-05" });
    expect(t.weekly.map((w) => w.week)).toEqual(["2026-W39", "2026-W40", "2026-W41"]);
  });
});

describe("outputStats", () => {
  it("reports done tasks, lead time and deliverables", () => {
    const o = outputStats(input({ tasks: [
      task("T1", { status: "done", received_at: "2026-09-20", done_at: "2026-09-25", deliverables: ["a.md", "b.xlsx"] }),
      task("T2", { status: "done", received_at: "2026-09-21", done_at: "2026-09-22" }),
    ] }), W39);
    // ordered by done_at: T2 (9/22) before T1 (9/25)
    expect(o.done_tasks.map((d) => [d.task_id, d.lead_days, d.deliverables])).toEqual([["T2", 1, 0], ["T1", 5, 2]]);
    expect(o.avg_lead_days).toBe(3);
    expect(o.deliverables_count).toBe(2);
  });

  it("is empty and null-averaged when nothing was done", () => {
    expect(outputStats(input(), W39)).toEqual({ done_tasks: [], avg_lead_days: null, deliverables_count: 0, estimate_gaps: [] });
  });

  it("compares manual hours with all-history actual hours for tasks active in the range", () => {
    const o = outputStats(input({
      tasks: [task("T1", { hours_manual: 3 }), task("T2", { hours_manual: 1 })],
      sessions: [
        sess("old", "2026-09-01T01:00:00Z", { task_id: "T1", minutes: 120 }),
        sess("new", "2026-09-22T01:00:00Z", { task_id: "T1", minutes: 60 }),
        sess("hid", "2026-09-22T02:00:00Z", { task_id: "T1", minutes: 600, hidden: true }),
      ],
      notes: [note("n", "2026-09-23T10:00:00", { task_id: "T1", minutes: 30 })],
    }), W39);
    expect(o.estimate_gaps).toEqual([{ task_id: "T1", title: "t T1", manual_hours: 3, actual_hours: 3.5 }]);
  });
});

describe("timeStats unlinked split", () => {
  const W = { from: "2026-09-21", to: "2026-09-27" };
  it("reports how much of the unlinked time is notes", () => {
    const t = timeStats(input({
      sessions: [sess("s", "2026-09-22T01:00:00Z", { minutes: 30 })],
      notes: [note("n", "2026-09-22T10:00:00", { minutes: 20 })],
    }), W);
    expect(t.unlinked_minutes).toBe(50);
    expect(t.unlinked_note_minutes).toBe(20);
  });
});
