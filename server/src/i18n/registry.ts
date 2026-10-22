// Every field that is stored in three languages. `id` and `text` are SQL over alias `b` (the base table).
export type Entity = "task" | "note" | "plan_item" | "day_plan_item" | "session" | "weekly_review" | "report_override" | "digest";
export type Source = {
  entity: Entity; field: string; from: string; id: string; text: string;
  /** Text that is kept as is in all three languages (stored with model 'identity'). */
  identity?: (text: string) => boolean;
  /** SQL boolean over alias `b`: this row's text is typed by a person and is polished before it is translated
   *  (design 2026-10-09 input polish §5). Absent = translate only (names, codes, AI output). */
  polish?: string;
  /** A register the translation (and polish) must follow, sent in the user message beside the kind. */
  style?: string;
};

/** The cover oneliner's register in every language (spec §10, user 10/13): the same rule as ONELINER_STYLE in
 *  server/src/report/digests.ts, plus ONELINER_NAMES' short 案件 names (keep them in step). */
export const ONELINER_STYLE_NOTE = "a formal written report sentence in every language (書き言葉 for Japanese, 书面语 for Chinese, formal business English for English; e.g. \"Completed the X rework and began verifying Y.\"). No colloquial or casual wording, no impressions. Chinese stays within 40 characters, English within 25 words. A 案件 name may stay in the short form the source uses (the leading part of the glossary name before （ ( ： :, or its common abbreviation): shortened only, never replaced by another name or invented.";

const INT = /^-?\d+$/, FLOAT = /^-?\d+(\.\d+)?$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
const notWords = (s: string) => INT.test(s) || FLOAT.test(s) || DATE.test(s);

export const overrideId = (week: string, template: string, sheet: string, row_key: string, column: string) =>
  [week, template, sheet, row_key, column].join("\u001f");

export const SOURCES: Source[] = [
  { entity: "task", field: "title", from: "tasks", id: "b.id", text: "COALESCE(b.title, '')", polish: "1" },
  { entity: "task", field: "project", from: "tasks", id: "b.id", text: "COALESCE(b.project, '')" },
  { entity: "task", field: "thinking", from: "tasks", id: "b.id", text: "COALESCE(b.thinking, '')", polish: "1" },
  { entity: "note", field: "text", from: "notes", id: "b.id", text: "b.text", polish: "1" },
  { entity: "plan_item", field: "text", from: "plan_items", id: "b.id", text: "b.text", polish: "1" },
  { entity: "day_plan_item", field: "text", from: "day_plan_items", id: "b.id", text: "b.text", polish: "1" },
  { entity: "day_plan_item", field: "detail", from: "day_plan_items", id: "b.id", text: "b.detail", polish: "1" },
  { entity: "day_plan_item", field: "ai_progress", from: "day_plan_items", id: "b.id", text: "COALESCE(b.ai_progress, '')" },
  { entity: "day_plan_item", field: "ai_note", from: "day_plan_items", id: "b.id", text: "COALESCE(b.ai_note, '')" },
  // The effective summary: a human edit wins over the collector's text.
  { entity: "session", field: "summary", from: "sessions", id: "b.id", text: "COALESCE(b.summary_edited, b.summary)", polish: "b.summary_edited IS NOT NULL" },
  { entity: "weekly_review", field: "text", from: "weekly_reviews", id: "b.week", text: "b.text" },
  {
    entity: "report_override", field: "value", from: "report_overrides",
    id: `b.week || char(31) || b.template || char(31) || b.sheet || char(31) || b.row_key || char(31) || b."column"`,
    text: "b.value", identity: notWords, polish: "1",
  },
  // Sweep budget (Workers Free, 50 D1 queries a run): 15 entries → 15 + 2×8 (+3 failed writes in flight, which end the
  // round) + 15 = 49/50 (SWEEP_LIMIT in sweep.ts) — a new entry needs a budget change first (test: i18n-sweep "sweep D1 budget").
  { entity: "digest", field: "text", from: "report_digests", id: "b.week || char(31) || b.day", text: "b.text", polish: "b.edited = 1" },
  { entity: "digest", field: "pdf_text", from: "report_digests", id: "b.week || char(31) || b.day", text: "COALESCE(b.pdf_text, '')", polish: "b.edited = 1" },
  { entity: "digest", field: "oneliner", from: "report_digests", id: "b.week || char(31) || b.day", text: "COALESCE(b.oneliner, '')", polish: "b.oneliner_edited = 1", style: ONELINER_STYLE_NOTE },
];

export const sourceOf = (entity: Entity, field: string): Source => {
  const s = SOURCES.find((x) => x.entity === entity && x.field === field);
  if (!s) throw new Error(`no translation source ${entity}.${field}`);
  return s;
};
