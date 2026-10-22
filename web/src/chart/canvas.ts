import { dpr, sprite } from "../led/sprite";

export interface Surface { ctx: CanvasRenderingContext2D; w: number; h: number }

/** Sizes the backing store to the CSS box at the device pixel ratio. Null without a 2D context (jsdom). */
export function surface(cv: HTMLCanvasElement): Surface | null {
  const r = cv.getBoundingClientRect(), D = dpr();
  cv.width = Math.max(1, Math.round(r.width * D));
  cv.height = Math.max(1, Math.round(r.height * D));
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(D, 0, 0, D, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
export function disc(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string): void {
  x.fillStyle = fill; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
}
/** One lit LED: the pre-rendered sprite, or a flat disc where sprites cannot be made. `color` is #rrggbb. */
export function lit(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, glow: number): void {
  const s = sprite(color, r, glow);
  if (s) x.drawImage(s.c, cx - s.s / 2, cy - s.s / 2, s.s, s.s);
  else disc(x, cx, cy, r, color);
}
