import type { DashInput, DashNote, DashSession, DashTask, SessionTokens, TokenCounts } from "../src/dashboard/types";

export const counts = (over: Partial<TokenCounts> = {}): TokenCounts => ({
  input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, reasoning: 0, ...over,
});
export const tokens = (over: Partial<SessionTokens> = {}): SessionTokens => ({
  by_model: {}, subagent: {}, cost_usd: 0, cost_partial: false, ...over,
});
export const sess = (id: string, started_at: string, over: Partial<DashSession> = {}): DashSession => ({
  id, machine: "macmini", agent: "claude-code", started_at,
  ended_at: new Date(Date.parse(started_at) + (over.minutes ?? 60) * 60_000).toISOString(),
  active_intervals: null, minutes: 60, summary: "s " + id, summary_source: "llm", task_id: null, hidden: false,
  tokens: null, files_written: [], ...over,
});
export const task = (id: string, over: Partial<DashTask> = {}): DashTask => ({
  id, title: "t " + id, project: "P", requester: "R", status: "open",
  received_at: "2026-09-01", done_at: null, deliverables: [], hours_manual: null, ...over,
});
export const note = (id: string, ts: string, over: Partial<DashNote> = {}): DashNote => ({
  id, task_id: null, ts, minutes: 30, ...over,
});
export const input = (over: Partial<DashInput> = {}): DashInput => ({
  sessions: [], notes: [], tasks: [], machines: [], ...over,
});
