import type { World } from "../prefs/types";
import { LINE_PALETTE, hashLineColor } from "../ui/palette";
import { taskBadgeOf } from "../ui/taskBadges";
import type { Level } from "./lod";
import { isBadgeObject, pickFallbackObject } from "./objects";
import { omoteSvg } from "./omote";
import { fnv1a } from "./rng";
import { canvasSampler } from "./sampler";
import { H, RATIO, W } from "./geom";
import { buildScene } from "./scene";
import { uraSvg } from "./ura";

/** What a caller knows about a task's badge. `undefined` = ask the registry (B1 stored badge); an explicit `null` = no stored
 *  value, fall back (also for a culled object). */
export interface BadgeSpec { id: string; obj?: string | null; color?: number | null }

export function resolveBadge(spec: BadgeSpec): { obj: string; color: string } {
  const stored = spec.obj === undefined || spec.color === undefined ? taskBadgeOf(spec.id) : undefined;
  const so = spec.obj === undefined ? stored?.obj : spec.obj, sc = spec.color === undefined ? stored?.color : spec.color;
  const obj = so && isBadgeObject(so) ? so : pickFallbackObject(fnv1a(spec.id));
  const ok = typeof sc === "number" && Number.isInteger(sc) && sc >= 0 && sc < LINE_PALETTE.length;
  return { obj, color: ok ? LINE_PALETTE[sc as number] : hashLineColor(spec.id) };
}

let raster: boolean | undefined;
/** True when a 2D canvas exists (browsers); false in jsdom, where badges stay SVG. */
export function canRaster(): boolean {
  if (raster === undefined) { try { raster = !!document.createElement("canvas").getContext("2d"); } catch { raster = false; } }
  return raster;
}

const svgs = new Map<string, string>();
const bitmaps = new Map<string, Promise<string | null>>();
let seq = 0;
const done = new Map<string, string | null>();
const keyOf = (spec: BadgeSpec, level: Level, world: World) => { const b = resolveBadge(spec); return `${spec.id}|${b.obj}|${b.color}|${level}|${world}`; };

const bitmapKey = (spec: BadgeSpec, level: Level, world: World, cssHeight: number, dpr: number) =>
  `${keyOf(spec, level, world)}|${Math.max(1, Math.round(cssHeight * dpr))}`;
/** A bitmap already made for this key (so a remounted badge paints it in its first frame); undefined if not yet. */
export const peekBadgeBitmap = (spec: BadgeSpec, level: Level, world: World, cssHeight: number, dpr: number) =>
  done.get(bitmapKey(spec, level, world, cssHeight, dpr)) ?? undefined;

/** Spec §4: one SVG per (task, object, colour, level, world) per page load. */
export function badgeSvgUrl(spec: BadgeSpec, level: Level, world: World): string {
  const key = keyOf(spec, level, world), hit = svgs.get(key);
  if (hit) return hit;
  const { obj, color } = resolveBadge(spec), scene = buildScene(spec.id, obj, level), u = `b${++seq}`;
  const body = world === "omote" ? omoteSvg(scene, color, level, spec.id, u) : uraSvg(scene, color, level, spec.id, u, canvasSampler(scene));
  const url = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`);
  svgs.set(key, url);
  return url;
}

/** Browser seam #2: rasterise once at the displayed pixel size, so filters are not re-run for every copy on the
 *  page. Null without a canvas (the SVG URL stays in use). */
export function badgeBitmapUrl(spec: BadgeSpec, level: Level, world: World, cssHeight: number, dpr: number): Promise<string | null> {
  const h = Math.max(1, Math.round(cssHeight * dpr)), w = Math.round(h * RATIO), key = bitmapKey(spec, level, world, cssHeight, dpr);
  const hit = bitmaps.get(key);
  if (hit) return hit;
  const p = (async () => {
    try {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const cx = cv.getContext("2d");
      if (!cx) return null;
      const img = new Image(); img.src = badgeSvgUrl(spec, level, world); await img.decode();
      cx.drawImage(img, 0, 0, w, h);
      return cv.toDataURL();
    } catch { return null; }
  })().then((u) => { done.set(key, u); return u; });
  bitmaps.set(key, p);
  return p;
}

export const badgeCacheStats = () => ({ svg: svgs.size, bitmap: bitmaps.size });
export function __resetBadgeCacheForTests() { svgs.clear(); bitmaps.clear(); done.clear(); raster = undefined; seq = 0; }
