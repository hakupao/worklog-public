import { coverage, STEP_MIN } from "../../chart/dots";
import { bits, type Bitmap } from "../../led/bits";
import { PITCH } from "../../led/lattice";
import { activeMs, type SnapSession, type Snapshot } from "../../predict/snapshot";
import { DAY, MIN, dayStart } from "../../predict/time";
import { C, lineColor } from "../../ui/palette";
import { disc, lit } from "../../chart/canvas";

// Today's run chart (spec §3.1, §7.4): one track per task (unlinked sessions share one), one dot row per
// machine. The axis stretches to the track width (relayout spec §2.1): the dot pitch stays PITCH on the lattice and
// the dot count follows the width, so one dot holds (h1 − h0) h / ndot (≈ 4 min at 1512) instead of a fixed 5 min.
// Ported from world-now.html:587-676 without its always-on rAF and pulses: the chart redraws only when its data,
// the world, the size, the hover or the pixel font changes.

export { coverage, STEP_MIN };

/** Track rows flex with the room (prototype now-c3a.html:778-800): (h − TOP − BOT) / tracks, between these. */
export const ROW_MIN = 22;     // ≥ 21: a dense 8px CJK label lit 7 rows × 3px (T10 F2); 14px at PITCH 2, the floor is layout and stays
export const ROW_MAX = 40;
/** Past this many tracks, or under this row height (px), the labels go dense (RunChart, T10 verdict 6). */
export const DENSE_TRACKS = 6;
export const DENSE_ROW = 24;
export const TOP = 24;
export const BOT = 20;
export const X0 = 12;

export interface Track {
  taskId: string | null; sessions: SnapSession[]; minutes: number; running: boolean; runningOn: string[];
}
export interface ChartLayout {
  date: string; dayStart: number; h0: number; h1: number; machines: string[]; tracks: Track[]; nowMin: number;
}
/** The width-dependent part: dot count, minutes per dot, now's dot and each track's per-machine coverage. */
export interface Geom {
  w: number; h: number; pitch: number; offX: number; offY: number; rowH: number;
  ndot: number; minPerDot: number; nowIdx: number; cov: Float32Array[][];
  dotX: (i: number) => number; rowY: (ti: number, mi: number) => number;
}
export type Hover = { taskId: string | null } | null;
type BitsFn = (text: string, size: 8, glyph: "zh") => Bitmap;

const pad2 = (n: number) => String(n).padStart(2, "0");
const hmOfMin = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

export function layoutChart(s: Snapshot): ChartLayout {
  const day0 = dayStart(s.date), nowMin = Math.min(1440, Math.max(0, Math.round((s.now - day0) / MIN)));
  const today = s.sessions.filter((x) => x.days.includes(s.date));
  let first = Infinity, last = -Infinity;
  for (const x of today) for (const [a, b] of x.intervals) {
    const lo = Math.max(a, day0), hi = Math.min(b, day0 + DAY);
    if (hi > lo) { first = Math.min(first, lo); last = Math.max(last, hi); }
  }
  const fm = Number.isFinite(first) ? (first - day0) / MIN : 540, lm = Number.isFinite(last) ? (last - day0) / MIN : 1260;
  const h0 = Math.min(9, Math.floor(fm / 60));
  const h1 = Math.min(24, Math.max(21, Math.ceil(lm / 60), Math.ceil(nowMin / 60)));
  const machines = [...new Set([...s.machines.map((m) => m.name), ...today.map((x) => x.machine)])].sort();
  const order: (string | null)[] = [];
  for (const x of today) if (!order.includes(x.taskId)) order.push(x.taskId);
  const tracks = order.map((taskId): Track => {
    const ss = today.filter((x) => x.taskId === taskId);
    const runningOn = [...new Set(s.running.filter((r) => r.session.taskId === taskId).map((r) => r.session.machine))].sort();
    return {
      taskId, sessions: ss, runningOn, running: runningOn.length > 0,
      minutes: Math.round(ss.reduce((n, x) => n + activeMs(x, day0, day0 + DAY), 0) / MIN),
    };
  });
  return { date: s.date, dayStart: day0, h0, h1, machines, tracks, nowMin };
}

