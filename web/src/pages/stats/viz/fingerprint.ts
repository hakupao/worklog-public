// 节律指纹 (`fingerprint`, lab s5): a radial clock of seven rings — Monday innermost, Sunday outermost — each cut
// into the 24 JST clock hours (0:00 just right of a small gap at the top, clockwise); a cell is as bright as that
// weekday-hour's average wall clock per day (÷ that weekday's 5:00 days in the range, idle ones included), against
// the brightest. The weekday is the 5:00 day's; the hour is the clock's. Beside it: the weekday averages (星期均值's
// deriveWeekday) and the hour totals (24 小时分布's deriveHours24).
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { C } from "../../../ui/palette";
import { cutDays, weekdayOf } from "./day";
import { lattice } from "./dayview";
import { busiest } from "./echarts-theme";
import { deriveHours24, hh } from "./hours24";
import type { DayAgg, Seg } from "./wall";
import { deriveWeekday, type WeekdayAvg } from "./weekday";

type BitsFn = Parameters<typeof lattice>[4];

/** `hm[w][h]`: wall-clock minutes on weekday w (0 = Monday) at clock hour h; `av` = hm ÷ that weekday's days (0 for
 *  a weekday the range does not reach); `best` = the first brightest cell; `hours` = the hour totals and `bestH`
 *  the busiest hour (−1 without wall clock); `wd` = the weekday averages. */
export interface Fingerprint { hm: number[][]; av: number[][]; max: number; best: { w: number; h: number } | null; hours: number[]; bestH: number; wd: WeekdayAvg }

export function deriveFingerprint(segs: readonly Seg[], days: readonly DayAgg[]): Fingerprint {
  const byDay = new Map<string, Seg[]>();
  for (const g of segs) for (const q of cutDays(g.a, g.b)) {
    const xs = byDay.get(q.date) ?? [];
    xs.push({ a: q.a, b: q.b, ids: g.ids });
    byDay.set(q.date, xs);
  }
  const hm = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const [date, xs] of byDay) deriveHours24(xs).forEach((m, h) => { hm[weekdayOf(date)][h] += m; });
  const wd = deriveWeekday(days);
  const av = hm.map((row, w) => row.map((m) => (wd.n[w] ? m / wd.n[w] : 0)));
  let best: Fingerprint["best"] = null, max = 0;
  av.forEach((row, w) => row.forEach((v, h) => { if (v > max) { max = v; best = { w, h }; } }));
  const hours = deriveHours24(segs);
  return { hm, av, max, best, hours, bestH: busiest(hours), wd };
}

const P = PITCH, U = OMOTE_UNIT;                         // 里 dot step; 表's unit and the canvas height both worlds share
const TAU = Math.PI * 2, GAP = 0.26;                     // radians left open at the top
const RHH = 196;                                         // dots

export const FP_HEIGHT = RHH * U;

/** Clockwise angle from the top of clock hour `h` (0–24). */
export const angOf = (h: number) => GAP / 2 + (h / 24) * (TAU - GAP);

/** The rings as drawn (px): centre, inner radius, outer radius, ring width. */
export interface FpGeom { cx: number; cy: number; R0: number; R: number; wr: number }

/** The weekday ring and clock hour under the point; null in the centre, outside, or in the gap. */
export function fpAt(g: FpGeom, px: number, py: number): { w: number; h: number } | null {
  const dx = px - g.cx, dy = py - g.cy, r = Math.hypot(dx, dy);
  if (r < g.R0 || r >= g.R) return null;
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += TAU;
  if (a < GAP / 2 || a > TAU - GAP / 2) return null;
  return { w: Math.min(6, Math.floor((r - g.R0) / g.wr)), h: Math.min(23, Math.floor(((a - GAP / 2) / (TAU - GAP)) * 24)) };
}

/** Ring geometry in dots for a canvas `ny` dots tall (both worlds). */
const rings = (ny: number) => { const R = ny / 2 - 12, R0 = R * 0.3; return { R, R0, w: (R - R0) / 7 }; };

