import { describe, expect, it } from "vitest";
import { BIOME_LABEL, BIOMES, buildBiome } from "../src/badge/biomes";
import { SX, W } from "../src/badge/geom";
import { LANDMARKS } from "../src/badge/landmarks";
import { rng } from "../src/badge/rng";

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("landmarks", () => {
  it("each is a closed path inside the 100 box, standing on y=100", () => {
    for (const [n, d] of Object.entries(LANDMARKS)) {
      expect(d, n).toMatch(/^M.*Z$/);
      const v = nums(d);
      expect(Math.min(...v), n).toBeGreaterThanOrEqual(0);
      expect(Math.max(...v), n).toBeLessThanOrEqual(100);
    }
  });
});

describe("biomes", () => {
  it("bands and ridges reach the right edge of the 320 field", () => {
    for (const b of ["mountains", "sunrise", "toriiSea", "satoyama"] as const) expect(buildBiome(b, rng(5)).far[0].d, b).toContain(`L${W} 100Z`);
    expect(buildBiome("castle", rng(5)).near[0].d.split("Z").length - 1).toBe(Math.ceil(W / 34) + 1);
    expect((buildBiome("port", rng(5)).near[0].d)).toMatch(new RegExp(` ${W} 70$`));
  });
  it("landmark positions spread over the wider capsule (scaled by W/190)", () => {
    const xs = Array.from({ length: 60 }, (_, s) => buildBiome("fuji", rng(s)).far[0].mat![4]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(20 * SX - 1e-9);
    expect(Math.max(...xs)).toBeGreaterThan(100); // B0's maximum was 100
    expect(Math.max(...xs)).toBeLessThanOrEqual(100 * SX);
  });
  it("nine landscapes, each labelled", () => {
    expect(BIOMES).toHaveLength(9);
    for (const b of BIOMES) expect(BIOME_LABEL[b]).toBeTruthy();
  });
  it("every biome yields far (bg) and near (acc) items with drawable paths, no NaN", () => {
    for (const b of BIOMES) {
      const { far, near } = buildBiome(b, rng(123));
      expect(far.length, b).toBeGreaterThan(0);
      expect(near.length, b).toBeGreaterThan(0);
      for (const it of far) expect(it.tier).toBe("bg");
      for (const it of near) expect(it.tier).toBe("acc");
      for (const it of [...far, ...near]) { expect(it.d, b).toMatch(/^M/); expect(it.d, b).not.toContain("NaN"); }
    }
  });
  it("is deterministic for the same seed", () => {
    for (const b of BIOMES) expect(buildBiome(b, rng(9))).toEqual(buildBiome(b, rng(9)));
  });
});
