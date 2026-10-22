import { describe, expect, it } from "vitest";
import { CAL_HEIGHT, calAt, deriveCalendar, drawCalendarOmote, drawCalendarUra } from "../src/pages/stats/viz/calendar";
import { PITCH } from "../src/led/lattice";
import { perDay, prepare } from "../src/pages/stats/viz/wall";
import { C } from "../src/ui/palette";
import { rec, type Call } from "./canvas-rec";
import { VIZ } from "./viz-fixture";

const calOf = (from = VIZ.range.from, to = VIZ.range.to) => deriveCalendar(perDay(prepare({ ...VIZ, range: { from, to } })));
const DOW = ["一", "二", "三", "四", "五", "六", "日"];
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const dots = (calls: Call[]) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ x: arcs[i].args[0] as number, y: arcs[i].args[1] as number, fill: c.fill }));
};
const cx = (i: number) => i * PITCH + PITCH / 2;

describe("deriveCalendar", () => {
  it("the fixture: one week (W39, cut — only Mon / Tue in range) holding 450 min; Monday ×1.33, Tuesday ×1; both in the 2-day streak", () => {
    const cal = calOf();
    expect(cal.weeks).toEqual([{ mon: "2026-09-21", label: "W39", union: 450, cut: true }]);
    expect(cal.cells.map((c) => [c.day.date, c.wi, c.dow, c.streak])).toEqual([["2026-09-21", 0, 0, true], ["2026-09-22", 0, 1, true]]);
    expect(cal.cells[0].ratio).toBeCloseTo(480 / 360);
    expect(cal.cells[1].ratio).toBe(1);
    expect(cal.maxUnion).toBe(360);
  });

  it("9/16 (Wed) – 9/29 (Tue): W38 and W40 cut, W39 whole; X (Sunday 9/20) joins the streak 9/20–9/22; idle days ratio 1, outside it", () => {
    const cal = calOf("2026-09-16", "2026-09-29");
    expect(cal.weeks.map((w) => [w.label, w.mon, w.union, w.cut])).toEqual([["W38", "2026-09-14", 60, true], ["W39", "2026-09-21", 450, false], ["W40", "2026-09-28", 0, true]]);
    expect(cal.cells).toHaveLength(14);
    expect(cal.cells.filter((c) => c.streak).map((c) => c.day.date)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(cal.cells.find((c) => c.day.date === "2026-09-25")).toMatchObject({ wi: 1, dow: 4, ratio: 1, streak: false });
    expect(cal.streak).toEqual({ len: 3, from: "2026-09-20", to: "2026-09-22" });
  });

  it("only the longest run is marked: an active day before an idle one stays unmarked", () => {
    const day = (date: string, union: number) => ({ date, union, sum: union, peak: union ? 1 : 0, peakAt: null, first: null, last: null, ge: [0, 0, 0, 0, 0, 0, 0], ids: [] });
    const cal = deriveCalendar([day("2026-09-21", 30), day("2026-09-22", 0), day("2026-09-23", 90), day("2026-09-24", 120)]);
    expect(cal.cells.map((c) => c.streak)).toEqual([false, false, true, true]);
    expect(cal.streak).toEqual({ len: 2, from: "2026-09-23", to: "2026-09-24" });
  });

  it("no days: nothing", () => {
    expect(deriveCalendar([])).toEqual({ weeks: [], cells: [], maxUnion: 0, streak: null });
  });
});

describe("drawCalendarUra", () => {
  // 102 dots; one week, capped at 48 dots (44-dot bars); weekday rows of 13 dots under a 14-dot band
  const draw = () => { const r = rec(); const g = drawCalendarUra(r.ctx, calOf(), DOW, { w: 102 * PITCH, h: CAL_HEIGHT, offX: 0, offY: 0 }, "zh", 10, noGlyph); return { ...r, g }; };
  const row = (ds: ReturnType<typeof dots>, j: number) => ds.filter((d) => d.y === cx(j) && d.x >= cx(30) && d.x < cx(30 + 44));

  it("Monday a full bar in the ×1.33 colour, Tuesday a quarter in amber; the days the range does not reach are left blank", () => {
    const ds = dots(draw().calls);
    expect(row(ds, 14).filter((d) => d.fill === "#ffc46a")).toHaveLength(44);
    expect(row(ds, 14 + 13).filter((d) => d.fill === C.AMBER)).toHaveLength(11);
    expect(row(ds, 14 + 13).filter((d) => d.fill.startsWith("rgba"))).toHaveLength(33);
    expect(row(ds, 14 + 2 * 13)).toEqual([]);                                   // Wednesday: outside the range
    expect(ds.filter((d) => d.x === cx(28) && d.fill === "#fff4e2")).toHaveLength(6);  // streak marks, 3 dots per day
  });

  it("geometry: the day under the pointer; a blank day or off the grid is null", () => {
    const { g } = draw(), cal = calOf(), x0 = 30 * PITCH, y0 = 14 * PITCH, cw = 48 * PITCH, rh = 13 * PITCH;   // GL, TOP, the week, RHT
    expect(g).toEqual({ x0, y0, cw, rh, nw: 1 });
    expect(calAt(g, cal, x0 + 10, y0 + rh + 5)?.day.date).toBe("2026-09-22");
    expect(calAt(g, cal, x0 + 10, y0 + 2 * rh + 5)).toBeNull();
    expect(calAt(g, cal, x0 - 10, y0 + 8)).toBeNull();
    expect(calAt(g, cal, x0 + cw + 1, y0 + 8)).toBeNull();
  });
});

describe("drawCalendarOmote", () => {
  it("ink bars darker with parallel ratio, week labels and totals (a cut week in the light ink), streak squares", () => {
    const r = rec();
    const g = drawCalendarOmote(r.ctx, calOf(), DOW, { w: 306, h: CAL_HEIGHT }, () => "11px sans-serif");
    expect(g).toEqual({ x0: 90, y0: 42, cw: 144, rh: 39, nw: 1 });
    const rects = r.calls.filter((c) => c.op === "fillRect");
    expect(rects.find((c) => c.fill === "rgba(15,28,46,0.41)")!.args).toEqual([90, 42, 132, 27]);   // .3 + .32 × .333
    expect(rects.find((c) => c.fill === "rgba(15,28,46,0.30)")!.args).toEqual([90, 81, 33, 27]);
    expect(rects.filter((c) => c.fill === "#0f1c2e")).toHaveLength(2);
    const texts = r.calls.filter((c) => c.op === "fillText");
    expect(texts.find((c) => c.args[0] === "W39 · 9/21")!.fill).toBe("#97a1ae");
    expect(texts.map((c) => c.args[0])).toContain("7.5h");
  });
});
