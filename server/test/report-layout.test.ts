import { describe, expect, it } from "vitest";
import { layoutSheets } from "../src/report/layout";
import { pyLen } from "../src/report/pystr";
import { TEMPLATES } from "../src/report/templates";
import type { DayRow, Grid, GridRow, SessionLite, TaskLike, TaskRow, WeekData, WeekSummary } from "../src/report/types";

// layoutSheets is the "what to compute" half of src/worklog/report/xlsx.py (the _write_* helpers).
// Everything here is hand-built WeekData, so no D1 and no week building is involved.

const task = (id: string, over: Partial<TaskLike> = {}): TaskLike => ({
  id, requester: "田中", project: "社内", title: `件名 ${id}`, status: "open",
  received_at: "2026-09-21", done_at: null, thinking: "", deliverables: [], hours_manual: null, ...over,
});
const taskRow = (t: TaskLike, over: Partial<TaskRow> = {}): TaskRow => ({ task: t, hours: 1, week_minutes: 60, sessions: [], ...over });
const day = (over: Partial<DayRow> = {}): DayRow => ({
  date: "2026-09-22", task_id: "T1", task_title: "帳票修正", text: "作業", minutes: 30,
  source: { kind: "session", id: "S1" }, ...over,
});
const summary = (over: Partial<WeekSummary> = {}): WeekSummary => ({
  week: "2026-W39", week_start: "2026-09-21", week_end: "2026-09-27",
  new: 2, done: 1, ongoing: 3, by_requester: [["田中", 1], ["佐藤", 2]],
  total_hours: 7.5, unassigned_hours: 0.5, ...over,
});
const DATES = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
const weekData = (over: Partial<WeekData> = {}): WeekData => ({
  tasks: [], days: [], summary: summary(), dates: DATES, day_minutes: DATES.map((d) => [d, 0]), day_sum_minutes: [], day_buckets: {},
  unassigned_sessions: 0, unassigned_minutes: 0, ...over,
});

const sheet = (grids: Grid[], key: string) => grids.find((g) => g.key === key)!;
const values = (row: GridRow) => row.cells.map((c) => c.value);
const kinds = (row: GridRow) => row.cells.map((c) => c.kind);
const bolds = (row: GridRow) => row.cells.map((c) => c.bold === true);

// The five days below span two dates and three tasks, and are deliberately out of date order.
const DAYS: DayRow[] = [
  day({ text: "A", minutes: 30, source: { kind: "session", id: "S1" } }),
  day({ text: "", minutes: 15, source: { kind: "note", id: "N1" } }),
  day({ text: "B", minutes: 5, source: { kind: "session", id: "S2" } }),
  day({ task_id: "T2", task_title: "在庫調査", text: "C", minutes: 60, source: { kind: "session", id: "S3" } }),
  day({ date: "2026-09-21", task_id: null, task_title: "その他・調査", text: "D", minutes: 20, source: { kind: "note", id: "N2" } }),
];

