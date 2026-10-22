// 大圆表盘 (`dial`, lab s10): one 5:00 day as a 24-hour clock face — midnight at the top, clockwise — its sessions as
// arcs packed greedily into lanes (a lane is reused once its last session has ended), the day's concurrency as a ring
// outside them, 15-minute ticks round the rim. The now hand is a separate overlay (drawHand*), redrawn once a minute
// without touching the face.
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { C, inkOf, lineColor } from "../../../ui/palette";
import { hours } from "../../../lib/format";
import { dayStartMs, DAY_MS, HOUR_MS } from "./day";
import { lattice, openAt, piecesOn, sessionsOn, type DaySession } from "./dayview";
import { hm } from "./fmt";
import type { Piece } from "./waterfall";
import type { DayAgg, Prepared, Seg } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];
const TAU = Math.PI * 2;
const JST = 9 * HOUR_MS;

export interface DialArc extends DaySession { lane: number }
export interface Dial { day: DayAgg; arcs: DialArc[]; lanes: number; pieces: Piece[] }

/** Greedy lanes: by first instant, each session takes the first lane whose last session ended by then. */
export function packLanes(ss: readonly DaySession[]): { arcs: DialArc[]; lanes: number } {
  const ends: number[] = [];
  const arcs = ss.map((o): DialArc => {
    let lane = ends.findIndex((e) => e <= o.a);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = o.b;
    return { ...o, lane };
  });
  return { arcs, lanes: ends.length };
}

export function deriveDial(p: Prepared, segs: readonly Seg[], day: DayAgg): Dial {
  return { day, ...packLanes(sessionsOn(p, day.date)), pieces: piecesOn(segs, day.date) };
}

/** The default day: the latest with three hours or more of wall clock, else the peak day, else null (lab DIALD). */
export function defaultDialDay(days: readonly DayAgg[], peak: string | null): string | null {
  for (let i = days.length - 1; i >= 0; i--) if (days[i].union >= 180) return days[i].date;
  return peak;
}

