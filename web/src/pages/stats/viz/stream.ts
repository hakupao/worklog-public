// 案件时间流 (`stream`, lab s3): a weekly streamgraph — one band per task, as thick as the task's wall clock that
// week with concurrent tasks splitting it evenly (U17, so a week's bands add up to its wall clock), stacked about the
// centre line in the lab's inside-out order. Weeks = the Monday weeks the range's 5:00 days touch (calendar's), a
// week the range cuts labelled dim. 里: LED dots with each band's code knocked out at its thickest column; 表: ink
// polygons.
import { bits as defaultBits } from "../../../led/bits";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { C, inkOf, lineColor, mix } from "../../../ui/palette";
import { drawGlyph, type TaskSil } from "../../../ui/taskGlyph";
import { taskCode } from "../../now/format";
import { deriveCalendar, type CalWeek } from "./calendar";
import { dayStartMs, DAY_MS } from "./day";
import { lattice } from "./dayview";
import { segments, splitBy, type DayAgg, type Prepared } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];

/** A week's wall clock by task id ("" = unlinked), split evenly where tasks overlap; sums to `union`. */
export interface StreamWeek extends CalWeek { by: Map<string, number> }
/** `order`: the bands top to bottom; `totals`: each task's minutes over the range; `max`: the busiest week's wall
 *  clock (the height scale). */
export interface Stream { weeks: StreamWeek[]; order: string[]; totals: Map<string, number>; max: number }

export function deriveStream(prep: Prepared, days: readonly DayAgg[]): Stream {
  const weeks = deriveCalendar(days).weeks.map((w): StreamWeek => {
    const a = dayStartMs(w.mon);
    return { ...w, by: splitBy(segments(prep, a, a + 7 * DAY_MS), prep, (s) => s.task_id ?? "") };
  });
  const totals = new Map<string, number>();
  for (const w of weeks) for (const [k, m] of w.by) totals.set(k, (totals.get(k) ?? 0) + m);
  // inside-out (lab s3): by centre of mass in time (ties: the larger first), each one onto the lighter side
  const com = (k: string) => { let s = 0, m = 0; weeks.forEach((w, i) => { const v = w.by.get(k) ?? 0; s += v * i; m += v; }); return m ? s / m : 0; };
  const keys = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || (a < b ? -1 : a > b ? 1 : 0));
  const top: string[] = [], bot: string[] = [];
  let st = 0, sb = 0;
  for (const k of keys.sort((a, b) => com(a) - com(b))) {
    if (st <= sb) { top.push(k); st += totals.get(k)!; } else { bot.push(k); sb += totals.get(k)!; }
  }
  return { weeks, order: [...top.reverse(), ...bot], totals, max: Math.max(0, ...weeks.map((w) => w.union)) };
}

/** Week value of `k` at fractional week `f`, smoothstep between neighbouring weeks (lab val). */
function valAt(st: Stream, f: number, k: string): number {
  const n = st.weeks.length;
  if (!n) return 0;
  const a = Math.max(0, Math.min(n - 1, Math.floor(f))), b = Math.min(n - 1, a + 1), u = Math.max(0, Math.min(1, f - a)), sm = u * u * (3 - 2 * u);
  return (st.weeks[a].by.get(k) ?? 0) * (1 - sm) + (st.weeks[b].by.get(k) ?? 0) * sm;
}

export interface Band { key: string; v: number; y0: number; y1: number }

