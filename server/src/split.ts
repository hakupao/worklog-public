import { jstClock, jstDate } from "./jst";

/** A session's active time cut into Tokyo whole hours, so it can be summed by day (a day boundary
 *  is an hour boundary) and by heatmap cell without any caller doing calendar math. */
export interface Piece { date: string; weekday: number; hour: number; seconds: number }

const HOUR_MS = 3_600_000;
const JST_OFFSET = 9 * HOUR_MS;

export const cellKey = (weekday: number, hour: number) => `${weekday}:${hour}`;

/** Every [start, end] interval split at each Tokyo whole hour; pieces of the same (date, hour)
 *  merged; empty pieces and inverted intervals dropped. Order: by date, then hour. */
export function hourPieces(intervals: [string, string][]): Piece[] {
  const acc = new Map<string, Piece>();
  for (const [startIso, endIso] of intervals) {
    let at = Date.parse(startIso);
    const end = Date.parse(endIso);
    if (!Number.isFinite(at) || !Number.isFinite(end)) continue;
    while (at < end) {
      // Next Tokyo whole hour after `at`: shift into JST, floor to the hour, shift back.
      const nextHour = (Math.floor((at + JST_OFFSET) / HOUR_MS) + 1) * HOUR_MS - JST_OFFSET;
      const to = Math.min(nextHour, end);
      const c = jstClock(new Date(at).toISOString());
      const hour = Math.floor(c.minuteOfDay / 60);
      const key = `${c.date}:${hour}`;
      const p = acc.get(key) ?? { date: c.date, weekday: c.weekday, hour, seconds: 0 };
      p.seconds += (to - at) / 1000;
      acc.set(key, p);
      at = to;
    }
  }
  return [...acc.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.hour - b.hour));
}

/** Largest-remainder split of an integer `total` by `weights`: integer parts that sum to exactly
 *  `total`, so per-day and per-cell figures add up to the session's minutes with no rounding drift.
 *  Ties go to the earlier index. All-zero weights give all zeros. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || weights.length === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rem: x - parts[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

export interface Split {
  byDay: Map<string, number>;
  byCell: Map<string, number>;   // key cellKey(weekday, hour)
  fallback: boolean;             // true when nothing could be split (no usable intervals, or no minutes to share): everything sits on the start instant
}

/** `minutes` (minutes_effective, so a human override is already applied) spread over the session's
 *  active intervals in proportion to their seconds. Without intervals — a row from before the column,
 *  or a session whose clusters have no length — the old rule stands: all of it on the Tokyo day and
 *  hour of started_at. */
export function splitMinutes(s: SplitInput): Split {
  const { pieces, fallback } = splitPieces(s);
  const byDay = new Map<string, number>();
  const byCell = new Map<string, number>();
  for (const p of pieces) {
    byDay.set(p.date, (byDay.get(p.date) ?? 0) + p.minutes);
    const k = cellKey(p.weekday, p.hour);
    byCell.set(k, (byCell.get(k) ?? 0) + p.minutes);
  }
  return { byDay, byCell, fallback };
}

export type SplitInput = { started_at: string; active_intervals: [string, string][] | null; minutes: number };
export interface MinutePiece { date: string; weekday: number; hour: number; minutes: number }

/** The same split with the date kept on every piece, for a caller that must keep only the pieces of
 *  some dates (a heatmap over a range must not count a session's hours on days outside it). Whole
 *  minutes, summing to `minutes`; the fallback is one piece at the start instant.
 *  A piece that rounds to 0 minutes is dropped: a day a session touched for 30 seconds is not a day
 *  it was worked on, and the timeline/report would otherwise list a 0-minute card there. A session
 *  with no minutes at all keeps its single start piece, so it is still listed once. */
export function splitPieces(s: SplitInput): { pieces: MinutePiece[]; fallback: boolean } {
  const cut = s.active_intervals?.length ? hourPieces(s.active_intervals) : [];
  // Days first, then hours within each day. Apportioning all hour pieces in one go would let the
  // remainder ties fall on the earliest hours (53 minutes over 70 equal hours: the last day gets
  // nothing), so a day's total is settled from its seconds before its hours share it.
  const days = new Map<string, Piece[]>();
  for (const p of cut) days.set(p.date, [...(days.get(p.date) ?? []), p]);
  const perDay = [...days.values()];
  const dayMinutes = apportion(s.minutes, perDay.map((ps) => ps.reduce((n, p) => n + p.seconds, 0)));
  const pieces = perDay.flatMap((ps, d) => {
    const parts = apportion(dayMinutes[d], ps.map((p) => p.seconds));
    return ps.map((p, i) => ({ date: p.date, weekday: p.weekday, hour: p.hour, minutes: parts[i] }));
  }).filter((p) => p.minutes > 0);
  if (pieces.length === 0) {
    const c = jstClock(s.started_at);
    return { pieces: [{ date: jstDate(s.started_at), weekday: c.weekday, hour: Math.floor(c.minuteOfDay / 60), minutes: s.minutes }], fallback: true };
  }
  return { pieces, fallback: false };
}