/** The row height for `room` px of chart (TOP and BOT included): the share of each track, clamped to ROW_MIN–ROW_MAX (22–40). */
export const rowHeight = (L: ChartLayout, room: number) =>
  Math.min(ROW_MAX, Math.max(ROW_MIN, (room - TOP - BOT) / Math.max(1, L.tracks.length)));
export const chartHeight = (L: ChartLayout, rowH = ROW_MAX) => TOP + Math.max(1, L.tracks.length) * rowH + BOT;

/** Dots per track at a width of 0 (jsdom) or a degenerate one: enough for the axis to stay readable. */
const MIN_DOTS = 48;

/** Dot positions on the page-wide lattice (offX / offY are the canvas's lattice offsets). The pitch is `u` — PITCH in
 *  里, OMOTE_UNIT in 表 (its drawing keeps the 3px grid) — and the dot count fills the width less the 12px margins;
 *  the coverage is binned at that count. */
export function geometry(L: ChartLayout, w: number, h: number, u: number, offX = 0, offY = 0): Geom {
  const pitch = u, n = Math.max(1, L.machines.length), rowH = rowHeight(L, h);
  const ndot = Math.max(MIN_DOTS, Math.floor((w - 24) / pitch)), minPerDot = ((L.h1 - L.h0) * 60) / ndot;
  const nowIdx = Math.min(ndot - 1, Math.floor((L.nowMin - L.h0 * 60) / minPerDot)), from = L.dayStart + L.h0 * 60 * MIN;
  const cov = L.tracks.map((tr) => L.machines.map((m) =>
    coverage(tr.sessions.filter((x) => x.machine === m).flatMap((x) => x.intervals), from, ndot, minPerDot)));
  const snapX = (x: number) => offX + Math.round((x - offX) / u) * u;
  const snapY = (y: number) => offY + Math.round((y - offY - u / 2) / u) * u + u / 2;
  return {
    w, h, pitch, offX, offY, rowH, ndot, minPerDot, nowIdx, cov,
    dotX: (i) => snapX(offX + X0 + i * pitch + pitch / 2),
    rowY: (ti, mi) => snapY(TOP + rowH * ti + rowH / 2 + (mi - (n - 1) / 2) * pitch),
  };
}

export function hitTest(L: ChartLayout, g: Geom, x: number, y: number): { track: Track; session: SnapSession | null } | null {
  const ti = Math.floor((y - TOP) / g.rowH), track = L.tracks[ti];
  if (y < TOP || !track) return null;
  const at = L.dayStart + (L.h0 * 60 + ((x - g.offX - X0) / g.pitch) * g.minPerDot) * MIN, pad = g.minPerDot * MIN * 1.2;
  let mi = 0;
  for (let k = 1; k < L.machines.length; k++) if (Math.abs(y - g.rowY(ti, k)) < Math.abs(y - g.rowY(ti, mi))) mi = k;
  let best: SnapSession | null = null, score = Infinity;
  for (const s of track.sessions) for (const [a, b] of s.intervals) {
    if (at < a - pad || at > b + pad) continue;
    const v = (s.machine === L.machines[mi] ? 0 : 1) + (at < a ? (a - at) / MIN : at > b ? (at - b) / MIN : 0);
    if (v < score) { score = v; best = s; }
  }
  return { track, session: best };
}

/** The x of hour h on the axis: the left edge of the dot it starts in (fractional dot indices snap like dots). */
const hourX = (L: ChartLayout, g: Geom, h: number) => g.dotX(((h - L.h0) * 60) / g.minPerDot) - g.pitch / 2;

