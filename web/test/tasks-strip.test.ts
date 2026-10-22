import { describe, expect, it } from "vitest";
import { PITCH } from "../src/led/lattice";
import { drawStripOmote, drawStripUra, stripWidth } from "../src/pages/tasks/strip";
import { rec } from "./canvas-rec";

const COL = "#25e0c8";
const litOf = (calls: ReturnType<typeof rec>["calls"]) => {
  // jsdom has no sprites, so a lit LED is a flat disc in its colour (chart/canvas.ts lit())
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ c, a: arcs[i] })).filter(({ c }) => c.fill === COL).map(({ a }) => [a.args[0] as number, a.args[1] as number]);
};

describe("每日条带", () => {
  it("width: per day 3 dots + 1 gap on the 3px lattice", () => {
    expect(stripWidth(5)).toBe(57);          // no gap after the last day
    expect(stripWidth(7)).toBe(81);
    expect(stripWidth(1, { colW: 9, gap: 0 })).toBe(27);
  });
  it("里: a column per day, lit from the bottom in proportion to the shared max; an empty day lights nothing", () => {
    const { ctx, calls } = rec();
    drawStripUra(ctx, [60, 0, 30], 60, COL, { w: 12 * PITCH, h: 12 * PITCH, offX: 0, offY: 0 });   // 12 × 12 dots of room
    const lit = litOf(calls);
    const col = (d: number) => lit.filter(([x]) => x >= d * 4 * PITCH && x < (d * 4 + 3) * PITCH);
    expect(col(0)).toHaveLength(3 * 10);          // the max: the full 10 rows, 3 dots wide
    expect(col(1)).toHaveLength(0);
    expect(col(2)).toHaveLength(3 * 5);           // half the max: 5 rows
    // lit from the bottom: the half column's top is below the full column's top
    expect(Math.min(...col(2).map(([, y]) => y))).toBeGreaterThan(Math.min(...col(0).map(([, y]) => y)));
    // every centre on the lattice
    for (const [x, y] of lit) { expect((x - PITCH / 2) % PITCH).toBe(0); expect((y - PITCH / 2) % PITCH).toBe(0); }
  });
  it("里: a little work still lights one dot; the max is shared, so a small row stays small", () => {
    const { ctx, calls } = rec();
    drawStripUra(ctx, [1, 0, 0], 600, COL, { w: 12 * PITCH, h: 12 * PITCH, offX: 0, offY: 0 });
    expect(litOf(calls)).toHaveLength(3);
  });
  it("表: solid bars on a hairline baseline, no lattice dots", () => {
    const { ctx, calls } = rec();
    drawStripOmote(ctx, [60, 0, 30], 60, COL, { w: 36, h: 36 });
    const bars = calls.filter((c) => c.op === "fillRect" && c.fill === COL);
    expect(bars).toHaveLength(2);
    const hs = bars.map((b) => b.args[3] as number);
    expect(hs[0]).toBeGreaterThan(hs[1]);
    expect(calls.some((c) => c.op === "arc")).toBe(false);
  });
});
