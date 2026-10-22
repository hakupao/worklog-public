import { describe, expect, it } from "vitest";
import { defaultDay, dayRows, suggestTasks, unlinkedRows } from "../src/pages/timeline/rows";
import { layoutWeek } from "../src/pages/timeline/week";
import { J, machine, session, task } from "../src/predict/fixtures";
import { note, weekTl } from "./tl-fixtures";

const W = "2026-W40", MON = "2026-09-28";
const T = (s: string) => Date.parse(J(s));
const tasks = [task("A", "alpha"), task("B", "beta"), task("Z", "zeta", "done")];
const lay = (ss: ReturnType<typeof session>[], o: { now?: string; notes?: ReturnType<typeof note>[]; machines?: ReturnType<typeof machine>[] } = {}) =>
  layoutWeek({ timeline: weekTl(W, MON, ss, o.notes), tasks, machines: o.machines ?? [], now: T(o.now ?? "2026-10-02 14:20"), runningMin: 10 });

describe("layoutWeek", () => {
  it("five weekday bands; tracks in first-start order with 未关联 last; today marked; one shared 9–21 axis", () => {
    const L = lay([
      session("s1", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "B" }),
      session("s2", "2026-10-01 09:30", "2026-10-01 09:50"),
      session("s3", "2026-10-01 13:00", "2026-10-01 13:30", { task_id: "A" }),
      session("s4", "2026-10-02 10:00", "2026-10-02 10:30", { task_id: "A" }),
    ]);
    expect(L.bands.map((b) => [b.date, b.dow, b.isToday])).toEqual([
      ["2026-09-28", 1, false], ["2026-09-29", 2, false], ["2026-09-30", 3, false], ["2026-10-01", 4, false], ["2026-10-02", 5, true],
    ]);
    expect(L.bands[3].tracks.map((t) => [t.taskId, t.minutes])).toEqual([["B", 60], ["A", 30], [null, 20]]);
    expect([L.h0, L.h1, L.ndot]).toEqual([9, 21, 144]);
    expect(L.legend).toEqual(["B", "A", null]);
    expect(L.nowIdx).toBe(64);                                  // 14:20 → (14:20 − 9:00) / 5 min
    expect([L.totalMinutes, L.sessionCount, L.cost]).toEqual([140, 4, 4]);
  });
  it("a weekend band only when something happened on it", () => {
    expect(lay([session("w", "2026-10-03 10:00", "2026-10-03 10:20")]).bands.map((b) => b.date))
      .toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(lay([], { notes: [note("1", "2026-10-04T12:00:00", { minutes: 30 })] }).bands.at(-1)!.date).toBe("2026-10-04");
  });
  it("a cross-midnight session is on both bands with each day's share; its cost is split the same way", () => {
    const L = lay([session("x", "2026-09-29 23:00", "2026-09-30 01:00", { task_id: "A" }, 4)]);
    const tue = L.bands[1], wed = L.bands[2];
    expect([tue.tracks[0].minutes, wed.tracks[0].minutes]).toEqual([60, 60]);
    expect([tue.cost, wed.cost, L.cost]).toEqual([2, 2, 4]);
    expect([L.h0, L.h1]).toEqual([0, 24]);                      // the axis widens to hold both ends
    expect(L.sessionCount).toBe(1);
  });
  it("a day the server does not list the session on (its share rounds to 0) gets no dot either", () => {
    const L = lay([session("t", "2026-09-29 23:50", "2026-09-30 00:00", { active_intervals: [[J("2026-09-29 23:50"), "2026-09-29T15:00:20.000Z" /* 00:00:20 JST */]] })]);
    expect(L.bands[2].sessions).toEqual([]);
    expect(L.bands[2].tracks).toEqual([]);
    expect(L.bands[1].tracks).toHaveLength(1);
    expect(L.h0).toBe(9);                        // the 20 s past midnight does not widen the axis either
  });
  it("the week's cost is its days' — a session reaching back into last week brings only this week's part", () => {
    const L = lay([session("p", "2026-09-27 23:00", "2026-09-28 01:00", { task_id: "A" }, 2)]);
    expect([L.bands[0].cost, L.cost]).toEqual([1, 1]);
  });
  it("a task that no longer exists draws on the 未关联 row; a hidden session draws nowhere", () => {
    const L = lay([
      session("g", "2026-09-28 10:00", "2026-09-28 10:30", { task_id: "GONE" }),
      session("h", "2026-09-28 11:00", "2026-09-28 11:30", { task_id: "A", hidden: 1 }),
    ]);
    expect(L.bands[0].tracks.map((t) => t.taskId)).toEqual([null]);
    expect(L.sessionCount).toBe(1);
  });
  it("运行中 on today's band uses the same rule as 此刻 (last burst within 10 min of the machine's collection)", () => {
    const L = lay([session("r", "2026-10-02 13:00", "2026-10-02 14:00", { task_id: "A" }), session("o", "2026-10-02 09:00", "2026-10-02 10:00", { task_id: "B" })],
      { machines: [machine("macmini", "2026-10-02 14:05")] });
    expect(L.bands[4].tracks.map((t) => [t.taskId, t.running])).toEqual([["B", false], ["A", true]]);
  });
  it("an empty week: five empty bands, the default axis, no today when the week is past", () => {
    const L = lay([], { now: "2026-10-08 10:00" });
    expect(L.bands).toHaveLength(5);
    expect(L.bands.every((b) => b.tracks.length === 0)).toBe(true);
    expect([L.h0, L.h1, L.nowIdx, L.totalMinutes, L.legend]).toEqual([9, 21, null, 0, []]);
  });
  it("today past 21:00 widens the axis to now", () => {
    expect(lay([], { now: "2026-10-02 22:30" }).h1).toBe(23);
  });
});

