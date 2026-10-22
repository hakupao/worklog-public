import { describe, expect, it } from "vitest";
import { PITCH } from "../src/led/lattice";
import { dailyAt, drawDailyOmote, drawDailyUra } from "../src/pages/stats/daily";
import { C } from "../src/ui/palette";
import { rec, type Call } from "./canvas-rec";

const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const one = () => ({ w: 1, h: 1, on: new Uint8Array([1]) });
// jsdom has no sprites, so a lit LED is a flat disc in its colour (chart/canvas.ts lit())
const lits = (calls: Call[], col: string) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ c, a: arcs[i] })).filter(({ c }) => c.fill === col)
    .map(({ c, a }) => ({ x: a.args[0] as number, y: a.args[1] as number, alpha: c.alpha }));
};
// Mon 2026-09-28 … Sun 10-04; Sat 10-03 is a weekend day
const DAYS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]
  .map((date, i) => ({ date, minutes: [480, 1440, 0, 2880, 60, 600, 0][i] }));

describe("统计 daily bars (里)", () => {
  const W = 100 * PITCH, H = 46 * PITCH, cy = (j: number) => j * PITCH + PITCH / 2, ix = (x: number) => (x - PITCH / 2) / PITCH;
  // 100×46 dots (W × H); 10 label rows + 1 gap leave 35 bar rows; 16 dots kept on the right for 8h / 24h;
  // (100 − 16) / 7 → 12 dots a day, bars 11 wide; the scale is the busiest day (2880), never under 24h
  const draw = (bitsFn = noGlyph) => { const r = rec(); const g = drawDailyUra(r.ctx, DAYS, { w: W, h: H, offX: 0, offY: 0 }, "zh", bitsFn); return { ...r, g }; };
  const col = <T extends { x: number }>(pts: T[], i: number): T[] => pts.filter((p) => p.x >= i * 12 * PITCH && p.x < (i * 12 + 11) * PITCH);

  it("each day fills from the bottom by its share of the busiest day; a day with no time lights nothing", () => {
    const { calls } = draw();
    const amber = lits(calls, C.AMBER);
    // 480/2880 × 35 → 6 rows, 1440 → 18 (rounded), 2880 → 35, 60 → 1, 600 → 7 (weekend)
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => col(amber, i).length)).toEqual([66, 198, 0, 385, 11, 77, 0]);
    // from the bottom: every bar's lowest dot is on the same row
    expect(new Set([0, 1, 3, 4, 5].map((i) => Math.max(...col(amber, i).map((p) => p.y)))).size).toBe(1);
    for (const p of amber) { expect((p.x - PITCH / 2) % PITCH).toBe(0); expect((p.y - PITCH / 2) % PITCH).toBe(0); }
  });

  it("weekend days are one tier down (half alpha); weekdays are full", () => {
    const amber = lits(draw().calls, C.AMBER);
    expect(new Set(col(amber, 5).map((p) => p.alpha))).toEqual(new Set([0.5]));
    expect(new Set(col(amber, 3).map((p) => p.alpha))).toEqual(new Set([1]));
  });

  it("8h and 24h are dotted rows (every second dot) across the bars, 24h brighter", () => {
    const ref = lits(draw().calls, "#ffe2b8");
    // rows: 35 − round(480/2880 × 35) = 29; 35 − round(1440/2880 × 35) = 17
    const at = (y: number) => ref.filter((p) => p.y === y);
    expect(at(cy(29))).toHaveLength(42);
    expect(at(cy(17))).toHaveLength(42);
    expect(at(cy(29)).every((p) => p.alpha === 0.22)).toBe(true);
    expect(at(cy(17)).every((p) => p.alpha === 0.55)).toBe(true);
    expect(ref).toHaveLength(84);
    expect(at(cy(17)).map((p) => ix(p.x))).toEqual(Array.from({ length: 42 }, (_, i) => i * 2));
  });

  it("labels are dot glyphs: 8h, 24h, and the first and last dates (Mondays only when they fit)", () => {
    const glyphs = lits(draw(one).calls, C.AMBER).length - lits(draw().calls, C.AMBER).length;
    expect(glyphs).toBe(4);
  });

  it("returns where the days are, for the hover tip", () => {
    const { g } = draw();
    expect(g).toEqual({ x0: 0, pitch: 12 * PITCH, span: 12 * PITCH, n: 7 });   // 12 dots a day
    expect([dailyAt(g, 0), dailyAt(g, 12 * PITCH + 1), dailyAt(g, 84 * PITCH - 1), dailyAt(g, 84 * PITCH), dailyAt(g, -1)]).toEqual([0, 1, 6, null, null]);
  });

  it("days that don't divide the width still span it (a 3-month range): columns at fractional steps", () => {
    const r = rec();
    const ten = Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(21 + i).padStart(2, "0")}`, minutes: 1440 }));
    const g = drawDailyUra(r.ctx, ten, { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    // 84 dots / 10 days = 8.4: day k starts at floor(8.4k), bars 7 wide; the last starts at 75 and ends on dot 81
    expect(g.pitch).toBeCloseTo(8.4 * PITCH);
    const xs = lits(r.calls, C.AMBER).map((p) => ix(p.x));
    expect(Math.max(...xs)).toBe(81);
    expect(new Set(xs).size).toBe(70);
    // the reference rows run the whole 84 dots
    expect(lits(r.calls, "#ffe2b8").filter((p) => p.y === cy(0))).toHaveLength(42);
  });

  it("a single day (今天) is a bar no wider than a week's, not one slab across the chart", () => {
    const r = rec();
    drawDailyUra(r.ctx, [{ date: "2026-09-29", minutes: 2880 }], { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    const xs = new Set(lits(r.calls, C.AMBER).map((p) => p.x));
    // (100 − 16) / 7 → 12 dots a week-day, so 11 columns (as each bar above), not 83
    expect(xs.size).toBe(11);
  });

  it("a single day's hover covers its bar's slot (12 dots), not the whole chart", () => {
    const g = drawDailyUra(rec().ctx, [{ date: "2026-09-29", minutes: 2880 }], { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    expect([dailyAt(g, 0), dailyAt(g, 12 * PITCH - 1), dailyAt(g, 12 * PITCH), dailyAt(g, 66 * PITCH)]).toEqual([0, 0, null, null]);
  });

  it("90 days on a canvas too narrow for them and the 8h / 24h labels: the labels go, the bars stay inside the canvas", () => {
    const r = rec();
    const days = Array.from({ length: 90 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10), minutes: 1440 }));
    // 100 dots: 90 days + 16 label dots don't fit, so the days take the whole 100
    drawDailyUra(r.ctx, days, { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    const amber = lits(r.calls, C.AMBER).map((p) => ix(p.x));
    expect(Math.max(...amber)).toBeLessThan(100);
    expect(new Set(amber).size).toBe(90);
    const ref = lits(r.calls, "#ffe2b8").map((p) => ix(p.x));
    expect(Math.max(...ref)).toBeLessThan(100);
    // with glyphs that light one dot, every added dot is a date label (row 35 + 2): no 8h / 24h labels
    const g1 = rec(), g0 = rec();
    drawDailyUra(g1.ctx, days, { w: W, h: H, offX: 0, offY: 0 }, "zh", one);
    drawDailyUra(g0.ctx, days, { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    const off = (calls: Call[]) => lits(calls, C.AMBER).filter((p) => p.y !== cy(37)).length;
    expect(off(g1.calls) - off(g0.calls)).toBe(0);
    expect(lits(g1.calls, C.AMBER).length).toBeGreaterThan(lits(g0.calls, C.AMBER).length);
  });

  it("the scale never drops under 24h, so both lines stay in frame on a light range", () => {
    const r = rec();
    drawDailyUra(r.ctx, [{ date: "2026-09-28", minutes: 60 }], { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    const ys = new Set(lits(r.calls, "#ffe2b8").map((p) => p.y));
    // 24h on the top row (35 − 35 = 0), 8h at 35 − round(35/3) = 23
    expect(ys).toEqual(new Set([cy(0), cy(23)]));
  });
});

describe("统计 daily bars (表)", () => {
  // 300×138: 28px kept on the right, (300 − 28) / 7 a day; bars from y 120 up over 114px
  const draw = () => { const r = rec(); const g = drawDailyOmote(r.ctx, DAYS, { w: 300, h: 138 }, (wt) => `${wt} 11px x`); return { ...r, g }; };

  it("solid bars in ink, weekends grey; no bar for a day with no time; no lattice dots", () => {
    const { calls } = draw();
    const bars = calls.filter((c) => c.op === "fillRect" && (c.fill === "#0f1c2e" || c.fill === "#8a94a3"));
    // heights: 480 → 19, 1440 → 57, 2880 → 114, 60 → 2 (at least 2px), 600 → 24
    expect(bars.map((b) => [b.fill, b.args[3]])).toEqual([["#0f1c2e", 19], ["#0f1c2e", 57], ["#0f1c2e", 114], ["#0f1c2e", 2], ["#8a94a3", 24]]);
    expect(bars.every((b) => (b.args[1] as number) + (b.args[3] as number) === 120)).toBe(true);
    expect(calls.some((c) => c.op === "arc")).toBe(false);
  });

  it("8h a hairline, 24h a darker line, each labelled on the right; dates under the bars", () => {
    const { calls } = draw();
    const line = (fill: string) => calls.filter((c) => c.op === "fillRect" && c.fill === fill).map((c) => c.args);
    expect(line("rgba(15,28,46,.35)")).toEqual([[0, 63, 272, 1]]);
    expect(line("rgba(15,28,46,.12)")).toContainEqual([0, 101, 272, 1]);
    const text = calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
    expect(text).toEqual(expect.arrayContaining(["8h", "24h", "9/28", "10/4"]));
  });

  it("a single day (今天) is a bar no wider than a week's", () => {
    const r = rec();
    drawDailyOmote(r.ctx, [{ date: "2026-09-29", minutes: 600 }], { w: 300, h: 138 }, (wt) => `${wt} 11px x`);
    const bars = r.calls.filter((c) => c.op === "fillRect" && c.fill === "#0f1c2e");
    // round(272 / 7) − 2 = 37px, the same as a day of the week above, not 270
    expect(bars.map((b) => b.args[2])).toEqual([37]);
  });

  it("a single day's hover covers its bar's slot (272 / 7 px), not the whole chart", () => {
    const g = drawDailyOmote(rec().ctx, [{ date: "2026-09-29", minutes: 600 }], { w: 300, h: 138 }, (wt) => `${wt} 11px x`);
    expect([dailyAt(g, 0), dailyAt(g, 38), dailyAt(g, 39), dailyAt(g, 200)]).toEqual([0, 0, null, null]);
  });

  it("returns where the days are", () => {
    const { g } = draw();
    expect(g.x0).toBe(0);
    expect(g.pitch).toBeCloseTo(272 / 7);
    expect([dailyAt(g, 39), dailyAt(g, 271), dailyAt(g, 273)]).toEqual([1, 6, null]);
  });
});
