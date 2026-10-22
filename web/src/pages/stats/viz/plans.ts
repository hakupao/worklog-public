// 计划兑现 (`plans`, lab s9, many-to-many): rows = the tasks the range's day-plan items name, columns = the plan
// dates; a cell = each item of that date naming the task as two lamps (AI, manual: full = done, half = partial, dim
// = none, off = not judged) over a dot bar of the task's wall clock on that 5:00 day (concurrent tasks split evenly,
// U17). An item with several tasks counts toward each of its tasks' rows; an item without a task has no row but
// counts in the head figures. Many dates (C2): a column too narrow for a pair gets one lamp per item (the manual
// verdict, else the AI's); too many even for that, only the latest dates that fit are drawn.
import type { StatsPlan } from "../../../api/types";
import type { Glyph } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { C, inkOf, lineColor } from "../../../ui/palette";
import { drawGlyph, type TaskSil } from "../../../ui/taskGlyph";
import { taskCode } from "../../now/format";
import { dayStartMs, DAY_MS } from "./day";
import { bits } from "../../../led/bits";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import { lattice } from "./dayview";
import { segments, splitBy, type Prepared } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];
type Status = StatsPlan["ai_status"];

/** One task on one plan date: the items naming it (in plan order), its wall clock that day; `itemWall[i]` = item i's
 *  wall clock (Σ its tasks' wall clock that day). */
export interface PlanCell { items: StatsPlan[]; wall: number; itemWall: number[] }
export interface PlanRow { task: string; cells: PlanCell[] }
export interface Plans {
  dates: string[]; rows: PlanRow[];
  /** The bar scale: the largest planned cell's wall clock, at least 60 minutes (lab). */
  max: number;
  items: number; judged: number; aiDone: number; manDone: number; both: number; agree: number;
}

