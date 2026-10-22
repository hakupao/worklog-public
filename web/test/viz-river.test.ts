import { describe, expect, it } from "vitest";
import { peakDay, piecesOn, sessionsOn, stepDay } from "../src/pages/stats/viz/dayview";
import { drawLanesOmote, drawLanesUra, drawRippleUra, drawRiverOmote, drawRiverUra, laneAt, lanesHeight, RIVER_HEIGHT, riverAt, vAt, waveAt } from "../src/pages/stats/viz/river";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { perDay, prepare, segments, type DayAgg } from "../src/pages/stats/viz/wall";
import { C, inkOf, lineColor } from "../src/ui/palette";
import { rec, type Call } from "./canvas-rec";
import { fakeSil } from "./fake-sil";
import { jst, VIZ } from "./viz-fixture";

const prep = prepare(VIZ), segs = segments(prep), days = perDay(prep);
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const dots = (calls: Call[]) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ x: arcs[i].args[0] as number, y: arcs[i].args[1] as number, fill: c.fill, alpha: c.alpha }));
};
const cx = (i: number) => i * PITCH + PITCH / 2;
/** 里 at the dot counts of the 表-sized canvases: 200 dots wide, the same rows high (heights are set in 表 units). */
const W = 200 * PITCH, ura = (h: number) => (h / OMOTE_UNIT) * PITCH;
const day = (date: string, union: number, peak = union ? 1 : 0): DayAgg =>
  ({ date, union, sum: union, peak, peakAt: null, first: null, last: null, ge: [0, union, 0, 0, 0, 0, 0], ids: [] });

describe("the opened day — sessions, pieces, stepping", () => {
  it("sessionsOn 9/21: A B C D E by first instant, clipped to the 5:00 day (E's 04:00–05:00 only)", () => {
    const ss = sessionsOn(prep, "2026-09-21");
    expect(ss.map((o) => [o.s.id, o.wall])).toEqual([["A", 120], ["B", 120], ["C", 60], ["D", 120], ["E", 60]]);
    expect(ss[4]).toMatchObject({ a: jst("2026-09-22T04:00"), b: jst("2026-09-22T05:00") });
    expect(sessionsOn(prep, "2026-09-22").map((o) => [o.s.id, o.wall, o.a])).toEqual([["E", 60, jst("2026-09-22T05:00")], ["F", 30, jst("2026-09-22T13:00")]]);
  });

  it("piecesOn: the sweep's segments cut to the day, with their concurrency", () => {
    expect(piecesOn(segs, "2026-09-21").map((g) => g.c)).toEqual([1, 2, 3, 2, 1, 1, 1]);
    expect(piecesOn(segs, "2026-09-22")).toEqual([
      { a: jst("2026-09-22T05:00"), b: jst("2026-09-22T06:00"), c: 1 },
      { a: jst("2026-09-22T13:00"), b: jst("2026-09-22T13:30"), c: 1 },
    ]);
  });

  it("stepDay skips days without wall clock; null past the ends. peakDay = the first day with the highest concurrency", () => {
    const ds = [day("2026-09-01", 30), day("2026-09-02", 0), day("2026-09-03", 0), day("2026-09-04", 90, 2), day("2026-09-05", 10, 2)];
    expect(stepDay(ds, "2026-09-04", -1)).toBe("2026-09-01");
    expect(stepDay(ds, "2026-09-01", 1)).toBe("2026-09-04");
    expect(stepDay(ds, "2026-09-05", 1)).toBeNull();
    expect(stepDay(ds, "2026-09-01", -1)).toBeNull();
    expect(peakDay(ds)).toBe("2026-09-04");
    expect(peakDay(days)).toBe("2026-09-21");
    expect(peakDay([day("2026-09-01", 0)])).toBeNull();
  });
});

