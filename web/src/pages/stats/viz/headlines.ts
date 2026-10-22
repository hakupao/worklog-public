// 洞察头条 (`headlines`): ten figures over the range (lab s0), on 7b's terms — 5:00 days, wall clock from the
// concurrency segments, no finish-drift figure.
import type { StatsSession } from "../../../api/types";
import { dayStartMs, day5, hourOf5, HOUR_MS } from "./day";
import { peak, summedMin, unionMin, type DayAgg, type Prepared, type Seg } from "./wall";
import { deriveWeekday } from "./weekday";

/** A day counts towards the start / finish medians from this much wall clock (lab WORKDAYS). */
export const WORKDAY_MIN = 60;

export interface Headlines {
  sessions: number;
  /** Wall-clock and summed minutes over the range. */
  wall: number; summed: number;
  peak: { c: number; at: number; date: string } | null;
  /** The day with the most summed minutes. */
  dense: { date: string; sum: number; union: number } | null;
  /** The session with the most wall clock inside the window (first in window order on a tie). */
  longest: { id: string; task: string | null; wall: number; t0: number } | null;
  /** Median start / finish in hours after 05:00 over the `workdays` days with ≥ WORKDAY_MIN; null without any. */
  start: number | null; end: number | null; workdays: number;
  /** Busiest / quietest weekday (0 = Monday) by average wall clock per day; weekdays the range never reaches ignored. */
  wd: { best: number; avg: number; low: number; lowAvg: number } | null;
  /** The priced session with the highest cost (sessions whose cost is null never win); null when none is above 0. */
  costly: { id: string; task: string | null; cost: number; t0: number; tokens: number | null } | null;
  /** Tokens of the range's sessions (whole sessions; not collected = none). */
  tokens: { all: number; cacheRead: number; output: number };
  /** Days with any wall clock / days in the range; the longest run of consecutive active days. */
  active: number; days: number;
  streak: Streak | null;
}
export interface Streak { len: number; from: string; to: string }

/** A session's tokens, all four kinds over its models; null when not collected. */
export function tokensOf(s: Pick<StatsSession, "tokens">): number | null {
  if (!s.tokens) return null;
  return Object.values(s.tokens).reduce((m, k) => m + k.input + k.output + k.cache_read + k.cache_write, 0);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median start and finish (hours after 05:00; a day running to the next 05:00 finishes at 24) over the days with
 *  at least WORKDAY_MIN of wall clock. */
export function medians(days: readonly DayAgg[]): { start: number | null; end: number | null; n: number } {
  const ws = days.filter((d) => d.union >= WORKDAY_MIN && d.first !== null && d.last !== null);
  if (!ws.length) return { start: null, end: null, n: 0 };
  return {
    start: median(ws.map((d) => hourOf5(d.first!))),
    end: median(ws.map((d) => (d.last! - dayStartMs(d.date)) / HOUR_MS)),
    n: ws.length,
  };
}

/** The longest run of consecutive active 5:00 days (the first one on a tie); null without an active day. */
export function streakOf(days: readonly DayAgg[]): Streak | null {
  let best: Streak | null = null, len = 0, from = "";
  for (const d of days) {
    if (d.union > 0) {
      if (!len++) from = d.date;
      if (!best || len > best.len) best = { len, from, to: d.date };
    } else len = 0;
  }
  return best;
}

export function deriveHeadlines(prep: Prepared, segs: Seg[], days: readonly DayAgg[]): Headlines {
  const ss = prep.sessions;
  const pk = peak(segs);
  const dense = days.reduce<DayAgg | null>((m, d) => (d.sum > 0 && (!m || d.sum > m.sum) ? d : m), null);
  const long = ss.reduce<(typeof ss)[number] | null>((m, s) => (!m || s.wall > m.wall ? s : m), null);
  const costly = ss.reduce<(typeof ss)[number] | null>((m, s) => (s.cost_usd !== null && s.cost_usd > 0 && (!m || s.cost_usd > m.cost_usd!) ? s : m), null);
  const { avg } = deriveWeekday(days);
  let best = -1, low = -1;
  avg.forEach((v, i) => {
    if (v === null) return;
    if (best < 0 || v > avg[best]!) best = i;
    if (low < 0 || v < avg[low]!) low = i;
  });
  const tokens = { all: 0, cacheRead: 0, output: 0 };
  for (const s of ss) for (const k of Object.values(s.tokens ?? {})) {
    tokens.all += k.input + k.output + k.cache_read + k.cache_write;
    tokens.cacheRead += k.cache_read;
    tokens.output += k.output;
  }
  const md = medians(days);
  return {
    sessions: ss.length,
    wall: unionMin(segs), summed: summedMin(segs),
    peak: pk && { c: pk.c, at: pk.at, date: day5(pk.at) },
    dense: dense && { date: dense.date, sum: dense.sum, union: dense.union },
    longest: long && { id: long.id, task: long.task_id, wall: long.wall, t0: long.t0 },
    start: md.start, end: md.end, workdays: md.n,
    wd: best >= 0 && avg[best]! > 0 ? { best, avg: avg[best]!, low, lowAvg: avg[low]! } : null,
    costly: costly && { id: costly.id, task: costly.task_id, cost: costly.cost_usd!, t0: costly.t0, tokens: tokensOf(costly) },
    tokens,
    active: days.filter((d) => d.union > 0).length, days: days.length,
    streak: streakOf(days),
  };
}
