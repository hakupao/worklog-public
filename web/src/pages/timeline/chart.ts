import { disc, lit } from "../../chart/canvas";
import { STEP_MIN } from "../../chart/dots";
import { bits, type Bitmap } from "../../led/bits";
import { OMOTE_UNIT, PITCH } from "../../led/lattice";
import type { SnapSession } from "../../predict/snapshot";
import { MIN, dayStart } from "../../predict/time";
import { C, lineColor } from "../../ui/palette";
import type { Band, BandTrack, WeekLayout } from "./week";

// Drawing for the week's day bands and the hour ruler above them (prototype page-timeline.html:290-345),
// without the prototype's always-on rAF: a band redraws when its data, the world, the size or the hover
// changes. One dot row per task, rows 6px apart on the PITCH lattice; 1 dot = 5 min.

export const ROW = 6;
export const RULER_H = 33;
const X0 = 6;
/** A band is tall enough for its rows plus a margin, never below one board row (45px), on the 3px grid: a size both
 *  worlds share, so OMOTE_UNIT (里's dots still snap — offY comes from the band's page position). */
export const bandHeight = (n: number) => Math.max(45, Math.ceil((n * ROW + 15) / OMOTE_UNIT) * OMOTE_UNIT);

export interface WGeom { w: number; h: number; pitch: number; offX: number; offY: number; dotX: (i: number) => number; snapY: (y: number) => number }
/** Hover on the week: a task id, null for the 未关联 rows, undefined for nothing. */
export type WHover = string | null | undefined;
type BitsFn = (text: string, size: 8, glyph: "zh") => Bitmap;

const pad2 = (n: number) => String(n).padStart(2, "0");
const hmOfMin = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

/** Same pitch rule as 此刻 (half-pixel steps, never below `u`), so the bands fill their width; every centre snaps to the
 *  lattice of `u` — PITCH in 里, OMOTE_UNIT in 表 (its drawing keeps the 3px grid). */
export function weekGeom(L: Pick<WeekLayout, "ndot">, w: number, h: number, u: number, offX = 0, offY = 0): WGeom {
  const pitch = Math.max(u, Math.floor(((w - X0 * 2) / L.ndot) * 2) / 2);
  const snapX = (x: number) => offX + Math.round((x - offX) / u) * u;
  const snapY = (y: number) => offY + Math.round((y - offY - u / 2) / u) * u + u / 2;
  return { w, h, pitch, offX, offY, snapY, dotX: (i) => snapX(offX + X0 + i * pitch + pitch / 2) };
}
export function trackYs(n: number, g: WGeom): number[] {
  const top = (g.h - n * ROW) / 2 + ROW / 2;
  return Array.from({ length: n }, (_, i) => g.snapY(top + i * ROW));
}
const hourX = (L: WeekLayout, g: WGeom, h: number) => g.dotX(((h - L.h0) * 60) / STEP_MIN) - g.pitch / 2;
/** The last dot that may light on this band: up to now on today, everything on other days. */
const lastDot = (L: WeekLayout, b: Band) => (b.isToday && L.nowIdx !== null ? L.nowIdx : L.ndot - 1);
const dimmed = (t: BandTrack, hover: WHover, onlyUnlinked: boolean) => (hover !== undefined && hover !== t.taskId) || (onlyUnlinked && t.taskId !== null);

/** The session under a point of a band, with the track it is on; null off every row. */
export function hitBand(L: WeekLayout, b: Band, g: WGeom, x: number, y: number): { track: BandTrack; session: SnapSession | null } | null {
  const ys = trackYs(b.tracks.length, g);
  let ti = -1, best = Infinity;
  ys.forEach((ty, i) => { const d = Math.abs(y - ty); if (d < best) { best = d; ti = i; } });
  if (ti < 0 || best > ROW) return null;
  const track = b.tracks[ti], at = dayStart(b.date) + (L.h0 * 60 + ((x - g.offX - X0) / g.pitch) * STEP_MIN) * MIN, pad = STEP_MIN * MIN * 1.2;
  let session: SnapSession | null = null, score = Infinity;
  for (const s of track.sessions) for (const [a, e] of s.intervals) {
    if (at < a - pad || at > e + pad) continue;
    const v = at < a ? a - at : at > e ? at - e : 0;
    if (v < score) { score = v; session = s; }
  }
  return { track, session };
}

function ledText(x: CanvasRenderingContext2D, g: WGeom, str: string, cx: number, cy: number, color: string, alpha: number, bitsFn: BitsFn): void {
  const b = bitsFn(str, 8, "zh"), p = PITCH, w = b.w * p;
  const ox = g.offX + Math.round((cx - w / 2 - g.offX) / p) * p, oy = g.offY + Math.round((cy - (b.h * p) / 2 - g.offY) / p) * p;
  x.save(); x.globalAlpha = alpha;
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) if (b.on[j * b.w + i]) lit(x, ox + i * p + p / 2, oy + j * p + p / 2, p * 0.4, color, 0.6);
  x.restore();
}