describe("layoutSheets", () => {
  it("emits only the enabled sheets, in the template's order", () => {
    const data = weekData();
    expect(layoutSheets(data, TEMPLATES.weekly).map((g) => [g.key, g.title])).toEqual([
      ["summary", "サマリー"], ["tasks", "案件一覧"], ["days", "日別作業"], ["deliverables", "成果物"], ["hours", "稼働"],
    ]);
    const noHours = { ...TEMPLATES.weekly, hours: { enabled: false, title: "稼働" } };
    expect(layoutSheets(data, noHours).map((g) => g.key)).toEqual(["summary", "tasks", "days", "deliverables"]);
  });

  describe("summary sheet", () => {
    const grid = () => sheet(layoutSheets(weekData(), TEMPLATES.weekly), "summary");

    it("has no header row and is not frozen", () => {
      expect(grid().freeze_header).toBe(false);
      expect(grid().columns).toEqual([{ key: "label", header: null }, { key: "value", header: null }]);
    });

    it("lays out six labelled rows, a blank row, a header row and one row per requester", () => {
      const g = grid();
      expect(g.rows.map((r) => r.row_key)).toEqual([
        "week", "new", "done", "ongoing", "total_hours", "unassigned_hours", "blank", "req_header",
        "req:田中", "req:佐藤",
      ]);
      expect(g.rows.map(values)).toEqual([
        ["週", "2026-W39"], ["新規", 2], ["完了", 1], ["継続", 3], ["総工数(h)", 7.5],
        ["未割当工数(h)", 0.5], [null, null], ["依頼元", "件数"], ["田中", 1], ["佐藤", 2],
      ]);
    });

    it("bolds the six labels and both header cells, and nothing else", () => {
      expect(grid().rows.map(bolds)).toEqual([
        [true, false], [true, false], [true, false], [true, false], [true, false], [true, false],
        [false, false], [true, true], [false, false], [false, false],
      ]);
    });

    it("types the counts as int and the hours as float", () => {
      expect(grid().rows.map(kinds)).toEqual([
        ["text", "text"], ["text", "int"], ["text", "int"], ["text", "int"], ["text", "float"],
        ["text", "float"], ["text", "text"], ["text", "text"], ["text", "int"], ["text", "int"],
      ]);
    });

    it("keeps by_requester in first-occurrence order rather than sorting it", () => {
      const data = weekData({ summary: summary({ by_requester: [["山田", 3], ["安藤", 1]] }) });
      const g = sheet(layoutSheets(data, TEMPLATES.weekly), "summary");
      expect(g.rows.slice(8).map(values)).toEqual([["山田", 3], ["安藤", 1]]);
    });

    it("falls back to the date range when the week label is empty, like xlsx.py", () => {
      const data = weekData({ summary: summary({ week: "" }) });
      const g = sheet(layoutSheets(data, TEMPLATES.weekly), "summary");
      expect(values(g.rows[0])).toEqual(["週", "2026-09-21 - 2026-09-27"]);
    });

    it("carries no sessions", () => {
      expect(grid().rows.some((r) => r.sessions !== undefined)).toBe(false);
    });
  });

  describe("tasks sheet", () => {
    const sessions: SessionLite[] = [
      { id: "S1", started_at: "2026-09-22T10:00:00Z", summary: "作業", minutes: 30, task_id: "T1" },
    ];
    const data = weekData({
      tasks: [
        taskRow(task("T1", {
          title: "帳票修正", status: "done", received_at: "2026-09-21", done_at: "2026-09-24",
          deliverables: ["docs/a.xlsx", "docs/b.pdf"], thinking: "備考", requester: "佐藤", project: "経理",
        }), { hours: 2.5, week_minutes: 75, sessions }),
        taskRow(task("T2", { title: "在庫調査", status: "hold" }), { hours: 0, week_minutes: 0 }),
        taskRow(task("T3", { status: "wontfix" as TaskLike["status"] })),
      ],
    });
    const grid = () => sheet(layoutSheets(data, TEMPLATES.weekly), "tasks");

    it("takes its columns and headers from the template and freezes the header row", () => {
      const g = grid();
      expect(g.freeze_header).toBe(true);
      expect(g.columns).toEqual([
        { key: "requester", header: "依頼元" }, { key: "title", header: "案件名" },
        { key: "project", header: "プロジェクト" }, { key: "status", header: "状態" },
        { key: "received_at", header: "受領日" }, { key: "done_at", header: "完了日" },
        { key: "hours", header: "累計(h)" }, { key: "week_hours", header: "今週(h)" },
        { key: "deliverables", header: "成果物" },
        { key: "thinking", header: "備考" },
      ]);
    });

    it("writes one row per task, keyed by task id, with the deliverables joined by a comma", () => {
      const g = grid();
      expect(g.rows.map((r) => r.row_key)).toEqual(["T1", "T2", "T3"]);
      expect(values(g.rows[0])).toEqual([
        "佐藤", "帳票修正", "経理", "完了", "2026-09-21", "2026-09-24", 2.5, 1.25, "docs/a.xlsx, docs/b.pdf", "備考",
      ]);
    });

    it("maps the status labels and passes an unknown status through", () => {
      const status = grid().rows.map((r) => r.cells[3].value);
      expect(status).toEqual(["完了", "保留", "wontfix"]);
    });

    it("leaves a null done_at as a null date cell", () => {
      const doneAt = grid().rows[1].cells[5];
      expect(doneAt).toEqual({ column: "done_at", value: null, kind: "date" });
    });

    it("types the dates as date and the hours as float", () => {
      expect(kinds(grid().rows[0])).toEqual([
        "text", "text", "text", "text", "date", "date", "float", "float", "text", "text",
      ]);
    });

    it("writes 今週(h) from the week's wall-clock minutes, rounded to two places", () => {
      const g = sheet(layoutSheets(weekData({
        tasks: [taskRow(task("T1"), { week_minutes: 50 }), taskRow(task("T2"), { week_minutes: 0 })],
      }), TEMPLATES.weekly), "tasks");
      expect(g.rows.map((r) => r.cells.find((c) => c.column === "week_hours")!.value)).toEqual([0.83, 0]);
    });

    it("carries the task's sessions on the row", () => {
      const g = grid();
      expect(g.rows[0].sessions).toEqual(sessions);
      expect(g.rows[1].sessions).toEqual([]);
    });
  });

  describe("days sheet", () => {
    const data = weekData({ days: DAYS });

    it("has the four day columns", () => {
      expect(sheet(layoutSheets(data, TEMPLATES.weekly), "days").columns).toEqual([
        { key: "date", header: "日付" }, { key: "task", header: "案件" },
        { key: "text", header: "作業内容" }, { key: "minutes", header: "分" },
      ]);
    });

    it("types the cells and carries no sessions", () => {
      const g = sheet(layoutSheets(data, TEMPLATES.weekly), "days");
      expect(kinds(g.rows[0])).toEqual(["date", "text", "text", "int"]);
      expect(g.rows.some((r) => r.sessions !== undefined)).toBe(false);
    });

    it("writes one row per day row in input order, keyed by source", () => {
      const g = sheet(layoutSheets(data, TEMPLATES.weekly), "days");
      expect(g.rows.map((r) => r.row_key)).toEqual(["S:S1", "N:N1", "S:S2", "S:S3", "N:N2"]);
      expect(g.rows.map(values)).toEqual([
        ["2026-09-22", "帳票修正", "A", 30],
        ["2026-09-22", "帳票修正", "", 15],
        ["2026-09-22", "帳票修正", "B", 5],
        ["2026-09-22", "在庫調査", "C", 60],
        ["2026-09-21", "その他・調査", "D", 20],
      ]);
    });
  });

  describe("deliverables sheet", () => {
    const data = weekData({
      tasks: [
        taskRow(task("T1", { title: "帳票修正", done_at: "2026-09-24", deliverables: ["docs/a.xlsx", "docs/b.pdf"] })),
        taskRow(task("T2", { title: "在庫調査" })),
        taskRow(task("T3", { title: "棚卸", deliverables: ["c.png"] })),
      ],
    });
    const grid = () => sheet(layoutSheets(data, TEMPLATES.weekly), "deliverables");

    it("writes one row per deliverable, keyed by task id and index", () => {
      const g = grid();
      expect(g.columns).toEqual([
        { key: "title", header: "案件" }, { key: "path", header: "成果物パス" },
        { key: "done_at", header: "完了日" },
      ]);
      expect(g.rows.map((r) => r.row_key)).toEqual(["T1|0", "T1|1", "T3|0"]);
      expect(g.rows.map(values)).toEqual([
        ["帳票修正", "docs/a.xlsx", "2026-09-24"],
        ["帳票修正", "docs/b.pdf", "2026-09-24"],
        ["棚卸", "c.png", null],
      ]);
      expect(kinds(g.rows[0])).toEqual(["text", "text", "date"]);
    });

    const auto = (key: string, label: string, date: string, kind: "file" | "artifact" = "file") => ({ kind, key, label, date });
    const withAuto = (items: ReturnType<typeof auto>[]) => sheet(layoutSheets(weekData({ tasks: [
      taskRow(task("T1", { title: "帳票修正", done_at: "2026-09-24", deliverables: ["docs/a.xlsx"] }), { auto: items }),
    ] }), TEMPLATES.weekly), "deliverables");

    it("lists the week's automatic ones after the hand-picked ones, dated by when they were written, keyed by what they are", () => {
      const g = withAuto([auto("/w/成果物/x.md", "成果物/x.md", "2026-09-22"), auto("https://claude.ai/artifact/A", "週報ページ", "2026-09-23", "artifact")]);
      expect(g.rows.map(values)).toEqual([
        ["帳票修正", "docs/a.xlsx", "2026-09-24"],
        ["帳票修正", "成果物/x.md", "2026-09-22"],
        ["帳票修正", "週報ページ", "2026-09-23"],
      ]);
      const keys = g.rows.map((r) => r.row_key);
      expect(keys[0]).toBe("T1|0");
      expect(keys[1]).toMatch(/^T1\|d:[0-9a-f]{8}$/);
      expect(new Set(keys).size).toBe(3);
      // The key does not move when another automatic one comes or goes, so a hand edit stays on its row.
      const alone = withAuto([auto("https://claude.ai/artifact/A", "週報ページ", "2026-09-23", "artifact")]);
      expect(alone.rows[1].row_key).toBe(keys[2]);
      // …nor with the mount the file was read through.
      expect(withAuto([auto("/Volumes/X/w/成果物/x.md", "成果物/x.md", "2026-09-22")]).rows[1].row_key).toBe(keys[1]);
    });

    it("the tasks sheet's 成果物 column names the automatic ones too", () => {
      const g = sheet(layoutSheets(weekData({ tasks: [
        taskRow(task("T1", { deliverables: ["docs/a.xlsx"] }), { auto: [auto("/w/b.md", "b.md", "2026-09-22")] }),
      ] }), TEMPLATES.weekly), "tasks");
      expect(g.rows[0].cells.find((c) => c.column === "deliverables")!.value).toBe("docs/a.xlsx, b.md");
    });
  });

  describe("hours sheet", () => {
    // DAYS' minutes per date, as weekly.ts's wall clock would give them when nothing runs in parallel.
    const minutes: Record<string, number> = { "2026-09-21": 20, "2026-09-22": 110 };
    const grid = () => sheet(layoutSheets(weekData({
      days: DAYS, day_minutes: DATES.map((d) => [d, minutes[d] ?? 0]),
    }), TEMPLATES.weekly), "hours");

    it("lists the worked days of day_minutes in date order and rounds the hours to two places", () => {
      const g = grid();
      expect(g.columns).toEqual([{ key: "date", header: "日付" }, { key: "hours", header: "稼働時間(h)" }]);
      expect(g.rows.map((r) => r.row_key)).toEqual(["2026-09-21", "2026-09-22", "total"]);
      expect(g.rows.map(values)).toEqual([
        ["2026-09-21", 0.33], ["2026-09-22", 1.83], ["合計", 2.17],
      ]);
    });

    it("bolds the total label and rounds the total from the raw minutes, not from the rounded rows", () => {
      const g = grid();
      const total = g.rows[2];
      expect(bolds(total)).toEqual([true, false]);
      expect(kinds(total)).toEqual(["text", "float"]);
      expect(total.cells[1].value).toBe(2.17); // 0.33 + 1.83 would be 2.16
      expect(kinds(g.rows[0])).toEqual(["date", "float"]);
    });

    it("reads the wall-clock day_minutes, not the sum of the day rows", () => {
      // Two parallel sessions: the day rows add to 110 on 9/22, the wall clock says 80.
      const g = sheet(layoutSheets(weekData({
        days: DAYS, day_minutes: DATES.map((d) => [d, d === "2026-09-22" ? 80 : 0]),
      }), TEMPLATES.weekly), "hours");
      expect(g.rows.map(values)).toEqual([["2026-09-22", 1.33], ["合計", 1.33]]);
    });

    it("still writes a zero total when there are no days", () => {
      const g = sheet(layoutSheets(weekData(), TEMPLATES.weekly), "hours");
      expect(g.rows.map(values)).toEqual([["合計", 0]]);
    });
  });
});

describe("pyLen", () => {
  it("counts code points for text", () => {
    expect(pyLen("帳票修正", "text")).toBe(4);
    expect(pyLen("", "text")).toBe(0);
    expect(pyLen("𠮷野家", "text")).toBe(3); // one astral code point, two UTF-16 units
  });

  it("counts an int the way str() prints it", () => {
    expect(pyLen(2, "int")).toBe(1);
    expect(pyLen(120, "int")).toBe(3);
  });

  it("counts a whole float as Python's trailing .0", () => {
    expect(pyLen(2, "float")).toBe(3);   // str(2.0) == "2.0"
    expect(pyLen(2.25, "float")).toBe(4);
    expect(pyLen(0, "float")).toBe(3);   // str(0.0) == "0.0"
  });

  it("counts a date as its ISO form", () => {
    expect(pyLen("2026-09-22", "date")).toBe(10);
  });

  it("counts null as zero, because Python skips a None cell", () => {
    expect(pyLen(null, "text")).toBe(0);
    expect(pyLen(null, "date")).toBe(0);
    expect(pyLen(null, "float")).toBe(0);
  });
});