/** The bands at fractional week `f` in minutes, stacked in `order` from −total / 2 (top) about the centre line. */
export function streamStack(st: Stream, f: number): Band[] {
  const vs = st.order.map((k) => valAt(st, f, k));
  let y = -vs.reduce((m, v) => m + v, 0) / 2;
  return st.order.map((key, i) => { const y0 = y; y += vs[i]; return { key, v: vs[i], y0, y1: y }; });
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
const RH = 116, BOT = 12, GL = 4, GR = 4;          // dots: rows, week-label strip, gutters
const YC = (RH - BOT) / 2, HALF = YC - 2;

export const STREAM_HEIGHT = RH * U;

/** Where the weeks were drawn (px): columns x0..x1 over the `n` weeks, the centre line at cy, `k` px per minute. */
export interface StreamGeom { x0: number; x1: number; cy: number; k: number; n: number }

/** The week (index) and band under the point; null off the columns or outside every band. */
export function streamAt(g: StreamGeom, st: Stream, px: number, py: number): { w: number; key: string } | null {
  if (px < g.x0 || px >= g.x1 || !g.n || g.k <= 0) return null;
  const f = ((px - g.x0) / (g.x1 - g.x0)) * g.n - 0.5, m = (py - g.cy) / g.k;
  const b = streamStack(st, f).find((x) => x.v > 0 && m >= x.y0 && m < x.y1);
  return b ? { w: Math.max(0, Math.min(g.n - 1, Math.round(f))), key: b.key } : null;
}

/** Hover factor (lab fk): no hover 1, the hovered task 1.25, the others .3. */
const fk = (hover: string | null, key: string) => (hover === null ? 1 : key === hover ? 1.25 : 0.3);

export function drawStreamUra(x: CanvasRenderingContext2D, st: Stream, hover: string | null, g: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, bitsFn?: BitsFn, sil?: TaskSil | null): StreamGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), cols = Math.max(1, nx - GL - GR), n = st.weeks.length, sc = st.max > 0 ? (HALF * 2) / st.max : 0;
  const lay = Array.from({ length: cols }, (_, q) => streamStack(st, ((q + 0.5) / cols) * n - 0.5));
  // knockout codes at each band's thickest column (bands at least 11 dots thick)
  const mask = new Set<number>();
  st.order.forEach((k, i) => {
    let bq = 0, bt = 0;
    for (let q = 0; q < cols; q++) { const th = lay[q][i].v * sc; if (th > bt) { bt = th; bq = q; } }
    if (bt < 11) return;
    const on = k ? sil?.dots(k, 9) : null;
    const b = on ? { w: 9, h: 9, on } : (bitsFn ?? defaultBits)(taskCode(k || null), 8, glyph);
    const qa = Math.max(0, Math.min(cols - b.w - 1, bq - (b.w >> 1))), ja = Math.round(YC + ((lay[bq][i].y0 + lay[bq][i].y1) / 2) * sc - 4);
    for (let r = 0; r < b.h; r++) for (let c = 0; c < b.w; c++) if (b.on[r * b.w + c]) mask.add((qa + c) * 1000 + ja + r);
  });
  x.save();
  for (let q = 0; q < cols; q++) {
    for (let j = 1; j < RH - BOT; j++) {
      const y = (j + 0.5 - YC) / (sc || 1), band = sc ? lay[q].find((b) => b.v > 0 && y >= b.y0 && y < b.y1) : undefined;
      if (!band) { L.off(GL + q, j, 0.045); continue; }
      if (mask.has(q * 1000 + j)) { L.off(GL + q, j, 0.03); continue; }
      const edge = band.v * sc > 3 && (y - band.y0) * sc < 1, k = fk(hover, band.key);
      L.dot(GL + q, j, lineColor(band.key || null), (edge ? 0.3 : 0.88) * k, hover !== null && band.key === hover ? 0.9 : 0.6);
    }
  }
  // tier 3 (G3 c3): at each task band's start (column 0 or the first column back at >= 4 dots after a thinner one) a
  // 3-dot capsule lit in the band colour mixed 45% to white, full glow; outer columns one dot shorter at each end.
  // 未关联: unchanged.
  if (sc) st.order.forEach((k, i) => {
    if (!k) return;
    const col = mix(lineColor(k), "#ffffff", 0.45), k2 = Math.min(1, fk(hover, k));
    for (let q = 0; q < cols; q++) {
      if (lay[q][i].v * sc < 4 || (q > 0 && lay[q - 1][i].v * sc >= 4)) continue;
      const ja = Math.ceil(YC + lay[q][i].y0 * sc - 0.5), jb = Math.ceil(YC + lay[q][i].y1 * sc - 0.5) - 1;
      for (let dq = 0; dq < 3 && q + dq < cols; dq++) for (let j = ja + (dq === 1 ? 0 : 1); j <= jb - (dq === 1 ? 0 : 1); j++)
        { if (!mask.has((q + dq) * 1000 + j)) L.dot(GL + q + dq, j, col, k2, 1); }
    }
  });
  st.weeks.forEach((w, i) => L.text(w.label, GL + Math.round(((i + 0.5) / n) * cols), RH - 10, "center", w.cut ? 0.2 : 0.4, C.AMBER));
  x.restore();
  return { x0: g.offX + GL * P, x1: g.offX + (GL + cols) * P, cy: g.offY + YC * P, k: sc * P, n };
}

