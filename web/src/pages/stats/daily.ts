import { disc, lit } from "../../chart/canvas";
import { bits, type Bitmap } from "../../led/bits";
import { PITCH } from "../../led/lattice";
import type { Glyph } from "../../prefs/types";
import { mdOf, weekdayOfDate } from "../../predict/time";
import { C } from "../../ui/palette";

// 每日工时 (prototype page-stats.html daily()): one bar per day of the range, scaled to the busiest day but never
// under 24h, with 8h and 24h reference rows (a day over 24h is parallel sessions counted twice). 里: LED columns
// on the page's PITCH lattice, the reference rows every second dot, labels in dot glyphs; 表: printed bars, the
// reference rows thin lines. Weekend days are one tier down in both.

const P = PITCH;
const LAB = 10;            // 里: rows under the bars for the date labels (8px glyphs + gap)
const RIGHT = 16;          // 里: dots kept on the right for the 8h / 24h labels
const RIGHT_PX = 28;       // 表: the same, in px
const WIDEST = 7;          // a bar is never wider than a week's would be (今天 is one day: not a slab)
export const REFS: { min: number; label: string }[] = [{ min: 480, label: "8h" }, { min: 1440, label: "24h" }];

export interface Day { date: string; minutes: number }
/** Where the days were drawn (px from the canvas's left): day i's slot starts at x0 + i·pitch; its first `span` px
 *  (its bar and the gap after it — less than the pitch only when the bars are held to a week's width) are its. */
export interface DailyGeom { x0: number; pitch: number; span: number; n: number }
type BitsFn = (text: string, size: 8, glyph: Glyph) => Bitmap;

const scaleOf = (days: Day[]) => Math.max(1440, ...days.map((d) => d.minutes));
const weekend = (date: string) => weekdayOfDate(date) >= 6;

/** The day under x, or null off the bars (past a narrow 今天 bar too). */
export function dailyAt(g: DailyGeom, px: number): number | null {
  const i = Math.floor((px - g.x0) / g.pitch);
  return i >= 0 && i < g.n && px - g.x0 - i * g.pitch < g.span ? i : null;
}

/** The date labels: the first and last day, and Mondays in between where they don't run into a neighbour.
 *  `w(text)` is a label's width and `at(i)` a day's left edge, in the drawer's own unit; the last label is
 *  pulled in so it ends at `end`. */
function dateLabels(days: Day[], at: (i: number) => number, w: (s: string) => number, end: number, gap: number) {
  const n = days.length;
  if (!n) return [];
  const last = { i: n - 1, s: mdOf(days[n - 1].date) }, lastX = Math.max(0, Math.min(at(n - 1), end - w(last.s)));
  const out: { s: string; x: number }[] = [];
  let edge = -Infinity;
  for (let i = 0; i < n - 1; i++) {
    if (i > 0 && weekdayOfDate(days[i].date) !== 1) continue;
    const s = mdOf(days[i].date), x = at(i);
    if (x < edge + gap || x + w(s) + gap > lastX) continue;
    out.push({ s, x });
    edge = x + w(s);
  }
  out.push({ s: last.s, x: lastX });
  return out;
}

