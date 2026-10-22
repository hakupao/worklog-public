import { describe, expect, it } from "vitest";
import { PITCH } from "../src/led/lattice";
import { drawDayBarOmote, drawDayBarUra } from "../src/pages/report/bar";
import { rec } from "./canvas-rec";

const COL = "#ffad3a", TRACK = "rgba(255,236,214,.07)";
// jsdom has no sprites, so a lit LED is a flat disc in its colour (chart/canvas.ts lit()); each arc is followed by its fill
const dots = (calls: ReturnType<typeof rec>["calls"]) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((f, i) => ({ fill: f.fill, x: arcs[i].args[0] as number, y: arcs[i].args[1] as number }));
};

describe("日別作業 day bar", () => {
  it("里: two rows of dots on the PITCH lattice, lit from the left by the day's share, the rest a dim track", () => {
    const { ctx, calls } = rec();
    drawDayBarUra(ctx, 0.5, COL, { w: 20 * PITCH, h: 4 * PITCH, offX: 0, offY: 0 });   // 20 dots × 4 rows of room
    const d = dots(calls);
    expect(d).toHaveLength(20 * 2);
    const lit = d.filter((x) => x.fill === COL), track = d.filter((x) => x.fill === TRACK);
    expect(lit).toHaveLength(10 * 2);
    expect(track).toHaveLength(10 * 2);
    expect(Math.max(...lit.map((x) => x.x))).toBeLessThan(Math.min(...track.map((x) => x.x)));
    for (const x of d) { expect((x.x - PITCH / 2) % PITCH).toBe(0); expect((x.y - PITCH / 2) % PITCH).toBe(0); }
  });
  it("里: the page lattice offset shifts every dot; a zero day is only track; frac is clamped", () => {
    const a = rec();
    drawDayBarUra(a.ctx, 0, COL, { w: 20 * PITCH, h: 4 * PITCH, offX: 1, offY: PITCH - 1 });
    const d = dots(a.calls);
    expect(d.every((x) => x.fill === TRACK)).toBe(true);
    expect(d[0]).toMatchObject({ x: 1 + PITCH / 2, y: PITCH - 1 + PITCH / 2 });
    const b = rec();
    drawDayBarUra(b.ctx, 3, COL, { w: 20 * PITCH, h: 4 * PITCH, offX: 0, offY: 0 });
    expect(dots(b.calls).every((x) => x.fill === COL)).toBe(true);
  });
  it("表: a printed bar on a hairline track, no dots", () => {
    const { ctx, calls } = rec();
    drawDayBarOmote(ctx, 0.5, { w: 60, h: 12 });
    const rects = calls.filter((c) => c.op === "fillRect");
    expect(rects.map((r) => [r.fill, ...r.args])).toEqual([
      ["rgba(15,28,46,.08)", 0, 5.5, 60, 1],    // the hairline through the middle
      ["#5b6573", 0, 3, 30, 6],                 // 2 rows × 3px, centred
    ]);
    expect(calls.some((c) => c.op === "arc")).toBe(false);
  });
  it("表: a zero day draws only the track", () => {
    const { ctx, calls } = rec();
    drawDayBarOmote(ctx, 0, { w: 60, h: 12 });
    expect(calls.filter((c) => c.op === "fillRect")).toHaveLength(1);
  });
});
