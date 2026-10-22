// One 5:00 day opened up (并行编队's swim lanes, 大圆表盘): its sessions clipped to the day, the concurrency pieces,
// stepping between days that have sessions, and the 里 lattice painter the two views share.
import { disc, lit } from "../../../chart/canvas";
import { bits, type Bitmap } from "../../../led/bits";
import type { PixelSize } from "../../../led/fonts";
import { PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { cutDays, dayStartMs, DAY_MS } from "./day";
import type { Piece } from "./waterfall";
import type { DayAgg, Prepared, PSession, Seg } from "./wall";

/** A session's part of the day: `iv` clipped to [05:00, next 05:00), `a` / `b` its first / last instant there,
 *  `wall` its minutes there. */
export interface DaySession { s: PSession; iv: [number, number][]; a: number; b: number; wall: number }

/** The sessions open during `date` (5:00 day), by their first instant in it (then id). */
export function sessionsOn(p: Prepared, date: string): DaySession[] {
  const ds = dayStartMs(date), de = ds + DAY_MS, out: DaySession[] = [];
  for (const s of p.sessions) {
    const iv: [number, number][] = [];
    for (const [x, y] of s.iv) { const lo = Math.max(ds, x), hi = Math.min(de, y); if (hi > lo) iv.push([lo, hi]); }
    if (!iv.length) continue;
    out.push({ s, iv, a: iv[0][0], b: iv[iv.length - 1][1], wall: iv.reduce((m, [x, y]) => m + (y - x) / 60_000, 0) });
  }
  return out.sort((x, y) => x.a - y.a || (x.s.id < y.s.id ? -1 : x.s.id > y.s.id ? 1 : 0));
}

/** The range's concurrency segments cut to `date`. */
export function piecesOn(segs: readonly Seg[], date: string): Piece[] {
  const out: Piece[] = [];
  for (const g of segs) for (const q of cutDays(g.a, g.b)) if (q.date === date) out.push({ a: q.a, b: q.b, c: g.ids.length });
  return out;
}

/** Sessions open at `ms` among the pieces (0 when none). */
export const openAt = (pieces: readonly Piece[], ms: number) => pieces.find((g) => g.a <= ms && g.b > ms)?.c ?? 0;

/** The nearest day before (dir −1) or after (+1) `date` with any wall clock; null when there is none. */
export function stepDay(days: readonly DayAgg[], date: string, dir: -1 | 1): string | null {
  for (let i = days.findIndex((d) => d.date === date) + dir; i >= 0 && i < days.length; i += dir) if (days[i].union > 0) return days[i].date;
  return null;
}

/** The 5:00 day holding the range's first highest-concurrency moment (null without any wall clock). */
export function peakDay(days: readonly DayAgg[]): string | null {
  let best: DayAgg | null = null;
  for (const d of days) if (d.peak > 0 && (!best || d.peak > best.peak)) best = d;
  return best?.date ?? null;
}

type BitsFn = (text: string, size: PixelSize, glyph: Glyph) => Bitmap;
const P = PITCH;

/** 里's lattice painter for a canvas at the page's PITCH offset: lit / dim dots by lattice index, dot-glyph text, and
 *  2×2-cluster hero digits. */
export function lattice(x: CanvasRenderingContext2D, offX: number, offY: number, glyph: Glyph, bitsFn: BitsFn = bits) {
  const px = (i: number) => offX + i * P + P / 2, py = (j: number) => offY + j * P + P / 2;
  const dot = (i: number, j: number, col: string, a: number, gl: number) => { x.globalAlpha = Math.min(1, a); lit(x, px(i), py(j), P * 0.4, col, gl); };
  const off = (i: number, j: number, a: number) => { x.globalAlpha = 1; disc(x, px(i), py(j), P * 0.3, `rgba(255,236,214,${a})`); };
  const text = (s: string, i: number, j: number, align: "left" | "right" | "center", a: number, col: string, size: PixelSize = 8, scale = 1) => {
    const b = bitsFn(s, size, glyph), w = b.w * scale, i0 = align === "right" ? i - w : align === "center" ? i - Math.floor(w / 2) : i;
    for (let r = 0; r < b.h; r++) for (let q = 0; q < b.w; q++) if (b.on[r * b.w + q])
      for (let u = 0; u < scale; u++) for (let v = 0; v < scale; v++) dot(i0 + q * scale + u, j + r * scale + v, col, a, 0.25);
  };
  return { px, py, dot, off, text };
}
