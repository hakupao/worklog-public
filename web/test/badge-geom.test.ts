import { describe, expect, it } from "vitest";
import { capsule, DESIGN_W, FIELD, H, insideField, mix, poly, RATIO, SX, W } from "../src/badge/geom";
import { fnv1a, rng } from "../src/badge/rng";

describe("rng", () => {
  it("fnv1a is the 32-bit FNV-1a", () => {
    expect(fnv1a("")).toBe(2166136261);
    expect(fnv1a("a")).toBe(0xe40c292c);
  });
  it("golden vector: rng(42) starts 0.58945…, 0.89321…, 0.11248… (changing this reshuffles every stored badge's landscape)", () => {
    const r = rng(42);
    expect([r(), r(), r()]).toEqual([0.5894574688281864, 0.8932178856339306, 0.1124822769779712]);
  });
  it("the same seed gives the same sequence in [0,1)", () => {
    const a = rng(42), b = rng(42), xs = Array.from({ length: 50 }, a);
    expect(Array.from({ length: 50 }, b)).toEqual(xs);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(new Set(xs).size).toBeGreaterThan(45);
  });
});

describe("geom", () => {
  it("the capsule spans the 320×100 box (ratio 3.2) and the field is inset 7", () => {
    expect([W, H, RATIO]).toEqual([320, 100, 3.2]);
    expect([DESIGN_W, SX]).toEqual([190, 320 / 190]);
    const nums = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums(capsule(0)).filter((_, i) => i % 2 === 0), ys = nums(capsule(0)).filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(1, 0); expect(Math.max(...xs)).toBeCloseTo(319, 0);
    expect(Math.min(...ys)).toBeCloseTo(1, 0); expect(Math.max(...ys)).toBeCloseTo(99, 0);
    expect(FIELD).toBe(capsule(7));
    expect(capsule(0)).toMatch(/^M.*Z$/);
  });
  it("insideField: centre in, corners out, flat sides nearly to the edge", () => {
    expect(insideField(160, 50)).toBe(true);
    expect(insideField(9, 9)).toBe(false);
    expect(insideField(12, 50)).toBe(true);
    expect(insideField(308, 50)).toBe(true);
    expect(insideField(160, 94)).toBe(false);
    expect(insideField(314, 50)).toBe(false);
  });
  it("mix accepts #rgb and #rrggbb", () => {
    expect(mix("#ff0000", "#000", 0.5)).toBe("#800000");
    expect(mix("#fff", "#000000", 0)).toBe("#ffffff");
  });
  it("poly closes the path", () => { expect(poly([[0, 0], [1, 0], [1, 1]])).toBe("M0.0 0.0L1.0 0.0L1.0 1.0Z"); });
});

describe("capsule memo", () => {
  it("capsule(inset) is memoised: the same string object for the same inset", () => {
    expect(capsule(3.1)).toBe(capsule(3.1));
    expect(capsule(3.1)).not.toBe(capsule(3.2));
  });
});