/** Tokyo clock hours of an instant, fractional, [0, 24). */
export const clockOf = (ms: number) => ((((ms + JST) % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
/** The instant inside `date`'s 5:00 day at clock hour `h` (00:00–04:59 is the next calendar morning). */
export const tOf = (date: string, h: number) => dayStartMs(date) + ((((h - 5) % 24) + 24) % 24) * HOUR_MS;
/** Clock angle: 0 at the top (midnight), clockwise. */
export const angleOf = (ms: number) => (clockOf(ms) / 24) * TAU;

const P = PITCH, U = OMOTE_UNIT;                   // 里 dot step; 表's unit and the canvas height both worlds share
const DH = 170;                                    // rows
export const DIAL_HEIGHT = DH * U;

/** The face in px: centre, px per lattice unit; radii in units — rim R, lanes R0..RL, `lw` per lane. */
export interface DialGeom { cx: number; cy: number; u: number; R: number; R0: number; RL: number; lw: number }

/** Both worlds share the layout; 里 snaps the centre to a lattice dot. */
export function dialGeom(g: { w: number; h: number; offX: number; offY: number }, ura: boolean, lanes: number): DialGeom {
  const ny = ura ? Math.floor((g.h - g.offY) / P) : g.h / U, R = ny / 2 - 11, R0 = R * 0.34, RL = R * 0.84;
  const cx = ura ? g.offX + Math.floor(Math.floor((g.w - g.offX) / P) / 2) * P + P / 2 : g.w / 2;
  const cy = ura ? g.offY + Math.floor(ny / 2) * P + P / 2 : g.h / 2;
  return { cx, cy, u: ura ? P : U, R, R0, RL, lw: (RL - R0) / Math.max(4, lanes) };
}

/** What the point is on: a session's arc, or the concurrency ring at an instant; null elsewhere. */
export function dialAt(g: DialGeom, d: Dial, px: number, py: number): { arc: DialArc } | { ms: number; c: number } | null {
  const dx = (px - g.cx) / g.u, dy = (py - g.cy) / g.u, r = Math.hypot(dx, dy);
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += TAU;
  const ms = tOf(d.day.date, (a / TAU) * 24);
  if (r >= g.R0 && r < g.RL) {
    const lane = Math.floor((r - g.R0) / g.lw), arc = d.arcs.find((o) => o.lane === lane && o.a <= ms && o.b > ms);
    return arc ? { arc } : null;
  }
  if (r >= g.RL && r < g.R) return { ms, c: openAt(d.pieces, ms) };
  return null;
}

/** `date`: the day's label for the centre; `hover`: every other task's arcs drop to .3. */
export function drawDialUra(x: CanvasRenderingContext2D, d: Dial, hover: string | null, date: string,
  g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn): DialGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn), G = dialGeom(g, true, d.lanes);
  const ci = Math.round((G.cx - g.offX - P / 2) / P), cj = Math.round((G.cy - g.offY - P / 2) / P), R = G.R;
  x.save();
  for (let i = Math.floor(ci - R); i <= Math.ceil(ci + R); i++) for (let j = Math.floor(cj - R); j <= Math.ceil(cj + R); j++) {
    const dx = i - ci, dy = j - cj, r = Math.hypot(dx, dy);
    if (r > R) continue;
    let a = Math.atan2(dx, -dy);
    if (a < 0) a += TAU;
    const h = (a / TAU) * 24, ms = tOf(d.day.date, h);
    if (r >= R - 2.2) {                                                    // the rim: 15-minute ticks
      const m = h * 4, near = Math.abs(m - Math.round(m)) < 0.09, hr = Math.round(m) % 4 === 0, big = Math.round(m) % 12 === 0;
      if (near && r >= R - (big ? 2.2 : hr ? 1.2 : 0.3)) L.dot(i, j, big ? C.WARM : C.AMBER, big ? 0.7 : hr ? 0.45 : 0.22, 0.3);
      else L.off(i, j, 0.04);
    } else if (r >= G.RL + 1 && r < G.RL + 4) {                            // the concurrency ring
      const c = openAt(d.pieces, ms);
      if (c) L.dot(i, j, c >= 4 ? "#fff4e2" : c >= 2 ? C.WARM : C.AMBER, 0.25 + 0.13 * c, 0.6);
      else L.off(i, j, 0.05);
    } else if (r >= G.R0 && r < G.RL) {                                    // the lanes
      const lane = Math.floor((r - G.R0) / G.lw), fr = (r - G.R0) / G.lw - lane;
      if (fr > 0.74) { L.off(i, j, 0.025); continue; }
      const o = d.arcs.find((z) => z.lane === lane && z.a <= ms && z.b > ms);
      if (!o) { L.off(i, j, 0.04); continue; }
      const k = hover !== null && o.s.task_id !== hover ? 0.3 : 1;
      if (o.iv.some(([A, B]) => A <= ms && B > ms)) L.dot(i, j, lineColor(o.s.task_id), 0.92 * k, 0.7);
      else L.off(i, j, 0.16 * k);
    } else if (r < G.R0 - 1.5 && r > G.R0 - 2.5) L.off(i, j, 0.1);
  }
  for (let h = 0; h < 24; h += 3) {
    const a = (h / 24) * TAU, r = R + 6;
    L.text(String(h), Math.round(ci + Math.sin(a) * r), Math.round(cj - Math.cos(a) * r) - 3, "center", 0.5, C.AMBER);
  }
  L.text(date, ci, cj - 17, "center", 0.55, C.WARM);
  L.text(hours(d.day.union).replace(/h$/, ""), ci, cj - 7, "center", 1, C.AMBER, 8, 2);
  L.text(`h · ×${d.day.peak}`, ci, cj + 11, "center", 0.5, C.AMBER);
  x.restore();
  return G;
}

const INK = { t0: "#0f1c2e", t2: "#5b6573", t3: "#97a1ae", hair: "rgba(15,28,46,.12)" };
const TEAL = "#0e7c86";

export function drawDialOmote(x: CanvasRenderingContext2D, d: Dial, hover: string | null, date: string,
  g: { w: number; h: number }, font: (weight: number) => string): DialGeom {
  x.clearRect(0, 0, g.w, g.h);
  const G = dialGeom({ ...g, offX: 0, offY: 0 }, false, d.lanes), { cx, cy, u } = G, ang = (ms: number) => angleOf(ms) - Math.PI / 2;
  const arc = (r: number, A: number, B: number) => { const a0 = ang(A), a1 = ang(B); x.beginPath(); x.arc(cx, cy, r, a0, a1 < a0 ? a1 + TAU : a1); x.stroke(); };
  x.strokeStyle = INK.t0; x.lineWidth = 1.2; x.beginPath(); x.arc(cx, cy, G.R * u, 0, TAU); x.stroke();
  for (let m = 0; m < 96; m++) {
    const a = (m / 96) * TAU - Math.PI / 2, r0 = (G.R - (m % 12 === 0 ? 4 : m % 4 === 0 ? 2.6 : 1.4)) * u;
    x.strokeStyle = m % 4 ? INK.t3 : INK.t0; x.lineWidth = m % 12 === 0 ? 1.4 : 0.7;
    x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); x.lineTo(cx + Math.cos(a) * (G.R - 0.3) * u, cy + Math.sin(a) * (G.R - 0.3) * u); x.stroke();
  }
  x.font = font(600); x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillStyle = INK.t0;
  for (let h = 0; h < 24; h += 3) { const a = (h / 24) * TAU - Math.PI / 2, r = (G.R + 6) * u; x.fillText(String(h), cx + Math.cos(a) * r, cy + Math.sin(a) * r + 4); }
  x.lineWidth = 4;
  for (const q of d.pieces) { x.strokeStyle = `rgba(15,28,46,${(0.15 + 0.14 * q.c).toFixed(2)})`; arc((G.RL + 3) * u, q.a, q.b); }
  x.lineCap = "butt";
  for (const o of d.arcs) {
    const r = (G.R0 + (o.lane + 0.4) * G.lw) * u;
    x.globalAlpha = hover !== null && o.s.task_id !== hover ? 0.3 : 1;
    x.strokeStyle = INK.hair; x.lineWidth = 0.8; arc(r, o.a, o.b);
    x.strokeStyle = inkOf(lineColor(o.s.task_id)); x.lineWidth = Math.max(2, G.lw * u * 0.62);
    for (const [A, B] of o.iv) arc(r, A, B);
    x.globalAlpha = 1;
  }
  x.fillStyle = INK.t2; x.font = font(400); x.fillText(date, cx, cy - 6);
  x.fillStyle = INK.t0; x.font = font(500).replace(/\d+px/, "30px"); x.fillText(hours(d.day.union), cx, cy + 24);
  return G;
}

