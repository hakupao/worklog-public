// 算力构成 (`compute`, lab s7; needs stats.cost): per Monday week a dot column of the tokens by kind — cache read,
// cache write, input, output from the bottom, 1 dot = `unit` tokens, the unit the smallest 1-2-5 step that fits the
// busiest week — with the week's cost above and its cost per wall-clock hour below. A session's tokens and cost go
// whole to the week of its first instant in the window (as the headlines). $/h divides by the week's WALL clock
// (calendar's week union, the range's part of a cut week), not the summed session time the lab used. Beside it:
// machine / agent shares of wall clock (split evenly, U17) and of cost, model-family token shares, subagent share.
import type { StatsSession } from "../../../api/types";
import type { Glyph } from "../../../prefs/types";
import { bits } from "../../../led/bits";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import { C } from "../../../ui/palette";
import { deriveCalendar, type CalWeek } from "./calendar";
import { day5, weekMonday } from "./day";
import { lattice } from "./dayview";
import { splitBy, unionMin, type DayAgg, type Prepared, type Seg } from "./wall";

type BitsFn = Parameters<typeof lattice>[4];

/** Bottom to top in a column. */
export const KINDS = ["cache_read", "cache_write", "input", "output"] as const;
export type Kind = (typeof KINDS)[number];
export type Kinds = Record<Kind, number>;

/** `cost` sums the known amounts; `partial` = some session in it has no amount or a partial one. `perHour` = cost ÷
 *  wall-clock hours (null without wall clock); `counts` = dots per kind at the view's unit; `families` = the week's
 *  tokens by model family, most first (F3). */
export interface ComputeWeek extends CalWeek { kinds: Kinds; tok: number; cost: number; partial: boolean; perHour: number | null; counts: number[]; families: [string, number][] }
/** A machine's / agent's wall clock (split evenly where they overlap) and known cost (whole sessions). */
export interface Share { key: string; wall: number; cost: number }
export interface Compute {
  weeks: ComputeWeek[];
  /** Tokens per dot; `rows` = the tallest column in rows of BW dots. */
  unit: number; rows: number;
  kinds: Kinds; tok: number; cost: number; partial: boolean; wall: number; perHour: number | null;
  machines: Share[]; agents: Share[];
  /** Model family → tokens, most first. */
  families: [string, number][];
  /** Subagent tokens (a subset of `tok`). */
  sub: number;
}

/** Dots per row of a week's column, and the most rows the unit lets the busiest week take. */
export const BW = 16;
export const MAX_ROWS = 24;

const zero = (): Kinds => ({ cache_read: 0, cache_write: 0, input: 0, output: 0 });

/** Lab `fam`: the model family of a model name. */
export function familyOf(model: string): string {
  const m = model.toLowerCase();
  return /fable/.test(m) ? "Fable" : /opus/.test(m) ? "Opus" : /sonnet/.test(m) ? "Sonnet" : /haiku/.test(m) ? "Haiku" : /gpt/.test(m) ? "GPT" : "other";
}

/** Dots per kind at `unit` (a kind with any tokens gets at least one, lab). */
export const countsOf = (k: Kinds, unit: number) => KINDS.map((q) => (k[q] > 0 ? Math.max(1, Math.round(k[q] / unit)) : 0));

/** The smallest 1-2-5 step whose columns all fit BW × MAX_ROWS dots. */
export function unitFor(weeks: readonly Kinds[]): number {
  for (let e = 1; ; e *= 10) for (const n of [1, 2, 5]) {
    const u = n * e;
    if (weeks.every((k) => countsOf(k, u).reduce((m, c) => m + c, 0) <= BW * MAX_ROWS)) return u;
  }
}

/** Family → tokens as a list, the families with any, most first. */
const byMost = (fam: Map<string, number>): [string, number][] => [...fam].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

const unpriced = (s: StatsSession) => s.cost_usd === null || s.cost_partial;

function shares(segs: Seg[], prep: Prepared, keyOf: (s: StatsSession) => string): Share[] {
  const wall = splitBy(segs, prep, keyOf), cost = new Map<string, number>();
  for (const s of prep.sessions) cost.set(keyOf(s), (cost.get(keyOf(s)) ?? 0) + (s.cost_usd ?? 0));
  return [...new Set([...wall.keys(), ...cost.keys()])].map((key) => ({ key, wall: wall.get(key) ?? 0, cost: cost.get(key) ?? 0 }))
    .sort((a, b) => b.wall - a.wall || (a.key < b.key ? -1 : 1));
}