export function derivePlans(prep: Prepared, plans: readonly StatsPlan[]): Plans {
  const dates = [...new Set(plans.map((p) => p.date))].sort();
  const tasks = [...new Set(plans.flatMap((p) => p.task_ids))];
  const day = new Map(dates.map((d) => {
    const a = dayStartMs(d);
    return [d, splitBy(segments(prep, a, a + DAY_MS), prep, (s) => s.task_id ?? "")];
  }));
  const wallOf = (task: string, date: string) => day.get(date)!.get(task) ?? 0;
  const rows = tasks.map((task): PlanRow => ({
    task,
    cells: dates.map((d) => {
      const items = plans.filter((p) => p.date === d && p.task_ids.includes(task));
      return { items, wall: wallOf(task, d), itemWall: items.map((p) => p.task_ids.reduce((m, k) => m + wallOf(k, d), 0)) };
    }),
  }));
  const both = plans.filter((p) => p.ai_status && p.manual_status);
  return {
    dates, rows,
    max: Math.max(60, ...rows.flatMap((r) => r.cells.filter((c) => c.items.length).map((c) => c.wall))),
    items: plans.length, judged: plans.filter((p) => p.ai_status).length,
    aiDone: plans.filter((p) => p.ai_status === "done").length, manDone: plans.filter((p) => p.manual_status === "done").length,
    both: both.length, agree: both.filter((p) => p.ai_status === p.manual_status).length,
  };
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
const GL = 42, TOP = 12, RH = 11, CW_MAX = 36, LAMP = 4, PAIR = 11;   // dots; GL = the river's code column (a code is 34 dots wide)
const CW_PAIR = 2 * LAMP + 2, CW_MIN = LAMP + 2;                       // a column that holds a pair of lamps / one lamp

export const plansHeight = (rows: number) => (TOP + rows * RH + 2) * U;

/** Where the matrix was drawn (px): the `nc` dates from `c0` (the latest that fit), column k at x0 + k·cw, row r at
 *  y0 + r·rh; `merged` = one lamp per item (a column too narrow for a pair). */
export interface PlansGeom { x0: number; y0: number; cw: number; rh: number; c0: number; nc: number; nr: number; merged: boolean }

/** The (row, date index) under the point; null off the matrix. */
export function plansAt(g: PlansGeom, px: number, py: number): { r: number; c: number } | null {
  const k = Math.floor((px - g.x0) / g.cw), r = Math.floor((py - g.y0) / g.rh);
  return k >= 0 && k < g.nc && r >= 0 && r < g.nr ? { r, c: g.c0 + k } : null;
}

/** Columns for `n` dates across `nx` dots (C2): up to 36 wide; below a pair's width one merged lamp per item; when
 *  even one lamp's width does not fit them all, only the latest dates that fit. */
function fit(nx: number, n: number): { cw: number; c0: number; merged: boolean } {
  const room = nx - GL - 1, k = Math.min(n, Math.max(1, Math.floor(room / CW_MIN)));
  const cw = Math.max(1, Math.min(CW_MAX, Math.floor(room / Math.max(1, k))));
  return { cw, c0: n - k, merged: cw < CW_PAIR };
}
/** One lamp for an item when they are merged: the manual verdict if there is one, else the AI's. */
const merge = (it: StatsPlan): { v: Status; manual: boolean } => (it.manual_status ? { v: it.manual_status, manual: true } : { v: it.ai_status, manual: false });
/** Every k-th date label so the widest (`w`, in columns' units) keeps a gap to the next; one that would run past
 *  `right` is left out. */
const labelStep = (cw: number, w: number) => Math.max(1, Math.ceil((w + 2) / cw));
const fk = (hover: string | null, task: string) => (hover === null ? 1 : task === hover ? 1.25 : 0.3);

export function drawPlansUra(x: CanvasRenderingContext2D, pl: Plans, hover: string | null, g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn, sil?: TaskSil | null): PlansGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), { cw, c0, merged } = fit(nx, pl.dates.length);
  const shown = pl.dates.slice(c0), bw = (s: string) => (bitsFn ?? bits)(s, 8, glyph).w;
  const step = labelStep(cw, Math.max(0, ...shown.map((d) => bw(mdOf(d)))));
  x.save();
  shown.forEach((d, c) => { if (c % step === 0 && GL + c * cw + bw(mdOf(d)) <= nx) L.text(mdOf(d), GL + c * cw, 1, "left", 0.45, C.AMBER); });
  pl.rows.forEach((R, r) => {
    const j0 = TOP + r * RH, k = fk(hover, R.task), col = lineColor(R.task);
    const on = sil?.dots(R.task, 9);
    if (on) { const i0 = GL - 3 - 9; for (let q = 0; q < 9; q++) for (let c = 0; c < 9; c++) if (on[q * 9 + c]) L.dot(i0 + c, j0 + 1 + q, col, 0.9 * Math.min(1, k), 0.5); }
    else L.text(taskCode(R.task), GL - 3, j0 + 2, "right", 0.8 * Math.min(1, k), col);
    R.cells.slice(c0).forEach((cell, c) => {
      const i0 = GL + c * cw;
      if (!cell.items.length) { L.off(i0 + 1, j0 + 4, 0.1); L.off(i0 + 2, j0 + 4, 0.1); return; }
      const lamp = (i: number, v: Status, warm: boolean) => {
        for (let a = 0; a < LAMP; a++) for (let b = 0; b < LAMP; b++) {
          const on = v === "done" || (v === "partial" && a < LAMP / 2);
          if (on) L.dot(i + a, j0 + 1 + b, warm ? C.WARM : C.AMBER, k, 0.5);
          else L.off(i + a, j0 + 1 + b, v === "none" ? 0.3 : 0.12);
        }
      };
      cell.items.forEach((it, n) => {
        if (merged) {
          const i = i0 + n * (LAMP + 1), m = merge(it);
          if (i + LAMP > i0 + cw - 1) return;           // no room for another lamp
          lamp(i, m.v, m.manual);
          return;
        }
        const i = i0 + n * PAIR;
        if (i + 2 * LAMP + 1 > i0 + cw - 1) return;     // no room for another pair
        lamp(i, it.ai_status, false);
        lamp(i + LAMP + 1, it.manual_status, true);
      });
      const len = cw - 3, on = Math.round((cell.wall / pl.max) * len);
      for (let q = 0; q < len; q++) for (let b = 0; b < 2; b++) {
        if (q < on) L.dot(i0 + q, j0 + 6 + b, col, 0.9 * k, 0.5);
        else L.off(i0 + q, j0 + 6 + b, 0.05);
      }
    });
  });
  x.restore();
  return { x0: g.offX + GL * P, y0: g.offY + TOP * P, cw: cw * P, rh: RH * P, c0, nc: pl.dates.length - c0, nr: pl.rows.length, merged };
}

