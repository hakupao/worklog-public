import { circ, f, poly, SX, W } from "./geom";
import { LANDMARKS, type LandmarkName } from "./landmarks";

export type Tier = "bg" | "acc" | "hero";
export type Mat = [number, number, number, number, number, number];
/** One layer of a badge: a path in field units (or under `mat`), filled or stroked, drawn at a brightness tier. */
export interface Item { d: string; tier: Tier; mode: "fill" | "stroke"; w?: number; mat?: Mat; rule?: "evenodd" }

export type BiomeName = "mountains" | "city" | "sunrise" | "fuji" | "castle" | "port" | "toriiSea" | "satoyama" | "bamboo";
export const BIOMES: readonly BiomeName[] = ["mountains", "city", "sunrise", "fuji", "castle", "port", "toriiSea", "satoyama", "bamboo"];
export const BIOME_LABEL: Record<BiomeName, string> = {
  mountains: "山野", city: "城市夜景", sunrise: "海上日出", fuji: "富士", castle: "城下町", port: "港町", toriiSea: "海上鸟居", satoyama: "乡间", bamboo: "竹林",
};

const bg = (d: string): Item => ({ d, tier: "bg", mode: "fill" });
const acc = (d: string): Item => ({ d, tier: "acc", mode: "fill" });
/** A landmark scaled to `h` units tall with its left edge at x, standing on `base`. */
const lm = (name: LandmarkName, x: number, h: number, base: number, tier: Tier): Item =>
  ({ d: LANDMARKS[name], tier, mode: "fill", mat: [h / 100, 0, 0, h / 100, x, base - h] });
/** A filled band under a sine edge (waves, hills). */
function band(y0: number, amp: number, freq: number, ph: number): string {
  let p = `M0 100L0 ${f(y0)}`;
  for (let x = 0; x <= W; x += 4) p += `L${x} ${f(y0 + amp * Math.sin(x * freq + ph))}`;
  return p + `L${W} 100Z`;
}
const ridge = (r: () => number, lo: number, hi: number) => {
  let p = "M0 100";
  for (let x = 0; x <= W; x += 10 + r() * 8) p += `L${f(x)} ${f(lo + r() * (hi - lo))}`;
  return p + `L${W} 100Z`;
};
const moon = (x: number, y: number) => `M${f(x)} ${f(y - 9)}A9 9 0 1 0 ${f(x + 8)} ${f(y + 9)}A7 7 0 1 1 ${f(x)} ${f(y - 9)}Z`;
const sunRays = (sx: number, sy: number) => circ(sx, sy, 13) + Array.from({ length: 8 }, (_, j) => {
  const a = Math.PI + (j * Math.PI) / 7;
  return poly([[sx + Math.cos(a - 0.08) * 17, sy + Math.sin(a - 0.08) * 17], [sx + Math.cos(a) * 25, sy + Math.sin(a) * 25], [sx + Math.cos(a + 0.08) * 17, sy + Math.sin(a + 0.08) * 17]]);
}).join("");
function city(r: () => number): { far: string; windows: string } {
  let far = "", windows = "", x = 0;
  while (x < W) {
    const w = 8 + r() * 12, h = 22 + r() * 40;
    far += poly([[x, 100], [x, 100 - h], [x + w, 100 - h], [x + w, 100]]);
    for (let wy = 100 - h + 4; wy < 92; wy += 6) for (let wx = x + 2.5; wx < x + w - 3; wx += 5) if (r() < 0.35) windows += poly([[wx, wy], [wx + 2.4, wy], [wx + 2.4, wy + 3], [wx, wy + 3]]);
    x += w + 1.5;
  }
  return { far, windows };
}

/** One landscape (spec §2.2): `far` is the silhouette layer M keeps, `near` + sky only appear at L. Absolute x
 *  positions were drawn for a 190-wide capsule and scale by SX; bands, ridges and the city run to W. */
export function buildBiome(name: BiomeName, r: () => number): { far: Item[]; near: Item[] } {
  const S = SX;
  switch (name) {
    case "mountains": return { far: [bg(ridge(r, 30, 58))], near: [acc(band(72 + r() * 6, 5, 0.035, r() * 6) + circ((20 + r() * 150) * S, 17 + r() * 8, 7))] };
    case "city": { const c = city(r); return { far: [bg(c.far)], near: [acc(c.windows + moon((150 + r() * 20) * S, 23))] }; }
    case "sunrise": return { far: [bg(band(62, 2 + r() * 2, 0.08 + r() * 0.07, r() * 6) + band(73, 2 + r() * 2, 0.08 + r() * 0.07, r() * 6))], near: [acc(band(84, 2 + r() * 2, 0.1, r() * 6) + sunRays((30 + r() * 130) * S, 60))] };
    case "fuji": { const x = (20 + r() * 80) * S; return { far: [lm("fuji", x, 70, 100, "bg")], near: [lm("fujiCap", x, 70, 100, "acc"), acc(band(80 + r() * 4, 4, 0.04, r() * 6))] }; }
    case "castle": { const cx = (30 + r() * 100) * S; return { far: [lm("castle", cx, 62, 100, "bg"), lm("pagoda", cx > 95 * S ? (10 + r() * 30) * S : (140 + r() * 30) * S, 70, 100, "bg")], near: [acc(Array.from({ length: Math.ceil(W / 34) + 1 }, (_, k) => poly([[k * 34, 100], [k * 34 + 30, 100], [k * 34 + 30, 90], [k * 34 + 15, 84], [k * 34, 90]])).join(""))] }; }
    case "port": { const tx = (20 + r() * 120) * S, a = 48 * S, b = 136 * S, m1 = 51 * S, m2 = 95 * S, m3 = 139 * S; return { far: [lm("tower", tx, 82, 92, "bg"), bg(poly([[0, 74], [W, 74], [W, 78], [0, 78]]) + poly([[a, 40], [a + 6, 40], [a + 6, 92], [a, 92]]) + poly([[b, 40], [b + 6, 40], [b + 6, 92], [b, 92]]))], near: [{ d: `M0 70Q${f(m1)} 78 ${f(m1)} 40Q${f(m2)} 76 ${f(m3)} 40Q${f(m3)} 78 ${W} 70`, tier: "acc", mode: "stroke", w: 1.2 }, acc(band(90, 2, 0.12, r() * 6))] }; }
    case "toriiSea": { const x = (30 + r() * 100) * S; return { far: [bg(band(70, 2 + r() * 2, 0.09, r() * 6))], near: [lm("torii", x, 46, 86, "acc"), acc(band(86, 2, 0.12, r() * 6))] }; }
    case "satoyama": { const x = (20 + r() * 120) * S; let terr = ""; for (let k = 0; k < 4; k++) terr += band(62 + k * 9, 1.5, 0.03 + r() * 0.02, r() * 6); return { far: [bg(ridge(r, 34, 52))], near: [acc(terr), lm("torii", x, 30, 70, "acc")] }; }
    case "bamboo": { let stalks = "", leaves = ""; for (let x = 6; x < W; x += 9 + r() * 10) { const w = 2.4 + r() * 1.4; for (let y = 0; y < 100; y += 14 + r() * 6) stalks += poly([[x, y + 1], [x + w, y + 1], [x + w, y + 12], [x, y + 12]]); if (r() < 0.6 || !leaves) { const ly = 10 + r() * 50; leaves += poly([[x + w, ly], [x + w + 14, ly - 4], [x + w + 3, ly + 2]]); } } return { far: [bg(stalks)], near: [acc(leaves)] }; }
  }
}
