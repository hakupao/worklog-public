/** Input polish (design 2026-10-09 §8): the raw text the user typed, and whether it is pinned (还原). */
export interface PolishMeta { raw: string; pinned: boolean }
export type PolishEntity = "task" | "note" | "plan_item" | "day_plan_item" | "session" | "report_override" | "digest";
export type Agent = "claude-code" | "codex";
export type LinkMethod = "auto-dir" | "auto-time" | "manual" | "none";
export type TaskStatus = "open" | "done" | "hold";

export interface Session {
  _polish?: Record<string, PolishMeta>;
  id: string; machine: string; agent: Agent; session_id: string; cwd: string;
  started_at: string; ended_at: string;            // ISO-8601 instants
  active_minutes: number; turns: number;
  summary: string; summary_source: "llm" | "fallback";
  task_id: string | null; link_method: LinkMethod;
  summary_edited: string | null; minutes_override: number | null; hidden: 0 | 1;
  files_written: string[];                         // absolute paths the agent wrote: deliverable candidates
  tokens: SessionTokens | null;                    // null = not collected (harvested before tokens existed)
  active_intervals: [string, string][] | null;     // activity clusters as UTC instants; null = not collected
  /** Artifact pages the session published; null = not collected. Absent from a server before migration 0015. */
  artifacts?: { url: string; title: string | null; artifact_id: string | null; ts: string }[] | null;
  ts: string; updated_at: string;
  summary_effective: string; minutes_effective: number;
  // Timeline only: this day's share of minutes_effective. A session that crosses Tokyo midnight is
  // listed under each day it was active, so the day totals never put today's work on yesterday.
  minutes_on_day?: number;
}
/** One model's tokens. `input` is uncached input; `reasoning` is a part of `output`, never added to a total. */
export interface ModelTokens {
  input: number; output: number; cache_read: number; cache_write_5m: number; cache_write_1h: number; reasoning: number;
}
/** `subagent` is the part of `by_model` the session's subagents used. cost_usd is null when no model it used has a price. */
export interface SessionTokens {
  by_model: Record<string, ModelTokens>; subagent: Record<string, ModelTokens>;
  cost_usd: number | null; cost_partial: boolean;
}
export interface Note {
  _polish?: Record<string, PolishMeta>;
  id: string; text: string; task_id: string | null; minutes: number | null;
  machine: string; ts: string /* naive JST wall clock */; updated_at: string;
}
export interface Task {
  _polish?: Record<string, PolishMeta>;
  id: string; requester: string; project: string; title: string; status: TaskStatus;
  received_at: string; done_at: string | null; thinking: string; deliverables: string[];
  hours_manual: number | null; machine: string; ts: string; updated_at: string;
  /** Stored badge (B1, migration 0019); absent from an older server, null until assigned. */
  badge_obj?: string | null; badge_color?: number | null;
}
/** minutes = 累计 (each session's own minutes, parallel ones in full); wall_minutes = 工作时间 (parallel ones once) */
export interface TimelineDay { date: string; minutes: number; wall_minutes?: number; sessions: Session[]; notes: Note[] }
export interface Timeline { week: string; days: TimelineDay[]; total_minutes: number; total_wall_minutes?: number; unassigned: number; hidden: number }
/** A 案件's automatic 成果物 (server deliverables/derive.ts): a file its sessions wrote or an Artifact page they
 *  published, with the verdict user > model > rule. "pending" = the rule left it to the collector's model. */
export interface AutoDeliverable {
  kind: "file" | "artifact";
  /** The key a verdict is written under: a file's path, or the Artifact's url. */
  key: string;
  keys: string[];
  title: string | null;
  verdict: "in" | "out" | "pending";
  source: "rule" | "model" | "user" | null;
  reason: string;
  sessions: string[];
  last_at: string;
}
export interface TaskDetail {
  task: Task; sessions: Session[]; notes: Note[]; total_minutes: number;
  /** Absent from a server before the deliverables migration. */
  auto_deliverables?: AutoDeliverable[];
}
/** GET /api/tasks/totals: a task's detail 合计 and the last Tokyo day anything not hidden happened on it. */
export interface TaskTotal { id: string; total_minutes: number; last_date: string | null }
export interface Machine { name: string; last_seen_at: string }
export type MachineRuns = { name: string; hours: boolean[]; last_run_at: string | null };