export function drawStreamOmote(x: CanvasRenderingContext2D, st: Stream, hover: string | null, g: { w: number; h: number }, font: (weight: number) => string, sil?: TaskSil | null): StreamGeom {
  x.clearRect(0, 0, g.w, g.h);
  const n = st.weeks.length, x0 = GL * U, w = Math.max(1, g.w - (GL + GR) * U), cy = YC * U, k = st.max > 0 ? (HALF * 2 * U) / st.max : 0;
  const fOf = (q: number) => (q / w) * n - 0.5;
  const cols: Band[][] = [];
  for (let q = 0; q <= w; q += 2) cols.push(streamStack(st, fOf(q)));
  const qs = cols.map((_, i) => i * 2);
  st.order.forEach((key, i) => {
    // one polygon per run of columns where the band has thickness (plus the zero column at each end it tapers to):
    // a band drawn where it is zero thick would leave its paper-coloured outline as a hairline across the others
    const on = cols.map((c) => c[i].y1 - c[i].y0 > 1e-9);
    for (let j = 0; j < cols.length; j++) {
      if (!on[j]) continue;
      const a = Math.max(0, j - 1);
      while (j < cols.length && on[j]) j++;
      const b = Math.min(cols.length - 1, j);
      x.beginPath();
      for (let q = a; q <= b; q++) x.lineTo(x0 + qs[q], cy + cols[q][i].y0 * k);
      for (let q = b; q >= a; q--) x.lineTo(x0 + qs[q], cy + cols[q][i].y1 * k);
      x.closePath();
      x.globalAlpha = 0.88 * (hover !== null && key !== hover ? 0.3 : 1);
      x.fillStyle = inkOf(lineColor(key || null));
      x.fill();
      x.globalAlpha = 1;
      x.strokeStyle = "#f4f5f7"; x.lineWidth = 0.8; x.stroke();
      // tier 3 (G3 c3): a 1.75 px bright top edge on a task band at least 6 px thick, clipped to the band
      let thick = 0;
      for (let q = a; q <= b; q++) thick = Math.max(thick, (cols[q][i].y1 - cols[q][i].y0) * k);
      if (key && thick >= 6) {
        x.save(); x.clip(); x.beginPath();
        for (let q = a; q <= b; q++) x.lineTo(x0 + qs[q], cy + cols[q][i].y0 * k + 0.4 + 0.875);
        x.globalAlpha = hover !== null && key !== hover ? 0.3 : 1;
        x.strokeStyle = mix(inkOf(lineColor(key)), "#ffffff", 0.55); x.lineWidth = 1.75; x.stroke();
        x.restore();
      }
    }
  });
  x.textBaseline = "middle"; x.textAlign = "center";
  st.order.forEach((key, i) => {                      // codes inside bands at least 14px thick
    let bj = 0, bt = 0;
    cols.forEach((c, j) => { const th = c[i].v * k; if (th > bt) { bt = th; bj = j; } });
    if (bt < 14) return;
    x.font = font(600); x.fillStyle = "#ffffff"; x.globalAlpha = hover !== null && key !== hover ? 0.3 : 1;
    const px = Math.min(x0 + w - 24, Math.max(x0 + 24, x0 + qs[bj])), py = cy + ((cols[bj][i].y0 + cols[bj][i].y1) / 2) * k;
    const g = key && sil ? sil.of(key) : null;
    if (g) drawGlyph(x, g, px - 6, py - 6, 12, "#ffffff");
    else x.fillText(taskCode(key || null), px, py);
    x.globalAlpha = 1;
  });
  x.font = font(400); x.textBaseline = "alphabetic"; x.fillStyle = "#5b6573";
  st.weeks.forEach((wk, i) => { x.globalAlpha = wk.cut ? 0.45 : 1; x.fillText(wk.label, x0 + ((i + 0.5) / n) * w, g.h - 4); });
  x.globalAlpha = 1;
  return { x0, x1: x0 + w, cy, k, n };
}
