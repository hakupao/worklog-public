import { describe, expect, it } from "vitest";
import { W } from "../src/badge/geom";
import { levelFor } from "../src/badge/lod";
import { buildScene, seasonOf } from "../src/badge/scene";

const ID = "T20261001-01";

describe("levelFor", () => {
  it("S ≤ 24, M 25–48, L > 48 (CSS px, fractional included)", () => {
    expect([17, 18, 23.5, 24].map(levelFor)).toEqual(["S", "S", "S", "S"]);
    expect([24.1, 25, 36, 48].map(levelFor)).toEqual(["M", "M", "M", "M"]);
    expect([48.5, 49, 96, 400].map(levelFor)).toEqual(["L", "L", "L", "L"]);
  });
});

describe("seasonOf", () => {
  it("month → season, day → 5 + day % 6", () => {
    expect(seasonOf("T20260401-01")).toEqual({ season: "spring", count: 6 });
    expect(seasonOf("T20260701-01")).toEqual({ season: "summer", count: 6 });
    expect(seasonOf("T20261013-01")).toEqual({ season: "autumn", count: 6 });
    expect(seasonOf("T20260116-02")).toEqual({ season: "winter", count: 9 });
    expect(seasonOf("T20261231-01").season).toBe("winter");
  });
  it("an id without a date falls back deterministically (no NaN)", () => {
    const a = seasonOf("legacy-7"), b = seasonOf("legacy-7");
    expect(a).toEqual(b);
    expect(["spring", "summer", "autumn", "winter"]).toContain(a.season);
    expect(Number.isInteger(a.count)).toBe(true);
  });
});

describe("buildScene", () => {
  it("summer sparkles spread across the whole width", () => {
    const xs = Array.from({ length: 30 }, (_, i) => buildScene(`T202607${String(1 + i).padStart(2, "0")}-01`, "phosphor:cat", "L"))
      .flatMap((s) => [...s.items.at(-2)!.d.matchAll(/M(-?[\d.]+) /g)].map((m) => +m[1]));
    expect(Math.max(...xs)).toBeGreaterThan(190);
    expect(Math.max(...xs)).toBeLessThanOrEqual(310);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
  });
  it("an even-odd object's hero carries the rule; a nonzero one carries none", () => {
    for (const l of ["S", "M", "L"] as const) {
      expect(buildScene(ID, "fluent:panda", l).items.at(-1)!.rule, l).toBe("evenodd");
      expect(buildScene(ID, "phosphor:cat", l).items.at(-1)!.rule, l).toBeUndefined();
    }
  });
  it("S has only the hero, M adds the far layer, L adds near + weather", () => {
    const tiers = (l: "S" | "M" | "L") => buildScene(ID, "phosphor:cat", l).items.map((i) => i.tier);
    expect(tiers("S")).toEqual(["hero"]);
    expect(new Set(tiers("M"))).toEqual(new Set(["bg", "hero"]));
    expect(new Set(tiers("L"))).toEqual(new Set(["bg", "acc", "hero"]));
    for (const l of ["S", "M", "L"] as const) expect(tiers(l).at(-1)).toBe("hero");
  });
  it("hero: S/M 100 units tall from y=0 (no crop), L 96 standing on y=98", () => {
    const hero = (id: string, l: "S" | "M" | "L") => buildScene(id, "phosphor:cat", l).items.at(-1)!.mat!;
    for (const l of ["S", "M"] as const) { const m = hero(ID, l); expect(Math.abs(m[0]) * 256).toBeCloseTo(100); expect(m[5]).toBeCloseTo(0); }
    const m = hero(ID, "L"); expect(Math.abs(m[0]) * 256).toBeCloseTo(96); expect(m[5]).toBeCloseTo(2);
  });
  it("the hero box stays inside the capsule horizontally (S/M 0…W, L 8…W−8), flipped or not", () => {
    const left = (m: number[]) => (m[0] < 0 ? m[4] + m[0] * 256 : m[4]);
    for (let i = 0; i < 40; i++) {
      const id = `T202610${String(1 + (i % 28)).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      for (const l of ["S", "M"] as const) { const m = buildScene(id, "phosphor:cat", l).items.at(-1)!.mat!; expect(left(m)).toBeGreaterThanOrEqual(-1e-9); expect(left(m) + 100).toBeLessThanOrEqual(W + 1e-9); }
      const m = buildScene(id, "phosphor:cat", "L").items.at(-1)!.mat!; expect(left(m)).toBeGreaterThanOrEqual(8 - 1e-9); expect(left(m) + 96).toBeLessThanOrEqual(W - 8 + 1e-9);
    }
  });
  it("S/M: the hero sits at one fixed spot on the right (box 165…265) for every id, flipped or not; L still moves", () => {
    const left = (m: number[]) => (m[0] < 0 ? m[4] + m[0] * 256 : m[4]);
    const ids = Array.from({ length: 40 }, (_, i) => `T202610${String(1 + (i % 28)).padStart(2, "0")}-${String(i).padStart(2, "0")}`);
    for (const l of ["S", "M"] as const) for (const id of ids) expect(left(buildScene(id, "phosphor:cat", l).items.at(-1)!.mat!)).toBeCloseTo(165);
    expect(new Set(ids.map((id) => buildScene(id, "phosphor:cat", "L").items.at(-1)!.mat![4].toFixed(1))).size).toBeGreaterThan(10);
  });
  it("same id → same scene; the object does not change the landscape", () => {
    expect(buildScene(ID, "phosphor:cat", "L")).toEqual(buildScene(ID, "phosphor:cat", "L"));
    const a = buildScene(ID, "phosphor:cat", "L"), b = buildScene(ID, "phosphor:rocket", "L");
    expect(b.biome).toBe(a.biome); expect(b.flip).toBe(a.flip);
    expect(b.items.slice(0, -1)).toEqual(a.items.slice(0, -1));
  });
  it("S, M and L share flip and biome", () => {
    const s = buildScene(ID, "phosphor:cat", "S"), l = buildScene(ID, "phosphor:cat", "L");
    expect(s.flip).toBe(l.flip); expect(s.biome).toBe(l.biome);
  });
  it("different ids spread over the biomes", () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => buildScene(`T202610${String(1 + (i % 28)).padStart(2, "0")}-${String(i).padStart(2, "0")}`, "phosphor:cat", "L").biome));
    expect(seen.size).toBeGreaterThanOrEqual(7);
  });
  it("no NaN anywhere, even for a dateless id", () => {
    for (const id of [ID, "legacy-7", ""]) for (const l of ["S", "M", "L"] as const) {
      const s = buildScene(id, "phosphor:cat", l);
      for (const it of s.items) { expect(it.d).not.toContain("NaN"); expect(it.mat?.some(Number.isNaN) ?? false).toBe(false); }
    }
  });
});
