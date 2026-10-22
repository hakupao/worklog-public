import { describe, expect, it } from "vitest";
import { aiStats, overview, requesterStats, rhythmStats, sharesIn, timeStats } from "../src/dashboard/stats";
import { buildHints } from "../src/dashboard/hints";
import { counts, input, sess, task, tokens } from "./dashboard-fixtures";

// Tue 2026-09-29 23:30 JST -> Wed 2026-09-30 02:30 JST, one 180-minute cluster: 30 min on the
// Tuesday, 150 on the Wednesday. The window stayed open past midnight, so the old rule would have
// put all 180 on the Tuesday.
const NIGHT = sess("night", "2026-09-29T14:30:00Z", {
  minutes: 180, task_id: "T1",
  active_intervals: [["2026-09-29T14:30:00Z", "2026-09-29T17:30:00Z"]],
  tokens: tokens({ by_model: { opus: counts({ input: 1200, output: 600 }) }, subagent: { opus: counts({ output: 300 }) }, cost_usd: 12 }),
});
const TUE = { from: "2026-09-29", to: "2026-09-29" };
const WED = { from: "2026-09-30", to: "2026-09-30" };
const W40 = { from: "2026-09-28", to: "2026-10-04" };
const i = input({ tasks: [task("T1", { requester: "A" })], sessions: [NIGHT] });

describe("sharesIn", () => {
  it("gives each day its own part of a session that ran across midnight", () => {
    expect(sharesIn(i, TUE).map((x) => [x.minutes, x.weight])).toEqual([[30, 30 / 180]]);
    expect(sharesIn(i, WED).map((x) => [x.minutes, x.weight])).toEqual([[150, 150 / 180]]);
    expect(sharesIn(i, W40).map((x) => x.minutes)).toEqual([180]);
    expect(sharesIn(i, { from: "2026-10-01", to: "2026-10-01" })).toEqual([]);
  });
  it("keeps a session without intervals wholly on its start day", () => {
    const old = input({ sessions: [sess("old", "2026-09-29T14:30:00Z", { minutes: 180 })] });
    expect(sharesIn(old, TUE).map((x) => x.minutes)).toEqual([180]);
    expect(sharesIn(old, WED)).toEqual([]);
  });
  it("counts a zero-minute session once, on its start day", () => {
    const zero = input({ sessions: [sess("z", "2026-09-29T14:30:00Z", { minutes: 0, active_intervals: [["2026-09-29T14:30:00Z", "2026-09-29T14:30:00Z"]] })] });
    expect(sharesIn(zero, TUE).map((x) => [x.minutes, x.weight])).toEqual([[0, 1]]);
    expect(sharesIn(zero, WED)).toEqual([]);
  });
});

describe("overview and time by day share", () => {
  it("scales minutes, tokens and cost by the part in range; the session counts once per range", () => {
    const wed = overview(i, WED);
    expect(wed.minutes).toBe(150);
    expect(wed.sessions).toBe(1);
    expect(wed.active_days).toBe(1);
    expect(wed.tokens).toBe(1500);          // 1800 * 150/180
    expect(wed.cost_usd).toBe(10);          // 12 * 150/180
    const tue = overview(i, TUE);
    expect([tue.minutes, tue.tokens, tue.cost_usd]).toEqual([30, 300, 2]);
    const week = overview(i, W40);
    expect([week.minutes, week.tokens, week.cost_usd, week.active_days]).toEqual([180, 1800, 12, 2]);
  });
  it("files each day's minutes under that day's ISO week and the task", () => {
    const t = timeStats(i, { from: "2026-09-28", to: "2026-10-11" });
    expect(t.by_task).toEqual([{ task_id: "T1", title: "t T1", minutes: 180 }]);
    expect(t.weekly.find((w) => w.week === "2026-W40")!.by_project).toEqual([{ key: "P", minutes: 180 }]);
    expect(timeStats(i, WED).by_task[0].minutes).toBe(150);
    expect(requesterStats(i, WED)).toEqual([{ requester: "A", minutes: 150, tokens: 1500, cost_usd: 10, cost_partial: false }]);
  });
  it("scales the AI figures the same way and lists the session with its full cost", () => {
    const a = aiStats(i, WED);
    expect(a.by_model).toEqual([{ model: "opus", input: 1000, output: 500, cache_read: 0, cache_write: 0, total: 1500 }]);
    expect(a.by_agent).toEqual([{ agent: "claude-code", sessions: 1, minutes: 150, cost_usd: 10, cost_partial: false }]);
    expect(a.subagent_share).toBeCloseTo(300 / 1800);
    expect(a.cost_per_hour).toBeCloseTo(10 / 2.5);
    expect(a.by_task_cost[0]).toMatchObject({ task_id: "T1", cost_usd: 10, minutes: 150 });
    expect(a.top_sessions[0]).toMatchObject({ id: "night", cost_usd: 12, tokens: 1800 });
  });
  it("puts the hint's unlinked hours on the in-range part", () => {
    const u = input({ sessions: [{ ...NIGHT, task_id: null }] });
    const h = buildHints(u, WED, rhythmStats(u, WED), new Date("2026-09-30T12:00:00Z"));
    expect(h.find((x) => x.id === "unlinked")!.text).toContain("2.5h");
  });
});

