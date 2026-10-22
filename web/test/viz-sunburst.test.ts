import { describe, expect, it } from "vitest";
import { type Sunburst, deriveSunburst, drawSunOmote, drawSunUra, NO_REQ, SUN_HEIGHT, sunAt } from "../src/pages/stats/viz/sunburst";
import { taskMap } from "../src/pages/stats/useViz";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { prepare, segments } from "../src/pages/stats/viz/wall";
import { C, inkOf, lineColor, mix } from "../src/ui/palette";
import { rec } from "./canvas-rec";
import { VIZ, VIZ_TASKS } from "./viz-fixture";

const font = () => "600 11px sans";
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const sbOf = (from = VIZ.range.from, to = VIZ.range.to, tasks = VIZ_TASKS) => {
  const p = prepare({ ...VIZ, range: { from, to } });
  return deriveSunburst(p, segments(p), taskMap(tasks));
};
const TAU = Math.PI * 2;

describe("deriveSunburst — requester → task → machine, wall clock split evenly", () => {
  it("inner ring: 田中 135 (T1), unlinked 120, 佐藤 / 鈴木 97.5 each (T2's 195 halved) — adds up to the range's 450", () => {
    const sb = sbOf();
    expect(sb.total).toBe(450);
    expect(sb.rings[0].map((z) => [z.req, z.v, z.ri])).toEqual([["田中", 135, 0], ["", 120, 1], ["佐藤", 97.5, 2], ["鈴木", 97.5, 3]]);
    expect(sb.rings[0].reduce((m, z) => m + z.v, 0)).toBe(450);
    expect(sb.rings[1].map((z) => [z.req, z.task, z.v])).toEqual([["田中", "T1", 135], ["", "", 120], ["佐藤", "T2", 97.5], ["鈴木", "T2", 97.5]]);
  });

  it("outer ring: a task's slice splits by its own per-machine wall clock — T1 macmini 135 / win11 45 of 180 → 101.25 / 33.75", () => {
    const sb = sbOf();
    expect(sb.rings[2].map((z) => [z.task, z.machine, z.v])).toEqual([
      ["T1", "macmini", 101.25], ["T1", "win11", 33.75], ["", "macmini", 120], ["T2", "macmini", 97.5], ["T2", "macmini", 97.5],
    ]);
  });

  it("arcs: clockwise from 0, each ring's parts nest in their parent and the rings close at 2π", () => {
    const sb = sbOf();
    for (const ring of sb.rings) {
      expect(ring[0].a0).toBe(0);
      expect(ring[ring.length - 1].a1).toBeCloseTo(TAU);
    }
    expect(sb.rings[0][0].a1).toBeCloseTo((135 / 450) * TAU);
    expect(sb.rings[1][0].a1).toBeCloseTo(sb.rings[0][0].a1);
    expect(sb.rings[2][1].a1).toBeCloseTo(sb.rings[1][0].a1);
  });

  it("a task the table does not know goes to the no-requester slice; nothing in range: empty", () => {
    const sb = sbOf("2026-09-20", "2026-09-22", VIZ_TASKS.filter((t) => t.id !== "T3"));
    expect(sb.rings[0].map((z) => [z.req, z.v])).toContainEqual([NO_REQ, 60]);
    expect(sbOf("2026-10-05", "2026-10-06")).toEqual({ total: 0, rings: [[], [], []] });
  });
});