export interface SessionPatch { summary_edited?: string | null; minutes_override?: number | null; hidden?: boolean; task_id?: string | null }
export interface TaskCreate { requester: string; title: string; project?: string; received_at?: string; thinking?: string }
export type TaskPatch = Partial<Pick<Task, "requester" | "title" | "project" | "status" | "received_at" | "done_at" | "thinking" | "deliverables" | "hours_manual">>;
export interface NoteCreate { text: string; task_id?: string | null; minutes?: number | null; date?: string }
export interface NotePatch { text?: string; task_id?: string | null; minutes?: number | null }

// ---- report preview (plan 3) — mirrors server/src/report/types.ts field-for-field ------------

/** The report's one template is `weekly`; `agency` / `site` are the names it had before the two merged, which
 *  the server still answers as `weekly` (the v1 page sends them). */
export type TemplateKey = "weekly" | "agency" | "site";
export type SheetKey = "summary" | "tasks" | "days" | "deliverables" | "hours";
export type CellKind = "text" | "int" | "float" | "date";
export type CellValue = string | number | null;
export interface GridCell { column: string; value: CellValue; kind: CellKind; bold?: boolean; auto?: CellValue; overridden?: boolean; polish?: PolishMeta }
export interface SessionLite { id: string; started_at: string; summary: string; minutes: number; task_id: string | null }
export interface GridRow { row_key: string; cells: GridCell[]; sessions?: SessionLite[] }
export interface Grid { key: SheetKey; title: string; freeze_header: boolean; columns: Array<{ key: string; header: string | null }>; rows: GridRow[] }

/** An AI digest line of the 週報 (server/src/report/types.ts); text in the request's X-Lang. */
export interface DigestOut { text: string; pdf_text: string | null; edited: boolean; stale: boolean; updated_at: string; oneliner?: string | null; oneliner_edited?: boolean; polish?: { text?: PolishMeta; pdf_text?: PolishMeta; oneliner?: PolishMeta } }
/** PATCH …/digests/:day: a text edit answers the line; a regenerate answers the line (if any) plus `auto` — false when
 *  DIGESTS_AUTO is off and the line is only marked for the next local generation (R12). */
export type DigestPatchOut = DigestOut | (Partial<DigestOut> & { auto: boolean }) | null;
export interface ReportPreview {
  week: string; template: TemplateKey;
  /** The report week's days, Saturday → Friday (server/src/report/week.ts). */
  range: { from: string; to: string; dates: string[] };
  sheets: Grid[]; unassigned_sessions: number; unassigned_minutes: number;
  digests: { week: DigestOut | null; days: Record<string, DigestOut> };
  /** 累計 per day (each session's own minutes, parallel ones in full) beside the wall-clock 稼働; absent on old servers */
  day_sum_minutes?: Record<string, number>;
}

// Dashboard (copied verbatim from server/src/dashboard/types.ts)
export interface KeyMinutes { key: string; minutes: number }
export interface Overview {
  minutes: number; active_days: number; sessions: number; tasks_done: number;
  tokens: number; cost_usd: number; cost_partial: boolean;
}
export interface TimeStats {
  by_project: KeyMinutes[]; by_requester: KeyMinutes[];
  by_task: { task_id: string; title: string; minutes: number }[];
  unlinked_minutes: number;
  unlinked_note_minutes: number;
  weekly: { week: string; by_project: KeyMinutes[] }[];
}
export interface AiStats {
  by_model: { model: string; input: number; output: number; cache_read: number; cache_write: number; total: number }[];
  by_agent: { agent: string; sessions: number; minutes: number; cost_usd: number | null; cost_partial: boolean }[];
  subagent_share: number | null;
  cost_per_hour: number | null;
  cache_hit_rate: number | null;
  by_task_cost: { task_id: string; title: string; cost_usd: number; cost_partial: boolean; minutes: number }[];
  top_sessions: { id: string; summary: string; cost_usd: number; tokens: number; started_at: string }[];
  uncollected_sessions: number;
}
export interface RhythmStats {
  daily: { date: string; minutes: number }[];
  heatmap: number[][];                       // [7][24], Mon..Sun x 0..23
  late_night_share: number | null; weekend_share: number | null;
  focus_blocks: { bucket: string; count: number }[];
  avg_start: string | null; avg_end: string | null;
}
export interface OutputStats {
  done_tasks: { task_id: string; title: string; received_at: string; done_at: string; lead_days: number; deliverables: number }[];
  avg_lead_days: number | null; deliverables_count: number;
  estimate_gaps: { task_id: string; title: string; manual_hours: number; actual_hours: number }[];
}
export interface RequesterShare {
  requester: string; minutes: number; tokens: number; cost_usd: number; cost_partial: boolean;
}
export interface Hint {
  id: string; level: "info" | "warn"; text: string; links: { label: string; href: string }[];
  params: Record<string, number | string>;   // the numbers in `text`, fixed keys per id, for clients that word it themselves
}
export interface Dashboard {
  range: { from: string; to: string }; prev_range: { from: string; to: string };
  overview: Overview; overview_prev: Overview;
  time: TimeStats; ai: AiStats; rhythm: RhythmStats; output: OutputStats; hints: Hint[];
  requesters: RequesterShare[];
}
// GET /api/stats/sessions (copied verbatim from server/src/stats/types.ts)
export interface StatsTokens { input: number; output: number; cache_read: number; cache_write: number }
export interface StatsSession {
  id: string; machine: string; agent: "claude-code" | "codex"; task_id: string | null;
  started_at: string; ended_at: string; active_minutes: number; turns: number; files: number;
  intervals: [string, string][]; approx: boolean;
  tokens: Record<string, StatsTokens> | null; subagent_tokens: number | null;
  cost_usd: number | null; cost_partial: boolean; summary: string;
}
export interface StatsPlan { date: string; text: string; task_ids: string[]; ai_status: "done" | "partial" | "none" | null; manual_status: "done" | "partial" | "none" | null }
export interface StatsSessions { range: { from: string; to: string }; day_start: "05:00"; sessions: StatsSession[]; plans: StatsPlan[] }
export interface Review { week: string; text: string; model: string; generated_at: string; machine: string }

