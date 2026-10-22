import { describe, expect, it } from "vitest";
import { binRow, cAt, deriveWaterfall, drawWaterfallOmote, drawWaterfallUra, waterAt, waterHeight } from "../src/pages/stats/viz/waterfall";
import { perDay, prepare, segments } from "../src/pages/stats/viz/wall";
import { PITCH } from "../src/led/lattice";
import { C } from "../src/ui/palette";
import { rec, type Call } from "./canvas-rec";
import { jst, VIZ } from "./viz-fixture";

const prep = prepare(VIZ);
const wf = deriveWaterfall(segments(prep), perDay(prep));
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
/** Lit / off dots as {x, y, fill, alpha} (no sprites in jsdom: each dot is an arc + fill). */
const dots = (calls: Call[]) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ x: arcs[i].args[0] as number, y: arcs[i].args[1] as number, fill: c.fill, alpha: c.alpha }));
};
const cx = (i: number) => i * PITCH + PITCH / 2;

describe("deriveWaterfall — the shared fixture", () => {
  it("one row per 5:00 day; the sweep's segments cut at 05:00 with their concurrency (E's 04:00–06:00 splits across the two days)", () => {
    expect(wf.rows.map((r) => [r.day.date, r.dow])).toEqual([["2026-09-21", 0], ["2026-09-22", 1]]);
    expect(wf.rows[0].pieces.map((g) => g.c)).toEqual([1, 2, 3, 2, 1, 1, 1]);
    expect(wf.rows[0].pieces[6]).toEqual({ a: jst("2026-09-22T04:00"), b: jst("2026-09-22T05:00"), c: 1 });
    expect(wf.rows[1].pieces).toEqual([
      { a: jst("2026-09-22T05:00"), b: jst("2026-09-22T06:00"), c: 1 },
      { a: jst("2026-09-22T13:00"), b: jst("2026-09-22T13:30"), c: 1 },
    ]);
    expect(wf.maxSum).toBe(480);
    expect([wf.start, wf.end]).toEqual([2, 16.25]);
  });

  it("binRow: hourly bins from 05:00 — share covered and Σ share × concurrency", () => {
    const { cov, dep } = binRow(wf.rows[0], 24);
    expect(cov.map((v, b) => (v ? b : -1)).filter((b) => b >= 0)).toEqual([4, 5, 6, 18, 19, 20, 23]);
    expect([cov[4], dep[4]]).toEqual([1, 1]);          // 09–10 A
    expect([cov[5], dep[5]]).toEqual([1, 2.5]);        // 10–10:30 ×2, 10:30–11 ×3
    expect([cov[6], dep[6]]).toEqual([1, 1.5]);        // 11–11:30 ×2, 11:30–12 ×1
    expect([cov[18], cov[19], cov[20], cov[23]]).toEqual([0.5, 1, 0.5, 1]);  // D 23:30–01:30, E 04–05
    const half = binRow(wf.rows[0], 48);
    expect([half.dep[10], half.dep[11]]).toEqual([2, 3]);
  });

  it("cAt: sessions open at an instant", () => {
    expect(cAt(wf.rows[0], jst("2026-09-21T10:45"))).toBe(3);
    expect(cAt(wf.rows[0], jst("2026-09-21T11:30"))).toBe(1);
    expect(cAt(wf.rows[0], jst("2026-09-21T13:00"))).toBe(0);
  });

  it("an empty range: idle rows, no scale, no medians", () => {
    const e = prepare({ ...VIZ, sessions: [] }), w = deriveWaterfall(segments(e), perDay(e));
    expect(w.rows.map((r) => r.pieces.length)).toEqual([0, 0]);
    expect([w.maxSum, w.start, w.end]).toEqual([0, null, null]);
  });
});

