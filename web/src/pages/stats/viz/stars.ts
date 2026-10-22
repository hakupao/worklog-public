// 会话星图 (`stars`, lab s4): one star per session — x = its first instant across the window, y = its window minutes
// on a log scale (1 minute to 24 hours), size = tokens, colour = the task's line colour (unlinked grey), hollow =
// Codex. Hovering a task anywhere on the page draws its constellation (its sessions joined in time order) and drops
// the others to .3. The costliest (only where amounts may show) and the longest are labelled. 里: LED dots on the
// PITCH lattice, the static layer drawn once; the twinkle (the view's one moving thing) is a separate overlay
// (drawTwinkleUra) that brightens only the bigger stars' cores. 表: ink discs.
import { usd } from "../../../lib/format";
import { bits as defaultBits } from "../../../led/bits";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { C, inkOf, lineColor } from "../../../ui/palette";
import { daysOf } from "./day";
import { hmin } from "./fmt";
import { lattice } from "./dayview";
import { tokensOf } from "./headlines";
import type { Prepared, PSession } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];

/** `x`, `y` in [0, 1]; `r` in dots; `ph` the twinkle phase; `tok` 0 where tokens were not collected. */
export interface Star { s: PSession; x: number; y: number; r: number; ph: number; tok: number }
export interface Stars { stars: Star[]; maxTok: number; longest: PSession | null; costliest: PSession | null }

const LOG_DAY = Math.log(1440);

