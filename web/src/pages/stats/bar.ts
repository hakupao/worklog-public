import { OMOTE_UNIT } from "../../led/lattice";

// The 统计 list bars (ledger, 每周, 按依頼元): 里 draws them with report/bar.ts drawDayBarUra (any colour on the
// PITCH lattice); 表 is this — a printed bar in the row's colour (a task's line colour, else ink) on a hairline track.

const P = OMOTE_UNIT;   // 表's unit: a bar `rows` × 3px tall

export function drawBarOmote(x: CanvasRenderingContext2D, frac: number, color: string, g: { w: number; h: number }, rows = 3): void {
  x.clearRect(0, 0, g.w, g.h);
  const h = Math.max(4, Math.min(g.h, rows * P)), y = Math.round((g.h - h) / 2);
  x.fillStyle = "rgba(15,28,46,.08)";
  x.fillRect(0, y + h / 2 - 0.5, g.w, 1);
  const w = Math.round(g.w * Math.min(1, Math.max(0, frac)));
  if (w <= 0) return;
  x.fillStyle = color;
  x.fillRect(0, y, w, h);
}
