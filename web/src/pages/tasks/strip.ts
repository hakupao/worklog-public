import { disc, lit } from "../../chart/canvas";
import { OMOTE_UNIT, PITCH } from "../../led/lattice";

// The 每日 strip (prototype page-tasks.html strip()): one LED column per day, lit from the bottom in
// proportion to a shared max, on the page's PITCH lattice; in 表, solid bars on a hairline baseline.
// Also the drawer's 本周 bars (one wide column per day).

export interface StripOpt { colW?: number; gap?: number; rows?: number }
const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit and the canvas width both worlds share
export const stripWidth = (days: number, { colW = 3, gap = 1 }: StripOpt = {}) => days * (colW + gap) * U - gap * U;

export function drawStripUra(x: CanvasRenderingContext2D, vals: number[], max: number, color: string,
  g: { w: number; h: number; offX: number; offY: number }, { colW = 3, gap = 1, rows = 10 }: StripOpt = {}): void {
  x.clearRect(0, 0, g.w, g.h);
  const ny = Math.max(1, Math.min(rows, Math.floor((g.h - g.offY) / P)));
  const y0 = g.offY + (Math.floor((g.h - g.offY) / P) - ny) * P, mx = Math.max(max, 1e-9);
  vals.forEach((v, i) => {
    const n = v > 0 ? Math.max(1, Math.round((v / mx) * ny)) : 0;
    for (let a = 0; a < colW; a++) for (let j = 0; j < ny; j++) {
      const cx = g.offX + (i * (colW + gap) + a) * P + P / 2, cy = y0 + (ny - 1 - j) * P + P / 2;
      if (j < n) lit(x, cx, cy, P * 0.4, color, 0.9);
      else disc(x, cx, cy, P * 0.3, "rgba(255,236,214,.07)");
    }
  });
}

export function drawStripOmote(x: CanvasRenderingContext2D, vals: number[], max: number, color: string,
  g: { w: number; h: number }, { colW = 3, gap = 1 }: StripOpt = {}): void {
  x.clearRect(0, 0, g.w, g.h);
  const st = (colW + gap) * U, bw = colW * U - 1, top = 4, bot = g.h - 3, mx = Math.max(max, 1e-9);
  x.fillStyle = "rgba(15,28,46,.12)";
  x.fillRect(0, bot, vals.length * st - gap * U, 1);
  vals.forEach((v, i) => {
    if (v <= 0) return;
    const h = Math.max(2, Math.round((v / mx) * (bot - top)));
    x.fillStyle = color;
    x.fillRect(i * st, bot - h, bw, h);
  });
}
