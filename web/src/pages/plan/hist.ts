import { disc, lit } from "../../chart/canvas";
import { bits, type Bitmap } from "../../led/bits";
import { OMOTE_UNIT, PITCH } from "../../led/lattice";
import type { Glyph } from "../../prefs/types";
import { C } from "../../ui/palette";

// The AI 对账 bars (prototype page-plan.html slots() with frac, drawHist): one bar per weekday, filled from the
// bottom by the share of that day's items that ended done; green when all are, amber when some are. The chosen
// day's slot is brighter. 里: LED dots on the page's PITCH lattice with dot-glyph weekday labels; 表: solid bars on
// a pale track with body-font labels and a hairline baseline.

export const HIST = { sw: 22, gap: 3, rows: 16, lab: 11 } as const;
const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas width both worlds share
type BitsFn = (text: string, size: 10, glyph: Glyph) => Bitmap;

/** green = every item done, amber = some, the off colour = none (only the track shows then). */
export const histColor = (v: number) => (v >= 1 ? C.GREEN : v > 0 ? C.AMBER : "#8a8275");
const OMOTE: Record<string, string> = { [C.GREEN]: "#0e7c86", [C.AMBER]: "#6f7d8e", "#8a8275": "#c4cbd4" };

/** The canvas width the five bars need (one lattice step of slack for the page offset). */
export const histWidth = (n = 5) => (n * (HIST.sw + HIST.gap) - HIST.gap) * U + U;

export function drawHistUra(x: CanvasRenderingContext2D, vals: number[], labels: string[], today: number,
  g: { w: number; h: number; offX: number; offY: number }, glyph: Glyph, bitsFn: BitsFn = bits): void {
  x.clearRect(0, 0, g.w, g.h);
  const ny = Math.floor((g.h - g.offY) / P), top = Math.max(0, Math.floor((ny - HIST.lab - HIST.rows) / 2));
  const dot = (i: number, j: number) => [g.offX + i * P + P / 2, g.offY + j * P + P / 2] as const;
  vals.forEach((v, s) => {
    const x0 = s * (HIST.sw + HIST.gap), col = histColor(v), n = Math.round(Math.min(1, Math.max(0, v)) * HIST.rows);
    for (let j = 0; j < HIST.rows; j++) for (let i = 0; i < HIST.sw; i++) {
      const [cx, cy] = dot(x0 + i, top + j);
      if (HIST.rows - 1 - j < n) lit(x, cx, cy, P * 0.4, col, 0.9);
      else disc(x, cx, cy, P * (0.95 / 3), `rgba(255,236,214,${s === today ? 0.22 : 0.075})`);
    }
    const b = bitsFn(labels[s] ?? "", 10, glyph), lx = x0 + Math.floor((HIST.sw - b.w) / 2), ly = top + HIST.rows + 1;
    x.save(); x.globalAlpha = s === today ? 1 : 0.6;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) if (b.on[j * b.w + i]) { const [cx, cy] = dot(lx + i, ly + j); lit(x, cx, cy, P * 0.4, C.AMBER, 0.6); }
    x.restore();
  });
}

export function drawHistOmote(x: CanvasRenderingContext2D, vals: number[], labels: string[], today: number,
  g: { w: number; h: number }, font: (weight: number) => string): void {
  x.clearRect(0, 0, g.w, g.h);
  const bh = HIST.rows * U, lab = HIST.lab * U, top = Math.max(0, Math.floor((g.h - lab - bh) / 2)), st = (HIST.sw + HIST.gap) * U, w = HIST.sw * U - 1;
  vals.forEach((v, s) => {
    const x0 = s * st;
    x.fillStyle = s === today ? "#dfe4ea" : "#eef1f4";
    x.fillRect(x0, top, w, bh);
    const h = Math.round(Math.min(1, Math.max(0, v)) * bh);
    if (h > 0) { x.fillStyle = OMOTE[histColor(v)]; x.fillRect(x0, top + bh - h, w, h); }
    x.font = font(s === today ? 600 : 400); x.fillStyle = s === today ? "#0f1c2e" : "#5b6573";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(labels[s] ?? "", x0 + w / 2, top + bh + lab / 2 + 1);
  });
  x.fillStyle = "rgba(15,28,46,.08)";
  x.fillRect(0, top + bh, vals.length * st - HIST.gap * U, 1);
}
