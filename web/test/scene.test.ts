import { describe, expect, it } from "vitest";
import * as pkg from "ascii.rest/pieces";
import * as vendor from "../src/scene/vendor";
import { CAP, PERIOD, forPeriod, scenes, type Period, type SceneDef } from "../src/scene/registry";
import { sampleFrame } from "../src/scene/sample";
import { drawScene } from "../src/scene/draw";
import { fromOklab, oklab } from "../src/scene/oklab";
import { rec, type Call } from "./canvas-rec";

const stub: SceneDef = {
  id: "stub", fig: 1, period: "night", cap: { zh: "a", ja: "b", en: "c" },
  meta: { cols: 4, rows: 4, fps: 15, palette: ["#ffffff"] }, make: () => () => "",
};
const FRAME = "●●  \n●   \n    \n    ";
const alphaOf = (fill: string) => Number(/,([\d.]+)\)$/.exec(fill)![1]);

describe("registry", () => {
  it("every ascii.rest scene is in PERIOD and CAP, and nothing else is (D8: a version bump fails here until filled)", () => {
    const ids = (m: object) => Object.entries(m).filter(([, p]) => (p as { meta?: { category?: string } })?.meta?.category === "scenes").map(([id]) => id);
    const all = [...ids(pkg), ...ids(vendor)].sort();
    expect(Object.keys(PERIOD).sort()).toEqual(all);
    expect(Object.keys(CAP).sort()).toEqual(all);
    expect(scenes().map((s) => s.id).sort()).toEqual(all);
  });
  it("vendor/ only holds scenes the npm package lacks: a release that carries them fails here, delete vendor/", () => {
    const inPkg = new Set(Object.keys(pkg));
    expect(Object.keys(vendor).filter((id) => inPkg.has(id))).toEqual([]);
  });
  it("all 34 scenes split 5 / 7 / 9 / 13 over dawn / day / dusk / night (spec §3)", () => {
    expect(scenes()).toHaveLength(34);
    expect((["dawn", "day", "dusk", "night"] as const).map((p) => forPeriod(p).length)).toEqual([5, 7, 9, 13]);
    expect(forPeriod("day").map((s) => s.id).sort()).toEqual(["blackPrism", "deepReef", "earthrise", "jungleFalls", "kiteFestival", "planetScale", "saturnRise"]);
  });
  it("every cap has zh, ja and en", () => {
    for (const s of scenes()) for (const k of ["zh", "ja", "en"] as const) expect(s.cap[k].length, `${s.id}.${k}`).toBeGreaterThan(0);
  });
});

describe("sampleFrame", () => {
  it("a full glyph is weight 1 in its palette colour, an empty cell 0", () => {
    const s = sampleFrame(stub, () => FRAME, 0, [0, 4]);
    expect([s.C, s.R, s.cells.length]).toEqual([4, 4, 16]);
    expect(s.cells[0]).toEqual({ w: 1, rgb: [255, 255, 255] });
    expect(s.cells[15].w).toBe(0);
  });
  it("crops rows", () => {
    const s = sampleFrame(stub, () => FRAME, 0, [1, 3]);
    expect([s.C, s.R]).toEqual([4, 2]);
    expect(s.cells[0].w).toBe(1);
  });
});

describe("drawScene", () => {
  const s = sampleFrame(stub, () => FRAME, 0, [0, 4]);
  const top = (world: "ura" | "omote", dim: boolean, period: Period = "day") => {
    const { ctx, calls } = rec(); drawScene(ctx, s, world, 3, dim, period);
    return calls;
  };
  /** cell index → [radius, fill] of the dot drawn at its centre (pitch 3, 4 columns) */
  const dots = (calls: Call[]) => {
    const out = new Map<number, [number, string]>();
    calls.forEach((c, i) => {
      if (c.op !== "arc") return;
      const [x, y, r] = c.args as number[];
      out.set(((y - 1.5) / 3) * 4 + (x - 1.5) / 3, [r, calls[i + 1].fill]);
    });
    return out;
  };
  const L = (fill: string) => oklab(/\d+,\d+,\d+/.exec(fill)![0].split(",").map(Number) as [number, number, number])[0];
  it("里: colour alpha never exceeds .72, dim multiplies by .78", () => {
    const a = (dim: boolean) => Math.max(...top("ura", dim).filter((c) => c.op === "fill").map((c) => alphaOf(c.fill)));
    expect(a(false)).toBeCloseTo(0.72, 6);
    expect(a(true)).toBeCloseTo(0.72 * 0.78, 6);
  });
  it("表: no ground is painted, one opaque dot per cell, ≥ .3px and ≤ pitch/√π, no dim", () => {
    const calls = top("omote", false), d = dots(calls);
    expect(calls.some((c) => c.op === "fillRect")).toBe(false);
    expect(d.size).toBe(16);
    for (const [r, fill] of d.values()) { expect(r).toBeGreaterThanOrEqual(0.3); expect(r).toBeLessThanOrEqual(3 / Math.sqrt(Math.PI) + 1e-9); expect(fill).toMatch(/^rgb\(/); }
    expect(top("omote", true)).toEqual(calls);
  });
  it("表 AM: the bright cells print as smaller dots than the empty ones, both periods", () => {
    for (const p of ["day", "night"] as const) {
      const d = dots(top("omote", false, p));
      expect(d.get(0)![0], p).toBeLessThan(d.get(15)![0]);
    }
  });
  it("表: cells of the same weight in different colours print in different inks (the per-pair cache keys on colour)", () => {
    const cells = [{ w: 1, rgb: [255, 72, 176] as [number, number, number] }, { w: 1, rgb: [14, 124, 134] as [number, number, number] }];
    for (const p of ["day", "night"] as const) {
      const { ctx, calls } = rec(); drawScene(ctx, { C: 2, R: 1, cells }, "omote", 3, false, p);
      const fills = calls.filter((c) => c.op === "fill").map((c) => c.fill);
      expect(fills, p).toHaveLength(2);
      expect(fills[0], p).not.toBe(fills[1]);
    }
  });
  it("表: a frame with no tonal range prints light by day, not as a solid block", () => {
    const cells = Array.from({ length: 4 }, () => ({ w: 1, rgb: [200, 200, 200] as [number, number, number] }));
    const { ctx, calls } = rec(); drawScene(ctx, { C: 4, R: 1, cells }, "omote", 3, false, "day");
    for (const c of calls.filter((c) => c.op === "arc")) expect(c.args[2] as number).toBeLessThan(3 * 0.4);
  });
  it("表: dusk / night print deeper than dawn / day", () => {
    const day = dots(top("omote", false, "day")), night = dots(top("omote", false, "night")), dusk = dots(top("omote", false, "dusk"));
    expect(L(night.get(15)![1])).toBeLessThan(L(day.get(15)![1]) - 0.1);
    expect(dusk).toEqual(night);
    expect(dots(top("omote", false, "dawn"))).toEqual(day);
  });
});

describe("oklab", () => {
  it("round-trips sRGB", () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [244, 245, 247], [11, 22, 38], [255, 72, 176], [14, 124, 134]] as [number, number, number][])
      expect(fromOklab(oklab(c))).toEqual(c);
  });
});
