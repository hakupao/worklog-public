import { useEffect, useState } from "react";
import type { Glyph } from "../badge/glyph";      // type only: no runtime import of badge/ (constraint 4)
export type { Glyph } from "../badge/glyph";

let loading: Promise<(id: string) => Glyph> | undefined;
/** The silhouette engine (objects.gen.ts, 239 KB) loads on first use, never with a page chunk. */
export function loadTaskGlyph(): Promise<(id: string) => Glyph> {
  return (loading ??= import("../badge/glyph").then((m) => (id: string) => m.glyphFor({ id })).catch((e) => { loading = undefined; throw e; }));
}

/** Not escaped: `g.d` must be trusted path data (objects.gen) and `g.color` a hex colour (LINE_PALETTE). */
export function glyphDataUrl(g: Glyph, px: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${g.box} ${g.box}"><path d="${g.d}" fill="${g.color}" fill-rule="${g.rule}"/></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const paths = new Map<string, Path2D>();
const pathOf = (d: string) => { let p = paths.get(d); if (!p) { p = new Path2D(d); paths.set(d, p); } return p; };

export function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, x: number, y: number, size: number, color?: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / g.box, size / g.box);
  ctx.fillStyle = color ?? g.color;
  ctx.fill(pathOf(g.d), g.rule);
  ctx.restore();
}

/** An n×n dot grid from a side×side alpha raster: a cell is on when its mean alpha is over half. */
export function dotsOf(alpha: ArrayLike<number>, side: number, n: number): boolean[] {
  const S = side / n, out: boolean[] = new Array(n * n).fill(false);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let a = 0;
    for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) a += alpha[(r * S + v) * side + c * S + u];
    out[r * n + c] = a / (S * S * 255) > 0.5;
  }
  return out;
}

const dotCache = new Map<string, boolean[]>();
/** The glyph on an n×n LED grid (rasterised at 4 px a dot), cached per path and n; null without a 2D canvas. */
function glyphDots(g: Glyph, n: number): boolean[] | null {
  const key = `${n}|${g.rule}|${g.d}`, hit = dotCache.get(key);
  if (hit) return hit;
  const side = n * 4, cv = document.createElement("canvas");
  cv.width = side; cv.height = side;
  const x = cv.getContext("2d");
  if (!x) return null;
  x.scale(side / g.box, side / g.box);
  x.fillStyle = "#000";
  x.fill(pathOf(g.d), g.rule);
  const px = x.getImageData(0, 0, side, side).data, a = new Uint8ClampedArray(side * side);
  for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3];
  const out = dotsOf(a, side, n);
  dotCache.set(key, out);
  return out;
}

/** Tier-2 silhouettes for canvas / ECharts sites. */
export interface TaskSil { of(id: string): Glyph; dots(id: string, n: number): boolean[] | null }
let ready: TaskSil | null = null;
/** null until the glyph chunk is in (callers draw today's code meanwhile, and on failure); one load attempt per mount. */
export function useTaskGlyph(): TaskSil | null {
  const [sil, setSil] = useState<TaskSil | null>(ready);
  useEffect(() => {
    if (ready) { setSil(ready); return; }
    let live = true;
    loadTaskGlyph().then((of) => {
      ready = { of, dots: (id, n) => glyphDots(of(id), n) };
      if (live) setSil(ready);
    }, () => { /* constraint 8: stay on the code; the next mount tries again */ });
    return () => { live = false; };
  }, []);
  return sil;
}
