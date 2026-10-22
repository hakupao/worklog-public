// 并行编队 (`river`, lab s2): the range's concurrency as a river — layer k (1–6) as thick as the minutes with ≥ k
// sessions open, mirrored about the centre line, brightest = most at once — and one day opened up as swim lanes, one
// row per session. 里: LED dots on the PITCH lattice (the static layer is drawn once; the travelling ripple is a separate
// overlay, drawRippleUra); 表: ink polygons and rectangles.
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { C, inkOf, lineColor } from "../../../ui/palette";
import { drawGlyph, type TaskSil } from "../../../ui/taskGlyph";
import { taskCode } from "../../now/format";
import { dayStartMs, DAY_MS } from "./day";
import { lattice, type DaySession } from "./dayview";
import { clock5, hm } from "./fmt";
import { binRow, type Piece } from "./waterfall";
import type { DayAgg } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];

/** Minutes with ≥ k sessions open at fractional day index `f`, smoothstep between neighbouring days (lab vAt). */
export function vAt(days: readonly DayAgg[], f: number, k: number): number {
  const n = days.length;
  if (!n) return 0;
  const a = Math.max(0, Math.min(n - 1, Math.floor(f))), b = Math.min(n - 1, a + 1), u = Math.max(0, Math.min(1, f - a)), sm = u * u * (3 - 2 * u);
  return days[a].ge[k] * (1 - sm) + days[b].ge[k] * sm;
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas heights both worlds share
export const GL = 42, GR = 22;                     // dots: lane code gutter, minutes gutter (river and lanes align)
const RV = 84;                                     // river rows
const COL = ["", C.AMBER, C.AMBER, "#ffc46a", C.WARM, "#fff4e2", "#ffffff"];
const ALPHA = [0, 0.34, 0.7, 0.9, 1, 1, 1];
const OFF = 0.045;

export const RIVER_HEIGHT = RV * U;

/** What the river drawers leave for the hit test and the ripple: columns x0..x1 (px) over the `n` days; in 里 the
 *  per-column layer heights (`hk[q][k]`, dots) and the lattice placement, so the ripple redraws only its band. */
export interface RiverGeom { x0: number; x1: number; n: number; cols: number; offX: number; offY: number; yc: number; hk: Float32Array[]; sel: number }

/** The day under the point (index into days), null off the columns. */
export function riverAt(g: RiverGeom, px: number): number | null {
  const q = Math.floor(((px - g.x0) / (g.x1 - g.x0)) * g.n);
  return px >= g.x0 && q >= 0 && q < g.n ? q : null;
}

const levelOf = (hk: Float32Array, dd: number) => { let lev = 0; for (let k = 1; k <= 6; k++) if (dd <= hk[k] && hk[k] > 0.3) lev = k; return lev; };

/** `sel`: the opened day (index), its column lit a touch brighter and marked under the river. */
export function drawRiverUra(x: CanvasRenderingContext2D, days: readonly DayAgg[], sel: number, g: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, bitsFn?: BitsFn): RiverGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), cols = Math.max(1, nx - GL - GR), n = days.length;
  const yc = Math.floor((RV - 14) / 2) + 1, half = yc - 2, maxU = Math.max(1, ...days.map((d) => d.union)), sc = half / (maxU / 60);
  const colOf = (i: number) => GL + Math.round(((i + 0.5) / n) * cols - 0.5);
  const hk: Float32Array[] = [];
  x.save();
  for (let q = 0; q < cols; q++) {
    const f = ((q + 0.5) / cols) * n - 0.5, ff = Math.max(0, Math.min(n - 1, f)), on = Math.abs(f - sel) < 0.5;
    const h = new Float32Array(7);
    for (let k = 1; k <= 6; k++) h[k] = (vAt(days, ff, k) / 60) * sc;
    hk.push(h);
    for (let j = 1; j < RV - 13; j++) {
      const lev = levelOf(h, Math.abs(j - yc));
      if (!lev) { L.off(GL + q, j, on ? 0.14 : OFF); continue; }
      L.dot(GL + q, j, COL[lev], ALPHA[lev] * (on ? 1.25 : 1), lev >= 3 ? 0.9 : 0.4);
    }
  }
  days.forEach((d, i) => {
    if (i !== 0 && !d.date.endsWith("-01")) return;
    const c = colOf(i);
    if (i) for (let j = 1; j < RV - 13; j += 3) L.off(c, j, 0.16);
    L.text(mdOf(d.date), c + (i ? 2 : 0), RV - 11, "left", 0.45, C.AMBER);
  });
  const pk = days.reduce<number>((b, d, i) => (d.peak > (b < 0 ? 0 : days[b].peak) ? i : b), -1);
  if (pk >= 0) L.text(`×${days[pk].peak}`, colOf(pk), 0, "center", 0.85, C.WARM);
  if (sel >= 0) L.dot(colOf(sel), RV - 13, C.WARM, 0.9, 0.6);
  x.restore();
  return { x0: g.offX + GL * P, x1: g.offX + (GL + cols) * P, n, cols, offX: g.offX, offY: g.offY, yc, hk, sel };
}

