// 地形 (`terrain` lab s11, `contour` lab s12): the range's concurrency as land — one row per 5:00 day × 96 bins of 15
// minutes from 05:00, each bin its average concurrency, smoothed (σ 1.4 bins along the hours, then σ .9 along the
// days). The smoothing lowers the summits: a ×6 that lasts minutes reads about ×2.7, so both views say so and give
// the true peak beside. One grid for both views (terrainOf, memoised per day rows).
// 立体: a relief with hidden-line removal (the nearest row first, each lattice column keeping the highest point drawn
// so far as its horizon), shear and height turned by drag / arrow keys; no sway — a sway changes the projection, so
// it would redraw the whole relief every frame. 等高线: the same grid from above, a dot wherever the level changes.
import type { Glyph } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { bits } from "../../../led/bits";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import { C } from "../../../ui/palette";
import { weekdayOf } from "./day";
import { lattice } from "./dayview";
import { clock5 } from "./fmt";
import { binRow, deriveWaterfall } from "./waterfall";
import type { DayAgg, Seg } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];

/** 15-minute bins in a 5:00 day. */
export const NB = 96;

export interface Peak { d: number; b: number; z: number }
/** `raw[d][b]` = Σ share of the bin × sessions open; `z` the smoothed field; `zmax` / `top` its highest bin (first
 *  on ties); `peaks` the summits (see peaksOf). */
export interface Terrain { dates: string[]; raw: number[][]; z: number[][]; zmax: number; top: { d: number; b: number }; peaks: Peak[] }

/** Normalised Gaussian weights for |i| ≤ ⌈3σ⌉. */
function kernel(s: number): number[] {
  const r = Math.ceil(s * 3), w: number[] = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * s * s)));
  const tot = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / tot);
}
const KB = kernel(1.4), KD = kernel(0.9);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Summits (lab): z ≥ 2 and no higher bin within ±4 days × ±8 bins — an equal one earlier in the scan also wins, so
 *  a plateau gives one summit — highest first, at most six. */
export function peaksOf(z: readonly (readonly number[])[]): Peak[] {
  const out: Peak[] = [], nd = z.length;
  for (let d = 0; d < nd; d++) for (let b = 0; b < NB; b++) {
    const v = z[d][b];
    if (v < 2) continue;
    let top = true;
    for (let i = -4; i <= 4 && top; i++) for (let j = -8; j <= 8; j++) {
      const dd = d + i, bb = b + j;
      if ((!i && !j) || dd < 0 || dd >= nd || bb < 0 || bb >= NB) continue;
      const u = z[dd][bb];
      if (u > v || (u === v && (i < 0 || (i === 0 && j < 0)))) { top = false; break; }
    }
    if (top) out.push({ d, b, z: v });
  }
  return out.sort((p, q) => q.z - p.z).slice(0, 6);
}

export function deriveTerrain(segs: readonly Seg[], days: readonly DayAgg[]): Terrain {
  const raw = deriveWaterfall(segs, days).rows.map((r) => binRow(r, NB).dep);
  const nd = raw.length, rb = (KB.length - 1) / 2, rd = (KD.length - 1) / 2;
  const h1 = raw.map((row) => row.map((_, b) => KB.reduce((m, w, i) => m + w * row[clamp(b + i - rb, 0, NB - 1)], 0)));
  const z = h1.map((_, d) => h1[d].map((__, b) => KD.reduce((m, w, i) => m + w * h1[clamp(d + i - rd, 0, nd - 1)][b], 0)));
  let zmax = 0, top = { d: 0, b: 0 };
  z.forEach((row, d) => row.forEach((v, b) => { if (v > zmax) { zmax = v; top = { d, b }; } }));
  return { dates: days.map((d) => d.date), raw, z, zmax, top, peaks: peaksOf(z) };
}

