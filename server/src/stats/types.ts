// GET /api/stats/sessions — copied verbatim into web/src/api/types.ts.
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