function ledText(x: CanvasRenderingContext2D, g: Geom, str: string, cx: number, cy: number, alpha: number, bitsFn: BitsFn): void {
  const b = bitsFn(str, 8, "zh"), p = PITCH, w = b.w * p;
  const ox = g.offX + Math.round((cx - w / 2 - g.offX) / p) * p, oy = g.offY + Math.round((cy - (b.h * p) / 2 - g.offY) / p) * p;
  x.save(); x.globalAlpha = alpha;
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) if (b.on[j * b.w + i]) lit(x, ox + i * p + p / 2, oy + j * p + p / 2, p * 0.4, C.AMBER, 0.6);
  x.restore();
}

/** 里: dot rows; a track lights in its line colour only while running or hovered (world-now.html:647-675). */
export function drawUra(x: CanvasRenderingContext2D, L: ChartLayout, g: Geom, hover: Hover, bitsFn: BitsFn = bits): void {
  x.clearRect(0, 0, g.w, g.h);
  const r = Math.min(g.pitch * 0.4, g.rowH * 0.12), ni = g.nowIdx, nowX = g.dotX(Math.max(0, ni));
  for (let h = L.h0; h <= L.h1; h++) {
    const cx = hourX(L, g, h);
    if (Math.abs(cx - nowX) > 20 * PITCH) ledText(x, g, String(h), cx, 12, 0.3, bitsFn);
  }
  for (let q = 0; q < (L.h1 - L.h0) * 4; q++) {     // one tick per quarter hour
    const i = Math.round((q * 15) / g.minPerDot);
    disc(x, g.dotX(i), g.h - BOT + 8, 1, i <= ni ? "rgba(255,173,58,.28)" : "rgba(255,236,214,.08)");
  }
  L.tracks.forEach((tr, ti) => {
    const on = !!hover && hover.taskId === tr.taskId, dimmed = !!hover && !on;
    const col = tr.running || on ? lineColor(tr.taskId) : C.AMBER, base = on ? 1 : tr.running ? 0.95 : 0.34;
    g.cov[ti].forEach((cov, mi) => {
      const y = g.rowY(ti, mi), k = mi === 0 ? 1 : 0.9;
      for (let i = 0; i < g.ndot; i++) {
        const cx = g.dotX(i), f = i > ni ? 0 : Math.min(1, cov[i]);        // nothing after now: never the future
        if (f <= 0.02) { disc(x, cx, y, r * 0.75, i > ni ? "rgba(255,236,214,.03)" : "rgba(255,236,214,.055)"); continue; }
        x.globalAlpha = (dimmed ? 0.45 : 1) * base * (0.4 + 0.6 * f) * k;
        lit(x, cx, y, r, col, tr.running || on ? 1 : 0.2);
        x.globalAlpha = 1;
      }
    });
  });
  if (ni < 0) return;
  for (let y = TOP; y < g.h - BOT + 20; y += 6) disc(x, nowX, y, r * 0.75, "rgba(255,173,58,.42)");
  x.fillStyle = "rgba(4,5,6,.94)"; x.fillRect(nowX - 24, 0, 48, TOP - 3);
  ledText(x, g, hmOfMin(L.nowMin), nowX, 12, 0.6, bitsFn);
  L.tracks.forEach((tr, ti) => L.machines.forEach((m, mi) => {
    if (tr.runningOn.includes(m)) lit(x, nowX - g.pitch, g.rowY(ti, mi), r * 1.05, C.GREEN, 1);
  }));
}

