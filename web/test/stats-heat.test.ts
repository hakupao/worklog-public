import { describe, expect, it } from "vitest";
import { PITCH } from "../src/led/lattice";
import { drawHeatOmote, drawHeatUra, heatAt } from "../src/pages/stats/heat";
import { C } from "../src/ui/palette";
import { rec, type Call } from "./canvas-rec";

const noGlyph = () => ({ w: 0, h: 10, on: new Uint8Array(0) });
const one = () => ({ w: 1, h: 1, on: new Uint8Array([1]) });
const lits = (calls: Call[], col: string) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ c, a: arcs[i] })).filter(({ c }) => c.fill === col)
    .map(({ c, a }) => ({ x: a.args[0] as number, y: a.args[1] as number, alpha: c.alpha }));
};
const grid = () => { const g = Array.from({ length: 7 }, () => Array<number>(24).fill(0)); g[0][22] = 40; g[2][10] = 80; return g; };
const DOW = ["一", "二", "三", "四", "五", "六", "日"];

describe("统计 7×24 heat (里)", () => {
  // 133×76 dots; no-glyph labels leave a 2-dot column; 11 rows for the hour ticks. The cells take the
  // rest exactly: an hour every 131/24 dots, a day every 65/7, one dot apart; a dot belongs to the cell its centre is in
  const draw = (bitsFn = noGlyph) => { const r = rec(); const g = drawHeatUra(r.ctx, grid(), DOW, { w: 133 * PITCH, h: 76 * PITCH, offX: 0, offY: 0 }, "zh", 10, bitsFn); return { ...r, g }; };
  const same = (a: [number, number] | null, b: [number, number]) => a !== null && a[0] === b[0] && a[1] === b[1];

  it("one cluster of dots per hour, brightness by minutes against the busiest hour; empty hours are dim dots", () => {
    const { calls, g } = draw();
    const amber = lits(calls, C.AMBER);
    const cell = (d: number, h: number) => amber.filter((p) => same(heatAt(g, p.x, p.y), [d, h]));
    // hour 10 spans dots 55…59 after the label column (4 lit + 1 gap); hour 22 spans 120…125 (5 + 1); days 8 + 1
    expect(cell(2, 10)).toHaveLength(4 * 8);
    expect(cell(0, 22)).toHaveLength(5 * 8);
    expect(amber).toHaveLength(72);
    expect(new Set(cell(2, 10).map((p) => p.alpha))).toEqual(new Set([1]));
    expect(cell(0, 22)[0].alpha).toBeCloseTo(0.14 + 0.86 * Math.pow(0.5, 0.8));
    // every cell's dots: (131 − 24) columns × (65 − 7) rows, less the two lit cells
    const off = calls.filter((c) => c.op === "fill" && c.fill === "rgba(255,236,214,.05)");
    expect(off).toHaveLength(107 * 58 - 72);
  });

  it("the cells fill the slot: the last hour ends one gap dot before the edge, the last day on the row above the ticks", () => {
    const { calls, g } = draw();
    const dots = calls.filter((c) => c.op === "arc").map((c) => [c.args[0] as number, c.args[1] as number]);
    expect(Math.max(...dots.map(([x]) => x))).toBe(131 * PITCH + PITCH / 2);   // dot 132 is the last cell's gap
    expect(g.x0 + 24 * g.cw).toBeCloseTo(133 * PITCH);
    expect(g.y0 + 7 * g.ch).toBeCloseTo(65 * PITCH);
  });

  it("weekday labels and the 0 / 6 / 12 / 18 / 23 ticks are dot glyphs; the weekend rows are dimmer", () => {
    const { calls } = draw(one);
    const glyphs = lits(calls, C.AMBER).filter((p) => p.alpha < 0.6 && p.x < 2 * PITCH);
    // the label column is 1 + 2 dots wide: one label dot per weekday on dot 0
    expect(glyphs.map((p) => p.alpha)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.32, 0.32]);
    const ticks = lits(calls, C.AMBER).filter((p) => p.y > 65 * PITCH && p.alpha === 0.45);
    expect(ticks).toHaveLength(5);
  });

  it("returns the grid's geometry; heatAt maps a point to [weekday, hour]", () => {
    const { g } = draw();
    // lw = 0 + 2 dots → x0 2 · PITCH; 131/24 dots an hour, 65/7 dots a day
    expect(g.x0).toBe(2 * PITCH);
    expect(g.cw).toBeCloseTo((131 * PITCH) / 24);
    expect(g.ch).toBeCloseTo((65 * PITCH) / 7);
    expect(heatAt(g, g.x0 + 10 * g.cw + 1, 2 * g.ch + 1)).toEqual([2, 10]);
    expect(heatAt(g, g.x0 - 1, 10)).toBeNull();
    expect(heatAt(g, g.x0 + 24 * g.cw, 10)).toBeNull();
    expect(heatAt(g, 10, g.y0 + 7 * g.ch + 1e-6)).toBeNull();   // just under the last day (ε past 7 · ch: float error at 130/7)
  });
});

describe("统计 7×24 heat (表)", () => {
  const draw = () => { const r = rec(); const g = drawHeatOmote(r.ctx, grid(), DOW, { w: 400, h: 228 }, (wt) => `${wt} 11px x`); return { ...r, g }; };

  it("168 printed cells, ink by minutes; empty hours a faint wash; no lattice dots", () => {
    const { calls } = draw();
    const cells = calls.filter((c) => c.op === "fillRect");
    expect(cells).toHaveLength(168);
    expect(cells.filter((c) => c.fill === "rgba(15,28,46,.035)")).toHaveLength(166);
    expect(cells.find((c) => c.fill === "rgba(15,28,46,0.940)")).toBeTruthy();
    expect(calls.some((c) => c.op === "arc")).toBe(false);
  });

  it("weekday labels on the left (weekend lighter), hour ticks below; cells fill the width after the labels", () => {
    const { calls, g } = draw();
    const text = calls.filter((c) => c.op === "fillText");
    expect(text.map((c) => c.args[0])).toEqual([...DOW, "0", "6", "12", "18", "23"]);
    expect(g.x0).toBe(30);
    expect(g.x0 + 24 * g.cw).toBeCloseTo(400);
    expect(g.ch).toBeCloseTo((228 - 16) / 7);
    expect(heatAt(g, 31, 1)).toEqual([0, 0]);
  });
});