export function deriveCompute(prep: Prepared, segs: Seg[], days: readonly DayAgg[]): Compute {
  const cal = deriveCalendar(days).weeks;
  const at = new Map(cal.map((w, i) => [w.mon, i]));
  const acc = cal.map(() => ({ kinds: zero(), tok: 0, cost: 0, partial: false, fam: new Map<string, number>() }));
  const kinds = zero(), fam = new Map<string, number>();
  let sub = 0;
  for (const s of prep.sessions) {
    const w = acc[at.get(weekMonday(day5(s.t0)))!];
    for (const [model, k] of Object.entries(s.tokens ?? {})) {
      for (const q of KINDS) { w.kinds[q] += k[q]; kinds[q] += k[q]; }
      const n = k.input + k.output + k.cache_read + k.cache_write;
      w.tok += n;
      fam.set(familyOf(model), (fam.get(familyOf(model)) ?? 0) + n);
      w.fam.set(familyOf(model), (w.fam.get(familyOf(model)) ?? 0) + n);
    }
    w.cost += s.cost_usd ?? 0;
    w.partial ||= unpriced(s);
    sub += s.subagent_tokens ?? 0;
  }
  const unit = unitFor(acc.map((w) => w.kinds));
  const weeks = cal.map((c, i): ComputeWeek => {
    const { fam: wf, ...a } = acc[i];
    return { ...c, ...a, perHour: c.union > 0 ? a.cost / (c.union / 60) : null, counts: countsOf(a.kinds, unit), families: byMost(wf) };
  });
  const tok = KINDS.reduce((m, q) => m + kinds[q], 0), cost = acc.reduce((m, w) => m + w.cost, 0), wall = unionMin(segs);
  return {
    weeks, unit, rows: Math.max(1, ...weeks.map((w) => Math.ceil(w.counts.reduce((m, c) => m + c, 0) / BW))),
    kinds, tok, cost, partial: acc.some((w) => w.partial), wall, perHour: wall > 0 ? cost / (wall / 60) : null,
    machines: shares(segs, prep, (s) => s.machine), agents: shares(segs, prep, (s) => s.agent),
    families: byMost(fam),
    sub,
  };
}

/** "$12", "$1.2k": the short amount printed on a column. */
export const usdShort = (x: number) => (x >= 1000 ? `$${Math.round(x / 100) / 10}k` : `$${Math.round(x)}`);

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
const GL = 2, TOPM = 12, BOTM = 22;                       // dots: left gutter, cost-label strip, week-label + $/h strip

export const computeHeight = (rows: number) => (TOPM + rows + BOTM) * U;

/** Where the columns were drawn (px): week i spans [x0 + i·cw, x0 + (i+1)·cw); `unit` = the tokens per dot drawn. */
export interface ComputeGeom { x0: number; cw: number; n: number; unit: number }

/** The week (index) under the point; null outside the columns. */
export function computeAt(g: ComputeGeom, px: number): number | null {
  const i = Math.floor((px - g.x0) / g.cw);
  return g.cw > 0 && i >= 0 && i < g.n ? i : null;
}

const colW = (nx: number, n: number) => Math.max(1, Math.floor((nx - GL - 1) / Math.max(1, n)));
const bwOf = (cw: number) => Math.max(2, Math.min(BW, cw - 2));
/** 里's look per kind (lab KINDS): colour, alpha, glow. */
/** The unit and dots per kind as drawn `bw` dots wide: `c.unit` fits BW-wide columns into `c.rows` rows (the canvas
 *  height); a narrower column takes the next 1-2-5 step up until the tallest one fits those rows again. */
export function fitCompute(c: Compute, bw: number): { unit: number; counts: number[][] } {
  const top = Math.max(1, ...c.weeks.flatMap((w) => KINDS.map((q) => w.kinds[q])));
  const fits = (u: number) => c.weeks.every((w) => Math.ceil(countsOf(w.kinds, u).reduce((m, k) => m + k, 0) / bw) <= c.rows);
  const done = (u: number) => fits(u) || u >= top;   // past the largest kind every count is its minimum
  let unit = c.unit;
  for (let e = 1; !done(unit); e *= 10) for (const n of [1, 2, 5]) if (n * e > unit && !done(unit)) unit = n * e;
  return { unit, counts: c.weeks.map((w) => countsOf(w.kinds, unit)) };
}

