// Wall clock and concurrency over /api/stats/sessions (U16/U17). Pure functions, epoch ms.
// Wall clock = time with at least one session open; summed = Σ open sessions × time (≥ wall clock).
import type { StatsSession, StatsSessions } from "../../../api/types";
import { DAY_MS, dayStartMs, daysOf } from "./day";

const MIN_MS = 60_000;

export interface PSession extends StatsSession {
  /** Intervals clipped to the window, zero-length dropped, ascending. */
  iv: [number, number][];
  t0: number; t1: number;
  /** Minutes inside the window (a session's own intervals never overlap). */
  wall: number;
}
export interface Prepared { from: string; to: string; a: number; b: number; sessions: PSession[]; byId: Map<string, PSession> }

/** The window is [from 05:00, to+1 05:00); sessions with nothing left inside it are dropped. */
export function prepare(d: StatsSessions): Prepared {
  const { from, to } = d.range;
  const a = dayStartMs(from), b = dayStartMs(to) + DAY_MS;
  const sessions: PSession[] = [];
  for (const s of d.sessions) {
    const iv: [number, number][] = [];
    for (const [x, y] of s.intervals) {
      const lo = Math.max(a, Date.parse(x)), hi = Math.min(b, Date.parse(y));
      if (hi > lo) iv.push([lo, hi]);
    }
    if (!iv.length) continue;
    iv.sort((p, q) => p[0] - q[0]);
    const wall = iv.reduce((m, [x, y]) => m + (y - x) / MIN_MS, 0);
    sessions.push({ ...s, iv, t0: iv[0][0], t1: iv[iv.length - 1][1], wall });
  }
  sessions.sort((p, q) => p.t0 - q.t0 || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  return { from, to, a, b, sessions, byId: new Map(sessions.map((s) => [s.id, s])) };
}

/** A stretch of time and the sessions open through it (ids.length = concurrency ≥ 1). */
export interface Seg { a: number; b: number; ids: string[] }

/** Event sweep over [a, b) (default: the window). At one instant closes go before opens; back-to-back stretches with
 *  the same open set merge. `ids` follow the sessions' order in `p`. */
export function segments(p: Prepared, a = p.a, b = p.b): Seg[] {
  const ev: [number, number, number][] = []; // [ms, +1 open / −1 close, session index]
  p.sessions.forEach((s, i) => {
    for (const [x, y] of s.iv) {
      const lo = Math.max(a, x), hi = Math.min(b, y);
      if (hi > lo) { ev.push([lo, 1, i]); ev.push([hi, -1, i]); }
    }
  });
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Seg[] = [];
  const open = new Set<number>();
  let last = 0;
  for (const [ms, d, i] of ev) {
    if (open.size && ms > last) {
      const ids = [...open].sort((x, y) => x - y).map((k) => p.sessions[k].id);
      const prev = out[out.length - 1];
      if (prev && prev.b === last && prev.ids.join("\n") === ids.join("\n")) prev.b = ms;
      else out.push({ a: last, b: ms, ids });
    }
    if (d > 0) open.add(i); else open.delete(i);
    last = ms;
  }
  return out;
}

const len = (g: Seg) => (g.b - g.a) / MIN_MS;

/** Wall-clock minutes. */
export function unionMin(segs: Seg[]): number {
  return segs.reduce((m, g) => m + len(g), 0);
}

/** Summed minutes = Σ length × concurrency. */
export function summedMin(segs: Seg[]): number {
  return segs.reduce((m, g) => m + len(g) * g.ids.length, 0);
}

/** The first segment with the highest concurrency. */
export function peak(segs: Seg[]): { c: number; at: number } | null {
  let best: Seg | null = null;
  for (const g of segs) if (!best || g.ids.length > best.ids.length) best = g;
  return best && { c: best.ids.length, at: best.a };
}

/** Minutes with concurrency ≥ k. */
export function geMin(segs: Seg[], k: number): number {
  return segs.reduce((m, g) => m + (g.ids.length >= k ? len(g) : 0), 0);
}

/** U17: in each segment the k distinct keys get length / k each, so the values add up to unionMin(segs).
 *  Unlinked sessions should key as "". */
export function splitBy(segs: Seg[], p: Prepared, keyOf: (s: PSession) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of segs) {
    const keys = new Set(g.ids.map((id) => keyOf(p.byId.get(id)!)));
    const share = len(g) / keys.size;
    for (const k of keys) out.set(k, (out.get(k) ?? 0) + share);
  }
  return out;
}

export interface DayAgg {
  date: string; union: number; sum: number; peak: number; peakAt: number | null;
  /** Earliest / latest interval end inside the day. */
  first: number | null; last: number | null;
  /** ge[k] = minutes with concurrency ≥ k, k = 1..6 (ge[0] unused, 0). */
  ge: number[];
  /** Sessions open at some point in the day, in `p` order. */
  ids: string[];
}

/** One row per 5:00 day of the range, empty days included. */
export function perDay(p: Prepared): DayAgg[] {
  return daysOf(p.from, p.to).map((date) => {
    const a = dayStartMs(date);
    const segs = segments(p, a, a + DAY_MS);
    const pk = peak(segs);
    const seen = new Set(segs.flatMap((g) => g.ids));
    return {
      date, union: unionMin(segs), sum: summedMin(segs), peak: pk?.c ?? 0, peakAt: pk?.at ?? null,
      first: segs.length ? segs[0].a : null, last: segs.length ? segs[segs.length - 1].b : null,
      ge: [0, 1, 2, 3, 4, 5, 6].map((k) => (k ? geMin(segs, k) : 0)),
      ids: p.sessions.filter((s) => seen.has(s.id)).map((s) => s.id),
    };
  });
}
