import type { Glyph } from "../prefs/types";
import { pixelFamily, pixelFontReady, type PixelSize } from "./fonts";

export interface Bitmap { w: number; h: number; on: Uint8Array }

const ASC: Record<PixelSize, number> = { 12: 10, 10: 8, 8: 6 };   // em ascent at native size (measured in the prototype)
let ox: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, Bitmap>();
export function __clearBitsCache() { cache.clear(); ox = undefined; }

/** Drawn at K× the native size, each design pixel is a K × K block: its centre is solid or empty on every platform,
 *  while the antialiased outline edge (≈ 22% coverage at 1:1 on macOS, lifted past half by Windows' text gamma, which
 *  doubled every horizontal stroke) stays at the block's border. */
const K = 4;
const MAX_W = 8000;                                // native px: K × MAX_W stays under the browsers' canvas width limit

/** One string drawn on the pixel font's native grid: every lit design pixel is one LED. */
export function bits(text: string, size: PixelSize, glyph: Glyph): Bitmap {
  const key = `${size}${glyph}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (ox === undefined) ox = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ox) return { w: 0, h: size, on: new Uint8Array(0) };
  const off = ox.canvas, font = `${size * K}px "${pixelFamily(size, glyph)}"`;
  ox.font = font;
  const w = Math.min(MAX_W, Math.max(1, Math.ceil(ox.measureText(text).width / K)));
  if (off.width < w * K) off.width = w * K;
  off.height = size * 2 * K;
  ox.font = font; ox.textBaseline = "alphabetic"; ox.fillStyle = "#fff";
  ox.clearRect(0, 0, off.width, off.height);
  const bl = ASC[size] + 2;                       // 2px headroom, then crop the em box
  ox.fillText(text, 0, bl * K);
  const W = w * K, d = ox.getImageData(0, (bl - ASC[size]) * K, W, size * K).data;
  const on = new Uint8Array(w * size), c = K >> 1;
  for (let y = 0; y < size; y++) for (let x = 0; x < w; x++) on[y * w + x] = d[((y * K + c) * W + x * K + c) * 4 + 3] > 127 ? 1 : 0;
  const r = { w, h: size, on };
  if (!pixelFontReady(size, glyph)) return r;     // drawn in the fallback face: use it now, cache only the real cut
  if (cache.size > 800) cache.clear();
  cache.set(key, r);
  return r;
}
