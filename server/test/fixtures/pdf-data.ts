// server/test/fixtures/pdf-data.ts
// PdfData shapes for the HTML tests and scripts/pdf-check.mjs (one A4 page each). en-long has long titles and
// 12 tasks but fits without any fit step; en-overflow / en-mid / en-extreme carry repeated sentences so the fit steps
// (fit1..fit3, trim, clamp) really run (pdf-check.mjs pins the step each one ends at).
import type { PdfData } from "../../src/report/pdf/data";

const DATES = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const DATES_W53 = ["2026-12-26", "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"];
const day = (i: number, minutes: number, text: string | null) => ({ date: DATES[i], minutes, text: text ? [text] : [] });

const JA_DAYS = [
  day(0, 90, "作業記録システムの UI 文言を修正した。"), day(1, 0, null),
  day(2, 510, "ATLAS の API 3.1 検証と ORION-A 設定を修正。"), day(3, 600, "受注集計 worker を完成し検証段階も完了。"),
  day(4, 450, "サブプロジェクト B を実装し UI を改善。"), day(5, 420, "在庫 API 完了、DocMerge v2.30.1 公開。"),
  day(6, 528, "入力・出力を完了し BEACON 提案スライドを改訂。"),
];
const JA_TASKS = [
  ["ATLAS データ変換システム", "Kevin Liu", 600], ["ATLAS 受注管理サービス", "Kevin Liu", 480], ["LEDGER 基盤開発", "Team", 420],
  ["作業記録システム", "社内", 360], ["BEACON：AI 活用提案", "田中先生", 300], ["HARBOR2 帳票データマッピング", "Alex Wang", 210],
  ["DocMerge Tool", "Mia Chen", 126], ["その他・調査", "", 60], ["帳票テンプレート", "田中", 24], ["社内勉強会", "社内", 18],
  ["見積確認", "佐藤", 12], ["環境構築", "社内", 6],
].map(([title, requester, minutes]) => ({ title: title as string, requester: requester as string, minutes: minutes as number }));
const total = (ts: { minutes: number }[]) => ts.reduce((a, t) => a + t.minutes, 0);

const LONG = "Completed the HARBOR2 configuration export cleanup and released DocMerge Tool v2.30.1 to the team.";
const rep = (n: number) => LONG.repeat(Math.ceil(n / LONG.length)).slice(0, n).trim();
const longDays = (n: number) => DATES_W53.map((date) => ({ date, minutes: 600, text: [rep(n)] }));
const longTasks = JA_TASKS.map((t, i) => ({ ...t, title: `${i}. A deliberately long English project title that has to be cut with an ellipsis` }));
const overflow = (summary: number, dayChars: number): PdfData => ({ week: "2026-W53", lang: "en", issued: "2027-01-01",
  name: "Jordan Smith", summary: [rep(summary)], days: longDays(dayChars), tasks: longTasks, taskCount: 12, totalMinutes: total(JA_TASKS) });
