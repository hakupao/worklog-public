import type { Tier } from "./biomes";
import { f, FIELD, H, insideField, mix, SX, W } from "./geom";
import type { Level } from "./lod";
import { rim } from "./rim";
import { fnv1a, rng } from "./rng";
import type { Scene } from "./scene";

export type Sampler = (x: number, y: number) => Tier | null;
export const STEP: Record<Level, number> = { S: 9.5, M: 6.5, L: 5 };
export interface Cell { gx: number; gy: number; x: number; y: number; t: Tier | "off" }

/** The LED grid inside the field: one cell per `step`, each lit by whatever the scene has under its centre. */
export function sampleCells(sample: Sampler, step: number): Cell[] {
  const out: Cell[] = [];
  for (let gy = 0, y = 7 + step / 2; y < H - 7; y += step, gy++)
    for (let gx = 0, x = 7 + step / 2; x < W - 7; x += step, gx++)
      if (insideField(x, y)) out.push({ gx, gy, x, y, t: sample(x, y) ?? "off" });
  return out;
}
/** 里 tuning, chosen by the user in the G0 tuning prototype (round 1). Landscape dots (off / far / near) are drawn in
 *  the badge colour pulled `landGrey` toward grey; the hero stays the pure colour with a strong glow. */
export const URA = { field: "#06080a", fieldLight: 0, fieldTint: 0.1, off: ".2", bg: ".6", acc: "1", landGrey: 0.6, glowBlur: 3, glowGain: 2, knockout: 0 } as const;
/** S only (B2 G2 follow-up, 2026-10-14, user picked variant C): at 18–24 px on a phone's dark card the G0 field read
 *  as empty, so the field takes 25 % of the badge colour and the off dots show at .35. M and L keep the G0 values. */
export const URA_S = { fieldTint: 0.25, off: ".35" } as const;

/** Spec §2.3 knockout: lit non-hero dots within `w` cells of a hero dot go off (0 = no ring; 里 uses 0 since G0 round 1). */
export function knockout(cells: Cell[], w: number): Cell[] {
  if (w <= 0) return cells;
  const hero = new Set(cells.filter((c) => c.t === "hero").map((c) => `${c.gx},${c.gy}`));
  const near = (c: Cell) => {
    for (let dx = -w; dx <= w; dx++) for (let dy = -w; dy <= w; dy++) if ((dx || dy) && hero.has(`${c.gx + dx},${c.gy + dy}`)) return true;
    return false;
  };
  return cells.map((c) => (c.t !== "hero" && c.t !== "off" && near(c) ? { ...c, t: "off" } : c));
}

const R = { hero: 2, acc: 1.8, bg: 1.6, off: 1.2 } as const;

/** 里 world, spec §2.4 ④: dark glass, lit dots in four tiers, diamond-cut rim. Without a sampler (no canvas) the
 *  hero is drawn as one glowing silhouette so the badge still says which task it is. */
export function uraSvg(scene: Scene, color: string, level: Level, id: string, u: string, sample: Sampler | null): string {
  const rm = rim(u, color, rng(fnv1a(id + "|rim")), level), step = STEP[level], k = step / 5;
  let body: string;
  if (sample) {
    const g = { hero: "", acc: "", bg: "", off: "" }, land = mix(color, "#8c939c", URA.landGrey);
    for (const c of knockout(sampleCells(sample, step), URA.knockout)) g[c.t] += `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(R[c.t] * k)}"/>`;
    body = `<g fill="${land}" opacity="${level === "S" ? URA_S.off : URA.off}">${g.off}</g><g fill="${land}" opacity="${URA.bg}">${g.bg}</g><g fill="${land}" opacity="${URA.acc}">${g.acc}</g><g fill="${color}" filter="url(#glo-${u})">${g.hero}</g>`;
  } else {
    const h = scene.items[scene.items.length - 1], fr = h.rule ? ` fill-rule="${h.rule}"` : "";
    body = `<g clip-path="url(#cl-${u})"><path d="${h.d}" transform="matrix(${h.mat!.join(" ")})"${fr} fill="${color}" filter="url(#glo-${u})"/></g>`;
  }
  const field = mix(mix(URA.field, "#ffffff", URA.fieldLight), color, level === "S" ? URA_S.fieldTint : URA.fieldTint);
  return `<defs>${rm.defs}<filter id="glo-${u}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${URA.glowBlur}" result="g"/><feComponentTransfer in="g" result="g2"><feFuncA type="linear" slope="${URA.glowGain}"/></feComponentTransfer><feMerge><feMergeNode in="g2"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
${rm.under}<path d="${FIELD}" fill="${field}"/>${body}<ellipse clip-path="url(#cl-${u})" cx="${f(80 * SX)}" cy="14" rx="${f(90 * SX)}" ry="20" fill="#ffffff" opacity=".045"/>${rm.over}`;
}
