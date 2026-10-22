// 作息瀑布 (`waterfall`, lab s1): one row per 5:00 day × 24 hours from 05:00; brightness = sessions open at once;
// on the right, wall clock (lit) over summed (dim). 里: LED dots on the page's PITCH lattice, dot-glyph labels; 表: ink
// rectangles, body-font labels.
import { disc, lit } from "../../../chart/canvas";
import { bits, type Bitmap } from "../../../led/bits";
import type { PixelSize } from "../../../led/fonts";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { C } from "../../../ui/palette";
import { hours } from "../../../lib/format";
import { cutDays, dayStartMs, DAY_MS, HOUR_MS, weekdayOf } from "./day";
import { clock5 } from "./fmt";
import { medians } from "./headlines";
import type { DayAgg, Seg } from "./wall";

/** A stretch of a day with `c` sessions open (epoch ms). */
export interface Piece { a: number; b: number; c: number }
export interface WaterRow { day: DayAgg; dow: number; pieces: Piece[] }
/** `start` / `end`: the median start / finish, hours after 05:00 (headlines' medians). */
export interface Waterfall { rows: WaterRow[]; maxSum: number; start: number | null; end: number | null }

export function deriveWaterfall(segs: readonly Seg[], days: readonly DayAgg[]): Waterfall {
  const rows = days.map((day): WaterRow => ({ day, dow: weekdayOf(day.date), pieces: [] }));
  const at = new Map(rows.map((r) => [r.day.date, r]));
  for (const g of segs) for (const p of cutDays(g.a, g.b)) at.get(p.date)?.pieces.push({ a: p.a, b: p.b, c: g.ids.length });
  const { start, end } = medians(days);
  return { rows, maxSum: Math.max(0, ...days.map((d) => d.sum)), start, end };
}

/** The day cut into `cols` equal bins from 05:00: `cov` = the share of the bin with something open, `dep` = Σ share
 *  × sessions open (so dep / cov is the bin's average concurrency). */
export function binRow(row: WaterRow, cols: number): { cov: number[]; dep: number[] } {
  const cov = new Array<number>(cols).fill(0), dep = new Array<number>(cols).fill(0);
  const ds = dayStartMs(row.day.date), bm = DAY_MS / cols;
  for (const g of row.pieces) {
    const b0 = Math.floor((g.a - ds) / bm), b1 = Math.min(cols - 1, Math.floor((g.b - 1 - ds) / bm));
    for (let b = b0; b <= b1; b++) {
      const f = (Math.min(g.b, ds + (b + 1) * bm) - Math.max(g.a, ds + b * bm)) / bm;
      cov[b] += f; dep[b] += f * g.c;
    }
  }
  return { cov, dep };
}

