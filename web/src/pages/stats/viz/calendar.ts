// 日历热力 (`calendar`, lab s6): columns = the Monday weeks the range touches, rows = weekdays; each day a bar as long
// as its wall clock against the range's longest day, whiter the more it ran in parallel (summed / wall); the
// longest streak of active days marked. A week the range cuts is labelled dim and its days outside the range are
// left blank (spec §3).
import { disc, lit } from "../../../chart/canvas";
import { bits, type Bitmap } from "../../../led/bits";
import type { PixelSize } from "../../../led/fonts";
import { OMOTE_UNIT, PITCH } from "../../../led/lattice";
import type { Glyph } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { C } from "../../../ui/palette";
import { hours } from "../../../lib/format";
import { DAY_MS, isoWeekKey, weekdayOf, weekMonday } from "./day";
import { streakOf } from "./headlines";
import type { DayAgg } from "./wall";

export interface CalWeek { mon: string; label: string; union: number; cut: boolean }
/** `ratio` = summed / wall clock (1 for an idle day); `streak` = inside the longest run of active days. */
export interface CalCell { day: DayAgg; wi: number; dow: number; ratio: number; streak: boolean }
export interface Calendar { weeks: CalWeek[]; cells: CalCell[]; maxUnion: number; streak: { len: number; from: string; to: string } | null }

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function deriveCalendar(days: readonly DayAgg[]): Calendar {
  if (!days.length) return { weeks: [], cells: [], maxUnion: 0, streak: null };
  const from = days[0].date, to = days[days.length - 1].date, m0 = utc(weekMonday(from));
  const weeks: CalWeek[] = [];
  for (let m = m0; m <= utc(to); m += 7 * DAY_MS) {
    const mon = iso(m);
    weeks.push({ mon, label: `W${Number(isoWeekKey(mon).slice(-2))}`, union: 0, cut: mon < from || iso(m + 6 * DAY_MS) > to });
  }
  const streak = streakOf(days);
  const cells = days.map((day): CalCell => {
    const wi = Math.floor((utc(day.date) - m0) / (7 * DAY_MS));
    weeks[wi].union += day.union;
    return {
      day, wi, dow: weekdayOf(day.date), ratio: day.union ? day.sum / day.union : 1,
      streak: !!streak && day.date >= streak.from && day.date <= streak.to,
    };
  });
  return { weeks, cells, maxUnion: Math.max(0, ...days.map((d) => d.union)), streak };
}

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas height both worlds share
const GL = 30, TOP = 14, RHT = 13, BAR = 9, BOT = 13, CW_MAX = 48;   // dots

/** The canvas height (both worlds). */
export const CAL_HEIGHT = (TOP + 7 * RHT + BOT) * U;

/** Where the weeks were drawn (px): week wi starts at x0 + wi·cw, weekday d's row at y0 + d·rh. */
export interface CalGeom { x0: number; y0: number; cw: number; rh: number; nw: number }

/** The day under the point (null off the grid, or on a day the range does not include). */
export function calAt(g: CalGeom, cal: Calendar, px: number, py: number): CalCell | null {
  const wi = Math.floor((px - g.x0) / g.cw), dow = Math.floor((py - g.y0) / g.rh);
  if (wi < 0 || wi >= g.nw || dow < 0 || dow > 6) return null;
  return cal.cells.find((c) => c.wi === wi && c.dow === dow) ?? null;
}

/** Week width in dots: the weeks share the width after the label gutter, at most CW_MAX each. */
const cwOf = (nx: number, nw: number) => Math.max(6, Math.min(CW_MAX, Math.floor((nx - GL - 2) / Math.max(1, nw))));
/** Parallel ratio → colour, brightness, glow (lab s6). */
const tone = (r: number) => r < 1.3 ? { col: C.AMBER, a: 0.62, gl: 0.6 } : r < 1.9 ? { col: "#ffc46a", a: 0.85, gl: 0.6 }
  : r < 2.5 ? { col: C.WARM, a: 1, gl: 0.8 } : { col: "#fff4e2", a: 1, gl: 1 };

type BitsFn = (text: string, size: PixelSize, glyph: Glyph) => Bitmap;

