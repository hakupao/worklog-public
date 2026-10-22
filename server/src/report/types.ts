import type { PolishMeta } from "../i18n/store";
export type TemplateKey = "weekly";
export type SheetKey = "summary" | "tasks" | "days" | "deliverables" | "hours";
export type TaskColumn = "requester" | "title" | "project" | "status" | "received_at" | "done_at" | "hours" | "week_hours" | "deliverables" | "thinking";

export interface SheetConfig { enabled: boolean; title: string; columns?: TaskColumn[]; headers?: string[] }
export type Template = Record<SheetKey, SheetConfig>;

export interface TaskLike {
  id: string; requester: string; project: string; title: string; status: "open" | "done" | "hold";
  received_at: string; done_at: string | null; thinking: string; deliverables: string[]; hours_manual: number | null;
}
export interface SessionLite { id: string; started_at: string; summary: string; minutes: number; task_id: string | null }
// hours = 累計 (all history, quarter-rounded unless hours_manual); week_minutes = this week's wall-clock share (float).
/** An automatic 成果物 produced this report week (deliverables/derive.ts, verdict in): a file one of the week's sessions
 *  wrote or an Artifact one published. `label` is the file's path relative to its session's cwd, or the page's title;
 *  `date` the last 05:00-day of the week it was written / published on. */
export interface WeekDeliverable { kind: "file" | "artifact"; key: string; label: string; date: string }
// auto: the week's automatic 成果物, beside the hand-picked task.deliverables (absent = none).
export interface TaskRow { task: TaskLike; hours: number; week_minutes: number; sessions: SessionLite[]; auto?: WeekDeliverable[] }
export interface DayRow { date: string; task_id: string | null; task_title: string; text: string; minutes: number; source: { kind: "session" | "note"; id: string } }
export interface WeekSummary {
  week: string; week_start: string; week_end: string; new: number; done: number; ongoing: number;
  by_requester: Array<[string, number]>;   // 保持首次出现顺序（Python dict 语义）
  total_hours: number;
  unassigned_hours: number;   // 未归属桶的墙钟分钟 + 未归属 note 分钟 / 60
}
export interface WeekData {
  tasks: TaskRow[]; days: DayRow[]; summary: WeekSummary;
  dates: string[];                       // the report week's seven 05:00-days, Sat → Fri
  day_minutes: Array<[string, number]>;  // wall-clock minutes per day, all seven days (floats)
  day_sum_minutes: Array<[string, number]>;  // 累計 per day: each session's own minutes, parallel ones in full (floats)
  day_buckets: Record<string, Record<string, number>>;  // date → task id ("" = 未関連) → wall-clock minutes (floats)
  unassigned_sessions: number;
  unassigned_minutes: number;   // 只数 session，不含 note（给网页警告条）
}

export type CellKind = "text" | "int" | "float" | "date";
export type CellValue = string | number | null;
export interface GridCell { column: string; value: CellValue; kind: CellKind; bold?: boolean; auto?: CellValue; overridden?: boolean; polish?: PolishMeta }
export interface GridRow { row_key: string; cells: GridCell[]; sessions?: SessionLite[] }
export interface Grid { key: SheetKey; title: string; freeze_header: boolean; columns: Array<{ key: string; header: string | null }>; rows: GridRow[] }

// An AI digest line (report_digests); text in the request's X-Lang.
export interface DigestOut {
  text: string; pdf_text: string | null; edited: boolean; stale: boolean; updated_at: string;
  oneliner?: string | null; oneliner_edited?: boolean;   // the week row's; always null / false on a day
  polish?: { text?: PolishMeta; pdf_text?: PolishMeta; oneliner?: PolishMeta };
}
export interface ReportPreview {
  week: string; template: TemplateKey; range: { from: string; to: string; dates: string[] };
  sheets: Grid[]; unassigned_sessions: number; unassigned_minutes: number;
  digests: { week: DigestOut | null; days: Record<string, DigestOut> };
  /** 累計 per day (each session's own minutes, parallel ones in full) beside the wall-clock 稼働 of the sheets */
  day_sum_minutes: Record<string, number>;
}
export interface OverrideRow { sheet: SheetKey; row_key: string; column: string; value: string; updated_at: string; _polish?: Record<string, PolishMeta> }