describe("river", () => {
  it("vAt: ≥ k minutes per day, smoothstep in between", () => {
    expect(days.map((d) => d.ge)).toEqual([[0, 360, 90, 30, 0, 0, 0], [0, 90, 0, 0, 0, 0, 0]]);
    expect(vAt(days, 0, 1)).toBe(360);
    expect(vAt(days, 1, 1)).toBe(90);
    expect(vAt(days, 0.5, 1)).toBe(225);
    expect(vAt(days, 0.25, 1)).toBeCloseTo(360 * 0.84375 + 90 * 0.15625);
    expect(vAt(days, -3, 3)).toBe(30);
    expect(vAt(days, 9, 2)).toBe(0);
  });

  // 200 dots, 136 columns from dot 42 (68 a day); centre row 36, 34 rows a side for the fullest day (6h)
  const draw = (sel = 0) => { const r = rec(); const g = drawRiverUra(r.ctx, days, sel, { w: W, h: ura(RIVER_HEIGHT), offX: 0, offY: 0 }, "zh", noGlyph); return { ...r, g }; };

  it("里: mirrored layers about the centre — ×1 amber at .34, ×2 at .7, ×3 #ffc46a — the opened day's columns brighter", () => {
    const { calls, g } = draw(1);
    expect(g).toMatchObject({ x0: 42 * PITCH, x1: (42 + 136) * PITCH, n: 2, cols: 136, yc: 36, sel: 1 });
    const ds = dots(calls), at = (i: number, j: number) => ds.filter((d) => d.x === cx(i) && d.y === cx(j));
    // column 0 (9/21): 6h → 34 rows, ≥2 1.5h → 8.5, ≥3 .5h → 2.83
    expect(at(42, 36)[0]).toMatchObject({ fill: "#ffc46a", alpha: 0.9 });
    expect(at(42, 36 + 3)[0]).toMatchObject({ fill: C.AMBER, alpha: 0.7 });
    expect(at(42, 36 - 3)[0]).toMatchObject({ fill: C.AMBER, alpha: 0.7 });
    expect(at(42, 36 + 20)[0]).toMatchObject({ fill: C.AMBER, alpha: 0.34 });
    expect(at(42, 36 + 34)[0]).toMatchObject({ fill: C.AMBER });
    expect(at(42, 36 - 35)[0].fill).toMatch(/^rgba\(255,236,214,0\.045/);
    // the last column (9/22, opened): 1.5h → 8.5 rows of ×1, lit at .34 × 1.25
    expect(at(42 + 135, 36 + 8)[0]).toMatchObject({ fill: C.AMBER, alpha: 0.34 * 1.25 });
    expect(at(42 + 135, 36 + 9)[0].fill).toBe("rgba(255,236,214,0.14)");
    expect(g.hk[0][1]).toBeCloseTo(34);
  });

  it("hit test: the day under the point", () => {
    const { g } = draw();
    expect(riverAt(g, g.x0 + 10)).toBe(0);
    expect(riverAt(g, g.x0 + 70 * PITCH)).toBe(1);              // past the first day's 68 columns
    expect(riverAt(g, g.x0 - 26)).toBeNull();
    expect(riverAt(g, g.x1 + 6)).toBeNull();
  });

  it("the ripple overlay clears its own canvas and draws only layers ≥ 2 in its band", () => {
    const { g } = draw(-1), r = rec();
    drawRippleUra(r.ctx, g, 10, W, ura(RIVER_HEIGHT));
    expect(r.calls[0]).toMatchObject({ op: "clearRect", args: [0, 0, W, ura(RIVER_HEIGHT)] });
    const ds = dots(r.calls);
    const cols = new Set(ds.map((d) => (d.x - PITCH / 2) / PITCH - 42));
    expect(Math.min(...cols)).toBe(0);
    expect(Math.max(...cols)).toBe(28);                       // wave 10 ± 18
    expect(ds.every((d) => d.fill === C.AMBER || d.fill === "#ffc46a")).toBe(true);
    // at the crest (column 10, wv 1) a ×2 dot gets .35 of its .7
    expect(ds.find((d) => d.x === cx(52) && d.y === cx(36 + 3))!.alpha).toBeCloseTo(0.7 * 0.35);
    // far from the river: nothing
    const r2 = rec(); drawRippleUra(r2.ctx, g, -40, W, ura(RIVER_HEIGHT));
    expect(dots(r2.calls)).toEqual([]);
    expect(waveAt(136, 0)).toBe(-60);
    expect(waveAt(136, 55 * 70)).toBe(10);
    expect(waveAt(136, 55 * 256)).toBe(-60);
  });

  it("表: six ink layers (darker inward), the opened day in teal", () => {
    const r = rec();
    const g = drawRiverOmote(r.ctx, days, 0, { w: 600, h: RIVER_HEIGHT }, () => "11px sans-serif");
    expect(g).toMatchObject({ x0: 126, x1: 534, n: 2 });
    expect(r.calls.filter((c) => c.op === "fill").map((c) => c.fill)).toEqual([0.14, 0.3, 0.5, 0.7, 0.85, 1].map((a) => `rgba(15,28,46,${a})`));
    expect(r.calls.find((c) => c.op === "fillRect" && c.fill === "rgba(14,124,134,.7)")!.args[0]).toBe(126 + 0.25 * 408);
  });
});

describe("swim lanes", () => {
  const d21 = days[0], ss = sessionsOn(prep, d21.date), pieces = piecesOn(segs, d21.date);
  const draw = (hover: string | null = null) => {
    const r = rec(); const g = drawLanesUra(r.ctx, d21, pieces, ss, hover, { w: W, h: ura(lanesHeight(ss.length)), offX: 0, offY: 0 }, "zh", noGlyph); return { ...r, g };
  };

  it("one lane per session (9 rows each from row 22), intervals lit in the task's line colour; the unlinked grey", () => {
    const { calls, g } = draw();
    expect(g).toEqual({ y0: 22 * PITCH, lh: 9 * PITCH, n: 5 });
    expect(lanesHeight(5)).toBe((22 + 45 + 12) * 3);
    const ds = dots(calls);
    // 136 columns over 24h: A 09:00–11:00 = columns 22.67–34
    const laneA = ds.filter((d) => d.y === cx(22 + 4) && d.fill === lineColor("T1"));
    expect(laneA.length).toBeGreaterThan(5);
    expect(ds.filter((d) => d.y === cx(22 + 3 * 9 + 4) && d.fill === "#9aa0a8").length).toBeGreaterThan(3);  // D, unlinked
  });

  it("hover: every other task's lanes drop to .3", () => {
    const ds = dots(draw("T1").calls);
    expect(ds.find((d) => d.y === cx(22 + 4) && d.fill === lineColor("T1"))!.alpha).toBeCloseTo(0.92);
    expect(ds.find((d) => d.y === cx(22 + 9 + 4) && d.fill === lineColor("T2"))!.alpha).toBeCloseTo(0.92 * 0.3);
    expect(ds.find((d) => d.y === cx(22 + 27 + 4) && d.fill === "#9aa0a8")!.alpha).toBeCloseTo(0.92 * 0.3);
  });

  it("laneAt; 表 lanes in the deepened line colour, the hovered task's others at .3", () => {
    const { g } = draw();
    expect(laneAt(g, g.y0 + g.lh * 2 + 3)).toBe(2);
    expect(laneAt(g, g.y0 - 6)).toBeNull();
    expect(laneAt(g, g.y0 + g.lh * 5)).toBeNull();
    const r = rec();
    drawLanesOmote(r.ctx, d21, pieces, ss, "T2", { w: 600, h: lanesHeight(5) }, () => "11px sans-serif");
    const bars = r.calls.filter((c) => c.op === "fillRect" && c.fill.startsWith("#") && c.fill !== "#0f1c2e");
    expect(bars.find((c) => c.fill === inkOf(lineColor("T1")))!.alpha).toBe(0.3);
    expect(bars.find((c) => c.fill === inkOf(lineColor("T2")))!.alpha).toBe(1);
  });
});


describe("B3b archetype B — lane label silhouettes", () => {
  const d21 = days[0], ss = sessionsOn(prep, d21.date), pieces = piecesOn(segs, d21.date);
  const geo = { w: W, h: ura(lanesHeight(ss.length)), offX: 0, offY: 0 };   // 里 only
  const texts = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
  const wide = () => ({ w: 5, h: 8, on: new Uint8Array(40).fill(1) });
  it("表: 18 px silhouettes replace the lane codes at (x0 - 6 - 18, y + 4.5); an unlinked lane keeps `--`", () => {
    const r = rec();
    drawLanesOmote(r.ctx, d21, pieces, ss, null, { w: 600, h: lanesHeight(5) }, () => "11px sans-serif", fakeSil());
    const t = texts(r);
    expect(t).not.toContain("T1");
    expect(t).toContain("--");
    expect(t.filter((x) => x === "--")).toHaveLength(ss.filter((o) => !o.s.task_id).length);
    const fills = r.calls.filter((c) => c.op === "fill" && (c.args[0] as { d?: string })?.d);
    expect(fills).toHaveLength(ss.filter((o) => o.s.task_id).length);
    expect(fills[0].fill).toBe(inkOf("#3366ff"));
    expect(r.calls.filter((c) => c.op === "translate")[0].args).toEqual([42 * 3 - 6 - 18, 66 + 4.5]);
    // the minutes text after a silhouette is back in the muted ink, not the badge colour
    const mins = r.calls.find((c) => c.op === "fillText" && c.args[0] === String(Math.round(ss[0].wall)))!;
    expect(mins.fill).not.toBe(inkOf("#3366ff"));
    const today = rec(), nul = rec();
    drawLanesOmote(today.ctx, d21, pieces, ss, null, { w: 600, h: lanesHeight(5) }, () => "11px sans-serif");
    drawLanesOmote(nul.ctx, d21, pieces, ss, null, { w: 600, h: lanesHeight(5) }, () => "11px sans-serif", null);
    expect(nul.calls).toEqual(today.calls);
    expect(texts(today)).toContain("T1");
  });
  it("里: 8 dots right-aligned in the label column; an unlinked lane keeps its code; dots() null → the code", () => {
    const a = rec(), base = rec(), b = rec();
    drawLanesUra(a.ctx, d21, pieces, ss, null, geo, "zh", wide, fakeSil());
    drawLanesUra(base.ctx, d21, pieces, ss, null, geo, "zh", wide);
    drawLanesUra(b.ctx, d21, pieces, ss, null, geo, "zh", wide, fakeSil(null));
    expect(b.calls).toEqual(base.calls);
    const colDots = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "arc" && Number(c.args[0]) < 42 * PITCH && Number(c.args[1]) >= 22 * PITCH);
    const linked = ss.filter((o) => o.s.task_id).length, unlinked = ss.length - linked;
    expect(colDots(base)).toHaveLength(40 * ss.length);
    // BOX.slice(0, 64): 7 full rows of 7 lit cells = 49
    expect(colDots(a)).toHaveLength(49 * linked + 40 * unlinked);
    const xs = colDots(a).map((c) => Number(c.args[0]));
    expect(Math.max(...xs)).toBeCloseTo((42 - 3 - 1) * PITCH + PITCH / 2);                       // right edge = GL - 3 - 1
  });
});
