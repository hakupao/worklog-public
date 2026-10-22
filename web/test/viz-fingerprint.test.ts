import { describe, expect, it } from "vitest";
import { angOf, deriveFingerprint, drawFpOmote, drawFpUra, drawHoursOmote, FP_HEIGHT, fpAt } from "../src/pages/stats/viz/fingerprint";
import { perDay, prepare, segments } from "../src/pages/stats/viz/wall";
import { rec } from "./canvas-rec";
import { VIZ } from "./viz-fixture";

const fpOf = (from = VIZ.range.from, to = VIZ.range.to) => {
  const p = prepare({ ...VIZ, range: { from, to } });
  return deriveFingerprint(segments(p), perDay(p));
};
const font = () => "600 11px sans";
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });

describe("deriveFingerprint (lab s5)", () => {
  it("weekday of the 5:00 day × JST clock hour: D (9/22 00:00–01:30) and E's 04:00–05:00 stay on Monday's ring", () => {
    const fp = fpOf();
    const row = (w: number) => Object.fromEntries(fp.hm[w].flatMap((m, h) => (m ? [[h, m]] : [])));
    expect(row(0)).toEqual({ 0: 60, 1: 30, 4: 60, 9: 60, 10: 60, 11: 60, 23: 30 });
    expect(row(1)).toEqual({ 5: 60, 13: 30 });
    for (let w = 2; w < 7; w++) expect(row(w)).toEqual({});
  });

  it("the average divides by that weekday's days in the range, idle ones included; the peak cell; hour totals and the busiest hour", () => {
    // 9/14 (Mon) – 9/27 (Sun): two of each weekday; X (Sunday 9/20 20:00–21:00) joins
    const fp = fpOf("2026-09-14", "2026-09-27");
    expect(fp.wd.n).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(fp.av[0][9]).toBe(30);
    expect(fp.av[6][20]).toBe(30);
    expect(fp.av[2][9]).toBe(0);
    expect(fp.max).toBe(30);
    expect(fp.best).toEqual({ w: 0, h: 0 });                    // first highest, Monday from 0:00
    expect(fp.hours[9]).toBe(60);
    expect(fp.hours[20]).toBe(60);
    expect(fp.hours.reduce((a, b) => a + b, 0)).toBe(510);
    expect(fp.bestH).toBe(0);
    expect(fp.wd.avg[0]).toBe(180);
  });

  it("nothing in range: zeros, no peak", () => {
    const fp = fpOf("2026-10-05", "2026-10-11");
    expect(fp.max).toBe(0);
    expect(fp.best).toBeNull();
    expect(fp.bestH).toBe(-1);
  });
});

describe("drawFingerprint", () => {
  it("表: one sector per weekday × hour (168), ink by the average against the peak; the busiest hour in the centre", () => {
    const fp = fpOf(), r = rec();
    drawFpOmote(r.ctx, fp, { w: 600, h: FP_HEIGHT }, font);
    const fills = r.calls.filter((c) => c.op === "fill");
    expect(fills).toHaveLength(168);
    expect(fills[0].fill).toBe("rgba(15,28,46,0.960)");          // Monday 0:00 = the peak
    expect(fills[2].fill).toBe("rgba(15,28,46,0.030)");          // Monday 2:00, idle
    expect(r.calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toContain("00:00");
  });

  it("fpAt: Monday is the innermost ring, 0:00 just right of the top gap, clockwise; the gap and the centre are nothing", () => {
    const fp = fpOf(), r = rec();
    const g = drawFpOmote(r.ctx, fp, { w: 600, h: FP_HEIGHT }, font);
    const at = (w: number, h: number) => {
      const a = angOf(h + 0.5), rr = g.R0 + (w + 0.5) * g.wr;
      return fpAt(g, g.cx + Math.sin(a) * rr, g.cy - Math.cos(a) * rr);
    };
    expect(at(0, 9)).toEqual({ w: 0, h: 9 });
    expect(at(6, 20)).toEqual({ w: 6, h: 20 });
    expect(at(3, 0)).toEqual({ w: 3, h: 0 });
    expect(fpAt(g, g.cx, g.cy - g.R0 - g.wr / 2)).toBeNull();     // straight up: the gap
    expect(fpAt(g, g.cx, g.cy)).toBeNull();
    expect(angOf(0)).toBeCloseTo(0.13);
    expect(angOf(24)).toBeCloseTo(2 * Math.PI - 0.13);
  });

  it("里: lit dots only where a weekday-hour has wall clock; the hour bars light the busiest hour warm", () => {
    const fp = fpOf(), r = rec();
    drawFpUra(r.ctx, fp, { w: 600, h: FP_HEIGHT, offX: 0, offY: 0 }, "zh", noGlyph);
    const lit = r.calls.filter((c) => c.op === "fill" && c.fill.startsWith("#"));
    expect(lit.length).toBeGreaterThan(0);
    const h = rec();
    drawHoursOmote(h.ctx, fp.hours, fp.bestH, { w: 240, h: 54 }, font);
    const bars = h.calls.filter((c) => c.op === "fillRect");
    expect(bars).toHaveLength(24);
    expect(bars[0].fill).toBe("#0b1626");
    expect(bars[1].fill).toBe("rgba(15,28,46,.55)");
  });
});
