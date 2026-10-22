export interface TokenCounts {
  input: number; output: number; cache_read: number; cache_write_5m: number; cache_write_1h: number; reasoning: number;
}
export interface SessionTokens {
  by_model: Record<string, TokenCounts>;
  subagent: Record<string, TokenCounts>;
  cost_usd: number | null;
  cost_partial: boolean;
}
export interface DashSession {
  id: string; machine: string; agent: "claude-code" | "codex";
  started_at: string; ended_at: string;
  active_intervals: [string, string][] | null;   // null = harvested before the column (see split.ts)
  minutes: number;            // minutes_effective
  summary: string;            // summary_effective
  summary_source: "llm" | "fallback";
  task_id: string | null; hidden: boolean;
  tokens: SessionTokens | null; files_written: string[];
}
export interface DashNote { id: string; task_id: string | null; ts: string; minutes: number | null }
export interface DashTask {
  id: string; title: string; project: string; requester: string;
  status: "open" | "done" | "hold"; received_at: string; done_at: string | null;
  deliverables: string[]; hours_manual: number | null;
}
export interface DashMachine { name: string; last_seen_at: string }
export interface DashInput { sessions: DashSession[]; notes: DashNote[]; tasks: DashTask[]; machines: DashMachine[] }

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