/** Stars biggest token count first (drawn first, so small ones stay on top); ties keep the sessions' order. */
export function deriveStars(p: Prepared): Stars {
  const span = p.b - p.a;
  const toks = p.sessions.map((s) => ({ s, tok: tokensOf(s) ?? 0 })).sort((a, b) => b.tok - a.tok);
  const maxTok = Math.max(0, ...toks.map((t) => t.tok));
  const stars = toks.map(({ s, tok }, i): Star => ({
    s, tok, ph: (i * 2.399) % 6.283,
    x: (s.t0 - p.a) / span, y: Math.min(1, Math.log(Math.max(1, s.wall)) / LOG_DAY),
    r: 0.6 + (maxTok > 0 ? 6.2 * (tok / maxTok) ** 0.45 : 0),
  }));
  let longest: PSession | null = null, costliest: PSession | null = null;
  for (const s of p.sessions) {
    if (!longest || s.wall > longest.wall) longest = s;
    if (s.cost_usd !== null && s.cost_usd > 0 && (!costliest || s.cost_usd > costliest.cost_usd!)) costliest = s;
  }
  return { stars, maxTok, longest, costliest };
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
const RH = 176, BOT = 13, GL = 22, GR = 4, ROWS = RH - BOT - 4;     // dots
const TICKS: [number, string][] = [[1, "1m"], [10, "10m"], [60, "1h"], [240, "4h"], [720, "12h"]];
const yOf = (m: number) => Math.log(m) / LOG_DAY;

export const STARS_HEIGHT = RH * U;

/** A star as drawn: centre and radius in px (hit test); in 里 also its lattice centre / radius in dots, colour, phase
 *  and hover factor, so the twinkle overlay redraws only the stars. */
export interface StarPt { px: number; py: number; rp: number; cx: number; cy: number; r: number; col: string; ph: number; k: number }
export interface StarsGeom { pts: StarPt[]; offX: number; offY: number }

/** The star (index into stars) whose rim is nearest the point, within 10px; null otherwise. */
export function starAt(g: StarsGeom, px: number, py: number): number | null {
  let best = -1, bd = Infinity;
  g.pts.forEach((q, i) => { const d = Math.hypot(q.px - px, q.py - py) - q.rp; if (d < bd) { bd = d; best = i; } });
  return best >= 0 && bd <= 10 ? best : null;
}

/** Hover factor: none 1, the hovered task 1.25, the others .3. */
const fk = (hover: string | null, task: string | null) => (hover === null ? 1 : task === hover ? 1.25 : 0.3);
/** The days that get an x label: the first and each month's 1st. */
const marks = (p: Prepared) => daysOf(p.from, p.to).flatMap((d, i) => (i === 0 || d.endsWith("-01") ? [{ d, i }] : []));

/** `cost`: whether the costliest star's amount may be printed. */
export function drawStarsUra(x: CanvasRenderingContext2D, st: Stars, p: Prepared, hover: string | null, cost: boolean,
  g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn): StarsGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), cols = Math.max(1, nx - GL - GR), nd = daysOf(p.from, p.to).length;
  const pos = (s: Star): [number, number] => [GL + s.x * cols, 3 + (1 - s.y) * ROWS];
  x.save();
  for (const [m, l] of TICKS) {
    const j = Math.round(3 + (1 - yOf(m)) * ROWS);
    for (let i = GL; i < GL + cols; i += 3) L.off(i, j, 0.13);
    L.text(l, GL - 3, j - 3, "right", 0.38, C.AMBER);
  }
  for (const { d, i } of marks(p)) {
    const q = GL + Math.round((i / nd) * cols);
    if (i) for (let j = 3; j < RH - BOT; j += 3) L.off(q, j, 0.13);
    L.text(mdOf(d), q + (i ? 2 : 0), RH - BOT + 2, "left", 0.45, C.AMBER);
  }
  if (hover !== null) {                                // the hovered task's constellation
    const ch = st.stars.filter((s) => s.s.task_id === hover).sort((a, b) => a.s.t0 - b.s.t0).map(pos), col = lineColor(hover);
    for (let n = 1; n < ch.length; n++) {
      const [x0, y0] = ch[n - 1], [x1, y1] = ch[n], len = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let u = 0; u <= len; u += 2) L.dot(Math.round(x0 + ((x1 - x0) * u) / len), Math.round(y0 + ((y1 - y0) * u) / len), col, 0.38, 0.3);
    }
  }
  const pts: StarPt[] = [];
  for (const s of st.stars) {
    const [cx, cy] = pos(s), k = fk(hover, s.s.task_id), col = lineColor(s.s.task_id), R = Math.ceil(s.r), hollow = s.s.agent === "codex";
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
      const d = Math.hypot(di + (cx % 1) - 0.5, dj + (cy % 1) - 0.5);
      if (d > s.r + 0.25 || (hollow && d < s.r - 1.1 && s.r > 1.6)) continue;
      const f = 1 - d / (s.r + 0.6);
      L.dot(Math.floor(cx) + di, Math.floor(cy) + dj, d < 0.8 && s.r > 2 ? "#fff4e2" : col, Math.min(1, (0.3 + 0.8 * f) * k * (hover === null ? 0.9 : 1)), 0.8);
    }
    pts.push({ px: g.offX + cx * P, py: g.offY + cy * P, rp: s.r * P, cx, cy, r: s.r, col, ph: s.ph, k });
  }
  for (const [s, lab] of labels(st, cost)) {        // above the star, below it when that runs off the top; kept inside
    const star = st.stars.find((z) => z.s === s)!, [cx, cy] = pos(star), half = Math.ceil((bitsFn ?? defaultBits)(lab, 8, glyph).w / 2);
    const up = Math.floor(cy) - Math.ceil(star.r) - 12;
    L.text(lab, Math.max(half, Math.min(nx - half, Math.floor(cx))), up >= 0 ? up : Math.floor(cy) + Math.ceil(star.r) + 3, "center", 0.85, C.WARM);
  }
  x.restore();
  return { pts, offX: g.offX, offY: g.offY };
}

/** The costliest's amount (only with `cost`) and the longest's minutes (unless it is that same star). */
function labels(st: Stars, cost: boolean): [PSession, string][] {
  const out: [PSession, string][] = [];
  if (cost && st.costliest) out.push([st.costliest, usd(st.costliest.cost_usd!)]);
  if (st.longest && !(cost && st.longest === st.costliest)) out.push([st.longest, hmin(st.longest.wall)]);   // one label a star
  return out;
}

/** The twinkle overlay at `now` ms (lab .82 + .18·sin(now / 900 + ph), here added on top of the static stars): the
 *  cores of stars at least 1.6 dots across brighten with their own phase. Clears only its own canvas. */