describe("drawSunburst", () => {
  it("表: one sector per arc (4 + 4 + 5), tasks in their ink; the total in the centre; sunAt finds ring and arc", () => {
    const sb = sbOf(), r = rec();
    const g = drawSunOmote(r.ctx, sb, null, { w: 600, h: SUN_HEIGHT }, font, "7.5h");
    const fills = r.calls.filter((c) => c.op === "fill");
    expect(fills).toHaveLength(13);
    expect(fills[4].fill).toBe(inkOf(lineColor("T1")));
    // P3: the machine ring as the legend says — amber Mac, blue Win11 (inked for paper)
    expect(fills.slice(8).map((c) => c.fill)).toEqual(sb.rings[2].map((m) => inkOf(/^win/i.test(m.machine) ? "#bfe6ff" : C.AMBER)));
    expect(new Set(fills.slice(8).map((c) => c.fill)).size).toBe(2);
    expect(r.calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["7.5h"]);
    const at = (frac: number, a: number) => sunAt(g, sb, g.cx + Math.sin(a) * frac * g.R, g.cy - Math.cos(a) * frac * g.R);
    expect(at(0.4, 0.1)).toEqual({ ring: 0, i: 0 });
    expect(at(0.7, TAU * 0.5)).toEqual({ ring: 1, i: 1 });
    expect(at(0.95, sb.rings[2][1].a0 + 0.01)).toEqual({ ring: 2, i: 1 });
    expect(at(0.1, 1)).toBeNull();
    expect(at(0.535, 1)).toBeNull();
    expect(at(1.1, 1)).toBeNull();
    const h = rec();
    drawSunOmote(h.ctx, sb, "T2", { w: 600, h: SUN_HEIGHT }, font, "7.5h");
    expect(h.calls.filter((c) => c.op === "fill").map((c) => c.alpha)).toEqual([1, 1, 1, 1, 0.3, 0.3, 1, 1, 0.3, 0.3, 0.3, 1, 1]);   // R5: .3 in both worlds
  });

  it("a canvas narrower than it is tall (C3: 400 × 570): the circle fits the width in both worlds", () => {
    const sb = sbOf(), u = drawSunUra(rec().ctx, sb, null, { w: 400, h: SUN_HEIGHT, offX: 0, offY: 0 }, "zh", noGlyph);
    const r = rec(), o = drawSunOmote(r.ctx, sb, null, { w: 400, h: SUN_HEIGHT }, font, "7.5h");
    for (const g of [u, o]) {
      expect(g.cx - g.R).toBeGreaterThanOrEqual(0);
      expect(g.cx + g.R).toBeLessThanOrEqual(400);
      expect(g.R).toBeGreaterThan(160);
    }
    expect(Math.max(...r.calls.filter((c) => c.op === "arc").map((c) => Number(c.args[2])))).toBeLessThanOrEqual(200);
  });

  it("里: the task ring in line colours, Win11 blue on the outer ring", () => {
    const sb = sbOf(), r = rec();
    drawSunUra(r.ctx, sb, null, { w: 600, h: SUN_HEIGHT, offX: 0, offY: 0 }, "zh", noGlyph);
    const fills = new Set(r.calls.filter((c) => c.op === "fill" && c.fill.startsWith("#")).map((c) => c.fill));
    expect(fills.has(lineColor("T1"))).toBe(true);
    expect(fills.has(lineColor("T2"))).toBe(true);
    expect(fills.has("#bfe6ff")).toBe(true);
  });
});

