import type { SessionTokens, TokenCounts } from "../dashboard/types";
import type { Range } from "../dashboard/range";
import { withEffective } from "../effective";
import { addDays } from "../jst";
import type { StatsPlan, StatsSession, StatsTokens } from "./types";

const DAY_MS = 86_400_000;
const SUMMARY_CHARS = 80;

/** The range's 5:00 JST days as [start, end) epoch ms: from 05:00 to the day after `to`, 05:00. */
export function windowOf(r: Range): [number, number] {
  return [Date.parse(`${r.from}T05:00:00+09:00`), Date.parse(`${addDays(r.to, 1)}T05:00:00+09:00`)];
}

/** ISO bounds for the SQL pre-filter, one day wider each side: stored instants mix `…07Z` and `…07.936000Z`,
 *  which compare wrongly as strings within the same second. The exact test is `overlaps`. */
export function coarseBounds([a, b]: [number, number]): [string, string] {
  return [new Date(a - DAY_MS).toISOString(), new Date(b + DAY_MS).toISOString()];
}

/** The session's positive-length intervals; none (NULL, or only zero-length / reversed ones) →
 *  [started, started + minutes], approx. */
function intervalsOf(started: string, raw: [string, string][] | null, minutes: number): { intervals: [string, string][]; approx: boolean } {
  const kept = (raw ?? []).filter(([a, b]) => Date.parse(b) > Date.parse(a));
  if (kept.length > 0) return { intervals: kept, approx: false };
  return { intervals: [[started, new Date(Date.parse(started) + minutes * 60_000).toISOString()]], approx: true };
}

/** Some interval of positive length meets the window (a filled-in [started, started] for 0 minutes meets nothing). */
const overlaps = (intervals: [string, string][], [a, b]: [number, number]) =>
  intervals.some(([x, y]) => Date.parse(y) > Date.parse(x) && Date.parse(x) < b && Date.parse(y) > a);

const merged = (c: TokenCounts): StatsTokens =>
  ({ input: c.input, output: c.output, cache_read: c.cache_read, cache_write: c.cache_write_5m + c.cache_write_1h });

function subagentTotal(sub: Record<string, TokenCounts> | undefined): number | null {
  const all = Object.values(sub ?? {});
  if (all.length === 0) return null;
  return all.reduce((n, c) => { const m = merged(c); return n + m.input + m.output + m.cache_read + m.cache_write; }, 0);
}

/** A raw sessions row → the stats shape, or null when no interval meets the window. */
export function statsSession(row: Record<string, any>, win: [number, number]): StatsSession | null {
  const r = withEffective(row);
  const minutes = r.minutes_effective as number;
  const { intervals, approx } = intervalsOf(r.started_at, r.active_intervals, minutes);
  if (!overlaps(intervals, win)) return null;
  const tokens = r.tokens as SessionTokens | null;
  return {
    id: r.id, machine: r.machine, agent: r.agent, task_id: r.task_id ?? null,
    started_at: r.started_at, ended_at: r.ended_at, active_minutes: minutes, turns: r.turns, files: r.files_written.length,
    intervals, approx,
    tokens: tokens ? Object.fromEntries(Object.entries(tokens.by_model ?? {}).map(([m, c]) => [m, merged(c)])) : null,
    subagent_tokens: tokens ? subagentTotal(tokens.subagent) : null,
    cost_usd: tokens?.cost_usd ?? null, cost_partial: Boolean(tokens?.cost_partial),
    summary: Array.from((r.summary_effective ?? "") as string).slice(0, SUMMARY_CHARS).join(""),
  };
}

/** Sessions in start order (by instant, then id). */
export const byStart = (a: StatsSession, b: StatsSession) =>
  Date.parse(a.started_at) - Date.parse(b.started_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface PlanRow { id: string; date: string; text: string; ai_status: StatsPlan["ai_status"]; manual_status: StatsPlan["manual_status"]; tasks_json: string | null }