/** 表: solid bars on ECG paper, body-font ticks, a teal now-line with its label (world-now.html:632-669). */
export function drawOmote(x: CanvasRenderingContext2D, L: ChartLayout, g: Geom, hover: Hover, font = "500 11px sans-serif"): void {
  x.clearRect(0, 0, g.w, g.h);
  const ni = g.nowIdx, nowX = Math.round(g.dotX(Math.max(0, ni)));
  x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
  // ECG paper (spec §2.3, prototype now-c3a.html:806-809): a fine line every 15 min, a bold one every hour; the same
  // squares run vertically, every 4th bold. It replaces the grey row bands and hour rules (T10 verdict 6b).
  {
    const gx0 = Math.round(g.dotX(0) - g.pitch / 2), gx1 = Math.round(g.dotX(g.ndot - 1) + g.pitch / 2), gy0 = TOP - 4, gy1 = g.h - BOT + 4;
    const fs = (15 / g.minPerDot) * g.pitch;
    for (let q = 0; q <= (L.h1 - L.h0) * 4; q++) {
      x.fillStyle = q % 4 === 0 ? "rgba(184,50,42,.30)" : "rgba(184,50,42,.11)";
      x.fillRect(Math.round(gx0 + Math.round((q * 15) / g.minPerDot) * g.pitch), gy0, 1, gy1 - gy0);
    }
    for (let k = 0, yy = gy0; yy <= gy1 + 0.5; k++, yy += fs) {
      x.fillStyle = k % 4 === 0 ? "rgba(184,50,42,.24)" : "rgba(184,50,42,.09)"; x.fillRect(gx0, Math.round(yy), gx1 - gx0, 1);
    }
  }
  for (let h = L.h0; h <= L.h1; h++) {
    const cx = Math.round(hourX(L, g, h));
    x.fillStyle = h * 60 <= L.nowMin ? "#5b6573" : "#a3acb8";
    // the axis reaches the canvas edge: keep the last label on the canvas
    if (Math.abs(cx - nowX) > 40) x.fillText(pad2(h), Math.min(cx, g.w - x.measureText(pad2(h)).width / 2), 12);
  }
  const x0 = g.dotX(0) - g.pitch / 2;
  if (ni >= 0) { x.fillStyle = "rgba(14,124,134,.35)"; x.fillRect(x0, g.h - BOT + 8, nowX - x0, 2); }
  x.fillStyle = "#e3e7ec"; x.fillRect(nowX, g.h - BOT + 8, g.dotX(g.ndot - 1) - nowX, 2);
  const bh = Math.max(5, Math.min(g.rowH * 0.2, 9));
  L.tracks.forEach((tr, ti) => {
    const on = !!hover && hover.taskId === tr.taskId, dimmed = !!hover && !on;
    const col = on ? lineColor(tr.taskId) : tr.running ? "#0e7c86" : "#6f7d8e";
    g.cov[ti].forEach((cov, mi) => {
      const y = g.rowY(ti, mi), k = mi === 0 ? 1 : 0.75;
      let i = 0;
      while (i <= ni && i < g.ndot) {
        if (cov[i] <= 0.02) { i++; continue; }
        let j = i;
        while (j < g.ndot && j <= ni && cov[j] > 0.02) j++;
        x.globalAlpha = (dimmed ? 0.3 : 1) * (tr.running || on ? 1 : 0.6) * k;
        x.fillStyle = col; x.fillRect(g.dotX(i) - g.pitch / 2 + 0.5, y - bh / 2, g.dotX(j - 1) - g.dotX(i) + g.pitch - 1, bh);
        i = j;
      }
      x.globalAlpha = 1;
    });
  });
  if (ni < 0) return;
  x.fillStyle = "#0e7c86"; x.fillRect(nowX, TOP - 4, 1, g.h - BOT - TOP + 14);
  const str = hmOfMin(L.nowMin), tw = x.measureText(str).width + 12;
  x.fillRect(nowX - tw / 2, 3, tw, 18);
  x.fillStyle = "#fff"; x.fillText(str, nowX, 12.5);
  L.tracks.forEach((tr, ti) => L.machines.forEach((m, mi) => {
    if (!tr.runningOn.includes(m)) return;
    x.fillStyle = "#0e7c86"; x.beginPath(); x.arc(nowX, g.rowY(ti, mi), 3.5, 0, Math.PI * 2); x.fill();
  }));
}
