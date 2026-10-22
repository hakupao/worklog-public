import { describe, expect, it } from "vitest";
import { aiStats, rhythmStats } from "../src/dashboard/stats";
import { counts, input, note, sess, task, tokens } from "./dashboard-fixtures";

const W39 = { from: "2026-09-21", to: "2026-09-27" };

describe("aiStats", () => {
  const i = input({
    tasks: [task("T1", { title: "big" })],
    sessions: [
      sess("a", "2026-09-22T01:00:00Z", { task_id: "T1", minutes: 120, tokens: tokens({
        by_model: { opus: counts({ input: 100, output: 50, cache_read: 800, cache_write_5m: 50 }) },
        subagent: { opus: counts({ output: 25, cache_read: 400 }) },
        cost_usd: 6,
      }) }),
      sess("b", "2026-09-22T05:00:00Z", { agent: "codex", minutes: 60, tokens: tokens({
        by_model: { gpt: counts({ input: 200, output: 10 }) }, cost_usd: null, cost_partial: true,
      }) }),
      sess("c", "2026-09-23T01:00:00Z", { minutes: 30 }),
    ],
  });
  const a = aiStats(i, W39);

  it("aggregates tokens by model without per-model cost", () => {
    expect(a.by_model).toEqual([
      { model: "opus", input: 100, output: 50, cache_read: 800, cache_write: 50, total: 1000 },
      { model: "gpt", input: 200, output: 10, cache_read: 0, cache_write: 0, total: 210 },
    ]);
  });
  it("splits sessions, minutes and cost by agent; an agent with nothing priced has null cost", () => {
    expect(a.by_agent).toEqual([
      { agent: "claude-code", sessions: 2, minutes: 150, cost_usd: 6, cost_partial: false },
      { agent: "codex", sessions: 1, minutes: 60, cost_usd: null, cost_partial: false },
    ]);
  });
  it("marks an agent partial when some of its sessions are unpriced", () => {
    const j = input({ sessions: [
      sess("p", "2026-09-22T01:00:00Z", { agent: "codex", tokens: tokens({ cost_usd: 2 }) }),
      sess("q", "2026-09-22T03:00:00Z", { agent: "codex", tokens: tokens({ cost_usd: null, cost_partial: true }) }),
    ] });
    expect(aiStats(j, W39).by_agent).toEqual([{ agent: "codex", sessions: 2, minutes: 120, cost_usd: 2, cost_partial: true }]);
  });
  it("computes subagent share, cache hit rate and cost per hour", () => {
    expect(a.subagent_share).toBeCloseTo(425 / 1210);
    expect(a.cache_hit_rate).toBeCloseTo(800 / (100 + 800 + 50 + 200));
    expect(a.cost_per_hour).toBe(3);          // $6 over the 120 minutes of priced sessions
  });
  it("lists cost per task, the costliest sessions and uncollected sessions", () => {
    expect(a.by_task_cost).toEqual([{ task_id: "T1", title: "big", cost_usd: 6, cost_partial: false, minutes: 120 }]);
    expect(a.top_sessions.map((s) => [s.id, s.cost_usd, s.tokens])).toEqual([["a", 6, 1000]]);
    expect(a.uncollected_sessions).toBe(1);
  });
  it("returns nulls instead of NaN when there is no usage", () => {
    const e = aiStats(input(), W39);
    expect([e.subagent_share, e.cache_hit_rate, e.cost_per_hour]).toEqual([null, null, null]);
    expect(e.by_model).toEqual([]);
  });
});

describe("rhythmStats", () => {
  it("fills every day of the range, sessions plus notes", () => {
    const r = rhythmStats(input({
      sessions: [sess("a", "2026-09-22T01:00:00Z", { minutes: 50 })],
      notes: [note("n", "2026-09-22T20:00:00", { minutes: 10 })],
    }), W39);
    expect(r.daily).toHaveLength(7);
    expect(r.daily[1]).toEqual({ date: "2026-09-22", minutes: 60 });
  });
  it("puts session minutes in the weekday x hour heatmap by Tokyo start time", () => {
    const r = rhythmStats(input({ sessions: [sess("a", "2026-09-27T13:10:00Z", { minutes: 40 })] }), W39);
    expect(r.heatmap).toHaveLength(7);
    expect(r.heatmap[6][22]).toBe(40);        // Sunday 22:10 JST
  });
  it("computes late-night and weekend shares from session minutes", () => {
    const r = rhythmStats(input({ sessions: [
      sess("late", "2026-09-22T14:00:00Z", { minutes: 30 }),   // Tue 23:00 JST
      sess("early", "2026-09-22T19:00:00Z", { minutes: 10 }),  // Wed 04:00 JST
      sess("day", "2026-09-23T01:00:00Z", { minutes: 40 }),    // Wed 10:00 JST
      sess("sat", "2026-09-26T01:00:00Z", { minutes: 20 }),    // Sat 10:00 JST
    ] }), W39);
    expect(r.late_night_share).toBeCloseTo(40 / 100);
    expect(r.weekend_share).toBeCloseTo(20 / 100);
  });
  it("buckets focus blocks and averages start and end times", () => {
    const r = rhythmStats(input({ sessions: [
      sess("a", "2026-09-22T00:00:00Z", { minutes: 10 }),      // 09:00-09:10
      sess("b", "2026-09-22T08:00:00Z", { minutes: 70 }),      // 17:00-18:10
      sess("c", "2026-09-23T02:00:00Z", { minutes: 130 }),     // 11:00-13:10
    ] }), W39);
    expect(r.focus_blocks).toEqual([
      { bucket: "<15", count: 1 }, { bucket: "15–30", count: 0 }, { bucket: "30–60", count: 0 },
      { bucket: "60–120", count: 1 }, { bucket: "≥120", count: 1 },
    ]);
    expect(r.avg_start).toBe("10:00");       // (09:00 + 11:00) / 2
    expect(r.avg_end).toBe("15:40");         // (18:10 + 13:10) / 2
  });
  it("reports an end past midnight as 24:xx and nulls for no sessions", () => {
    const r = rhythmStats(input({ sessions: [sess("a", "2026-09-22T14:30:00Z", { minutes: 60 })] }), W39); // 23:30-00:30
    expect(r.avg_end).toBe("24:30");
    const e = rhythmStats(input(), W39);
    expect([e.late_night_share, e.weekend_share, e.avg_start, e.avg_end]).toEqual([null, null, null, null]);
  });
});