describe("day rows", () => {
  const L = lay([
    session("late", "2026-10-01 15:00", "2026-10-01 15:30", { cwd: "/a" }),
    session("early", "2026-10-01 09:00", "2026-10-01 09:30", { cwd: "/b", task_id: "A" }),
  ], { notes: [note("n1", "2026-10-01T12:00:00")] });
  const thu = L.bands[3];
  it("sessions by start, then notes", () => {
    expect(dayRows(thu, null).map((r) => r.key)).toEqual(["s:early", "s:late", "n:n1"]);
  });
  it("只看此目录: that directory's sessions, no notes", () => {
    expect(dayRows(thu, "/a").map((r) => r.key)).toEqual(["s:late"]);
  });
  it("the 未关联 list keeps the server's order and dates each row", () => {
    const list = [session("u2", "2026-09-20 10:00", "2026-09-20 12:00", { cwd: "/a" }), session("u1", "2026-10-01 10:00", "2026-10-01 10:10")];
    const rows = unlinkedRows(list, null, (iso) => iso.slice(0, 10));
    expect(rows.map((r) => [r.key, r.kind === "s" ? r.date : null])).toEqual([["s:u2", "2026-09-20"], ["s:u1", "2026-10-01"]]);
    expect(unlinkedRows(list, "/a", (iso) => iso.slice(0, 10)).map((r) => r.key)).toEqual(["s:u2"]);
  });
  it("default day: today in the week, else the first day with sessions, else Monday", () => {
    expect(defaultDay(L.bands)).toBe("2026-10-02");
    expect(defaultDay(lay([session("a", "2026-09-30 10:00", "2026-09-30 10:30")], { now: "2026-10-08 10:00" }).bands)).toBe("2026-09-30");
    expect(defaultDay(lay([], { now: "2026-10-08 10:00" }).bands)).toBe("2026-09-28");
    expect(defaultDay([])).toBeNull();
  });
});

describe("link suggestions", () => {
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  it("open tasks linked from the same directory, most minutes first, never done tasks or the session itself", () => {
    const s = session("u", "2026-10-01 10:00", "2026-10-01 10:30", { cwd: "/w/x" });
    const pool = [
      s,
      session("p1", "2026-10-01 08:00", "2026-10-01 08:10", { cwd: "/w/x", task_id: "A" }),
      session("p2", "2026-09-30 08:00", "2026-09-30 09:00", { cwd: "/w/x", task_id: "B" }),
      session("p3", "2026-09-30 10:00", "2026-09-30 13:00", { cwd: "/w/x", task_id: "Z" }),
      session("p4", "2026-09-30 10:00", "2026-09-30 13:00", { cwd: "/w/y", task_id: "A" }),
    ];
    expect(suggestTasks(s, pool, byId)).toEqual(["B", "A"]);
    expect(suggestTasks(session("v", "2026-10-01 10:00", "2026-10-01 10:30", { cwd: "/elsewhere" }), pool, byId)).toEqual([]);
  });
});