/** `labels`: the seven weekday names (Monday first) at glyph `size`. */
export function drawCalendarUra(x: CanvasRenderingContext2D, cal: Calendar, labels: readonly string[], g: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, size: PixelSize, bitsFn: BitsFn = bits): CalGeom {
  x.clearRect(0, 0, g.w, g.h);
  const nx = Math.floor((g.w - g.offX) / P), nw = cal.weeks.length, cw = cwOf(nx, nw), L = cw - 4;
  const px = (i: number) => g.offX + i * P + P / 2, py = (j: number) => g.offY + j * P + P / 2;
  const dot = (i: number, j: number, col: string, a: number, gl: number) => { x.globalAlpha = a; lit(x, px(i), py(j), P * 0.4, col, gl); };
  const text = (s: string, sz: PixelSize, i: number, j: number, right: boolean, a: number) => {
    const b = bitsFn(s, sz, glyph), i0 = right ? i - b.w : i;
    for (let r = 0; r < b.h; r++) for (let q = 0; q < b.w; q++) if (b.on[r * b.w + q]) dot(i0 + q, j + r, C.AMBER, a, 0.25);
  };
  x.save();
  labels.forEach((s, w) => text(s, size, GL - 4, TOP + w * RHT + Math.floor((BAR - size) / 2), true, w >= 5 ? 0.28 : 0.45));
  cal.weeks.forEach((W, wi) => {
    text(W.label, 8, GL + wi * cw, 2, false, W.cut ? 0.2 : 0.38);
    text(hours(W.union), 8, GL + wi * cw, TOP + 7 * RHT + 2, false, W.union ? (W.cut ? 0.3 : 0.55) : 0.2);
  });
  cal.cells.forEach((c) => {
    const i0 = GL + c.wi * cw, j0 = TOP + c.dow * RHT;
    const nU = c.day.union > 0 ? Math.max(1, Math.round((c.day.union / Math.max(1, cal.maxUnion)) * L)) : 0, t = tone(c.ratio);
    for (let q = 0; q < L; q++) for (let r = 0; r < BAR; r++) {
      if (q < nU) dot(i0 + q, j0 + r, t.col, t.a, t.gl);
      else { x.globalAlpha = 1; disc(x, px(i0 + q), py(j0 + r), P * 0.3, "rgba(255,236,214,.045)"); }
    }
    if (c.streak) for (let r = 3; r < BAR - 3; r++) dot(i0 - 2, j0 + r, "#fff4e2", 0.9, 0.8);
  });
  x.restore();
  return { x0: g.offX + GL * P, y0: g.offY + TOP * P, cw: cw * P, rh: RHT * P, nw };
}

const INK = { t1: "#0f1c2e", t2: "#5b6573", t3: "#97a1ae", hair2: "rgba(15,28,46,.06)" };

export function drawCalendarOmote(x: CanvasRenderingContext2D, cal: Calendar, labels: readonly string[], g: { w: number; h: number }, font: (weight: number) => string): CalGeom {
  x.clearRect(0, 0, g.w, g.h);
  const nw = cal.weeks.length, cw = cwOf(Math.floor(g.w / U), nw), L = (cw - 4) * U, u = U;
  x.font = font(400); x.textBaseline = "alphabetic";
  labels.forEach((s, w) => {
    x.fillStyle = w >= 5 ? INK.t3 : INK.t2; x.textAlign = "right";
    x.fillText(s, GL * u - 8, (TOP + w * RHT + BAR - 1) * u);
  });
  x.textAlign = "left";
  cal.weeks.forEach((W, wi) => {
    x.fillStyle = W.cut ? INK.t3 : INK.t2;
    x.fillText(`${W.label} · ${mdOf(W.mon)}`, (GL + wi * cw) * u, (TOP - 4) * u);
    x.fillStyle = W.cut ? INK.t3 : INK.t2;
    x.fillText(hours(W.union), (GL + wi * cw) * u, g.h - 3);
  });
  for (const c of cal.cells) {
    const xx = (GL + c.wi * cw) * u, yy = (TOP + c.dow * RHT) * u;
    x.fillStyle = INK.hair2; x.fillRect(xx, yy + (BAR * u) / 2, L, 1);
    if (c.day.union > 0) {
      x.fillStyle = `rgba(15,28,46,${Math.min(1, 0.3 + 0.32 * (c.ratio - 1)).toFixed(2)})`;
      x.fillRect(xx, yy, (c.day.union / Math.max(1, cal.maxUnion)) * L, BAR * u);
    }
    if (c.streak) { x.fillStyle = INK.t1; x.fillRect(xx - 6, yy + 10, 3, 3); }
  }
  return { x0: GL * u, y0: TOP * u, cw: cw * u, rh: RHT * u, nw };
}