const memo = new WeakMap<readonly DayAgg[], Terrain>();
/** deriveTerrain memoised on the day rows (useViz's, which change with the segments): 立体 and 等高线 share it. */
export function terrainOf(segs: readonly Seg[], days: readonly DayAgg[]): Terrain {
  let t = memo.get(days);
  if (!t) { t = deriveTerrain(segs, days); memo.set(days, t); }
  return t;
}

/** Bilinear height at fractional day `df` and bin `bf`, clamped to the grid. */
export function zAt(t: Terrain, df: number, bf: number): number {
  const nd = t.z.length;
  const d0 = clamp(Math.floor(df), 0, nd - 1), d1 = Math.min(nd - 1, d0 + 1), b0 = clamp(Math.floor(bf), 0, NB - 1), b1 = Math.min(NB - 1, b0 + 1);
  const u = clamp(df - d0, 0, 1), v = clamp(bf - b0, 0, 1), z = t.z;
  return (z[d0][b0] * (1 - v) + z[d0][b1] * v) * (1 - u) + (z[d1][b0] * (1 - v) + z[d1][b1] * v) * u;
}

/** The relief's view: `sh` shears each farther row right (dots per day), `hk` scales the heights. */
export interface View { sh: number; hk: number }
export const VIEW0: View = { sh: 0.34, hk: 1 };
/** The view moved by (dsh, dhk), clamped (lab: shear −1.2…1.6, height .3…2.2); the same object when nothing moves. */
export function turn(v: View, dsh: number, dhk: number): View {
  const r2 = (n: number) => Math.round(n * 1000) / 1000;
  const sh = r2(clamp(v.sh + dsh, -1.2, 1.6)), hk = r2(clamp(v.hk + dhk, 0.3, 2.2));
  return sh === v.sh && hk === v.hk ? v : { sh, hk };
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas heights both worlds share
const GL = 30, GR = 30, GT = 13;            // dots: date gutter, right margin, hour band (contour)
const RH = 190;                             // relief height, dots
const TICKS = [1, 4, 7, 10, 13, 16, 19, 22]; // hours after 05:00: 06 09 … 03
const INK = { t0: "#0b1626", t1: "#0f1c2e", t2: "#5b6573" };

export const TERRAIN_HEIGHT = RH * U;

/** Where each day's row was drawn, in lattice dots (表: units of `u` px from the canvas corner): its left end `x0`,
 *  width `w` and base line; `hS` = dots per unit of height on the nearest row; `u` = px per unit (里 PITCH, 表 3). */
export interface TerrGeom { x0: number[]; w: number[]; base: number[]; hS: number; offX: number; offY: number; u: number }

/** The lab's projection: nearer rows lower and wider (.74 → 1), farther ones shifted right by the shear. */
function project(t: Terrain, v: View, nx: number, u: number): TerrGeom {
  const nd = t.z.length, cols = Math.max(1, nx - GL - GR), depth = (RH - 26) * 0.46, top = 4, f = (d: number) => (nd > 1 ? d / (nd - 1) : 1);
  const scl = (d: number) => 0.74 + 0.26 * f(d);
  const days = [...Array(nd).keys()];
  return {
    x0: days.map((d) => GL + (cols - cols * scl(d)) / 2 + (nd - 1 - d) * v.sh),
    w: days.map((d) => cols * scl(d)),
    base: days.map((d) => top + (RH - 26) * 0.54 + f(d) * depth),
    hS: (((RH - 26) * 0.62) / Math.max(t.zmax, 1e-9)) * v.hk, offX: 0, offY: 0, u,
  };
}
const sclOf = (g: TerrGeom, d: number) => g.w[d] / g.w[g.w.length - 1];

/** The row whose drawn face holds the point (C1): from the nearest row back, the first whose span holds the column
 *  and whose face runs from its surface down to its base line through the point (a dot's slack either way) — what
 *  the hidden-line relief (里) and the paper rows (表) both show there. Null off every face; also the hour after
 *  05:00 along the row and the bin. */
export function terrainAt(g: TerrGeom, t: Terrain, px: number, py: number): { d: number; h: number; bf: number } | null {
  const i = (px - g.offX) / g.u, j = (py - g.offY) / g.u;
  for (let d = g.base.length - 1; d >= 0; d--) {
    const f = (i - g.x0[d]) / g.w[d];
    if (f < 0 || f >= 1) continue;
    const bf = f * (NB - 1), top = g.base[d] - zAt(t, d, bf) * g.hS * sclOf(g, d);
    if (j >= top - 1 && j <= g.base[d] + 1) return { d, h: f * 24, bf };
  }
  return null;
}

/** Height → colour (lab s11). */
const toneOf = (zn: number) => (zn < 0.4 ? C.AMBER : zn < 0.62 ? "#ffc46a" : zn < 0.82 ? C.WARM : "#fff4e2");

/** `coarse` (P1, while dragging): every other row counted from the front, every other lattice column, and no dim fill
 *  under the ridges — about a tenth of the dots, so a three-month drag keeps up; the release draws it whole. */
export function drawTerrainUra(x: CanvasRenderingContext2D, t: Terrain, v: View, g0: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, bitsFn?: BitsFn, coarse = false): TerrGeom {
  x.clearRect(0, 0, g0.w, g0.h);
  const nx = Math.floor((g0.w - g0.offX) / P), g = { ...project(t, v, nx, P), offX: g0.offX, offY: g0.offY }, nd = t.z.length;
  const L = lattice(x, g0.offX, g0.offY, glyph, bitsFn), zmax = Math.max(t.zmax, 1e-9);
  const hor = new Array<number>(nx + 1).fill(Infinity);
  x.save();
  for (let d = nd - 1; d >= 0; d--) {                 // nearest row first; a farther one shows only above the horizon
    const sc = sclOf(g, d), x0 = g.x0[d], w = g.w[d], yb = g.base[d];
    const skip = coarse && (nd - 1 - d) % 2 === 1, i0 = Math.max(0, Math.ceil(x0));
    for (let i = coarse ? i0 + (i0 % 2) : i0; !skip && i < x0 + w && i <= nx; i += coarse ? 2 : 1) {
      const z = zAt(t, d, ((i - x0) / w) * (NB - 1)), zn = z / zmax, jy = Math.round(yb - z * g.hS * sc);
      if (jy >= hor[i]) continue;
      const col = toneOf(zn);
      L.dot(i, jy, col, zn < 0.02 ? 0.1 + 0.08 * sc : 0.35 + 0.65 * Math.min(1, zn * 1.3), 0.5 + 0.5 * zn);
      if (!coarse) for (let j = jy + 1; j < Math.min(hor[i], Math.round(yb) + 1); j++) L.dot(i, j, col, 0.05 + 0.22 * zn, 0);
      hor[i] = jy;
    }
    if (weekdayOf(t.dates[d]) === 0 && d < nd - 3) L.text(mdOf(t.dates[d]), Math.floor(x0) - 2, Math.round(yb) - 4, "right", 0.35, C.AMBER);
  }
  const last = nd - 1;
  for (const h of TICKS) L.text(clock5(h).slice(0, 2), Math.round(g.x0[last] + (h / 24) * g.w[last]), Math.round(g.base[last]) + 3, "center", 0.4, C.AMBER);
  t.peaks.slice(0, 3).forEach((pk, n) => {
    const xx = g.x0[pk.d] + (pk.b / (NB - 1)) * g.w[pk.d], yy = g.base[pk.d] - pk.z * g.hS * sclOf(g, pk.d);
    L.text(mdOf(t.dates[pk.d]), Math.round(xx), Math.round(yy) - 11, "center", n ? 0.6 : 0.9, C.WARM);
  });
  x.restore();
  return g;
}

export function drawTerrainOmote(x: CanvasRenderingContext2D, t: Terrain, v: View, g0: { w: number; h: number }, font: (weight: number) => string): TerrGeom {
  x.clearRect(0, 0, g0.w, g0.h);
  const g = project(t, v, Math.floor(g0.w / U), U), nd = t.z.length, u = U;
  x.font = font(400); x.textBaseline = "alphabetic";
  for (let d = 0; d < nd; d++) {                        // far to near: each paper row covers what is behind it
    const sc = sclOf(g, d), x0 = g.x0[d], w = g.w[d], yb = g.base[d];
    x.beginPath(); x.moveTo(x0 * u, yb * u);
    for (let q = 0; q <= 160; q++) x.lineTo((x0 + (q / 160) * w) * u, (yb - zAt(t, d, (q / 160) * (NB - 1)) * g.hS * sc) * u);
    x.lineTo((x0 + w) * u, (yb + 2) * u); x.lineTo(x0 * u, (yb + 2) * u); x.closePath();
    x.fillStyle = "#f4f5f7"; x.fill();
    x.strokeStyle = d % 7 === 0 ? INK.t1 : "rgba(15,28,46,.55)"; x.lineWidth = d % 7 === 0 ? 0.9 : 0.6; x.stroke();
    if (weekdayOf(t.dates[d]) === 0 && d < nd - 3) { x.fillStyle = INK.t2; x.textAlign = "right"; x.fillText(mdOf(t.dates[d]), x0 * u - 6, yb * u + 3); }
  }
  const last = nd - 1;
  x.fillStyle = INK.t2; x.textAlign = "center";
  for (const h of TICKS) x.fillText(clock5(h).slice(0, 2), (g.x0[last] + (h / 24) * g.w[last]) * u, (g.base[last] + 9) * u);
  x.font = font(600); x.fillStyle = INK.t0;
  for (const pk of t.peaks.slice(0, 3)) {
    const xx = g.x0[pk.d] + (pk.b / (NB - 1)) * g.w[pk.d], yy = g.base[pk.d] - pk.z * g.hS * sclOf(g, pk.d);
    x.fillText(mdOf(t.dates[pk.d]), xx * u, yy * u - 8);
  }
  return g;
}

/* ---------- 等高线 ---------- */

export const CONTOUR_LEVELS = [0.2, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
/** How many levels `z` has reached (0 below .2). */
export function levelOf(z: number): number {
  let n = 0;
  while (n < CONTOUR_LEVELS.length && z >= CONTOUR_LEVELS[n]) n++;
  return n;
}

const RD = 3;                                // dots per day row
const GRc = 10;
/** The canvas height for `n` days (both worlds). */
export const contourHeight = (n: number) => (GT + n * RD + 4) * U;

/** The grid as drawn (px): days from y0, `rh` per day; the 24 hours across [x0, x0 + w). */
export interface ContourGeom { x0: number; y0: number; w: number; rh: number; n: number }

export function contourAt(g: ContourGeom, px: number, py: number): { d: number; h: number; bf: number } | null {
  const d = Math.floor((py - g.y0) / g.rh), f = (px - g.x0) / g.w;
  return d >= 0 && d < g.n && f >= 0 && f < 1 ? { d, h: f * 24, bf: f * (NB - 1) } : null;
}

/** Levels on a cols × rows lattice (one more each way for the right / lower neighbour). */
function levels(t: Terrain, cols: number, rows: number): number[][] {
  return Array.from({ length: rows + 1 }, (_, j) => Array.from({ length: cols + 1 }, (__, q) => levelOf(zAt(t, j / RD, (q / cols) * (NB - 1)))));
}
const peakLabel = (t: Terrain, pk: Peak) => `×${pk.z.toFixed(1)} ${mdOf(t.dates[pk.d])}`;

export interface Box { x: number; y: number; w: number; h: number }
const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, r: Box) => a.x >= r.x && a.y >= r.y && a.x + a.w <= r.x + r.w && a.y + a.h <= r.y + r.h;
/** The summits' labels placed in turn (highest first, P2): each at the first of `cands(k)` that stays inside `area`
 *  and overlaps nothing placed so far (`taken`: the hour labels, the date column, the summits' marks); null = no room (the summary still lists it). */
export function placeLabels(n: number, cands: (k: number) => Box[], area: Box, taken: Box[]): (Box | null)[] {
  const placed = [...taken], out: (Box | null)[] = [];
  for (let k = 0; k < n; k++) {
    const b = cands(k).find((c) => inside(c, area) && !placed.some((p) => hits(p, c))) ?? null;
    out.push(b);
    if (b) placed.push(b);
  }
  return out;
}
/** Above right of the summit, above left, below right, below left (a label `w` × `h` with a gap `g`); then the same
 *  one and two label heights farther out, so a crowd of summits stacks its labels. */
const around = (i: number, j: number, w: number, h: number, g: number): Box[] =>
  [0, 1, 2].flatMap((r) => [[i + g, j - g - h - r * (h + 1)], [i - g - w, j - g - h - r * (h + 1)], [i + g, j + g + r * (h + 1)], [i - g - w, j + g + r * (h + 1)]])
    .map(([x, y]) => ({ x, y, w, h }));

export function drawContourUra(x: CanvasRenderingContext2D, t: Terrain, g0: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, bitsFn?: BitsFn): ContourGeom {
  x.clearRect(0, 0, g0.w, g0.h);
  const nx = Math.floor((g0.w - g0.offX) / P), cols = Math.max(1, nx - GL - GRc), nd = t.z.length, rows = nd * RD;
  const L = lattice(x, g0.offX, g0.offY, glyph, bitsFn), lv = levels(t, cols, rows), top = CONTOUR_LEVELS.length;
  const bw = (s: string) => (bitsFn ?? bits)(s, 8, glyph).w, ticks: Box[] = [];
  x.save();
  for (const h of TICKS) {
    const s = clock5(h).slice(0, 2), w = bw(s), i = GL + Math.floor((h / 24) * cols);
    L.text(s, i, 2, "center", 0.38, C.AMBER);
    ticks.push({ x: i - Math.floor(w / 2), y: 2, w, h: 8 });
  }
  for (let j = 0; j < rows; j++) for (let q = 0; q < cols; q++) {
    const l0 = lv[j][q], lr = lv[j][q + 1], ld = lv[j + 1][q], i = GL + q, jj = GT + j;
    if (lr !== l0 || ld !== l0) {
      const k = Math.max(l0, lr, ld) / top;
      L.dot(i, jj, k > 0.55 ? "#fff4e2" : k > 0.3 ? C.WARM : C.AMBER, 0.35 + 0.65 * k, 0.6);
    } else if (l0) L.dot(i, jj, C.AMBER, 0.025 + 0.03 * l0, 0);
    else L.off(i, jj, 0.035);
  }
  t.dates.forEach((date, d) => { if (weekdayOf(date) === 0 && d < nd - 3) L.text(mdOf(date), GL - 3, GT + d * RD - 3, "right", 0.4, C.AMBER); });
  // the summits, then their labels on a cleared plate (a dot round the text), placed so none overlaps another
  const at = t.peaks.map((pk) => [GL + Math.round((pk.b / (NB - 1)) * cols), GT + pk.d * RD] as const);
  at.forEach(([i, j]) => L.dot(i, j, "#ffffff", 1, 1));
  const ny = Math.floor((g0.h - g0.offY) / P), labs = t.peaks.map((pk) => peakLabel(t, pk));
  // kept clear (C4): the hour labels, the date column and every summit's dot with the plate's margin round it
  const keep = [...ticks, { x: 0, y: 0, w: GL, h: ny }, ...at.map(([i, j]) => ({ x: i - 1, y: j - 1, w: 3, h: 3 }))];
  placeLabels(labs.length, (k) => around(at[k][0], at[k][1], bw(labs[k]), 8, 2), { x: 0, y: 0, w: nx, h: ny }, keep).forEach((b, n) => {
    if (!b) return;
    x.clearRect(g0.offX + (b.x - 1) * P, g0.offY + (b.y - 1) * P, (b.w + 2) * P, (b.h + 2) * P);
    L.text(labs[n], b.x, b.y, "left", n ? 0.65 : 0.95, C.WARM);
  });
  x.restore();
  return { x0: g0.offX + GL * P, y0: g0.offY + GT * P, w: cols * P, rh: RD * P, n: nd };
}

export function drawContourOmote(x: CanvasRenderingContext2D, t: Terrain, g0: { w: number; h: number }, font: (weight: number) => string): ContourGeom {
  x.clearRect(0, 0, g0.w, g0.h);
  const cols = Math.max(1, Math.floor(g0.w / U) - GL - GRc), nd = t.z.length, rows = nd * RD, X0 = GL * U, Y0 = GT * U;
  const lv = levels(t, cols, rows);
  for (let j = 0; j < rows; j++) for (let q = 0; q < cols; q++) {
    const l0 = lv[j][q], lr = lv[j][q + 1], ld = lv[j + 1][q], px = X0 + q * U, py = Y0 + j * U;
    if (l0) { x.fillStyle = `rgba(15,28,46,${(0.025 * l0).toFixed(3)})`; x.fillRect(px, py, U, U); }
    if (lr !== l0 || ld !== l0) {
      const l1 = Math.max(l0, lr, ld), s = l1 % 2 ? 1.6 : 1;
      x.fillStyle = l1 % 2 ? "rgba(15,28,46,.75)" : "rgba(15,28,46,.35)"; x.fillRect(px, py, s, s);
    }
  }
  x.font = font(400); x.textBaseline = "alphabetic"; x.fillStyle = INK.t2;
  x.textAlign = "center";
  const ticks: Box[] = [];
  for (const h of TICKS) {
    const s = clock5(h).slice(0, 2), w = x.measureText(s).width, cx = X0 + (h / 24) * cols * U;
    x.fillText(s, cx, Y0 - 8);
    ticks.push({ x: cx - w / 2, y: Y0 - 19, w, h: 13 });
  }
  x.textAlign = "right";
  t.dates.forEach((date, d) => { if (weekdayOf(date) === 0 && d < nd - 3) x.fillText(mdOf(date), X0 - 6, Y0 + d * RD * U + 4); });
  x.font = font(600); x.textAlign = "left"; x.fillStyle = INK.t0;
  const at = t.peaks.map((pk) => [X0 + (pk.b / (NB - 1)) * cols * U, Y0 + pk.d * RD * U] as const), labs = t.peaks.map((pk) => peakLabel(t, pk));
  for (const [px, py] of at) { x.beginPath(); x.moveTo(px, py - 3); x.lineTo(px + 3, py + 2); x.lineTo(px - 3, py + 2); x.fill(); }
  // labels on a cleared plate, placed so none overlaps another (the text's box: 13px from its top, baseline at 11)
  // kept clear (C4): the hour labels, the date column and every summit's triangle with the plate's margin round it
  const keep = [...ticks, { x: 0, y: 0, w: X0, h: g0.h }, ...at.map(([px, py]) => ({ x: px - 5, y: py - 4, w: 10, h: 7 }))];
  placeLabels(labs.length, (k) => around(at[k][0], at[k][1], x.measureText(labs[k]).width, 13, 5), { x: 0, y: 0, w: g0.w, h: g0.h }, keep).forEach((b, n) => {
    if (!b) return;
    x.clearRect(b.x - 2, b.y - 1, b.w + 4, b.h + 2);
    x.fillText(labs[n], b.x, b.y + 11);
  });
  return { x0: X0, y0: Y0, w: cols * U, rh: RD * U, n: nd };
}
