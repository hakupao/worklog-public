import { describe, expect, it, vi } from "vitest";
import { deriveHours24, hours24Option } from "../src/pages/stats/viz/hours24";
import { deriveWeekday, weekdayOption } from "../src/pages/stats/viz/weekday";
import { PITCH } from "../src/led/lattice";
import { busiest, dots, fillOf, glow, themeOf, tipHtml } from "../src/pages/stats/viz/echarts-theme";
import { tv, VSTRINGS } from "../src/pages/stats/viz/strings";
import { perDay, prepare, segments } from "../src/pages/stats/viz/wall";
import { VIZ } from "./viz-fixture";

const prep = prepare(VIZ);
/** The fixture's sessions over a whole week (9/21 Mon – 9/27 Sun): Mon 360, Tue 90, the rest idle. */
const WEEK = perDay(prepare({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-27" } }));
type Ser = { type: string; data: { value: number; itemStyle: { color: unknown; opacity?: number; shadowBlur?: number } }[] | number[]; silent?: boolean; symbolClip?: boolean; symbol?: string };
const series = (o: Record<string, unknown>) => o.series as Ser[];

describe("viz/strings — the views' own text (lazy chunk)", () => {
  it("every key has a non-empty zh, ja and en", () => {
    const missing = Object.entries(VSTRINGS).flatMap(([k, v]) =>
      (["zh", "ja", "en"] as const).filter((l) => !(v as Record<string, string>)[l]?.trim()).map((l) => `${k}.${l}`));
    expect(missing).toEqual([]);
  });
  it("tv picks the language and fills variables", () => {
    expect(tv("zh", "hours24.meta", { h: "10:00" })).toBe("最忙 10:00");
    expect(tv("en", "weekday.perDay", { v: "6h" })).toBe("6h / day");
  });
});

describe("hours24 — wall clock per JST clock hour (from segments, split at clock hours)", () => {
  it("fixture: 09/10/11/00/04/05 an hour each, 12 none (B ends 12:00), 13/23/01 half; sums to the window's union 450", () => {
    const h = deriveHours24(segments(prep));
    expect(h).toEqual([60, 30, 0, 0, 60, 60, 0, 0, 0, 60, 60, 60, 0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30]);
    expect(h.reduce((a, b) => a + b, 0)).toBe(450);
  });
  it("concurrency does not add up: three open sessions at 10:30–11:00 still give 10:00 one hour", () => {
    expect(deriveHours24(segments(prep))[10]).toBe(60);
  });
  it("an empty range: all zeros; busiest = -1", () => {
    const h = deriveHours24([]);
    expect(h).toEqual(new Array(24).fill(0));
    expect(busiest(h)).toBe(-1);
  });
  it("busiest: the first of the largest (a tie goes to the earlier hour), skipping nulls", () => {
    expect(busiest(deriveHours24(segments(prep)))).toBe(0);
    expect(busiest([null, 2, 5, 5, null])).toBe(2);
  });
  it("option: polar bar, 24 categories from 0 at the top; the busiest hour lit (#fff6e8 + glow in 里); values in hours", () => {
    const h = deriveHours24(segments(prep));
    const o = hours24Option("ura", h, "zh");
    expect((o.angleAxis as { data: string[]; startAngle: number }).data).toHaveLength(24);
    expect((o.angleAxis as { startAngle: number }).startAngle).toBe(90);
    const [s] = series(o);
    expect(s.type).toBe("bar");
    const d = s.data as { value: number; itemStyle: { color: unknown; shadowBlur?: number } }[];
    expect(d.map((x) => x.value)).toEqual(h.map((m) => Math.round(m / 6) / 10));
    expect(d[0].itemStyle.shadowBlur).toBe(18);
    expect(d[9].itemStyle.shadowBlur).toBeUndefined();
    // jsdom has no 2D context: the dot pattern falls back to the plain colour
    expect(d[0].itemStyle.color).toBe("rgba(255,246,232,1)");
  });
  it("option in 表: ink on paper, no glow", () => {
    const d = series(hours24Option("omote", deriveHours24(segments(prep)), "zh"))[0].data as { itemStyle: { color: unknown; shadowBlur?: number } }[];
    expect(d[0].itemStyle).toEqual({ color: "#0b1626" });
    expect(d[9].itemStyle).toEqual({ color: "#0f1c2e" });
  });
});

describe("weekday — average wall clock per weekday (÷ that weekday's 5:00 days in the range, idle days included)", () => {
  it("fixture over a week: Mon 360, Tue 90, the idle days 0; one day of each", () => {
    const w = deriveWeekday(WEEK);
    expect(w.avg).toEqual([360, 90, 0, 0, 0, 0, 0]);
    expect(w.n).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
  it("two weeks of days: the denominator counts idle days (Mon 360 over two Mondays = 180)", () => {
    const w = deriveWeekday(perDay(prepare({ ...VIZ, range: { from: "2026-09-21", to: "2026-10-04" } })));
    expect(w.avg).toEqual([180, 45, 0, 0, 0, 0, 0]);
    expect(w.n).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });
  it("a weekday absent from the range: null, not 0 / 0", () => {
    const w = deriveWeekday(perDay(prep));
    expect(w.avg).toEqual([360, 90, null, null, null, null, null]);
    expect(w.n).toEqual([1, 1, 0, 0, 0, 0, 0]);
  });
  it("option: a silent dim track under the clipped value bars; weekends at .6; the busiest weekday lit; 里 circles / 表 rects", () => {
    const names = ["一", "二", "三", "四", "五", "六", "日"], w = deriveWeekday(WEEK);
    const o = weekdayOption("ura", w, names, "zh");
    expect((o.yAxis as { data: string[] }).data).toEqual(names);
    const [track, val] = series(o);
    expect([track.type, track.silent, val.type, val.symbolClip, val.symbol]).toEqual(["pictorialBar", true, "pictorialBar", true, "circle"]);
    const d = val.data as { value: number; itemStyle: { color: unknown; opacity?: number } }[];
    expect(d.map((x) => x.value)).toEqual([6, 1.5, 0, 0, 0, 0, 0]);
    expect(d.map((x) => x.itemStyle.opacity)).toEqual([1, 1, 1, 1, 1, 0.6, 0.6]);
    expect(d[0].itemStyle.color).toBe("#ffe2b8");
    expect(d[1].itemStyle.color).toBe("#ffad3a");
    const om = series(weekdayOption("omote", w, names, "zh"));
    expect(om[1].symbol).toBe("rect");
    expect((om[1].data as { itemStyle: { color: unknown } }[]).map((x) => x.itemStyle.color).slice(0, 2)).toEqual(["#0b1626", "#0f1c2e"]);
  });
});

describe("echarts-theme", () => {
  it("tipHtml: heading, figure and small line as text — markup and quotes escaped (F1)", () => {
    expect(tipHtml(`<b>"a"</b>`, "1 & 2", "it's <x>")).toBe(
      `<div class="h">&lt;b&gt;&quot;a&quot;&lt;/b&gt;</div><div class="m">1 &amp; 2</div><div class="s">it&#39;s &lt;x&gt;</div>`);
    expect(tipHtml("h")).toBe(`<div class="h">h</div>`);
  });
  it("里: transparent, the pixel font, amber axes with dotted split lines; 表: ink palette and the page's body font", () => {
    const u = themeOf("ura") as Record<string, any>, o = themeOf("omote") as Record<string, any>;
    expect(u.backgroundColor).toBe("transparent");
    expect(u.textStyle.fontFamily).toBe('"fp12-sc","fp12-jp",monospace');
    expect(u.valueAxis.splitLine.lineStyle.type).toEqual([1, 3]);
    expect(o.color[0]).toBe("#0f1c2e");
    expect(o.textStyle.fontFamily).toBe(getComputedStyle(document.body).fontFamily);
  });
  it("fillOf: 表 prints amber as ink (#ffad3a → #0f1c2e, #c98a3a → #5b6573) and a line colour 28% deeper; 里 a dot pattern (plain rgba without a 2D context); glow only in 里", () => {
    expect(fillOf("omote", "#ffad3a")).toBe("#0f1c2e");
    expect(fillOf("omote", "#c98a3a")).toBe("#5b6573");
    expect(fillOf("omote", "#fff6e8")).toBe("#0b1626");
    expect(fillOf("omote", "#ffffff")).toBe("#bcbfc4");
    expect(fillOf("ura", "#ffad3a", 0.5)).toBe("rgba(255,173,58,0.5)");
    expect(glow("omote", "#ffad3a")).toEqual({});
    expect(glow("ura", "#ffad3a", 6)).toEqual({ shadowBlur: 6, shadowColor: "#ffad3a" });
  });
  it("dots: with a 2D context, a 2·PITCH square tile at half scale (one PITCH cell), cached per colour + alpha", () => {
    const stops: unknown[] = [];
    const ctx = { createRadialGradient: () => ({ addColorStop: (...a: unknown[]) => stops.push(a) }), fillRect() {}, fillStyle: "" };
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    const p = dots("#25e0c8", 0.7) as { image: HTMLCanvasElement; repeat: string; scaleX: number; scaleY: number };
    expect([p.image.width, p.image.height, p.repeat, p.scaleX, p.scaleY]).toEqual([PITCH * 2, PITCH * 2, "repeat", 0.5, 0.5]);
    expect(stops).toHaveLength(4);
    expect(dots("#25e0c8", 0.7)).toBe(p);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
