import { describe, expect, it } from "vitest";
import { PITCH } from "../src/led/lattice";
import { drawHistOmote, drawHistUra, HIST, histColor, histWidth } from "../src/pages/plan/hist";
import { C } from "../src/ui/palette";
import { rec } from "./canvas-rec";

const noGlyph = () => ({ w: 0, h: 10, on: new Uint8Array(0) });
const one = () => ({ w: 1, h: 1, on: new Uint8Array([1]) });
// jsdom has no sprites, so a lit LED is a flat disc in its colour (chart/canvas.ts lit())
const litIn = (calls: ReturnType<typeof rec>["calls"], col: string) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ c, a: arcs[i] })).filter(({ c }) => c.fill === col).map(({ a }) => [a.args[0] as number, a.args[1] as number]);
};

describe("AI 对账 bars", () => {
  it("colour: green when every item is done, amber when some, the off colour when none", () => {
    expect([histColor(1), histColor(0.5), histColor(0)]).toEqual([C.GREEN, C.AMBER, "#8a8275"]);
    expect(histWidth()).toBe((5 * 25 - 3) * 3 + 3);
  });
  it("里: each bar fills from the bottom by its share, 22 dots wide, 16 rows tall; an empty day lights nothing", () => {
    const { ctx, calls } = rec();
    drawHistUra(ctx, [1, 0.5, 0, 0.25, 0], ["一", "二", "三", "四", "五"], 2, { w: 400, h: 93, offX: 0, offY: 0 }, "zh", noGlyph);
    const green = litIn(calls, C.GREEN), amber = litIn(calls, C.AMBER);
    expect(green).toHaveLength(HIST.sw * 16);
    // 0.5 → 8 rows, 0.25 → 4 rows
    expect(amber).toHaveLength(HIST.sw * 8 + HIST.sw * 4);
    const bar = (s: number) => amber.filter(([x]) => x >= s * 25 * PITCH && x < (s * 25 + 22) * PITCH);
    // from the bottom: the half bar's lowest dot is level with the full bar's lowest
    expect(Math.max(...bar(1).map(([, y]) => y))).toBe(Math.max(...green.map(([, y]) => y)));
    for (const [x, y] of [...green, ...amber]) { expect((x - PITCH / 2) % PITCH).toBe(0); expect((y - PITCH / 2) % PITCH).toBe(0); }
  });
  it("里: the chosen day's unlit dots are brighter; labels are dot glyphs under the bars", () => {
    const { ctx, calls } = rec();
    drawHistUra(ctx, [0, 0, 0, 0, 0], ["一", "二", "三", "四", "五"], 3, { w: 400, h: 93, offX: 0, offY: 0 }, "zh", one);
    const off = calls.filter((c) => c.op === "fill" && c.fill.startsWith("rgba(255,236,214"));
    expect(off.filter((c) => c.fill.endsWith(",0.22)"))).toHaveLength(22 * 16);
    expect(litIn(calls, C.AMBER)).toHaveLength(5);              // one label dot per day
  });
  it("表: solid bars on a pale track, body-font labels (the chosen one bold), no lattice dots", () => {
    const { ctx, calls } = rec();
    drawHistOmote(ctx, [1, 0.5, 0, 0, 0], ["一", "二", "三", "四", "五"], 1, { w: 400, h: 93 }, (w) => `${w} 11px x`);
    const rects = calls.filter((c) => c.op === "fillRect");
    expect(rects.filter((c) => c.fill === "#0e7c86")).toHaveLength(1);
    const part = rects.filter((c) => c.fill === "#6f7d8e");
    expect(part).toHaveLength(1);
    expect(part[0].args[3]).toBe(24);                           // half of 16 rows × 3px
    expect(rects.filter((c) => c.fill === "#dfe4ea")).toHaveLength(1);
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["一", "二", "三", "四", "五"]);
    expect(calls.some((c) => c.op === "arc")).toBe(false);
  });
});