describe("rhythm by hour piece", () => {
  it("fills daily and the heatmap with the hours actually worked on days in range", () => {
    const wed = rhythmStats(i, WED);
    expect(wed.daily).toEqual([{ date: "2026-09-30", minutes: 150 }]);
    expect(wed.heatmap[2].slice(0, 3)).toEqual([60, 60, 30]);   // Wed 00:00-02:30
    expect(wed.heatmap[1][23]).toBe(0);                          // Tue 23:xx is outside the range
    expect(wed.late_night_share).toBe(1);                        // all before 05:00
    const tue = rhythmStats(i, TUE);
    expect(tue.daily).toEqual([{ date: "2026-09-29", minutes: 30 }]);
    expect(tue.heatmap[1][23]).toBe(30);
  });
  it("keeps the week's daily sum equal to the overview minutes", () => {
    const r = rhythmStats(i, W40);
    expect(r.daily.reduce((n, d) => n + d.minutes, 0)).toBe(overview(i, W40).minutes);
    expect(r.daily.map((d) => d.minutes)).toEqual([0, 30, 150, 0, 0, 0, 0]);
  });
  it("counts the focus block once and the start and end on the start day only", () => {
    const wed = rhythmStats(i, WED);
    expect(wed.focus_blocks.find((b) => b.bucket === "≥120")!.count).toBe(1);
    expect([wed.avg_start, wed.avg_end]).toEqual([null, null]);
    const tue = rhythmStats(i, TUE);
    expect([tue.avg_start, tue.avg_end]).toEqual(["23:30", "26:30"]);
  });
});

describe("rhythm start/end from active clusters", () => {
  // Window opened Mon 09:00 JST, worked until 18:00, left open, used again Tue 10:00–12:00 JST, closed Tue 12:00.
  const OPEN = sess("open", "2026-09-28T00:00:00Z", {
    minutes: 660,
    ended_at: "2026-09-29T03:00:00Z",
    active_intervals: [
      ["2026-09-28T00:00:00Z", "2026-09-28T09:00:00Z"],
      ["2026-09-29T01:00:00Z", "2026-09-29T03:00:00Z"],
    ],
  });
  const MON = { from: "2026-09-28", to: "2026-09-28" };
  const TUE2 = { from: "2026-09-29", to: "2026-09-29" };
  const BOTH = { from: "2026-09-28", to: "2026-09-29" };

  it("a window left open overnight ends the day at its last cluster", () => {
    const mon = rhythmStats(input({ sessions: [OPEN] }), MON);
    expect([mon.avg_start, mon.avg_end]).toEqual(["09:00", "18:00"]);
  });
  it("the next day's cluster starts and ends that day", () => {
    const tue = rhythmStats(input({ sessions: [OPEN] }), TUE2);
    expect([tue.avg_start, tue.avg_end]).toEqual(["10:00", "12:00"]);
  });
  it("averages the two days", () => {
    const r = rhythmStats(input({ sessions: [OPEN] }), BOTH);
    expect([r.avg_start, r.avg_end]).toEqual(["09:30", "15:00"]);
  });
  it("without intervals uses started_at plus active minutes, not ended_at", () => {
    const s = sess("x", "2026-09-28T00:00:00Z", { minutes: 120, ended_at: "2026-09-29T15:00:00Z" });
    const r = rhythmStats(input({ sessions: [s] }), MON);
    expect(r.avg_end).toBe("11:00");
  });
});