export function drawDailyUra(x: CanvasRenderingContext2D, days: Day[], g: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, bitsFn: BitsFn = bits): DailyGeom {
  x.clearRect(0, 0, g.w, g.h);
  const nx = Math.floor((g.w - g.offX) / P), ny = Math.floor((g.h - g.offY) / P), n = days.length;
  // a day needs one dot at least: when the days and the 8h / 24h labels don't both fit (90 days on a narrow
  // canvas), the labels go and the bars take their dots
  const labels = nx - RIGHT >= n, room = labels ? nx - RIGHT : nx;
  // a day's column is a fractional number of dots (day k starts on dot floor(k·cw)), so 90 days span the width too
  const nyc = Math.max(1, ny - LAB - 1), cw = Math.max(1, room / Math.max(1, n)), bw = Math.min(cw >= 2 ? Math.floor(cw) - 1 : 1, Math.max(1, Math.floor(room / WIDEST) - 1));
  const col = (k: number) => Math.floor(k * cw);
  const mx = scaleOf(days), rowOf = (m: number) => nyc - Math.round((m / mx) * nyc);
  const px = (i: number) => g.offX + i * P + P / 2, py = (j: number) => g.offY + j * P + P / 2;
  const glyphAt = (i0: number, j0: number, s: string, a: number, color: string = C.AMBER) => {
    const b = bitsFn(s, 8, glyph);
    x.save(); x.globalAlpha = a;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) if (b.on[j * b.w + i]) lit(x, px(i0 + i), py(j0 + j), P * 0.4, color, 0.25);
    x.restore();
    return b.w;
  };
  days.forEach((d, k) => {
    const on = d.minutes > 0 ? Math.max(1, Math.round((d.minutes / mx) * nyc)) : 0, we = weekend(d.date);
    x.save(); x.globalAlpha = we ? 0.5 : 1;
    for (let a = 0; a < bw; a++) for (let j = 0; j < nyc; j++) {
      if (nyc - 1 - j < on) lit(x, px(col(k) + a), py(j), P * 0.4, C.AMBER, we ? 0.25 : 0.75);
      else disc(x, px(col(k) + a), py(j), P * 0.3, "rgba(255,236,214,.06)");
    }
    x.restore();
  });
  const end = Math.min(Math.round(n * cw), room);
  for (const [r, { min, label }] of REFS.entries()) {
    const j = rowOf(min), a = r === 0 ? 0.22 : 0.55;
    x.save(); x.globalAlpha = a;
    for (let i = 0; i < end; i += 2) lit(x, px(i), py(j), P * 0.4, "#ffe2b8", 0.25);
    x.restore();
    if (labels) glyphAt(end + 1, Math.max(0, Math.min(nyc - 8, j - 3)), label, a + 0.15);
  }
  for (const l of dateLabels(days, col, (s) => bitsFn(s, 8, glyph).w, end, 3)) glyphAt(l.x, nyc + 2, l.s, 0.45);
  return { x0: g.offX, pitch: cw * P, span: Math.min(cw, room / WIDEST) * P, n };
}

export function drawDailyOmote(x: CanvasRenderingContext2D, days: Day[], g: { w: number; h: number }, font: (weight: number) => string): DailyGeom {
  x.clearRect(0, 0, g.w, g.h);
  const n = days.length, top = 6, bot = g.h - 18, hh = bot - top, end = g.w - RIGHT_PX, pitch = end / Math.max(1, n);
  const bw = Math.min(Math.max(1, pitch >= 4 ? Math.round(pitch) - 2 : Math.round(pitch)), Math.max(1, Math.round(end / WIDEST) - 2)), mx = scaleOf(days);
  x.font = font(400); x.textBaseline = "alphabetic";
  for (const [r, { min, label }] of REFS.entries()) {
    const y = Math.round(bot - (min / mx) * hh);
    x.fillStyle = r === 0 ? "rgba(15,28,46,.12)" : "rgba(15,28,46,.35)";
    x.fillRect(0, y, end, 1);
    x.fillStyle = "#5b6573"; x.textAlign = "right";
    x.fillText(label, g.w, y + 4);
  }
  days.forEach((d, i) => {
    if (d.minutes <= 0) return;
    const h = Math.max(2, Math.round((d.minutes / mx) * hh));
    x.fillStyle = weekend(d.date) ? "#8a94a3" : "#0f1c2e";
    x.fillRect(Math.round(i * pitch), bot - h, bw, h);
  });
  x.fillStyle = "rgba(15,28,46,.12)";
  x.fillRect(0, bot, end, 1);
  x.fillStyle = "#5b6573"; x.textAlign = "left";
  for (const l of dateLabels(days, (i) => Math.round(i * pitch), (s) => x.measureText(s).width, end, 8)) x.fillText(l.s, l.x, g.h - 3);
  return { x0: 0, pitch, span: Math.min(pitch, end / WIDEST), n };
}
