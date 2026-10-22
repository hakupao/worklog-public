import { describe, expect, it } from "vitest";
import type { GridRow } from "../src/api/types";
import { buildMatrix, editTargets, findCell, matrixOf, type MatrixInput } from "../src/pages/report/matrix";
import { session, task } from "../src/predict/fixtures";
import { dayRow, daysGrid, preview, taskRow, tasksGrid } from "./rp-serve";
import { note, weekTl } from "./tl-fixtures";
import { reportTimeline } from "../src/pages/report/useReportData";

// report week 2026-W40: Saturday 09-26 … Friday 10-02 (Mon–Fri 09-28 … 10-02); today = Friday 10-02
const T1 = { ...task("T20260901-01", "alpha 改修"), thinking: "まず影響範囲" };
const T2 = task("T20260915-01", "beta 調査");
const TASKS = [T1, T2];
const UN = "その他・調査";
const edited = (row: GridRow, column: string, value: string | number): GridRow => ({
  ...row, cells: row.cells.map((c) => (c.column === column ? { ...c, value, auto: c.value, overridden: true } : c)),
});

// This week's timeline without these rows' sessions (hidden since): each row is placed by its 案件 title.
const NO_SOURCES = weekTl("2026-W40", "2026-09-28", []);
const layout = (days: GridRow[], o: Partial<MatrixInput> = {}) => buildMatrix({
  week: "2026-W40", days: daysGrid(days), tasksGrid: tasksGrid([taskRow(T1, 2.5), taskRow(T2, 2)]),
  timeline: NO_SOURCES, tasks: TASKS, today: "2026-10-02", ...o,
});