describe("B3b archetype C (G3 c3) — sunburst task arcs", () => {
  const BANDS1: [number, number] = [0.55, 0.88];
  const mk = (arcs: [string, number, number][]): Sunburst => ({
    total: 100, rings: [[], arcs.map(([task, a0, a1]) => ({ v: 1, req: "r", task, a0, a1 })), []],
  });
  const edge = (k: string) => mix(inkOf(lineColor(k || null)), "#ffffff", 0.55);
  const capCol = (k: string) => mix(lineColor(k), "#ffffff", 0.45);

  it("表: a ring-1 task arc ≥ 6 px long gets a 1.75 px stroke on radius r1 − .875 in the mixed ink, clipped to the arc; 未关联 and short arcs none", () => {
    const sb = mk([["T1", 0, 3], ["", 3, 6], ["T2", 6, 6.01]]), r = rec();
    const g = drawSunOmote(r.ctx, sb, null, { w: 600, h: SUN_HEIGHT }, font, "x");
    const strokes = r.calls.map((c, i) => ({ c, i })).filter(({ c }) => c.op === "stroke");
    expect(strokes.map(({ c }) => [c.stroke, c.lw])).toEqual([[edge("T1"), 1.75]]);
    const i = strokes[0].i, before = r.calls.slice(0, i).map((c) => c.op);
    const arcs = r.calls.slice(0, i).filter((c) => c.op === "arc").at(-1)!;
    expect(arcs.args[2]).toBeCloseTo(0.88 * g.R - 0.875);
    expect(arcs.args[3]).toBeCloseTo(-Math.PI / 2);
    expect(r.calls[i + 1].op).toBe("restore");
    expect(before.lastIndexOf("clip")).toBe(before.lastIndexOf("save") + 1);
    expect(r.calls[before.lastIndexOf("clip") - 1].op).toBe("save");
    expect(r.calls.slice(before.lastIndexOf("save") - 1, before.lastIndexOf("save")).map((c) => c.op)).toEqual(["fill"]);
  });

  it("表: the stroke dims to .3 under another task's hover", () => {
    const r = rec();
    drawSunOmote(r.ctx, mk([["T1", 0, 3]]), "T2", { w: 600, h: SUN_HEIGHT }, font, "x");
    expect(r.calls.find((c) => c.op === "stroke")!.alpha).toBe(0.3);
  });

  /** 里 at the 200 × 190 dots of a 600px 表 canvas (centre dot (100, 95); heights are set in 表 units, the lattice is PITCH). */
  const GU = { w: 200 * PITCH, h: (SUN_HEIGHT / OMOTE_UNIT) * PITCH, offX: 0, offY: 0 };
  /** The lattice cell of each dot drawn in `col` as (arc length from the arc's start, distance from centre) in dots. */
  const cells = (r: ReturnType<typeof rec>, col: string) => r.calls.flatMap((c, i) => {
    if (c.op !== "fill" || c.fill !== col || r.calls[i - 1]?.op !== "arc") return [];
    const di = Math.round((Number(r.calls[i - 1].args[0]) - PITCH / 2) / PITCH) - 100, dj = Math.round((Number(r.calls[i - 1].args[1]) - PITCH / 2) / PITCH) - 95;
    let a = Math.atan2(di, -dj); if (a < 0) a += Math.PI * 2;
    return [{ a, rad: Math.hypot(di, dj), al: c.alpha }];
  });

  it("里: a ring-1 arc's first dots (0.7 ≤ d < 3.7) light in the mixed colour at full alpha; the rounded ends keep the band colour", () => {
    const sb = mk([["T1", 0, 3], ["", 3, 6]]), r = rec();
    drawSunUra(r.ctx, sb, null, GU, "zh", noGlyph);
    const R = 91, b0 = BANDS1[0] * R, b1 = BANDS1[1] * R;
    const cap = cells(r, capCol("T1")), band = cells(r, lineColor("T1"));
    expect(cap.length).toBeGreaterThan(8);
    expect(cap.every((c) => c.a * c.rad >= 0.7 && c.a * c.rad < 3.7 && c.al === 1)).toBe(true);
    expect(cap.every((c) => !((c.a * c.rad < 1.7 || c.a * c.rad >= 2.7) && (c.rad - b0 < 1 || b1 - c.rad < 1)))).toBe(true);
    expect(band.some((c) => c.a * c.rad >= 0.7 && c.a * c.rad < 1.7 && (c.rad - b0 < 1 || b1 - c.rad < 1))).toBe(true);
    expect(band.some((c) => c.a * c.rad >= 3.7)).toBe(true);
    expect(cells(r, mix(lineColor(null), "#ffffff", 0.45))).toHaveLength(0);       // 未关联: none
  });

  it("里: an arc shorter than 6 dots at its mid radius gets no capsule", () => {
    const r = rec();
    drawSunUra(r.ctx, mk([["T1", 0, 0.05], ["T2", 0.05, 6]]), null, GU, "zh", noGlyph);
    expect(cells(r, capCol("T1"))).toHaveLength(0);
    expect(cells(r, capCol("T2")).length).toBeGreaterThan(8);
  });

  it("里: the capsule keeps the hover dimming of its task (min(1, fk))", () => {
    const r = rec();
    drawSunUra(r.ctx, mk([["T1", 0, 3], ["T2", 3, 6]]), "T2", GU, "zh", noGlyph);
    expect(cells(r, capCol("T1")).every((c) => Math.abs(c.al - 0.3) < 1e-9)).toBe(true);
    expect(cells(r, capCol("T2")).every((c) => c.al === 1)).toBe(true);
  });
});