describe("drawWaterfallUra", () => {
  // 102 dots: 30 date gutter + 24 one-hour bins + 48 bar gutter; rows of 3 dots under a 13-dot band
  const draw = () => { const r = rec(); const g = drawWaterfallUra(r.ctx, wf, { w: 102 * PITCH, h: waterHeight(2), offX: 0, offY: 0 }, "zh", noGlyph); return { ...r, g }; };
  const at = (ds: ReturnType<typeof dots>, i: number, j: number) => ds.filter((d) => d.x === cx(i) && d.y === cx(j));

  it("a bin's colour follows its average concurrency; empty bins are dim dots; two lit dot rows per day", () => {
    const ds = dots(draw().calls);
    expect(at(ds, 30 + 4, 13).map((d) => d.fill)).toEqual([C.AMBER]);         // 09–10 ×1
    expect(at(ds, 30 + 5, 13).map((d) => d.fill)).toEqual(["#ffc46a"]);       // 10–11 ×2.5
    expect(at(ds, 30 + 5, 14).map((d) => d.fill)).toEqual(["#ffc46a"]);
    expect(at(ds, 30 + 5, 15)).toEqual([]);                                     // the third row of a day is the gap
    expect(at(ds, 30 + 0, 13)[0].fill).toMatch(/^rgba\(255,236,214,/);
    expect(at(ds, 30 + 18, 13)[0].alpha).toBeCloseTo(0.62 * (0.35 + 0.65 * 0.5));  // half-covered 23:00 bin
  });

  it("right gutter: wall clock lit over summed dim, against the fullest day (480): 9/21 → 32 of 42 lit, 42 summed", () => {
    const ds = dots(draw().calls).filter((d) => d.y === cx(13) && d.x >= cx(102 - 48 + 4));
    expect(ds.filter((d) => d.fill === C.AMBER)).toHaveLength(32);
    expect(ds.filter((d) => d.fill === C.WARM)).toHaveLength(10);
  });

  it("geometry: rows and hours under the pointer", () => {
    const { g } = draw(), x0 = 30 * PITCH, x1 = 54 * PITCH, y0 = 13 * PITCH, rh = 3 * PITCH;   // GL, GL + 24 bins, GT, RH
    expect(g).toEqual({ x0, x1, y0, rh, n: 2 });
    expect(waterAt(g, x0 + 5.5 * PITCH, y0 + 2)).toEqual({ row: 0, h: 5.5 });   // one bin = one dot = one hour
    expect(waterAt(g, x1 + 38, y0 + rh + 1)).toEqual({ row: 1, h: null });
    expect(waterAt(g, x0 + 10, y0 - 9)).toBeNull();
    expect(waterAt(g, x0 + 10, y0 + 2 * rh)).toBeNull();
  });
});

describe("drawWaterfallOmote", () => {
  const draw = () => { const r = rec(); const g = drawWaterfallOmote(r.ctx, wf, { w: 306, h: waterHeight(2) }, () => "11px sans-serif"); return { ...r, g }; };

  it("one ink rectangle per stretch, darker with more sessions open; the bars and the median lines", () => {
    const { calls, g } = draw();
    expect(g).toEqual({ x0: 90, x1: 162, y0: 39, rh: 9, n: 2 });
    const rects = calls.filter((c) => c.op === "fillRect");
    // 10:30–11:00 ×3: x = 90 + 5.5 × 3, 1.5px wide
    expect(rects.find((c) => c.fill === "rgba(15,28,46,0.82)")!.args).toEqual([106.5, 39.5, 1.5, 7.5]);
    expect(rects.filter((c) => c.fill.startsWith("rgba(15,28,46,0.")).length).toBe(9);
    // bars from x1 + 10, 130px for the fullest day: 9/21 summed 130, wall 97.5
    expect(rects.filter((c) => c.args[0] === 172).map((c) => c.args[2])).toEqual([130, 97.5, 90 * 130 / 480, 90 * 130 / 480]);
    expect(rects.some((c) => c.fill === "rgba(14,124,134,.55)" && c.args[0] === Math.round(90 + 2 * 3))).toBe(true);
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toContain("9/22");
  });
});
