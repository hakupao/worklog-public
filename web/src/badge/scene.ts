import { BIOMES, buildBiome, type BiomeName, type Item, type Mat } from "./biomes";
import { circ, poly, star4, W } from "./geom";
import type { Level } from "./lod";
import { OBJECT_BOX, objectFillRule, objectPath } from "./objects";
import { fnv1a, rng } from "./rng";

export type Season = "spring" | "summer" | "autumn" | "winter";
export interface Scene { items: Item[]; biome: BiomeName; season: Season; count: number; flip: boolean; side: number }

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];
/** Spec §2 (E): the id's month picks the weather, its day how much. A dateless id gets a stable stand-in. */
export function seasonOf(id: string): { season: Season; count: number } {
  const m = /^T\d{4}(\d{2})(\d{2})-/.exec(id);
  if (!m) { const h = fnv1a(id); return { season: SEASONS[h % 4], count: 5 + (h >>> 3) % 6 }; }
  const mo = +m[1], day = +m[2];
  const season: Season = mo >= 3 && mo <= 5 ? "spring" : mo >= 6 && mo <= 8 ? "summer" : mo >= 9 && mo <= 11 ? "autumn" : "winter";
  return { season, count: 5 + (day % 6) };
}

function weather(season: Season, count: number, r: () => number): string {
  let d = "";
  for (let k = 0; k < count; k++) {
    const x = 10 + r() * (W - 20), y = 10 + r() * 40, s = 2.6 + r() * 2, rot = r() * Math.PI;
    if (season === "spring") for (let j = 0; j < 5; j++) { const a = rot + j * 1.2566; d += circ(x + Math.cos(a) * s * 0.55, y + Math.sin(a) * s * 0.55, s * 0.45); }
    else if (season === "summer") d += star4(x, y, s);
    else if (season === "autumn") d += poly(Array.from({ length: 10 }, (_, j) => { const a = rot + j * 0.628, q = j % 2 ? s * 0.45 : s; return [x + Math.cos(a) * q, y + Math.sin(a) * q] as [number, number]; }));
    else for (let j = 0; j < 3; j++) { const a = rot + j * 1.047, c = Math.cos(a), sn = Math.sin(a), t = 0.55; d += poly([[x - c * s - sn * t, y - sn * s + c * t], [x + c * s - sn * t, y + sn * s + c * t], [x + c * s + sn * t, y + sn * s - c * t], [x - c * s + sn * t, y - sn * s - c * t]]); }
  }
  return d;
}

/** Hero box in field units (G0 round 1): S/M 100 tall from y = 0; L 96 tall standing on y = 98. S/M (rows, lists):
 *  one fixed spot on the right, box right edge at x = 265 — a random spot made a column of badges jump (user, B2 G2);
 *  265 is the furthest right that clips about as much ink as the centre (mean 1.14 % vs 1.04 %, top/bottom edges). L (shown alone): `side` (0–1) slides the box
 *  between the capsule's ends. */
const HERO = { smSize: 100, smTop: 0, smRight: 265, lSize: 96, lBase: 98 } as const;
function heroMat(level: Level, side: number, flip: boolean): Mat {
  let h: number, top: number, left: number;
  if (level === "L") { h = HERO.lSize; top = HERO.lBase - h; left = 8 + side * (W - 16 - h); }
  else { h = HERO.smSize; top = HERO.smTop; left = HERO.smRight - h; }
  const k = h / OBJECT_BOX;
  return flip ? [-k, 0, 0, k, left + h, top] : [k, 0, 0, k, left, top];
}

/** The layers of one badge (spec §2.3): S = hero only, M = + far silhouettes, L = + near layer, sky and weather.
 *  All randomness comes from the id, in a fixed draw order, so the object never shifts the landscape. */
export function buildScene(id: string, obj: string, level: Level): Scene {
  const r = rng(fnv1a(id + "|scene"));
  const biome = BIOMES[Math.floor(r() * BIOMES.length)], flip = r() < 0.5, side = r();
  const land = buildBiome(biome, rng(fnv1a(id + "|land")));
  const { season, count } = seasonOf(id);
  const wx = weather(season, count, rng(fnv1a(id + "|weather")));
  const items: Item[] = [];
  if (level !== "S") items.push(...land.far);
  if (level === "L") items.push(...land.near, { d: wx, tier: "acc", mode: "fill" });
  const hero: Item = { d: objectPath(obj) ?? "", tier: "hero", mode: "fill", mat: heroMat(level, side, flip) };
  if (objectFillRule(obj) === "evenodd") hero.rule = "evenodd";
  items.push(hero);
  return { items, biome, season, count, flip, side };
}