export const PDF_FIXTURES: Record<string, PdfData> = {
  "ja-w40": { week: "2026-W40", lang: "ja", issued: "2026-10-08", name: "Jordan Smith",
    summary: ["ATLAS と LEDGER を軸に進め、受注集計 A を完了し B に着手。HARBOR2 は 8 画面を完了。"],
    // 累計 beside the wall clock (user 10/9): parallel sessions make it larger on the busy days, equal on the rest
    days: JA_DAYS.map((d, i) => ({ ...d, sum: d.minutes * [1, 1, 2.1, 1.6, 1, 1.4, 1.9][i] })), tasks: JA_TASKS, taskCount: 11,
    totalMinutes: total(JA_TASKS), sumMinutes: total(JA_TASKS) * 1.6 },
  zh: { week: "2026-W40", lang: "zh", issued: "2026-10-08", name: "李 明",
    summary: ["以 ATLAS 和 LEDGER 为主推进，订单汇总 A 完成并开始 B。HARBOR2 完成 8 个画面。"],
    days: JA_DAYS.map((d) => ({ ...d, text: d.text.length ? ["完成了数据校验阶段，修复了设置页的显示问题。"] : [] })),
    tasks: JA_TASKS.map((t, i) => ({ ...t, title: i === 7 ? "其他・调研" : `案件 ${t.title}` })), taskCount: 11, totalMinutes: total(JA_TASKS) },
  "en-long": { week: "2026-W53", lang: "en", issued: "2027-01-01", name: "Jordan Smith",
    summary: ["Development centred on the ATLAS conversion system and the LEDGER platform; report-builder finished A and began B."],
    days: DATES_W53.map((date) => ({ date, minutes: 600, text: [LONG] })),
    tasks: JA_TASKS.map((t, i) => ({ ...t, title: `${i}. A deliberately long English project title that has to be cut with an ellipsis` })),
    taskCount: 12, totalMinutes: total(JA_TASKS) },
  empty: { week: "2026-W45", lang: "ja", issued: "2026-10-08", name: "Jordan Smith", summary: [],
    days: DATES.map((_, i) => day(i, 0, null)), tasks: [], taskCount: 0, totalMinutes: 0 },
  // A hand-edited digest can be 800 chars with no line break: one block that only the per-block line cap bounds (R5).
  "en-single-line": overflow(800, 400),
  "ja-sparse": { week: "2026-W40", lang: "ja", issued: "2026-10-08", name: "Jordan Smith",
    summary: ["ATLAS の受注集計を進め、API 3.1 の検証を終えた。"],
    days: [day(0, 0, null), day(1, 0, null), day(2, 300, "ATLAS の API 3.1 検証。"), day(3, 240, "受注集計 worker を整えた。"), day(4, 0, null),
      day(5, 180, "在庫 API を完了。"), day(6, 0, null)],
    tasks: JA_TASKS.slice(0, 2).map((t, i) => ({ ...t, minutes: [420, 300][i] })), taskCount: 2, totalMinutes: 720 },
  "ja-5lines": { week: "2026-W40", lang: "ja", issued: "2026-10-08", name: "Jordan Smith",
    summary: ["■ ATLAS：データ変換の API 3.1 検証を終え、ORION-A の設定を直した。", "■ LEDGER：基盤開発を続け、検証段階を完了した。",
      "■ 作業記録システム：UI の文言を整えて公開した。", "■ BEACON：AI 活用提案のスライドを改訂した。", "■ HARBOR2：12 画面分の帳票データマッピングを完了。",
      "■ その他：DocMerge Tool と社内勉強会など小さな作業。"],
    days: JA_DAYS.map((d) => ({ ...d, text: d.text.slice(0, 1) })), tasks: JA_TASKS, taskCount: 11, totalMinutes: total(JA_TASKS) },
  // A hand edit sets pdf_text NULL, so the PDF falls back to the multi-line web text: 8 ■ blocks of ~60 chars, 3–4
  // lines a day long enough to wrap, 12 tasks — the clamp step's worst case (final review Important 1).
  "hand-edited": { week: "2026-W40", lang: "ja", issued: "2026-10-08", name: "Jordan Smith",
    summary: Array.from({ length: 8 }, (_, i) => `■ 案件${i + 1}：データ変換の検証を終え、設定画面の表示を直し、手順書を整理して関係者に共有した。来週は残りの確認を進める予定。`),
    days: JA_DAYS.map((d, i) => ({ ...d, minutes: d.minutes || 120, text: Array.from({ length: 3 + (i % 2) },
      (_, j) => `${j + 1}. ATLAS の API 3.1 検証を進め、ORION-A の設定を直して関係者に共有した。あわせて設定画面の表示崩れを直し、手順書の該当箇所を書き直して共有した。`) })),
    tasks: JA_TASKS, taskCount: 12, totalMinutes: total(JA_TASKS) },
  "en-mid": overflow(400, 300),
  "en-overflow": overflow(480, 330),
  "en-extreme": overflow(500, 500),
};
