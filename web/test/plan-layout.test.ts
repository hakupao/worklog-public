import { describe, expect, it } from "vitest";
import { closedRows, dayRows, doneShare, pickable, preview, ttGroups, weekBands, weekdaysOf } from "../src/pages/plan/layout";
import { layoutWeek } from "../src/pages/timeline/week";
import { dayItem, dayPlan, J, machine, planItem, session, task, taskRef } from "../src/predict/fixtures";
import { weekTl } from "./tl-fixtures";

const W = "2026-W40", MON = "2026-09-28";
const tasks = [task("T1", "alpha"), task("T2", "beta"), task("T3", "gamma")];
const week = (ss: ReturnType<typeof session>[]) => layoutWeek({
  timeline: weekTl(W, MON, ss), tasks, machines: [machine("macmini", "2026-10-02 14:20")], now: Date.parse(J("2026-10-02 14:20")), runningMin: 10,
});
const band = (ss: ReturnType<typeof session>[], date: string) => week(ss).bands.find((b) => b.date === date) ?? null;

describe("dayRows (今日安排)", () => {
  const SS = [
    session("a", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "T1", summary: "帳票の修正" }),
    session("b", "2026-10-01 09:00", "2026-10-01 09:30", { task_id: "T2", summary: "先に始めた" }),
    // crosses midnight into 10/02: only 10/01's part counts on 10/01
    session("c", "2026-10-01 23:30", "2026-10-02 00:30", { task_id: "T1", summary: "夜" }),
    session("u", "2026-10-01 12:00", "2026-10-01 13:00", { summary: "未関連" }),
  ];
  it("minutes and sessions on the item's tasks that day; first-start order; the day's share only", () => {
    const [r] = dayRows(dayPlan("2026-10-01", [dayItem({ id: "D1", text: "x", tasks: [taskRef("T1"), taskRef("T2")] })]), band(SS, "2026-10-01"));
    expect(r.minutes).toBe(60 + 30 + 30);
    expect(r.sessions.map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(r.alt).toEqual({ kind: "time", minutes: 120, n: 3, summary: "先に始めた" });
  });
  it("the flip line: the AI's note, else its progress, else the concrete goal, else the time, else no related sessions", () => {
    const b = band(SS, "2026-10-01");
    const rows = dayRows(dayPlan("2026-10-01", [
      dayItem({ id: "1", text: "n", tasks: [taskRef("T1")], ai_note: " 約 3 輪 ", detail: "205 項" }),
      dayItem({ id: "2", text: "d", tasks: [taskRef("T1")], detail: "205 項 " }),
      dayItem({ id: "5", text: "p", tasks: [taskRef("T1")], ai_progress: " 约 51 轮 ", detail: "205 項" }),
      dayItem({ id: "3", text: "none", tasks: [taskRef("T3")] }),
      dayItem({ id: "4", text: "no task" }),
    ]), b);
    expect(rows.map((r) => r.alt)).toEqual([
      { kind: "note", text: "約 3 輪" }, { kind: "detail", text: "205 項" }, { kind: "progress", text: "约 51 轮" }, { kind: "idle" }, { kind: "idle" },
    ]);
    expect(rows[4].minutes).toBe(0);
  });
  it("status is final_status; by = manual when you overrode it, ai when judged, null before any judgement", () => {
    const rows = dayRows(dayPlan("2026-10-01", [
      dayItem({ id: "1", text: "m", ai_status: "none", manual_status: "done" }),
      dayItem({ id: "2", text: "a", ai_status: "partial" }),
      dayItem({ id: "3", text: "u" }),
    ]), null);
    expect(rows.map((r) => [r.status, r.by])).toEqual([["done", "manual"], ["partial", "ai"], ["none", null]]);
  });
  it("a day with no band (a weekend without activity, a week not loaded) has 0 minutes, not a crash", () => {
    const [r] = dayRows(dayPlan("2026-10-04", [dayItem({ id: "1", text: "x", tasks: [taskRef("T1")] })]), null);
    expect([r.minutes, r.alt]).toEqual([0, { kind: "idle" }]);
  });
});

describe("the AI 对账 week", () => {
  it("weekdaysOf: Monday to Friday of the date's week, from any day of it", () => {
    expect(weekdaysOf("2026-10-02")).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(weekdaysOf("2026-10-04")).toEqual(weekdaysOf("2026-09-28"));
    expect(weekdaysOf("2026-10-05")[0]).toBe("2026-10-05");
  });
  it("doneShare: done / items per day; not started, empty and not loaded are 0", () => {
    const p = (s: ("done" | "none" | "partial")[]) => dayPlan("2026-10-01", s.map((x, i) => dayItem({ id: `${i}`, text: "x", manual_status: x })));
    expect(doneShare([p(["done", "done"]), p(["done", "none", "partial"]), p([]), null, undefined])).toEqual([1, 1 / 3, 0, 0, 0]);
  });
});