export function drawTwinkleUra(x: CanvasRenderingContext2D, g: StarsGeom, now: number, w: number, h: number): void {
  x.clearRect(0, 0, w, h);
  const L = lattice(x, g.offX, g.offY, "zh");
  x.save();
  for (const q of g.pts) {
    if (q.r < 1.6) continue;
    const tw = Math.sin(now / 900 + q.ph);
    if (tw < 0.05) continue;
    const R = Math.ceil(q.r * 0.55);
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
      const d = Math.hypot(di + (q.cx % 1) - 0.5, dj + (q.cy % 1) - 0.5);
      if (d >= q.r * 0.55) continue;
      L.dot(Math.floor(q.cx) + di, Math.floor(q.cy) + dj, d < 0.8 ? "#fff4e2" : q.col, 0.35 * tw * Math.min(1, q.k), 0.5);
    }
  }
  x.restore();
}

const INK = { t0: "#0b1626", t2: "#5b6573", hair: "rgba(15,28,46,.12)", hair2: "rgba(15,28,46,.06)" };

export function drawStarsOmote(x: CanvasRenderingContext2D, st: Stars, p: Prepared, hover: string | null, cost: boolean,
  g: { w: number; h: number }, font: (weight: number) => string): StarsGeom {
  x.clearRect(0, 0, g.w, g.h);
  const x0 = GL * U, w = Math.max(1, g.w - (GL + GR) * U), nd = daysOf(p.from, p.to).length;
  const X = (s: Star) => x0 + s.x * w, Y = (y: number) => (3 + (1 - y) * ROWS) * U;
  x.font = font(400); x.textBaseline = "alphabetic";
  for (const [m, l] of TICKS) {
    x.fillStyle = INK.hair2; x.fillRect(x0, Y(yOf(m)), w, 1);
    x.fillStyle = INK.t2; x.textAlign = "right"; x.fillText(l, x0 - 6, Y(yOf(m)) + 4);
  }
  x.textAlign = "left";
  for (const { d, i } of marks(p)) {
    const q = x0 + (i / nd) * w;
    if (i) { x.fillStyle = INK.hair; x.fillRect(q, 0, 1, g.h - 16); }
    x.fillStyle = INK.t2; x.fillText(mdOf(d), i ? q + 3 : x0, g.h - 3);
  }
  if (hover !== null) {
    const ch = st.stars.filter((s) => s.s.task_id === hover).sort((a, b) => a.s.t0 - b.s.t0);
    x.strokeStyle = inkOf(lineColor(hover)); x.lineWidth = 1; x.globalAlpha = 0.6;
    x.beginPath();
    for (const s of ch) x.lineTo(X(s), Y(s.y));
    x.stroke();
    x.globalAlpha = 1;
  }
  const pts: StarPt[] = [];
  for (const s of st.stars) {
    const r = s.r * U * 0.95 + 0.8, col = inkOf(lineColor(s.s.task_id)), cx = X(s), cy = Y(s.y);
    x.globalAlpha = hover !== null && s.s.task_id !== hover ? 0.3 : 0.75;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2);
    if (s.s.agent === "codex") { x.strokeStyle = col; x.lineWidth = 1.4; x.stroke(); } else { x.fillStyle = col; x.fill(); }
    x.globalAlpha = 1;
    pts.push({ px: cx, py: cy, rp: r, cx: 0, cy: 0, r: s.r, col, ph: s.ph, k: 1 });
  }
  x.font = font(600); x.textAlign = "center"; x.fillStyle = INK.t0;
  for (const [s, lab] of labels(st, cost)) {        // above the star, below it when that runs off the top; kept inside
    const star = st.stars.find((z) => z.s === s)!, half = x.measureText(lab).width / 2, up = Y(star.y) - star.r * U - 6;
    x.fillText(lab, Math.max(half, Math.min(g.w - half, X(star))), up >= 12 ? up : Y(star.y) + star.r * U + 14);
  }
  return { pts, offX: 0, offY: 0 };
}
