// server/test/report-digest-context.test.ts
import { describe, expect, it } from "vitest";
import { capLines, digestInputs, SYSTEM_DAY, SYSTEM_WEEK } from "../src/report/digests";
import type { DigestContext } from "../src/report/digest-context";
import type { TaskLike, WeekData } from "../src/report/types";

const DATES = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
const task = (id: string, title: string, over: Partial<TaskLike> = {}): TaskLike => ({ id, requester: "田中", project: "", title,
  status: "open", received_at: "2026-09-01", done_at: null, thinking: "", deliverables: [], hours_manual: null, ...over });
const data: WeekData = {
  tasks: [
    { task: task("T1", "ATLAS 受注管理", { thinking: "10月中旬に全サブプロジェクト完了を目指す" }), hours: 40, week_minutes: 600, sessions: [] },
    { task: task("T2", "社内勉強会"), hours: 1, week_minutes: 30, sessions: [] },
  ],
  days: [
    { date: "2026-10-05", task_id: "T1", task_title: "ATLAS 受注管理", text: "runner を完成", minutes: 300, source: { kind: "session", id: "S1" } },
    { date: "2026-10-05", task_id: "T2", task_title: "社内勉強会", text: "資料を読んだ", minutes: 30, source: { kind: "session", id: "S2" } },
  ],
  summary: { week: "2026-W41", week_start: DATES[0], week_end: DATES[6], new: 0, done: 0, ongoing: 2, by_requester: [], total_hours: 10.5, unassigned_hours: 0 },
  dates: DATES, day_minutes: DATES.map((d) => [d, d === "2026-10-05" ? 330 : 0]), day_sum_minutes: [], day_buckets: {}, unassigned_sessions: 0, unassigned_minutes: 0,
};
const ctx: DigestContext = {
  plans: [{ task_id: "T1", horizon: "near", text: "サブプロジェクト B を完了", status: "active" }],
  dayPlans: [{ date: "2026-10-05", text: "runner 仕上げ", detail: "", status: "done", progress: "完成", task_ids: ["T1"] }],
  lastWeek: "■ ATLAS 受注管理：A を完了",
};

describe("digest inputs (S2c)", () => {
  it("a day input carries the task, its note, its plan goal, the day's plan judgement and the work", () => {
    const { days } = digestInputs(data, ctx);
    const d = days["2026-10-05"];
    expect(d).toContain("ATLAS 受注管理");
    expect(d).toContain("10月中旬に全サブプロジェクト完了を目指す");
    expect(d).toContain("サブプロジェクト B を完了");
    expect(d).toContain("runner 仕上げ");
    expect(d).toContain("runner を完成");
    expect(Object.keys(days)).toEqual(["2026-10-05"]);   // only worked days
  });

  it("the week input carries last week's summary, per-task week hours (no 累計), and the day lines", () => {
    const { weekOf } = digestInputs(data, ctx);
    const w = weekOf({ "2026-10-05": "■ ATLAS 受注管理：runner 完成" });
    expect(w).toContain("■ ATLAS 受注管理：A を完了");
    expect(w).toMatch(/ATLAS 受注管理.*今週 10\.0h/);
    expect(w).not.toContain("累計");   // as of the week's end: no all-history figure
    expect(w).toContain("2026-10-05：■ ATLAS 受注管理：runner 完成");
  });

  it("the task line carries 受領 and its state as of the week's end; no 累計 in the day input", () => {
    const at = (done_at: string | null, status: "open" | "done" = "done") => ({ ...data,
      tasks: [{ ...data.tasks[0], task: { ...data.tasks[0].task, status, done_at } }, data.tasks[1]] });
    const day = (d: WeekData) => digestInputs(d, ctx).days["2026-10-05"];
    expect(day(data)).toContain("受領：2026-09-01");
    expect(day(data)).not.toContain("累計");
    expect(day(at("2026-10-09"))).toMatch(/ATLAS 受注管理（[^）]*状態：完了/);    // done on the week's last day
    expect(day(at("2026-10-10"))).toMatch(/ATLAS 受注管理（[^）]*状態：対応中/);  // done after the week
  });

  it("a day plan's detail is in its line, cut like the 備考", () => {
    const withDetail = (detail: string) => digestInputs(data, { ...ctx, dayPlans: [{ ...ctx.dayPlans[0], detail }] }).days["2026-10-05"];
    expect(withDetail("domain A と B")).toMatch(/- runner 仕上げ.*domain A と B.*達成/);
    const long = withDetail("か".repeat(400));
    expect(long).toContain("か".repeat(300));
    expect(long).not.toContain("か".repeat(301));
  });

  it("weekOf leaves out 先週のまとめ when there is no last week", () => {
    const w = digestInputs(data, { ...ctx, lastWeek: null }).weekOf({ "2026-10-05": "■ x" });
    expect(w).not.toContain("先週のまとめ");
    expect(w).toContain("## 今週の案件");
  });

  it("is stable: same data and context give the same text", () => {
    expect(digestInputs(data, ctx).days).toEqual(digestInputs(data, ctx).days);
  });

  it("without plans, day plans or last week the sections are left out, not empty headings", () => {
    const d = digestInputs(data, { plans: [], dayPlans: [], lastWeek: null }).days["2026-10-05"];
    expect(d).not.toContain("計画");
    expect(d).not.toContain("予定");
  });

  it("prompts ask for per-task lines and plain words", () => {
    for (const s of [SYSTEM_DAY, SYSTEM_WEEK]) {
      expect(s).toContain("■ 案件名：");
      expect(s).toContain("技術に詳しくない人");
      expect(s).toContain("pdf_lines");
    }
    expect(SYSTEM_WEEK).not.toContain("累計");   // R13: the week input carries no all-history figure
    expect(SYSTEM_WEEK).toContain("今週の時間");
    expect(SYSTEM_WEEK).toContain("pdf_lines の最後にも必ず「■ その他：」");   // R16
    for (const s of [SYSTEM_DAY, SYSTEM_WEEK]) expect(s).toContain("理由があればその理由も添える");
  });

  it("capLines keeps whole lines under the limit", () => {
    expect(capLines(["あいう", "えお"], 10)).toBe("あいう\nえお");
    expect(capLines(["あいう", "えおかきく"], 6)).toBe("あいう");
    expect(capLines(["あいうえおかきくけこ"], 5)).toBe("あいうえ…");
  });
});