export function drawPlansOmote(x: CanvasRenderingContext2D, pl: Plans, hover: string | null, g: { w: number; h: number }, font: (weight: number) => string, sil?: TaskSil | null): PlansGeom {
  x.clearRect(0, 0, g.w, g.h);
  const u = U, { cw, c0, merged } = fit(Math.floor(g.w / u), pl.dates.length);
  x.textBaseline = "alphabetic"; x.textAlign = "left"; x.font = font(400); x.fillStyle = "#5b6573";
  const shown = pl.dates.slice(c0), tw = (d: string) => x.measureText(mdOf(d)).width;
  const step = labelStep(cw * u, Math.max(0, ...shown.map(tw)));
  shown.forEach((d, c) => { if (c % step === 0 && (GL + c * cw) * u + tw(d) <= g.w) x.fillText(mdOf(d), (GL + c * cw) * u, 26); });
  pl.rows.forEach((R, r) => {
    const y0 = (TOP + r * RH) * u, dim = hover !== null && hover !== R.task;
    x.globalAlpha = dim ? 0.3 : 1;
    x.font = font(600); x.textAlign = "right"; x.fillStyle = "#0f1c2e";
    if (sil) { const g = sil.of(R.task); drawGlyph(x, g, GL * u - 8 - 18, y0 + 1, 18, inkOf(g.color)); }
    else x.fillText(taskCode(R.task), GL * u - 8, y0 + 14);
    R.cells.slice(c0).forEach((cell, c) => {
      const x0 = (GL + c * cw) * u;
      if (!cell.items.length) { x.fillStyle = "rgba(15,28,46,.15)"; x.fillRect(x0 + 3, y0 + 12, 6, 1); return; }
      const lamp = (cx: number, v: Status) => {
        const cy = y0 + 3 * u + 1;
        x.beginPath(); x.arc(cx, cy, 4.5, 0, Math.PI * 2);
        x.strokeStyle = v === null ? "rgba(91,101,115,.4)" : "#5b6573"; x.lineWidth = 1; x.stroke();
        if (v === "done") { x.fillStyle = "#0f1c2e"; x.fill(); }
        else if (v === "partial") { x.beginPath(); x.arc(cx, cy, 4.5, Math.PI / 2, -Math.PI / 2); x.fillStyle = "#0f1c2e"; x.fill(); }
      };
      cell.items.forEach((it, n) => {
        if (merged) {
          const i = x0 + n * (LAMP + 1) * u;
          if (i + LAMP * u > x0 + (cw - 1) * u) return;
          lamp(i + 6, merge(it).v);
          return;
        }
        const i = x0 + n * PAIR * u;
        if (i + 2 * LAMP * u + u > x0 + (cw - 1) * u) return;
        lamp(i + 6, it.ai_status);
        lamp(i + 6 + (LAMP + 1) * u, it.manual_status);
      });
      const len = (cw - 3) * u;
      x.fillStyle = "rgba(15,28,46,.07)"; x.fillRect(x0, y0 + 6 * u, len, 2 * u - 1);
      x.fillStyle = inkOf(lineColor(R.task)); x.fillRect(x0, y0 + 6 * u, (cell.wall / pl.max) * len, 2 * u - 1);
    });
    x.globalAlpha = 1;
  });
  return { x0: GL * u, y0: TOP * u, cw: cw * u, rh: RH * u, c0, nc: pl.dates.length - c0, nr: pl.rows.length, merged };
}