/** Where the travelling ripple is (column, may be off the river) at `now` ms: one pass every (cols + 120) × 55ms. */
export const waveAt = (cols: number, now: number) => ((now / 55) % (cols + 120)) - 60;

/** The ripple overlay (the view's one moving thing): layers ≥ 2 within its band brightened by up to 35% — drawn
 *  on its own canvas over the static river, clearing only that canvas. */
export function drawRippleUra(x: CanvasRenderingContext2D, g: RiverGeom, wave: number, w: number, h: number): void {
  x.clearRect(0, 0, w, h);
  const L = lattice(x, g.offX, g.offY, "zh");
  const q0 = Math.max(0, Math.ceil(wave - 18)), q1 = Math.min(g.cols - 1, Math.floor(wave + 18));
  x.save();
  for (let q = q0; q <= q1; q++) {
    const wv = Math.exp(-(((q - wave) / 10) ** 2)), f = ((q + 0.5) / g.cols) * g.n - 0.5, on = Math.abs(f - g.sel) < 0.5;
    for (let j = 1; j < RV - 13; j++) {
      const lev = levelOf(g.hk[q], Math.abs(j - g.yc));
      if (lev >= 2) L.dot(GL + q, j, COL[lev], ALPHA[lev] * (on ? 1.25 : 1) * 0.35 * wv, lev >= 3 ? 0.9 : 0.4);
    }
  }
  x.restore();
}

const INK = { t1: "#0f1c2e", t2: "#5b6573", hair: "rgba(15,28,46,.12)", hair2: "rgba(15,28,46,.06)" };
const INK_A = [0, 0.14, 0.3, 0.5, 0.7, 0.85, 1];

export function drawRiverOmote(x: CanvasRenderingContext2D, days: readonly DayAgg[], sel: number, g: { w: number; h: number }, font: (weight: number) => string): RiverGeom {
  x.clearRect(0, 0, g.w, g.h);
  const n = days.length, x0 = GL * U, x1 = Math.max(x0 + 1, g.w - GR * U), w = x1 - x0;
  const yc = Math.floor((RV - 14) / 2) + 1, cy = yc * U + U / 2, maxU = Math.max(1, ...days.map((d) => d.union)), k2 = (m: number) => (m / 60) * ((yc - 2) / (maxU / 60)) * U;
  const fOf = (q: number) => Math.max(0, Math.min(n - 1, (q / w) * n - 0.5));
  for (let k = 1; k <= 6; k++) {
    x.beginPath();
    for (let q = 0; q <= w; q += 2) x.lineTo(x0 + q, cy - k2(vAt(days, fOf(q), k)));
    for (let q = Math.floor(w / 2) * 2; q >= 0; q -= 2) x.lineTo(x0 + q, cy + k2(vAt(days, fOf(q), k)));
    x.closePath();
    x.fillStyle = `rgba(15,28,46,${INK_A[k]})`;
    x.fill();
  }
  x.font = font(400); x.textAlign = "left"; x.textBaseline = "alphabetic";
  days.forEach((d, i) => {
    if (i !== 0 && !d.date.endsWith("-01")) return;
    const q = x0 + ((i + 0.5) / n) * w;
    if (i) { x.fillStyle = INK.hair; x.fillRect(q, 4, 1, g.h - 22); }
    x.fillStyle = INK.t2; x.fillText(mdOf(d.date), i ? q + 3 : x0, g.h - 4);
  });
  if (sel >= 0) { x.fillStyle = "rgba(14,124,134,.7)"; x.fillRect(x0 + ((sel + 0.5) / n) * w, 2, 1.5, g.h - 20); }
  return { x0, x1, n, cols: 0, offX: 0, offY: 0, yc, hk: [], sel };
}

// ---- the opened day: one swim lane per session (lab: no lane reuse) ----
const LH = 9, TOPH = 9, ST = 10, J0 = ST + TOPH + 3;
const TICKS = [1, 4, 7, 10, 13, 16, 19, 22];       // hours after 05:00: 06 09 … 03

/** The lanes canvas height for `n` sessions (both worlds). */
export const lanesHeight = (n: number) => (J0 + n * LH + 12) * U;

/** Lane `i` is y0 + i·lh (px). */
export interface LanesGeom { y0: number; lh: number; n: number }

/** The lane under the point (index into the day's sessions), null off the lanes. */
export function laneAt(g: LanesGeom, py: number): number | null {
  const i = Math.floor((py - g.y0) / g.lh);
  return i >= 0 && i < g.n ? i : null;
}