/** Every how many weeks the cost and $/h labels go (P2: twelve weeks' ran together): every week while the widest of
 *  them (`width`, in dots, plus 2 apart) fits a column `cw` dots wide, else every other, every third …, counted from
 *  the latest week. The amounts of the weeks left out are in the tip. */
function labelStep(c: Compute, cw: number, width: (s: string) => number): number {
  const widest = Math.max(0, ...c.weeks.flatMap((w) => [w.tok > 0 ? width(usdShort(w.cost)) : 0, w.perHour === null ? 0 : width(`${usdShort(w.perHour)}/h`)]));
  return Math.max(1, Math.ceil((widest + 2) / cw));
}

const LOOK: [string, number, number][] = [[C.AMBER, 0.15, 0], [C.AMBER, 0.85, 0.5], ["#ffc46a", 1, 0.5], ["#ffffff", 1, 1]];

export function drawComputeUra(x: CanvasRenderingContext2D, c: Compute, g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn?: BitsFn): ComputeGeom {
  x.clearRect(0, 0, g.w, g.h);
  const L = lattice(x, g.offX, g.offY, glyph, bitsFn);
  const nx = Math.floor((g.w - g.offX) / P), n = c.weeks.length, cw = colW(nx, n), bw = bwOf(cw), base = TOPM + c.rows, fit = fitCompute(c, bw);
  const step = labelStep(c, cw, (s) => (bitsFn ?? bits)(s, 8, glyph).w);
  x.save();
  c.weeks.forEach((w, wi) => {
    const i0 = GL + wi * cw, counts = fit.counts[wi], tot = counts.reduce((m, k) => m + k, 0);
    let q = 0;
    counts.forEach((cnt, ki) => {
      const [col, a, gl] = LOOK[ki];
      for (let d = 0; d < cnt; d++, q++) { const j = base - 1 - Math.floor(q / bw); if (j >= 0) L.dot(i0 + (q % bw), j, col, a, gl); }
    });
    for (; q < Math.ceil(tot / bw) * bw; q++) L.off(i0 + (q % bw), base - 1 - Math.floor(q / bw), 0.06);
    const lab = (n - 1 - wi) % step === 0;
    if (lab && w.tok > 0) L.text(usdShort(w.cost), i0, Math.max(0, base - Math.ceil(tot / bw) - 10), "left", 0.55, C.AMBER);
    L.text(w.label, i0, base + 2, "left", w.cut ? 0.22 : 0.42, C.AMBER);
    if (lab && w.perHour !== null) L.text(`${usdShort(w.perHour)}/h`, i0, base + 12, "left", 0.3, C.AMBER);
  });
  x.restore();
  return { x0: g.offX + GL * P, cw: cw * P, n, unit: fit.unit };
}

const INK = ["rgba(15,28,46,.22)", "rgba(15,28,46,.55)", "#0f1c2e", "#0b1626"];

export function drawComputeOmote(x: CanvasRenderingContext2D, c: Compute, g: { w: number; h: number }, font: (weight: number) => string): ComputeGeom {
  x.clearRect(0, 0, g.w, g.h);
  const n = c.weeks.length, cw = colW(g.w / U, n), bw = bwOf(cw), base = (TOPM + c.rows) * U, unit = fitCompute(c, bw).unit, k = U / unit / bw;
  x.textAlign = "left"; x.textBaseline = "alphabetic"; x.font = font(400);
  const step = labelStep(c, cw, (s) => x.measureText(s).width / U);
  c.weeks.forEach((w, wi) => {
    const x0 = (GL + wi * cw) * U, lab = (n - 1 - wi) % step === 0;
    let y = base;
    KINDS.forEach((q, ki) => {
      const h = ki === 3 ? Math.max(w.kinds[q] ? 2 : 0, w.kinds[q] * k) : w.kinds[q] * k;
      x.fillStyle = INK[ki];
      x.fillRect(x0, y - h, bw * U, h);
      y -= h;
    });
    x.font = font(400); x.fillStyle = "#5b6573";
    if (lab && w.tok > 0) x.fillText(usdShort(w.cost), x0, y - 4);
    x.globalAlpha = w.cut ? 0.45 : 1; x.fillStyle = "#0f1c2e"; x.fillText(w.label, x0, base + 14); x.globalAlpha = 1;
    if (lab && w.perHour !== null) { x.fillStyle = "#97a1ae"; x.fillText(`${usdShort(w.perHour)}/h`, x0, base + 28); }
  });
  return { x0: GL * U, cw: cw * U, n, unit };
}