export type Horizon = "daily" | "week" | "near" | "far";
export type DayStatus = "done" | "partial" | "none";
export interface TaskRef { id: string; title: string; status: TaskStatus }
export interface PlanItem {
  _polish?: Record<string, PolishMeta>;
  id: string; horizon: Horizon; text: string; tasks: TaskRef[]; status: "active" | "done" | "dropped";
  week: string | null; until_date: string | null; sort: number; created_at: string; done_at: string | null;
  updated_at: string; effective: boolean; stale: boolean;
}
export interface PlanItemPatch {
  text?: string; horizon?: Horizon; task_ids?: string[]; status?: PlanItem["status"];
  until_date?: string | null; sort?: number; week?: string;
}
export interface DayPlanItem {
  _polish?: Record<string, PolishMeta>;
  id: string; date: string; plan_item_id: string | null; tasks: TaskRef[]; text: string; detail: string;
  sort: number; ai_status: DayStatus | null; ai_progress: string | null; ai_evidence: string[]; ai_note: string | null;
  manual_status: DayStatus | null; updated_at: string; final_status: DayStatus;
  /** The cited sessions that still exist; only on GET /api/day-plans/:date (not on single-item replies). */
  ai_evidence_sessions?: { id: string; summary: string | null; started_at: string }[];
}
export interface DayPlan {
  date: string; started_at: string; judged_at: string | null; judge_machine: string | null; judge_model: string | null;
  updated_at: string; items: DayPlanItem[];
}
export interface DayPlanItemPatch { text?: string; detail?: string; task_ids?: string[]; sort?: number; manual_status?: DayStatus | null }

/** One week's last successful download — the xlsx (`weekly`; 'agency' / 'site' on rows from before the templates
 *  merged), or the PDF (GET /api/report-downloads). Any row of a week means it was downloaded. */
/** `range`: one row per week of a cross-week xlsx (GET /api/reports/range/xlsx). */
export interface ReportDownload { week: string; template: TemplateKey | "pdf" | "range"; at: string }
/** GET /api/reports/range/bounds: the first week with data (null = none yet) and the last report week. */
export interface RangeBounds { first: string | null; last: string }

export type ComposeMode = "show" | "other" | "hide";
export interface ComposeItem { id: string; mode: ComposeMode }
export interface ComposeRowOut extends ComposeItem { title: string; requester: string; minutes: number }
export interface ComposeLangText { summary: string[]; days: Record<string, string[]> }
/** GET /api/reports/:week/pdf/compose: server/src/routes/pdf-compose.ts ComposeOut. */
export interface ComposeOut {
  week: string; inherited: boolean; updated_at: string | null; items: ComposeRowOut[]; text: ComposeLangText | null;
  edited: boolean; generated_at: string | null; generating: boolean; translating: boolean; translate_failed: boolean;
  stale: { selection: boolean; inputs: boolean };
}