describe("the timetable", () => {
  const items = [
    planItem({ id: "P1", horizon: "daily", text: "BEACON", tasks: [taskRef("T1")], until_date: "2026-10-09" }),
    planItem({ id: "P2", horizon: "daily", text: "old", effective: false, until_date: "2026-09-30" }),
    planItem({ id: "P3", horizon: "week", text: "stale", stale: true, week: "2026-W39", tasks: [taskRef("T2"), taskRef("T3")] }),
    planItem({ id: "P4", horizon: "far", text: "far" }),
    planItem({ id: "P5", horizon: "week", text: "w" }),
  ];
  const SS = [
    session("a", "2026-09-29 10:00", "2026-09-29 11:00", { task_id: "T1" }),
    session("b", "2026-10-01 10:00", "2026-10-01 10:20", { task_id: "T3" }),
    session("h", "2026-09-30 10:00", "2026-09-30 11:00", { task_id: "T1", hidden: 1 }),
  ];
  it("four groups in horizon order; per-horizon order numbers; tags for stale and out of period", () => {
    const g = ttGroups(items, weekBands(week(SS), weekdaysOf("2026-10-02")));
    expect(g.map((x) => [x.horizon, x.rows.map((r) => r.item.id)])).toEqual([["daily", ["P1", "P2"]], ["week", ["P3", "P5"]], ["near", []], ["far", ["P4"]]]);
    expect(g[0].rows.map((r) => [r.order, r.tag, r.idle])).toEqual([[1, null, false], [2, "idle", true]]);
    expect(g[1].rows[0].tag).toBe("stale");
  });
  it("the week strip: minutes per weekday on any of its tasks; hidden sessions count nowhere", () => {
    const g = ttGroups(items, weekBands(week(SS), weekdaysOf("2026-10-02")));
    expect(g[0].rows[0].perDay).toEqual([0, 60, 0, 0, 0]);
    expect(g[1].rows[0].perDay).toEqual([0, 0, 0, 20, 0]);
    expect(g[3].rows[0].perDay).toEqual([0, 0, 0, 0, 0]);
  });
  it("no week loaded yet: every strip is empty, the rows still show", () => {
    const g = ttGroups(items, weekBands(null, weekdaysOf("2026-10-02")));
    expect(g[0].rows[0].perDay).toEqual([0, 0, 0, 0, 0]);
  });
  it("a closed daily item is done / dropped, never 不在期 (the server says effective:false for every closed one — review A)", () => {
    const [r] = closedRows([planItem({ id: "PD", horizon: "daily", text: "d", status: "done", effective: false })], []);
    expect([r.tag, r.idle]).toEqual(["done", false]);
  });
  it("closed rows: done and dropped, no order number, their own tag", () => {
    const c = closedRows([...items, planItem({ id: "P8", horizon: "near", text: "d", status: "done" }), planItem({ id: "P9", horizon: "far", text: "x", status: "dropped" })], []);
    expect(c.map((r) => [r.item.id, r.order, r.tag])).toEqual([["P8", null, "done"], ["P9", null, "dropped"]]);
  });
});

describe("before the day starts, and 从计划添加", () => {
  const items = [
    planItem({ id: "P1", horizon: "daily", text: "a" }),
    planItem({ id: "P2", horizon: "daily", text: "out", effective: false, until_date: "2026-09-30" }),
    planItem({ id: "P3", horizon: "far", text: "f" }),
    planItem({ id: "P4", horizon: "week", text: "w" }),
  ];
  it("preview: only the daily items in effect", () => {
    expect(preview(items, "2026-10-02").map((p) => p.id)).toEqual(["P1"]);
  });
  it("preview: in effect ON THAT DAY, like the server's start (preflight R7) — not the as-of-today flag", () => {
    const xs = [
      planItem({ id: "A", horizon: "daily", text: "until 10/7", until_date: "2026-10-07", effective: true }),
      planItem({ id: "B", horizon: "daily", text: "ended 9/30", until_date: "2026-09-30", effective: false }),
      planItem({ id: "C", horizon: "daily", text: "tasks all done", tasks: [taskRef("T1", "t", "done")], effective: false }),
      planItem({ id: "D", horizon: "daily", text: "one open", tasks: [taskRef("T1", "t", "done"), taskRef("T2")] }),
    ];
    expect(preview(xs, "2026-10-08").map((p) => p.id)).toEqual(["D"]);
    expect(preview(xs, "2026-09-29").map((p) => p.id)).toEqual(["A", "B", "D"]);
  });
  it("pickable: not already in the day, in horizon order", () => {
    const plan = dayPlan("2026-10-02", [dayItem({ id: "D1", text: "a", plan_item_id: "P1" })]);
    expect(pickable(items, plan).map((p) => p.id)).toEqual(["P2", "P4", "P3"]);
  });
});

describe("dowShort (one 33px slot)", () => {
  it("一 / 月 / M — English keeps only the first letter", async () => {
    const { dowShort } = await import("../src/pages/plan/codes");
    expect([dowShort("zh", "2026-09-28"), dowShort("ja", "2026-09-28"), dowShort("en", "2026-09-28"), dowShort("en", "2026-10-01")]).toEqual(["一", "月", "M", "T"]);
  });
});