/** The now hand (里): a line of bright dots from inside the lanes to the rim. Clears its own canvas only. */
export function drawHandUra(x: CanvasRenderingContext2D, G: DialGeom, now: number, w: number, h: number): void {
  x.clearRect(0, 0, w, h);
  // the face's centre dot is lattice index (ci, cj) of a painter placed at (ox, oy)
  const a = angleOf(now), ci = Math.floor(G.cx / P), cj = Math.floor(G.cy / P);
  const L = lattice(x, G.cx - P / 2 - ci * P, G.cy - P / 2 - cj * P, "zh");
  x.save();
  for (let r = G.R0 * 0.75; r <= G.R + 1; r += 0.7) L.dot(ci + Math.round(Math.sin(a) * r), cj - Math.round(Math.cos(a) * r), "#fff6e8", 0.95, 0.9);
  x.restore();
}

export function drawHandOmote(x: CanvasRenderingContext2D, G: DialGeom, now: number, w: number, h: number, font: (weight: number) => string): void {
  x.clearRect(0, 0, w, h);
  const a = angleOf(now) - Math.PI / 2, { cx, cy, u } = G;
  x.strokeStyle = TEAL; x.lineWidth = 1.6;
  x.beginPath(); x.moveTo(cx + Math.cos(a) * G.R0 * 0.8 * u, cy + Math.sin(a) * G.R0 * 0.8 * u); x.lineTo(cx + Math.cos(a) * (G.R + 2) * u, cy + Math.sin(a) * (G.R + 2) * u); x.stroke();
  x.font = font(600); x.textAlign = "center"; x.fillStyle = TEAL;
  x.fillText(hm(now), cx + Math.cos(a) * (G.R + 14) * u, cy + Math.sin(a) * (G.R + 14) * u + 4);
}