/** `hover`: the task hovered anywhere on the page — every other session's lane drops to .3. */
export function drawLanesUra(x: CanvasRenderingContext2D, day: DayAgg, pieces: Piece[], ss: readonly DaySession[], hover: string | null,
  g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn, sil?: TaskSil | null): LanesGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), cols = Math.max(1, nx - GL - GR), ds = dayStartMs(day.date), bm = DAY_MS / cols;
  const colOf = (ms: number) => GL + Math.floor((ms - ds) / bm);
  x.save();
  const { cov, dep } = binRow({ day, dow: 0, pieces }, cols);
  for (let b = 0; b < cols; b++) {
    const c = cov[b] > 0.02 ? dep[b] / cov[b] : 0, hgt = Math.round((c / 6) * TOPH);
    for (let r = 0; r < TOPH; r++) {
      if (TOPH - 1 - r < hgt) L.dot(GL + b, ST + r, c >= 4 ? "#fff4e2" : c >= 2.6 ? C.WARM : C.AMBER, 0.55 + 0.08 * c, 0.6);
      else if (r === TOPH - 1) L.off(GL + b, ST + r, 0.07);
    }
  }
  if (day.peak && day.peakAt !== null) L.text(`×${day.peak} ${hm(day.peakAt)}`, colOf(day.peakAt) + 3, 0, "left", 0.8, C.WARM);
  ss.forEach((o, li) => {
    const j = J0 + li * LH, task = o.s.task_id, col = lineColor(task), k = hover !== null && task !== hover ? 0.3 : 1;
    const on = task ? sil?.dots(task, 8) : null;
    if (on) { const i0 = GL - 3 - 8; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (on[r * 8 + c]) L.dot(i0 + c, j + r, col, 0.85 * k, 0.5); }
    else L.text(taskCode(task), GL - 3, j, "right", 0.75 * k, col);
    for (let b = Math.max(0, colOf(o.a) - GL); b <= Math.min(cols - 1, colOf(o.b - 1) - GL); b += 2) L.off(GL + b, j + 4, 0.16 * k);
    for (const [a, b] of o.iv) for (let q = colOf(a); q <= colOf(b - 1); q++) for (let r = 3; r < 6; r++) L.dot(q, j + r, col, 0.92 * k, 0.7);
    L.text(String(Math.round(o.wall)), nx - GR + 3, j, "left", 0.4 * k, C.AMBER);
  });
  const yb = J0 + ss.length * LH + 2;
  for (const h of TICKS) L.text(clock5(h).slice(0, 2), GL + Math.floor((h / 24) * cols), yb, "center", 0.38, C.AMBER);
  x.restore();
  return { y0: g.offY + J0 * P, lh: LH * P, n: ss.length };
}

export function drawLanesOmote(x: CanvasRenderingContext2D, day: DayAgg, pieces: Piece[], ss: readonly DaySession[], hover: string | null,
  g: { w: number; h: number }, font: (weight: number) => string, sil?: TaskSil | null): LanesGeom {
  x.clearRect(0, 0, g.w, g.h);
  const ds = dayStartMs(day.date), x0 = GL * U, w = Math.max(1, g.w - (GL + GR) * U), sx = (ms: number) => x0 + ((ms - ds) / DAY_MS) * w, y0 = J0 * U;
  for (const q of pieces) {
    const h = (q.c / 6) * TOPH * U;
    x.fillStyle = `rgba(15,28,46,${(0.25 + 0.12 * q.c).toFixed(2)})`;
    x.fillRect(sx(q.a), (ST + TOPH) * U - h, Math.max(0.8, sx(q.b) - sx(q.a)), h);
  }
  x.textBaseline = "alphabetic";
  ss.forEach((o, li) => {
    const y = y0 + li * LH * U, task = o.s.task_id;
    x.globalAlpha = hover !== null && task !== hover ? 0.3 : 1;
    x.fillStyle = INK.hair2; x.fillRect(sx(o.a), y + 13.5, Math.max(1, sx(o.b) - sx(o.a)), 1);
    x.fillStyle = inkOf(lineColor(task));
    for (const [a, b] of o.iv) x.fillRect(sx(a), y + 9, Math.max(1, sx(b) - sx(a)), 9);
    const gl = task && sil ? sil.of(task) : null;
    if (gl) drawGlyph(x, gl, x0 - 6 - 18, y + 4.5, 18, inkOf(gl.color));
    else { x.font = font(600); x.textAlign = "right"; x.fillStyle = INK.t2; x.fillText(taskCode(task), x0 - 6, y + 17.5); }
    x.fillStyle = INK.t2; x.font = font(400); x.textAlign = "left"; x.fillText(String(Math.round(o.wall)), x0 + w + 6, y + 17.5);
    x.globalAlpha = 1;
  });
  x.font = font(400); x.textAlign = "center"; x.fillStyle = INK.t2;
  for (const h of TICKS) x.fillText(clock5(h).slice(0, 2), x0 + (h / 24) * w, g.h - 3);
  return { y0, lh: LH * U, n: ss.length };
}
