import { disc, lit } from "../../chart/canvas";
import { OMOTE_UNIT, PITCH } from "../../led/lattice";

// The 日別作業 per-day bar under the 合計 row (prototype page-report.html dotBar()): the day's share of the
// busiest day. 里: LED dots on the page's PITCH lattice over a dim track; 表: a printed bar on a hairline track.

const P = PITCH, U = OMOTE_UNIT;   // 里 dot step; 表's unit

export function drawDayBarUra(x: CanvasRenderingContext2D, frac: number, color: string,
  g: { w: number; h: number; offX: number; offY: number }, rows = 2): void {
  x.clearRect(0, 0, g.w, g.h);
  const nx = Math.floor((g.w - g.offX) / P), ny = Math.min(rows, Math.floor((g.h - g.offY) / P));
  const on = Math.round(nx * Math.min(1, Math.max(0, frac)));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = g.offX + i * P + P / 2, cy = g.offY + j * P + P / 2;
    if (i < on) lit(x, cx, cy, P * 0.4, color, 0.8);
    else disc(x, cx, cy, P * 0.3, "rgba(255,236,214,.07)");
  }
}

export function drawDayBarOmote(x: CanvasRenderingContext2D, frac: number, g: { w: number; h: number }, rows = 2): void {
  x.clearRect(0, 0, g.w, g.h);
  const h = Math.max(4, Math.min(g.h, rows * U)), y = Math.round((g.h - h) / 2);
  x.fillStyle = "rgba(15,28,46,.08)";
  x.fillRect(0, y + h / 2 - 0.5, g.w, 1);
  const w = Math.round(g.w * Math.min(1, Math.max(0, frac)));
  if (w <= 0) return;
  x.fillStyle = rows > 2 ? "#0f1c2e" : "#5b6573";
  x.fillRect(0, y, w, h);
}