/** 里 ruler: LED hour digits, and today's time in their place when today is in the week ("13:42" is ~20 dots wide: hours within 16 dots of it give way). */
export function drawRulerUra(x: CanvasRenderingContext2D, L: WeekLayout, g: WGeom, bitsFn: BitsFn = bits): void {
  x.clearRect(0, 0, g.w, g.h);
  const nowX = L.nowIdx !== null ? g.dotX(Math.max(0, L.nowIdx)) : null;
  for (let h = L.h0; h <= L.h1; h++) {
    const cx = hourX(L, g, h);
    if (nowX === null || Math.abs(cx - nowX) > 16 * PITCH) ledText(x, g, String(h), cx, 16, C.AMBER, h * 60 <= L.nowMin || L.nowIdx === null ? 0.75 : 0.3, bitsFn);
  }
  if (nowX === null) return;
  ledText(x, g, hmOfMin(L.nowMin), nowX, 16, C.AMBER, 1, bitsFn);
}
/** 表 ruler: body-font hour ticks and a teal pill for now. */
export function drawRulerOmote(x: CanvasRenderingContext2D, L: WeekLayout, g: WGeom, font = "500 11px sans-serif"): void {
  x.clearRect(0, 0, g.w, g.h);
  x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
  const nowX = L.nowIdx !== null ? Math.round(g.dotX(Math.max(0, L.nowIdx))) : null;
  for (let h = L.h0; h <= L.h1; h++) {
    const cx = Math.round(hourX(L, g, h));
    if (nowX !== null && Math.abs(cx - nowX) < 26) continue;
    x.fillStyle = L.nowIdx === null || h * 60 <= L.nowMin ? "#5b6573" : "#a3acb8";
    x.fillText(pad2(h), cx, 17);
  }
  if (nowX === null) return;
  const str = hmOfMin(L.nowMin), tw = x.measureText(str).width + 12;
  x.fillStyle = "#0e7c86"; x.fillRect(nowX - tw / 2, 8, tw, 18);
  x.fillStyle = "#ffffff"; x.fillText(str, nowX, 17.5);
}

/** 里 band: faint hour columns, a dot per 5 minutes in the task's line colour, the running ones lit at now. */
export function drawBandUra(x: CanvasRenderingContext2D, L: WeekLayout, b: Band, g: WGeom, hover: WHover, onlyUnlinked: boolean): void {
  x.clearRect(0, 0, g.w, g.h);
  const ys = trackYs(b.tracks.length, g), last = lastDot(L, b), r = Math.min(g.pitch * 0.4, 2.5);
  for (let h = L.h0; h <= L.h1; h++) {
    const cx = hourX(L, g, h);
    for (let y = g.snapY(4); y < g.h - 3; y += ROW) disc(x, cx, y, 0.7, "rgba(255,236,214,.06)");
  }
  b.tracks.forEach((t, ti) => {
    const y = ys[ti], dim = dimmed(t, hover, onlyUnlinked), on = hover !== undefined && hover === t.taskId;
    // with the 未关联 filter on, the unlinked rows are what the page is about: they light amber instead of grey
    const col = t.taskId === null && onlyUnlinked ? C.AMBER : lineColor(t.taskId);
    for (let i = 0; i < L.ndot; i++) {
      const cx = g.dotX(i), f = i > last ? 0 : Math.min(1, t.cov[i]);
      if (f <= 0.02) { if (i % 2 === 0) disc(x, cx, y, 0.8, i > last ? "rgba(255,236,214,.03)" : "rgba(255,236,214,.06)"); continue; }
      x.globalAlpha = (dim ? 0.16 : on ? 1 : 0.85) * (0.45 + 0.55 * f);
      lit(x, cx, y, r, col, dim ? 0.2 : 1);
      x.globalAlpha = 1;
    }
    if (t.running && b.isToday && L.nowIdx !== null) lit(x, g.dotX(Math.max(0, L.nowIdx)), y, r * 1.05, "#fff6dc", 1);
  });
  if (b.isToday && L.nowIdx !== null && L.nowIdx >= 0) {
    const nx = g.dotX(L.nowIdx) + g.pitch / 2;
    for (let y = g.snapY(PITCH * 1.5); y < g.h - 1; y += PITCH) disc(x, nx, y, r * 0.6, "rgba(255,173,58,.42)");
  }
}
/** 表 band: thin hour rules, solid bars per run of activity, a teal now-line and running dots. */
export function drawBandOmote(x: CanvasRenderingContext2D, L: WeekLayout, b: Band, g: WGeom, hover: WHover, onlyUnlinked: boolean): void {
  x.clearRect(0, 0, g.w, g.h);
  const ys = trackYs(b.tracks.length, g), last = lastDot(L, b), bh = 5;
  x.fillStyle = "rgba(15,28,46,.08)";
  for (let h = L.h0; h <= L.h1; h++) x.fillRect(Math.round(hourX(L, g, h)), 0, 1, g.h);
  b.tracks.forEach((t, ti) => {
    const y = ys[ti], dim = dimmed(t, hover, onlyUnlinked), on = hover !== undefined && hover === t.taskId;
    // 未关联 rows are grey ink, except under the 未关联 filter, where they are the point (user 10/6: amber as in 里)
    x.fillStyle = t.taskId !== null ? lineColor(t.taskId) : onlyUnlinked ? "#b07a1e" : "#6f7d8e";
    x.globalAlpha = dim ? 0.18 : on ? 1 : 0.85;
    let i = 0;
    while (i <= last && i < L.ndot) {
      if (t.cov[i] <= 0.02) { i++; continue; }
      let j = i;
      while (j <= last && j < L.ndot && t.cov[j] > 0.02) j++;
      x.fillRect(g.dotX(i) - g.pitch / 2 + 0.5, y - bh / 2, g.dotX(j - 1) - g.dotX(i) + g.pitch - 1, bh);
      i = j;
    }
    x.globalAlpha = 1;
    if (t.running && b.isToday && L.nowIdx !== null) { x.fillStyle = "#0e7c86"; x.beginPath(); x.arc(g.dotX(Math.max(0, L.nowIdx)), y, 3, 0, Math.PI * 2); x.fill(); }
  });
  if (b.isToday && L.nowIdx !== null && L.nowIdx >= 0) { x.fillStyle = "#0e7c86"; x.fillRect(Math.round(g.dotX(L.nowIdx) + g.pitch / 2), 0, 1, g.h); }
}