/** Sessions open at `ms` in the row (0 when none). */
export function cAt(row: WaterRow, ms: number): number {
  return row.pieces.find((g) => g.a <= ms && g.b > ms)?.c ?? 0;
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
const GL = 30, GR = 48, GT = 13, RH = 3;          // dots: date gutter, bar gutter, hour band, rows (2 lit + 1 gap)
const TICKS = [1, 4, 7, 10, 13, 16, 19, 22];       // hours after 05:00: 06 09 … 03 (19 = 00:00)
const OFF = "rgba(255,236,214,";

/** The canvas height for `n` days (both worlds). */
export const waterHeight = (n: number) => (GT + n * RH + 4) * U;

/** Where the rows were drawn (px): day `i` is y0 + i·rh, hour h after 05:00 is x0 + h / 24 · (x1 − x0). */
export interface WaterGeom { x0: number; x1: number; y0: number; rh: number; n: number }

/** The day row under the point and the hour after 05:00 there (null off the 24 hours); null off the rows. */
export function waterAt(g: WaterGeom, px: number, py: number): { row: number; h: number | null } | null {
  const row = Math.floor((py - g.y0) / g.rh);
  if (row < 0 || row >= g.n) return null;
  const h = ((px - g.x0) / (g.x1 - g.x0)) * 24;
  return { row, h: h >= 0 && h < 24 ? h : null };
}

/** Average concurrency → colour, brightness and glow (lab s1). */
const tone = (c: number) => c < 1.6 ? { col: C.AMBER, a: 0.62, gl: 0.45 } : c < 2.6 ? { col: "#ffc46a", a: 0.86, gl: 0.9 }
  : c < 3.6 ? { col: C.WARM, a: 1, gl: 0.9 } : { col: "#fff4e2", a: 1, gl: 1 };

type BitsFn = (text: string, size: PixelSize, glyph: Glyph) => Bitmap;

export function drawWaterfallUra(x: CanvasRenderingContext2D, wf: Waterfall, g: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, bitsFn: BitsFn = bits): WaterGeom {
  x.clearRect(0, 0, g.w, g.h);
  const nx = Math.floor((g.w - g.offX) / P), cols = Math.max(1, nx - GL - GR), n = wf.rows.length, binH = 24 / cols;
  const px = (i: number) => g.offX + i * P + P / 2, py = (j: number) => g.offY + j * P + P / 2;
  const dot = (i: number, j: number, col: string, a: number, gl: number) => { x.globalAlpha = a; lit(x, px(i), py(j), P * 0.4, col, gl); };
  const off = (i: number, j: number, a: number) => { x.globalAlpha = 1; disc(x, px(i), py(j), P * 0.3, `${OFF}${a})`); };
  const text = (s: string, i: number, j: number, align: "left" | "right" | "center", a: number, col: string = C.AMBER) => {
    const b = bitsFn(s, 8, glyph), i0 = align === "right" ? i - b.w : align === "center" ? i - Math.floor(b.w / 2) : i;
    for (let r = 0; r < b.h; r++) for (let q = 0; q < b.w; q++) if (b.on[r * b.w + q]) dot(i0 + q, j + r, col, a, 0.25);
  };
  const colOf = (h: number) => GL + Math.floor(h / binH);
  x.save();
  for (const h of TICKS) text(clock5(h).slice(0, 2), colOf(h), 2, "center", h === 19 ? 0.55 : 0.38);
  const cS = wf.start === null ? -1 : colOf(wf.start), cE = wf.end === null ? -1 : colOf(Math.min(wf.end, 23.99));
  wf.rows.forEach((row, ri) => {
    const j0 = GT + ri * RH, d = row.day;
    if ((row.dow === 0 && ri < n - 3) || ri === n - 1) text(mdOf(d.date), GL - 3, j0 - 2, "right", ri === n - 1 ? 0.8 : 0.42, ri === n - 1 ? C.WARM : C.AMBER);
    else if (row.dow >= 5) { dot(GL - 4, j0, C.WARM, 0.4, 0); dot(GL - 5, j0, C.WARM, 0.4, 0); }
    const { cov, dep } = binRow(row, cols);
    for (let b = 0; b < cols; b++) {
      const i = GL + b, edge = b === 0 || Math.floor(b * binH) !== Math.floor((b - 1) * binH);
      for (let r = 0; r < RH - 1; r++) {
        if ((cov[b] ?? 0) > 0.02) {
          const t = tone(dep[b] / cov[b]);
          dot(i, j0 + r, t.col, t.a * (0.35 + 0.65 * Math.min(1, cov[b])), t.gl);
        } else off(i, j0 + r, (i === cS || i === cE) && r === 0 ? 0.2 : edge && Math.floor(b * binH) % 3 === 1 ? 0.085 : 0.045);
      }
    }
    // right gutter: summed (dim) under wall clock (lit), against the fullest day's summed minutes
    const bw = GR - 6, mx = Math.max(1, wf.maxSum);
    const nS = Math.round((d.sum / mx) * bw), nU = Math.max(d.union > 0 ? 1 : 0, Math.round((d.union / mx) * bw));
    for (let q = 0; q < bw; q++) for (let r = 0; r < RH - 1; r++) {
      const i = nx - GR + 4 + q;
      if (q < nU) dot(i, j0 + r, C.AMBER, 0.9, 0.6); else if (q < nS) dot(i, j0 + r, C.WARM, 0.3, 0); else off(i, j0 + r, 0.04);
    }
  });
  if (wf.maxSum > 0) text(hours(wf.maxSum), nx - GR + 4, 2, "left", 0.35);
  x.restore();
  return { x0: g.offX + GL * P, x1: g.offX + (GL + cols) * P, y0: g.offY + GT * P, rh: RH * P, n };
}

const INK = { t1: "#0f1c2e", t2: "#5b6573", hair: "rgba(15,28,46,.12)", hair2: "rgba(15,28,46,.06)" };

export function drawWaterfallOmote(x: CanvasRenderingContext2D, wf: Waterfall, g: { w: number; h: number }, font: (weight: number) => string): WaterGeom {
  x.clearRect(0, 0, g.w, g.h);
  const n = wf.rows.length, x0 = GL * U, x1 = Math.max(x0 + 1, g.w - GR * U), y0 = GT * U, rh = RH * U;
  const sx = (h: number) => x0 + (h / 24) * (x1 - x0);
  x.font = font(400); x.textBaseline = "alphabetic";
  for (const h of TICKS) {
    x.fillStyle = h === 19 ? INK.hair : INK.hair2;
    x.fillRect(Math.round(sx(h)), y0, 1, n * rh);
    x.fillStyle = INK.t2; x.textAlign = "center";
    x.fillText(clock5(h).slice(0, 2), sx(h), y0 - 8);
  }
  const mx = Math.max(1, wf.maxSum), bx = x1 + 10, bw = GR * U - 14;
  wf.rows.forEach((row, ri) => {
    const y = y0 + ri * rh, d = row.day, ds = dayStartMs(d.date);
    if (row.dow >= 5) { x.fillStyle = "rgba(15,28,46,.03)"; x.fillRect(x0, y, x1 - x0, rh); }
    if ((row.dow === 0 && ri < n - 3) || ri === n - 1) {
      x.fillStyle = ri === n - 1 ? INK.t1 : INK.t2; x.textAlign = "right";
      x.fillText(mdOf(d.date), x0 - 6, y + rh);
    }
    for (const q of row.pieces) {
      const a = (q.a - ds) / HOUR_MS, b = (q.b - ds) / HOUR_MS;
      x.fillStyle = `rgba(15,28,46,${Math.min(1, 0.28 + 0.18 * q.c).toFixed(2)})`;
      x.fillRect(sx(a), y + 0.5, Math.max(0.8, sx(b) - sx(a)), rh - 1.5);
    }
    x.fillStyle = "rgba(15,28,46,.18)"; x.fillRect(bx, y + 1, (bw * d.sum) / mx, rh - 2);
    x.fillStyle = INK.t1; x.fillRect(bx, y + 1, (bw * d.union) / mx, rh - 2);
  });
  x.fillStyle = "rgba(14,124,134,.55)";
  for (const h of [wf.start, wf.end]) {
    if (h === null) continue;
    for (let y = y0; y < y0 + n * rh; y += 4) x.fillRect(Math.round(sx(Math.min(h, 23.99))), y, 1, 2);
  }
  return { x0, x1, y0, rh, n };
}
