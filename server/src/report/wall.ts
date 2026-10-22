// Wall-clock hours for the 週報 (design 2026-10-08 §3.2). An event sweep over every session's active
// intervals: at each instant the k distinct buckets open (a task id, or UNLINKED) get 1/k each, and a
// bucket's share is split evenly among its sessions open then. Overridden sessions and notes add whole
// minutes outside the sweep. Minutes are floats; callers round for display.
// O(n log n): events are sorted once and the open set is kept incrementally (Workers Free = 10 ms CPU).
import { day5Of as day5OfAt, dayStart5 as dayStart5At } from "./week";

export type WallSession = { id: string; task_id: string | null; started_at: string; intervals: [string, string][] | null; minutes: number; override: boolean };
export type WallNote = { id: string; task_id: string | null; ts: string; minutes: number | null };
export type Wall = {
  days: Map<string, Map<string, number>>;
  /** 累計 per day: each session's own minutes there, parallel ones each counted in full (+ notes) — the timeline's
   *  sum, beside the wall clock of `days` (user 10/9: show both 工作时间 and 累计耗时). */
  sum: Map<string, number>;
  sessions: Map<string, Map<string, number>>;
  notes: Map<string, { date: string; minutes: number }>;
};
export const UNLINKED = "";

const MIN = 60_000, DAY = 86_400_000, JST = 9 * 3_600_000;
const bucketOf = (task: string | null) => task ?? UNLINKED;
// notes.ts is a naive JST wall-clock string; one that already carries Z or an offset is read as is.
export const noteMs = (ts: string) => (/(Z|[+-]\d{2}:?\d{2})$/.test(ts) ? Date.parse(ts) : Date.parse(`${ts}Z`) - JST);
const add2 = (m: Map<string, Map<string, number>>, k1: string, k2: string, v: number) => {
  const inner = m.get(k1) ?? new Map<string, number>();
  inner.set(k2, (inner.get(k2) ?? 0) + v);
  m.set(k1, inner);
};

/** `dayStartHour`: the hour (JST) a day starts at — 5 for the 週報 (default), 0 for the timeline's calendar days. */
export function wallSplit(sessions: WallSession[], notes: WallNote[], window?: { from: string; to: string }, dayStartHour = 5): Wall {
  const shift = (dayStartHour - 5) * 3_600_000;
  const day5Of = (ms: number) => day5OfAt(ms - shift);
  const dayStart5 = (date: string) => dayStart5At(date) + shift;
  const lo = window ? dayStart5(window.from) : -Infinity;
  const hi = window ? dayStart5(window.to) + DAY : Infinity;
  const inWin = (date: string) => !window || (date >= window.from && date <= window.to);
  const w: Wall = { days: new Map(), sum: new Map(), sessions: new Map(), notes: new Map() };
  const addSum = (date: string, m: number) => w.sum.set(date, (w.sum.get(date) ?? 0) + m);

  // Events per instant: pieces ending / starting there. A piece is one interval of a swept session, clipped to the window.
  const at = new Map<number, { ends: { id: string; bucket: string }[]; starts: { id: string; bucket: string }[] }>();
  const slot = (t: number) => at.get(t) ?? at.set(t, { ends: [], starts: [] }).get(t)!;
  let first = Infinity, last = -Infinity;
  for (const s of sessions) {
    if (s.override) {
      const t = Date.parse(s.started_at);
      if (!Number.isFinite(t)) continue;                     // unparsable start: nothing to place
      const date = day5Of(t);
      if (inWin(date) && s.minutes > 0) { add2(w.days, date, bucketOf(s.task_id), s.minutes); add2(w.sessions, s.id, date, s.minutes); addSum(date, s.minutes); }
      continue;
    }
    const ivs: [number, number][] = s.intervals?.length
      ? s.intervals.map(([x, y]) => [Date.parse(x), Date.parse(y)])
      : [[Date.parse(s.started_at), Date.parse(s.started_at) + s.minutes * MIN]];
    for (const [x, y] of ivs) {
      const a = Math.max(x, lo), b = Math.min(y, hi);
      if (!(Number.isFinite(a) && Number.isFinite(b) && b > a)) continue;
      const piece = { id: s.id, bucket: bucketOf(s.task_id) };
      slot(a).starts.push(piece); slot(b).ends.push(piece);
      if (a < first) first = a;
      if (b > last) last = b;
    }
  }

  // Every 05:00 boundary inside the span is also a point, so no segment crosses a day.
  if (first < last) for (let t = dayStart5(day5Of(first)) + DAY; t < last; t += DAY) slot(t);
  const xs = [...at.keys()].sort((p, q) => p - q);

  // bucket → (session id → open piece count); a session can hold several overlapping pieces.
  const open = new Map<string, Map<string, number>>();
  for (let i = 0; i < xs.length; i++) {
    const ev = at.get(xs[i])!;
    for (const p of ev.ends) {                                // ends before starts at the same instant
      const ids = open.get(p.bucket)!, n = ids.get(p.id)! - 1;
      if (n > 0) ids.set(p.id, n); else ids.delete(p.id);
      if (ids.size === 0) open.delete(p.bucket);
    }
    for (const p of ev.starts) {
      const ids = open.get(p.bucket) ?? open.set(p.bucket, new Map()).get(p.bucket)!;
      ids.set(p.id, (ids.get(p.id) ?? 0) + 1);
    }
    if (i + 1 === xs.length || open.size === 0) continue;
    const len = (xs[i + 1] - xs[i]) / MIN, share = len / open.size, date = day5Of(xs[i]);
    let running = 0;
    for (const ids of open.values()) running += ids.size;
    addSum(date, len * running);
    for (const [bucket, ids] of open) {
      add2(w.days, date, bucket, share);
      for (const id of ids.keys()) add2(w.sessions, id, date, share / ids.size);
    }
  }

  for (const n of notes) {
    const t = noteMs(n.ts);
    if (!Number.isFinite(t)) continue;
    const date = day5Of(t);
    if (!inWin(date)) continue;
    const m = n.minutes ?? 0;
    w.notes.set(n.id, { date, minutes: m });
    if (m > 0) { add2(w.days, date, bucketOf(n.task_id), m); addSum(date, m); }
  }
  return w;
}

/** The all-time sweep cut to the days [from, to]: equal to wallSplit(…, { from, to }) because every 05:00 boundary
 *  inside the span is a sweep point, so no segment straddles the window's edges. One sweep then serves both the
 *  week and the 累計 (10 ms CPU). */
export function wallWindow(w: Wall, from: string, to: string): Wall {
  const inWin = (date: string) => date >= from && date <= to;
  const out: Wall = { days: new Map(), sum: new Map(), sessions: new Map(), notes: new Map() };
  for (const [date, m] of w.days) if (inWin(date)) out.days.set(date, m);
  for (const [date, m] of w.sum) if (inWin(date)) out.sum.set(date, m);
  for (const [id, m] of w.sessions) {
    let kept: Map<string, number> | null = null;
    for (const [date, v] of m) if (inWin(date)) (kept ??= new Map()).set(date, v);
    if (kept) out.sessions.set(id, kept);
  }
  for (const [id, n] of w.notes) if (inWin(n.date)) out.notes.set(id, n);
  return out;
}

export const daySum = (w: Wall, date: string) => w.sum.get(date) ?? 0;
export const dayTotal = (w: Wall, date: string) => [...(w.days.get(date)?.values() ?? [])].reduce((x, y) => x + y, 0);
export const bucketTotal = (w: Wall, bucket: string) =>
  [...w.days.values()].reduce((sum, m) => sum + (m.get(bucket) ?? 0), 0);
