// 产出密度 (`density`, lab s8): one row per task, each of its sessions a dot at its turns per hour on a log axis
// (0.5–200/h), the row's median a white tick; rows by median, fastest first. Hours are the session's wall clock in
// the window (PSession.wall); its turns and files count in the window's share of the session, wall / active_minutes
// (capped at 1; the wall clock where there are no active minutes), so a long session the range cuts to a few minutes
// does not read as thousands an hour (F2). Only tasks with at least 3 sessions of ≥ 5 min and ≥ 120 min over all their sessions
// (lab filter); unlinked sessions left out.
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { C, inkOf, lineColor } from "../../../ui/palette";
import { drawGlyph, type TaskSil } from "../../../ui/taskGlyph";
import { taskCode } from "../../now/format";
import { lattice } from "./dayview";
import type { Prepared, PSession } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];

export const MIN_SESSION = 5;
export const MIN_SESSIONS = 3;
export const MIN_TASK = 120;

/** A session's turns / files in the window (its share) per wall-clock hour in the window. */
export interface DensityDot { s: PSession; tph: number; fph: number }
/** `dots`: the task's sessions of ≥ MIN_SESSION minutes; `med` / `fmed`: their median turns / files per hour;
 *  `wall`, `turns`, `files`: over all its sessions in the range. */
export interface DensityRow { task: string; dots: DensityDot[]; med: number; fmed: number; wall: number; turns: number; files: number; sessions: number }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function deriveDensity(prep: Prepared): DensityRow[] {
  const by = new Map<string, PSession[]>();
  for (const s of prep.sessions) if (s.task_id) by.set(s.task_id, [...(by.get(s.task_id) ?? []), s]);
  const rows: DensityRow[] = [];
  for (const [task, ss] of by) {
    const wall = ss.reduce((m, s) => m + s.wall, 0), long = ss.filter((s) => s.wall >= MIN_SESSION);
    if (long.length < MIN_SESSIONS || wall < MIN_TASK) continue;
    const dots = long.map((s) => {
      const share = s.active_minutes > 0 ? Math.min(1, s.wall / s.active_minutes) : 1, h = s.wall / 60;
      return { s, tph: (s.turns * share) / h, fph: (s.files * share) / h };
    });
    rows.push({
      task, dots, med: median(dots.map((d) => d.tph)), fmed: median(dots.map((d) => d.fph)), wall,
      turns: ss.reduce((m, s) => m + s.turns, 0), files: ss.reduce((m, s) => m + s.files, 0), sessions: ss.length,
    });
  }
  return rows.sort((a, b) => b.med - a.med || (a.task < b.task ? -1 : 1));
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
const RH = 11, TOP = 2, BOT = 12, GL = 42, GR = 30;      // dots; GL = the river's code column (a code is 34 dots wide)
const LO = Math.log(0.5), HI = Math.log(200);
export const TICKS = [1, 3, 10, 30, 100];

export const densityHeight = (n: number) => (TOP + n * RH + BOT) * U;

/** Fraction along the log axis of a rate (clamped to 0.5–200/h). */
export const axisOf = (v: number) => Math.max(0, Math.min(1, (Math.log(Math.max(0.5, v)) - LO) / (HI - LO)));

/** A dot's small vertical jitter in dots (lab: id hash, −3…3). */
export function jitter(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 7) - 3;
}

/** Where the rows were drawn (px): row r spans [y0 + r·rh, y0 + (r+1)·rh). */
export interface DensityGeom { y0: number; rh: number; n: number }

/** The row (index) under the point; null above / below the rows. */
export function densityAt(g: DensityGeom, py: number): number | null {
  const r = Math.floor((py - g.y0) / g.rh);
  return r >= 0 && r < g.n ? r : null;
}

const fk = (hover: string | null, task: string) => (hover === null ? 1 : task === hover ? 1.25 : 0.3);
const one = (v: number) => String(Math.round(v * 10) / 10);