describe("日別作業 matrix — columns, rows, totals, edits", () => {
  const rows = [
    dayRow("S:r1", "2026-09-28", "alpha 改修", "帳票の修正", 60),
    dayRow("S:r2", "2026-09-29", UN, "調べもの", 30),
    dayRow("S:r3", "2026-09-30", "alpha 改修", "テスト; レビュー", 90),
    dayRow("S:r4", "2026-09-30", "beta 調査", "調査", 120),
  ];
  it("Mon–Fri columns with today marked; rows by week minutes, 未割当 last; totals include 未割当", () => {
    const m = layout(rows);
    expect(m.columns.map((c) => [c.date, c.dow, c.today])).toEqual([
      ["2026-09-28", 1, false], ["2026-09-29", 2, false], ["2026-09-30", 3, false], ["2026-10-01", 4, false], ["2026-10-02", 5, true],
    ]);
    expect(m.rows.map((r) => [r.taskId, r.title, r.minutes])).toEqual([
      ["T20260901-01", "alpha 改修", 150], ["T20260915-01", "beta 調査", 120], [null, null, 30],
    ]);
    expect(m.dayTotals).toEqual([60, 30, 210, 0, 0]);
    expect(m.total).toBe(300);
    expect(m.taskCount).toBe(2);
    expect(m.pending).toBe(false);
    const c = m.rows[0].cells[2];
    expect(c).toMatchObject({ taskId: "T20260901-01", date: "2026-09-30", minutes: 90, overridden: false, sourceRowKeys: ["S:r3"] });
    expect(c.entries.map((e) => e.text)).toEqual(["テスト; レビュー"]);
    expect(m.rows[0].cells[1]).toMatchObject({ minutes: 0, entries: [], sourceRowKeys: [] });
  });
  it("a weekend column only when that day has a row, before Monday (the report week starts on Saturday)", () => {
    expect(layout(rows).columns).toHaveLength(5);
    const m = layout([...rows, dayRow("S:w1", "2026-09-27", "beta 調査", "休日対応", 45)]);
    expect(m.columns.map((c) => [c.date, c.dow, c.weekend])).toEqual([
      ["2026-09-27", 7, true], ["2026-09-28", 1, false], ["2026-09-29", 2, false], ["2026-09-30", 3, false], ["2026-10-01", 4, false], ["2026-10-02", 5, false],
    ]);
    expect(m.rows[0]).toMatchObject({ taskId: "T20260915-01", minutes: 165 });   // now the bigger one
    expect(m.dayTotals).toEqual([45, 60, 30, 210, 0, 0]);
    const both = layout([...rows, dayRow("S:w2", "2026-09-26", UN, "土曜", 10), dayRow("S:w3", "2026-09-27", UN, "日曜", 20)]);
    expect(both.columns.map((c) => c.date).slice(0, 3)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28"]);
    // the Sunday after Friday is the next report week's: never a column here
    expect(layout([...rows, dayRow("S:w4", "2026-10-04", UN, "x", 45)]).columns).toHaveLength(5);
  });
  it("equal minutes order by task id; 未割当 stays last however big", () => {
    const m = layout([
      dayRow("S:e1", "2026-09-28", UN, "x", 500),
      dayRow("S:e2", "2026-09-28", "beta 調査", "", 30),
      dayRow("S:e3", "2026-09-29", "alpha 改修", "", 30),
    ]);
    expect(m.rows.map((r) => r.taskId)).toEqual(["T20260901-01", "T20260915-01", null]);
  });
  it("hand edits: the cell shows the override and is flagged; an edited date or title does not move the row", () => {
    const m = layout([
      edited(rows[0], "minutes", 45),
      edited(edited(rows[2], "text", "手で書いた"), "date", "2026-10-01"),
      edited(rows[3], "task", "別名"),
    ]);
    expect(m.rows[0].cells[0]).toMatchObject({ minutes: 45, overridden: true });
    expect(m.rows[0].cells[2]).toMatchObject({ minutes: 90, overridden: true });
    expect(m.rows[0].cells[2].entries.map((e) => e.text)).toEqual(["手で書いた"]);
    expect(m.rows[0].cells[3].entries).toEqual([]);
    expect(m.rows[1]).toMatchObject({ taskId: "T20260915-01", title: "beta 調査" });
    expect(m.total).toBe(255);
  });

  it("preflight R2: an edited 日付 or 案件 alone flags the cell and its entry (shown in the drawer, restorable there)", () => {
    const m = layout([rows[0], edited(rows[2], "date", "2026-10-01"), edited(rows[3], "task", "別名")]);
    expect(m.rows[0].cells[0]).toMatchObject({ overridden: false });
    expect(m.rows[0].cells[2]).toMatchObject({ overridden: true });
    expect(m.rows[0].cells[2].entries[0]).toMatchObject({ overridden: true, dateCell: { value: "2026-10-01", auto: "2026-09-30" } });
    expect(m.rows[1].cells[2]).toMatchObject({ overridden: true });
    expect(m.rows[1].cells[2].entries[0].taskCell).toMatchObject({ value: "別名", auto: "beta 調査" });
  });
  it("考え方 comes from the 案件一覧 sheet (its override), else the task list; a task the list lacks keeps its sheet title", () => {
    const tg = tasksGrid([edited(taskRow(T1, 2.5), "thinking", "手直しした考え方"), taskRow(T2, 2)]);
    const m = layout(rows, { tasksGrid: tg });
    expect(m.rows[0]).toMatchObject({ thinking: "手直しした考え方", thinkingCell: { overridden: true } });
    expect(layout(rows, { tasksGrid: null }).rows[0]).toMatchObject({ thinking: "まず影響範囲", thinkingCell: null });
    // the session's 案件 comes from the timeline; the task list no longer has it
    const tl = weekTl("2026-W40", "2026-09-28", [session("g1", "2026-09-28 10:00", "2026-09-28 10:10", { task_id: "T20250101-01" })]);
    const gone = layout([dayRow("S:g1", "2026-09-28", "消えた案件", "", 10)], { tasks: [], timeline: tl });
    expect(gone.rows[0]).toMatchObject({ taskId: "T20250101-01", title: "消えた案件", task: null, thinking: "" });
  });
  it("editTargets: the minutes and text cells of the cell's rows; a day without a row has none", () => {
    const m = layout([edited(rows[0], "minutes", 45), ...rows.slice(1)]);
    const c = findCell(m, "T20260901-01", "2026-09-28")!;
    expect(editTargets(c).map((t) => [t.sheet, t.row_key, t.column, t.cell.value, t.cell.auto])).toEqual([
      ["days", "S:r1", "minutes", 45, 60],
      ["days", "S:r1", "text", "帳票の修正", undefined],
    ]);
    expect(editTargets(findCell(m, "T20260901-01", "2026-09-29")!)).toEqual([]);
    expect(findCell(m, null, "2026-09-29")!.minutes).toBe(30);
    expect(findCell(m, "T20260901-01", "2026-10-04")).toBeNull();   // no weekend column
    expect(findCell(m, "T-none", "2026-09-28")).toBeNull();
  });
});

describe("日別作業 matrix — sources (row_key S:<session> / N:<note>, task from the timeline: U1)", () => {
  const sessions = [
    session("a1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id, summary: "帳票の修正" }),
    session("a2", "2026-09-28 13:00", "2026-09-28 13:30", { task_id: T1.id, summary: "見直し" }),
    session("x1", "2026-09-29 09:00", "2026-09-29 09:20", { task_id: null, summary: "雑務" }),
    // over the 05:00 day boundary: 03:30–06:00, one row per day with the same row_key — 90 minutes on 9/30, 60 on 10/1
    session("m1", "2026-10-01 03:30", "2026-10-01 06:00", { task_id: T2.id, summary: "夜間バッチ" }),
  ];
  const notes = [note("n1", "2026-09-29T15:00:00", { task_id: T2.id, minutes: 40, text: "電話" })];
  const tl = weekTl("2026-W40", "2026-09-28", sessions, notes);
  const days = [
    dayRow("S:a1", "2026-09-28", "alpha 改修", "帳票の修正", 60),
    dayRow("S:a2", "2026-09-28", "alpha 改修", "見直し", 30),
    dayRow("S:x1", "2026-09-29", UN, "雑務", 20),
    dayRow("N:n1", "2026-09-29", "beta 調査", "電話", 40),
    dayRow("S:m1", "2026-09-30", "beta 調査", "夜間バッチ", 90),
    dayRow("S:m1", "2026-10-01", "beta 調査", "夜間バッチ", 60),
    // hidden on 时间线 since the report was built: not in the timeline, placed by its (unique) title
    dayRow("S:h1", "2026-10-02", "beta 調査", "隠した", 15),
    // unknown and titled like nothing in the list: 未割当
    dayRow("S:u1", "2026-10-02", UN, "どこにも", 5),
  ];
  const build = (o: Partial<MatrixInput> = {}) => buildMatrix({
    week: "2026-W40", days: daysGrid(days), tasksGrid: null, timeline: tl, tasks: TASKS, today: "2026-10-02", ...o,
  });

  it("S: / N: rows take the session's / note's task; a cell lists its entries with their timeline source", () => {
    const m = build();
    expect(m.pending).toBe(false);
    expect(m.rows.map((r) => [r.taskId, r.minutes])).toEqual([["T20260915-01", 205], ["T20260901-01", 90], [null, 25]]);
    const c = findCell(m, T1.id, "2026-09-28")!;
    expect(c.entries.map((e) => [e.rowKey, e.text, e.minutes, e.source?.kind, e.source?.id])).toEqual([
      ["S:a1", "帳票の修正", 60, "session", "a1"], ["S:a2", "見直し", 30, "session", "a2"],
    ]);
    expect(c.sources.map((s) => [s.kind, s.id, s.minutes])).toEqual([["session", "a1", 60], ["session", "a2", 30]]);
    expect(findCell(m, T2.id, "2026-09-29")!.entries[0]).toMatchObject({ rowKey: "N:n1", minutes: 40, source: { kind: "note", id: "n1" } });
    expect(findCell(m, T2.id, "2026-09-29")!.sources.map((s) => s.id)).toEqual(["n1"]);
    expect(editTargets(c).map((t) => `${t.row_key}/${t.column}`)).toEqual(["S:a1/minutes", "S:a1/text", "S:a2/minutes", "S:a2/text"]);
  });
  it("a session over 05:00 is a row on each day (same row_key), each with that day's share", () => {
    const m = build();
    const [d3, d4] = [findCell(m, T2.id, "2026-09-30")!, findCell(m, T2.id, "2026-10-01")!];
    expect([d3.minutes, d4.minutes]).toEqual([90, 60]);
    // each day's row takes that day's share of the session, not the first day's (group review A2)
    expect([d3.entries[0].source?.minutes, d4.entries[0].source?.minutes]).toEqual([90, 60]);
    expect(d3.sources.map((s) => s.minutes)).toEqual([90]);
    expect(d3.entries[0].rowKey).toBe(d4.entries[0].rowKey);
  });
  it("review fix 1: a session at Sat 10/3 02:00 is the report's Friday 10/2 — found by id under 10/2, not by title", () => {
    const late = session("s2", "2026-10-03 02:00", "2026-10-03 02:40", { task_id: T1.id, summary: "深夜対応" });
    const m = build({
      timeline: reportTimeline("2026-W40", weekTl("2026-W39", "2026-09-21", []), weekTl("2026-W40", "2026-09-28", [...sessions, late], notes)),
      // a title no 案件 has: only the id can place it
      days: daysGrid([...days, dayRow("S:s2", "2026-10-02", "どれでもない", "深夜対応", 40)]),
    });
    const c = findCell(m, T1.id, "2026-10-02")!;
    expect(c.entries.map((e) => [e.rowKey, e.source?.id, e.source?.minutes])).toEqual([["S:s2", "s2", 40]]);
    expect(c.sources.map((s) => s.id)).toEqual(["s2"]);
  });
  it("review fix 2: a cell's sources follow the 05:00 day — Sat 9/26 01:00 is W39's Friday, not W40's Saturday", () => {
    const early = session("e1", "2026-09-26 01:00", "2026-09-26 02:00", { task_id: T1.id, summary: "金曜の続き" });
    const day = session("d1", "2026-09-26 10:00", "2026-09-26 11:00", { task_id: T1.id, summary: "土曜作業" });
    const m = build({
      timeline: reportTimeline("2026-W40", weekTl("2026-W39", "2026-09-21", [early, day]), weekTl("2026-W40", "2026-09-28", sessions, notes)),
      days: daysGrid([...days, dayRow("S:d1", "2026-09-26", "alpha 改修", "土曜作業", 60)]),
    });
    expect(m.columns[0].date).toBe("2026-09-26");
    expect(findCell(m, T1.id, "2026-09-26")!.sources.map((s) => s.id)).toEqual(["d1"]);
  });
  it("an unparsable started_at / interval / note ts is skipped, never crashes the page (like server wall.ts)", () => {
    const bad = [
      { ...session("b1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id }), started_at: "garbage", active_intervals: null },
      { ...session("b2", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id }), started_at: "garbage", minutes_override: 30 },
      { ...session("b3", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id }), active_intervals: [["nope", "nope"]] as [string, string][] },
    ];
    const m = build({ timeline: weekTl("2026-W40", "2026-09-28", [...sessions, ...bad], [...notes, note("n9", "not a time", { task_id: T2.id, minutes: 5 })]) });
    expect(m.rows.map((r) => [r.taskId, r.minutes])).toEqual([["T20260915-01", 205], ["T20260901-01", 90], [null, 25]]);
  });
  it("a row the timeline lacks: its title when exactly one 案件 has it, else 未割当; a linked-to-nothing session is 未割当", () => {
    const m = build();
    const fri = findCell(m, T2.id, "2026-10-02")!;
    expect(fri.entries.map((e) => [e.rowKey, e.source])).toEqual([["S:h1", null]]);
    expect(fri.sources).toEqual([]);
    expect(findCell(m, null, "2026-10-02")!.entries.map((e) => e.rowKey)).toEqual(["S:u1"]);
    expect(findCell(m, null, "2026-09-29")!.entries.map((e) => e.rowKey)).toEqual(["S:x1"]);
    expect(findCell(m, null, "2026-09-29")!.sources.map((s) => s.id)).toEqual(["x1"]);
    const twin = build({ tasks: [...TASKS, task("T20260920-01", "beta 調査")] });
    expect(findCell(twin, null, "2026-10-02")!.entries.map((e) => e.rowKey)).toEqual(["S:h1", "S:u1"]);
  });
  it("group review A5: a row the server titled 未割当 stays 未割当 even when a 案件 bears that title", () => {
    const m = build({ tasks: [...TASKS, task("T20260925-01", UN)] });
    expect(findCell(m, null, "2026-10-02")!.entries.map((e) => e.rowKey)).toEqual(["S:u1"]);
    expect(m.rows.some((r) => r.taskId === "T20260925-01")).toBe(false);
  });
  it("group review B3: minutes typed over with text are kept as that text (and count as 0)", () => {
    const m = build({ days: daysGrid(days.map((r) => (r.row_key === "S:a2" ? edited(r, "minutes", "半日") : r))) });
    const c = findCell(m, T1.id, "2026-09-28")!;
    expect(c.entries.map((e) => [e.minutes, e.minutesText])).toEqual([[60, null], [0, "半日"]]);
    expect([c.minutes, c.raw]).toEqual([60, "半日"]);
    expect(findCell(m, T1.id, "2026-09-29")!.raw).toBeNull();
  });
  it("totals per day include 未割当; the hand-edited entry flags its cell", () => {
    const m = build({ days: daysGrid(days.map((r) => (r.row_key === "S:a2" ? edited(r, "text", "書き直し") : r))) });
    expect(m.columns.map((c) => c.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(m.dayTotals).toEqual([90, 60, 90, 60, 20]);
    expect(m.total).toBe(320);
    expect(findCell(m, T1.id, "2026-09-28")).toMatchObject({ overridden: true });
    expect(findCell(m, T1.id, "2026-09-28")!.entries.map((e) => e.overridden)).toEqual([false, true]);
  });
  it("pending without this week's timeline (none yet, or the previous week's kept): rows fall back to titles", () => {
    for (const timeline of [null, undefined, { ...tl, week: "2026-W39" }]) {
      const m = build({ timeline });
      expect(m.pending).toBe(true);
      expect(findCell(m, T1.id, "2026-09-28")!.entries.map((e) => [e.rowKey, e.source])).toEqual([["S:a1", null], ["S:a2", null]]);
      expect(findCell(m, T1.id, "2026-09-28")!.sources).toEqual([]);
    }
  });
});

describe("matrixOf", () => {
  it("reads the preview's own week / sheets; null without a 日別作業 sheet", () => {
    const p = preview("2026-W39", { tasks: [taskRow(T1, 1)], days: [dayRow("S:z1", "2026-09-21", "alpha 改修", "x", 60)] });
    const m = matrixOf(p, null, TASKS, "2026-10-02")!;
    expect(m).toMatchObject({ week: "2026-W39", total: 60, pending: true });
    expect(m.columns[0]).toMatchObject({ date: "2026-09-21", today: false });
    expect(m.rows[0].thinking).toBe("まず影響範囲");
    expect(matrixOf({ ...p, sheets: p.sheets.filter((g) => g.key !== "days") }, null, TASKS, "2026-10-02")).toBeNull();
  });
});
