// server/test/report-labels.test.ts
import { describe, expect, it } from "vitest";
import { LABELS, countText } from "../src/report/labels";
import { layoutSheets } from "../src/report/layout";
import { TEMPLATES } from "../src/report/templates";
import type { DayRow, TaskLike, WeekData } from "../src/report/types";
import { UNASSIGNED_LABEL } from "../src/report/weekly";

const DATES = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const task: TaskLike = { id: "T1", requester: "田中", project: "社内", title: "帳票修正", status: "hold",
  received_at: "2026-09-28", done_at: null, thinking: "", deliverables: ["a.xlsx"], hours_manual: null };
const days: DayRow[] = [
  { date: "2026-09-28", task_id: "T1", task_title: "帳票修正", text: "作業", minutes: 30, source: { kind: "session", id: "S1" } },
  { date: "2026-09-28", task_id: null, task_title: UNASSIGNED_LABEL, text: "調査", minutes: 20, source: { kind: "note", id: "N1" } },
];
const data: WeekData = {
  tasks: [{ task, hours: 1, week_minutes: 50, sessions: [] }], days,
  summary: { week: "2026-W40", week_start: DATES[0], week_end: DATES[6], new: 1, done: 0, ongoing: 1,
    by_requester: [["田中", 1]], total_hours: 0.83, unassigned_hours: 0.33 },
  dates: DATES, day_minutes: DATES.map((d) => [d, d === "2026-09-28" ? 50 : 0]), day_sum_minutes: [], day_buckets: {},
  unassigned_sessions: 0, unassigned_minutes: 0,
};
const texts = (L?: Parameters<typeof layoutSheets>[2]) => JSON.stringify(layoutSheets(data, TEMPLATES.weekly, L));

describe("report labels", () => {
  it("ja labels reproduce today's sheets exactly", () => {
    expect(texts(LABELS.ja)).toBe(texts(undefined));
  });

  it("en: sheet names, headers, status, summary labels, 合計 and the unassigned row are English", () => {
    const g = layoutSheets(data, TEMPLATES.weekly, LABELS.en);
    expect(g.map((s) => s.title)).toEqual(["Summary", "Tasks", "Daily work", "Deliverables", "Hours"]);
    const tasks = g.find((s) => s.key === "tasks")!;
    expect(tasks.columns.map((c) => c.header)).toEqual(
      ["Requester", "Task", "Project", "Status", "Received", "Done", "Total (h)", "This week (h)", "Deliverables", "Notes"]);
    expect(tasks.rows[0].cells.find((c) => c.column === "status")!.value).toBe("On hold");
    const summary = g.find((s) => s.key === "summary")!;
    expect(summary.rows.map((r) => r.cells[0].value).slice(0, 6))
      .toEqual(["Week", "New", "Done", "Ongoing", "Total hours (h)", "Unassigned hours (h)"]);
    const daysG = g.find((s) => s.key === "days")!;
    expect(daysG.rows.map((r) => r.cells[1].value)).toContain("Other / research");
    expect(g.find((s) => s.key === "hours")!.rows.at(-1)!.cells[0].value).toBe("Total");
  });

  it("zh: no Japanese-only label survives", () => {
    const all = texts(LABELS.zh);
    for (const ja of ["サマリー", "案件一覧", "日別作業", "稼働", "対応中", "その他・調査", "合計", "総工数", "受領日"]) {
      expect(all).not.toContain(ja);
    }
  });

  it("every language has every key", () => {
    const shape = (o: object): string[] => Object.entries(o).flatMap(([k, v]) =>
      typeof v === "object" && v !== null && !Array.isArray(v) ? shape(v).map((s) => `${k}.${s}`) : [k]);
    expect(shape(LABELS.zh)).toEqual(shape(LABELS.ja));
    expect(shape(LABELS.en)).toEqual(shape(LABELS.ja));
  });

  it("en count forms: singular at 1, plural otherwise (ja/zh repeat one form)", () => {
    const P = LABELS.en.pdf;
    expect([countText(P.others, 1), countText(P.others, 2)]).toEqual(["1 other", "2 others"]);
    expect([countText(P.taskCount, 1), countText(P.taskCount, 2)]).toEqual(["1 project", "2 projects"]);
    expect([countText(P.daysWorked, 1), countText(P.daysWorked, 2)]).toEqual(["1 day worked", "2 days worked"]);
    expect(countText(LABELS.ja.pdf.others, 1)).toBe(countText(LABELS.ja.pdf.others, 2).replace("2", "1"));
  });
});