export function drawFpUra(x: CanvasRenderingContext2D, fp: Fingerprint, g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn): FpGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), ny = Math.floor((g.h - g.offY) / P), cx = Math.floor(nx / 2), cy = Math.floor(ny / 2), { R, R0, w } = rings(ny);
  x.save();
  for (let i = Math.floor(cx - R); i <= Math.ceil(cx + R); i++) for (let j = Math.floor(cy - R); j <= Math.ceil(cy + R); j++) {
    const dx = i - cx, dy = j - cy, r = Math.hypot(dx, dy);
    if (r < R0 || r >= R) continue;
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += TAU;
    const ring = Math.floor((r - R0) / w), fr = (r - R0) / w - ring;
    if (a < GAP / 2 || a > TAU - GAP / 2) { if (fr < 0.2) L.off(i, j, 0.12); continue; }
    const hf = ((a - GAP / 2) / (TAU - GAP)) * 24, h = Math.floor(hf);
    if (fr > 0.84 || hf - h > 0.93) { L.off(i, j, 0.03); continue; }
    const v = fp.max ? fp.av[ring][h] / fp.max : 0;
    if (!v) { L.off(i, j, 0.055); continue; }
    L.dot(i, j, v > 0.7 ? "#fff4e2" : v > 0.4 ? C.WARM : C.AMBER, 0.05 + 0.95 * v ** 0.95, 0.4 + 0.5 * v);
  }
  for (let h = 0; h < 24; h += 3) {
    const a = angOf(h), r = R + 6;
    L.text(String(h), Math.round(cx + Math.sin(a) * r), Math.round(cy - Math.cos(a) * r) - 3, "center", fp.bestH >= 0 && h === fp.bestH - (fp.bestH % 3) ? 0.6 : 0.36, C.AMBER);
  }
  for (const ring of [0, 6]) L.dot(cx, Math.round(cy - (R0 + (ring + 0.5) * w)), C.WARM, 0.5, 0.3);   // Monday / Sunday at the gap
  if (fp.bestH >= 0) {
    L.text(String(fp.bestH).padStart(2, "0"), cx, cy - 9, "center", 1, C.AMBER, 8, 2);
    L.text(":00", cx, cy + 9, "center", 0.5, C.AMBER);
  }
  x.restore();
  return { cx: g.offX + cx * P + P / 2, cy: g.offY + cy * P + P / 2, R0: R0 * P, R: R * P, wr: w * P };
}

export function drawFpOmote(x: CanvasRenderingContext2D, fp: Fingerprint, g: { w: number; h: number }, font: (weight: number) => string): FpGeom {
  x.clearRect(0, 0, g.w, g.h);
  const cx = g.w / 2, cy = g.h / 2, { R, R0, w } = rings(g.h / U);
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const r0 = (R0 + d * w) * U, r1 = (R0 + (d + 1) * w) * U - 1.5, a0 = angOf(h) - Math.PI / 2, a1 = angOf(h + 1) - Math.PI / 2 - 0.012;
    const v = fp.max ? fp.av[d][h] / fp.max : 0;
    x.beginPath(); x.arc(cx, cy, r1, a0, a1); x.arc(cx, cy, r0, a1, a0, true); x.closePath();
    x.fillStyle = `rgba(15,28,46,${(v ? 0.06 + 0.9 * v ** 0.75 : 0.03).toFixed(3)})`;
    x.fill();
  }
  x.font = font(400); x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillStyle = "#5b6573";
  for (let h = 0; h < 24; h += 3) { const a = angOf(h) - Math.PI / 2, r = (R + 6) * U; x.fillText(String(h), cx + Math.cos(a) * r, cy + Math.sin(a) * r + 4); }
  if (fp.bestH >= 0) { x.font = font(600).replace("11px", "20px"); x.fillStyle = "#0b1626"; x.fillText(hh(fp.bestH), cx, cy + 6); }
  return { cx, cy, R0: R0 * U, R: R * U, wr: w * U };
}

/** The hour-totals strip beside the rings: 24 bars across the width, the busiest lit. */
export const HOURS_HEIGHT = 54;

export function drawHoursUra(x: CanvasRenderingContext2D, hours: readonly number[], best: number, g: { w: number; h: number; offX: number; offY: number }): void {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, "zh");
  const nx = Math.floor((g.w - g.offX) / P), ny = Math.floor((g.h - g.offY) / P), nyb = ny - 4, m = Math.max(1, ...hours);
  x.save();
  hours.forEach((v, h) => {
    const n = Math.round((v / m) * nyb), i0 = Math.floor((h * nx) / 24), i1 = Math.floor(((h + 1) * nx) / 24);
    for (let i = i0; i < i1 - 1; i++) for (let r = 0; r < nyb; r++) {
      if (nyb - 1 - r < n) L.dot(i, r, h === best ? C.WARM : C.AMBER, h === best ? 1 : 0.75, h === best ? 0.9 : 0.6);
      else L.off(i, r, 0.05);
    }
  });
  x.restore();
}

export function drawHoursOmote(x: CanvasRenderingContext2D, hours: readonly number[], best: number, g: { w: number; h: number }, font: (weight: number) => string): void {
  x.clearRect(0, 0, g.w, g.h);
  const bw = g.w / 24, m = Math.max(1, ...hours);
  hours.forEach((v, h) => {
    const hh = (v / m) * (g.h - 16);
    x.fillStyle = h === best ? "#0b1626" : "rgba(15,28,46,.55)";
    x.fillRect(h * bw + 1, g.h - 14 - hh, bw - 2, hh);
  });
  x.font = font(400); x.textAlign = "left"; x.textBaseline = "alphabetic"; x.fillStyle = "#5b6573";
  for (const h of [0, 6, 12, 18]) x.fillText(String(h), h * bw + 1, g.h - 2);
}
