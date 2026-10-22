import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dot } from "../src/led/board";
import { flickerLevel, fxDuration, pairDots } from "../src/led/fx";

// Keep jsdom's canvas "Not implemented" noise off stderr should anything touch a context.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => vi.restoreAllMocks());

const d = (x: number, y: number): Dot => ({ x, y, c: "#fff", k: 0 });

describe("pairDots", () => {
  it("pairs equal counts one to one in x-then-y order", () => {
    const p = pairDots([d(2, 0), d(0, 1), d(0, 0)], [d(5, 5), d(1, 1), d(3, 3)]);
    expect(p).toEqual([[d(0, 0), d(1, 1)], [d(0, 1), d(3, 3)], [d(2, 0), d(5, 5)]]);
  });
  it("splits: fewer old dots each feed several new ones", () => {
    const p = pairDots([d(0, 0)], [d(0, 0), d(1, 0), d(2, 0)]);
    expect(p).toHaveLength(3);
    expect(p.every(([a]) => a === p[0][0])).toBe(true);
  });
  it("merges: several old dots land on one new dot", () => {
    const p = pairDots([d(0, 0), d(1, 0), d(2, 0), d(3, 0)], [d(9, 9), d(10, 9)]);
    expect(p).toHaveLength(4);
    expect(new Set(p.map(([, b]) => b)).size).toBe(2);
  });
  it("empty sides become null", () => {
    expect(pairDots([], [d(0, 0)])).toEqual([[null, d(0, 0)]]);
    expect(pairDots([d(0, 0)], [])).toEqual([[d(0, 0), null]]);
    expect(pairDots([], [])).toEqual([]);
  });
});

describe("flickerLevel", () => {
  it("starts dark, flickers, settles fully lit", () => {
    expect(flickerLevel(0)).toBe(0);
    expect(flickerLevel(0.07)).toBeCloseTo(0.9);
    expect(flickerLevel(0.22)).toBe(0);
    expect(flickerLevel(1)).toBe(1);
    expect(flickerLevel(2)).toBe(1);
  });
});

describe("fxDuration", () => {
  const b = { prev: { w: 3, nk: 2 }, cur: { w: 3, nk: 5 }, gd: 1234 } as never;
  it("per effect", () => {
    expect(fxDuration("morph", b)).toBe(1000);
    expect(fxDuration("decode", b)).toBe(1100);
    expect(fxDuration("flicker", b)).toBe(1150);
    expect(fxDuration("flap", b)).toBe(460 + 5 * 34);
    expect(fxDuration("scan", b)).toBe(1234);
    expect(fxDuration("ripple", b)).toBe(1234);
  });
  it("flicker from a blank board is shorter", () => {
    expect(fxDuration("flicker", { prev: { w: 0, nk: 0 }, cur: { w: 3, nk: 1 }, gd: 0 } as never)).toBe(760);
  });
});
