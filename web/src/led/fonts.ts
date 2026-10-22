import fp8jp from "./fonts/fp8-jp.woff2?url";
import fp8sc from "./fonts/fp8-sc.woff2?url";
import fp10jp from "./fonts/fp10-jp.woff2?url";
import fp10sc from "./fonts/fp10-sc.woff2?url";
import fp12jp from "./fonts/fp12-jp.woff2?url";
import fp12sc from "./fonts/fp12-sc.woff2?url";
import type { Glyph } from "../prefs/types";

export type PixelSize = 8 | 10 | 12;
const URLS: Record<string, string> = {
  "fp8-jp": fp8jp, "fp8-sc": fp8sc, "fp10-jp": fp10jp, "fp10-sc": fp10sc, "fp12-jp": fp12jp, "fp12-sc": fp12sc,
};

export const pixelFamily = (size: PixelSize, glyph: Glyph) => `fp${size}-${glyph === "ja" ? "jp" : "sc"}`;

const loading = new Map<string, Promise<void>>();
const loaded = new Set<string>();
const noFontApi = () => typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts;
/** True once the cut is in `document.fonts` (always true without a FontFace API, e.g. jsdom). Before that a canvas
 *  draws in the fallback face, so bits() must not cache what it sampled. Not `document.fonts.check()`: the face is only
 *  added after it loads, and check() answers true when no registered face matches the family. */
export const pixelFontReady = (size: PixelSize, glyph: Glyph) => noFontApi() || loaded.has(pixelFamily(size, glyph));
/** Loads one cut on demand (spec §10.1: only the sizes and scripts a page uses). Idempotent. */
export function loadPixelFont(size: PixelSize, glyph: Glyph): Promise<void> {
  const fam = pixelFamily(size, glyph);
  if (noFontApi()) return Promise.resolve();
  let p = loading.get(fam);
  if (!p) {
    const face = new FontFace(fam, `url(${URLS[fam]})`);
    p = face.load().then((f) => { document.fonts.add(f); loaded.add(fam); }).catch((e) => { loading.delete(fam); console.error(`[led] font ${fam} failed`, e); });
    loading.set(fam, p);
  }
  return p;
}