export function drawDensityUra(x: CanvasRenderingContext2D, rows: DensityRow[], hover: string | null, g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn, sil?: TaskSil | null): DensityGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), cols = Math.max(2, nx - GL - GR), xOf = (v: number) => GL + axisOf(v) * (cols - 1);
  x.save();
  for (const v of TICKS) {
    const i = Math.round(xOf(v));
    for (let j = TOP; j < TOP + rows.length * RH; j += 3) L.off(i, j, 0.12);
    L.text(`${v}/h`, i, TOP + rows.length * RH + 2, "center", 0.38, C.AMBER);
  }
  rows.forEach((R, ri) => {
    const j0 = TOP + ri * RH, yc = j0 + 5, k = fk(hover, R.task), col = lineColor(R.task);
    const on = sil?.dots(R.task, 9);
    if (on) { const i0 = GL - 4 - 9; for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (on[r * 9 + c]) L.dot(i0 + c, j0 + 1 + r, col, 0.9 * Math.min(1, k), 0.5); }
    else L.text(taskCode(R.task), GL - 4, j0 + 1, "right", 0.8 * Math.min(1, k), col);
    for (let i = GL; i < GL + cols; i += 2) L.off(i, yc, 0.06);
    for (const d of R.dots) {
      const cx = Math.round(xOf(d.tph)), cy = yc + jitter(d.s.id), r = 0.45 + Math.sqrt(d.s.files) * 0.2, Rr = Math.ceil(r);
      for (let di = -Rr; di <= Rr; di++) for (let dj = -Rr; dj <= Rr; dj++) {
        const dd = Math.hypot(di, dj);
        if (dd <= r + 0.3) L.dot(cx + di, cy + dj, col, (0.45 + 0.4 * (1 - dd / (r + 1))) * k, hover === R.task ? 0.8 : 0.5);
      }
    }
    const mi = Math.round(xOf(R.med));
    for (let r = -4; r <= 4; r++) L.dot(mi, yc + r, "#fff4e2", Math.min(1, 0.85 * k), 0.7);
    L.text(`${Math.round(R.med)}·${one(R.fmed)}`, nx - 2, j0 + 1, "right", 0.6 * Math.min(1, k), C.WARM);
  });
  x.restore();
  return { y0: g.offY + TOP * P, rh: RH * P, n: rows.length };
}

export function drawDensityOmote(x: CanvasRenderingContext2D, rows: DensityRow[], hover: string | null, g: { w: number; h: number }, font: (weight: number) => string, sil?: TaskSil | null): DensityGeom {
  x.clearRect(0, 0, g.w, g.h);
  const u = U, cols = Math.max(2, g.w / u - GL - GR), xOf = (v: number) => (GL + axisOf(v) * (cols - 1)) * u;
  x.textBaseline = "alphabetic";
  x.font = font(400); x.textAlign = "center";
  for (const v of TICKS) {
    const q = xOf(v);
    x.fillStyle = "rgba(15,28,46,.06)"; x.fillRect(q, 0, 1, (TOP + rows.length * RH) * u);
    x.fillStyle = "#5b6573"; x.fillText(`${v}/h`, q, g.h - 3);
  }
  rows.forEach((R, ri) => {
    const yc = (TOP + ri * RH + 5) * u, dim = hover !== null && hover !== R.task;
    x.globalAlpha = dim ? 0.3 : 1; x.font = font(600); x.textAlign = "right"; x.fillStyle = "#0f1c2e";
    if (sil) { const g = sil.of(R.task); drawGlyph(x, g, GL * u - 8 - 24, yc - 12, 24, inkOf(g.color)); }
    else x.fillText(taskCode(R.task), GL * u - 8, yc + 4);
    x.fillStyle = inkOf(lineColor(R.task));
    for (const d of R.dots) {
      x.globalAlpha = 0.55 * (dim ? 0.3 : 1);
      x.beginPath(); x.arc(xOf(d.tph), yc + jitter(d.s.id) * 3, 1.6 + Math.sqrt(d.s.files) * 0.55, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = dim ? 0.3 : 1; x.fillStyle = "#0b1626"; x.fillRect(xOf(R.med) - 1, yc - 11, 2, 22);
    x.font = font(400); x.fillStyle = "#0f1c2e"; x.fillText(`${Math.round(R.med)} · ${one(R.fmed)}`, g.w - 4, yc + 4);
    x.globalAlpha = 1;
  });
  return { y0: TOP * u, rh: RH * u, n: rows.length };
}
