import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import type { StatsSession, StatsSessions } from "../src/api/types";
import { rankTiers } from "../src/pages/now/countdown";
import { drawUraMonth, glyphOrigin, TimeStrip } from "../src/pages/now/TimeStrip";
import type { DayCell } from "../src/cal/calendar";
import type { Bitmap } from "../src/led/bits";
import { C } from "../src/ui/palette";
import { rec } from "./canvas-rec";
import { applyWorld, resetWorldStore } from "../src/world/store";
import { V2TestProvider } from "./helpers";

const sess = (id: string, a: string, b: string): StatsSession => ({
  id, machine: "m", agent: "claude-code", task_id: null, started_at: a, ended_at: b, active_minutes: 0, turns: 0, files: 0,
  intervals: [[a, b]], approx: false, tokens: null, subagent_tokens: null, cost_usd: null, cost_partial: false, summary: "",
});
// 10/02 (4 h → tier 2) and 10/19 (10 h → tier 4) have hours; every other day of the month has none.
const payload = (from: string, to: string): StatsSessions => ({
  range: { from, to }, day_start: "05:00", plans: [],
  sessions: [
    sess("A", "2026-10-02T09:00:00+09:00", "2026-10-02T13:00:00+09:00"),
    sess("B", "2026-10-19T09:00:00+09:00", "2026-10-19T19:00:00+09:00"),
  ],
});

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
/** Every part appears in `s`, each after the one before it. */
const inOrder = (s: string, parts: string[]) => {
  let at = 0;
  for (const p of parts) {
    const i = s.indexOf(p, at);
    if (i < 0) return `missing "${p}" after index ${at}`;
    at = i + p.length;
  }
  return "ok";
};
// JST = UTC+9
const jst = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h - 9, mi);

beforeEach(() => {
  vi.spyOn(api, "statsSessions").mockImplementation(async (f, t) => payload(f, t));
  vi.spyOn(api, "tasks").mockResolvedValue([]);
});
afterEach(() => { act(() => resetWorldStore()); });

const mount = (now: number) => render(<V2TestProvider lang="zh"><TimeStrip now={now} /></V2TestProvider>);

describe("rankTiers", () => {
  it("nearest gets 0, the farthest of 5 gets 3", () => {
    expect(rankTiers(5)).toEqual([0, 1, 2, 2, 3]);
    expect(rankTiers(1)).toEqual([0]);
    expect(rankTiers(0)).toEqual([]);
  });
});

describe("<TimeStrip>", () => {
  it("2026-10-20 18:45: countdown rows nearest first, with date, days and business days", async () => {
    const { container } = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(ink(container)).toContain("給料日"));
    const eph = ink(container.querySelector(".eph")!);
    expect(inOrder(eph, ["給料日", "10/23", "3 天", "周末", "月末締め", "祝日", "文化の日", "长假", "年末年始"])).toBe("ok");
    const first = container.querySelector(".eph .er:not(.hd2)")!;
    expect(ink(first.querySelector(".c-kind")!)).toBe("給料日");
    expect(ink(first.querySelector(".c-biz")!)).toBe("2");
  });

  it("the countdown rows get dimmer by rank", async () => {
    const { container } = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(ink(container)).toContain("給料日"));
    const days = [...container.querySelectorAll(".eph .er:not(.hd2) .c-in canvas")].map((c) => c.getAttribute("data-tier"));
    expect(days).toEqual(["0", "1", "2", "2", "3"]);
  });

  it("the date is size 12, size 10 at ≤1400px (prototype now-c3a.html:1025)", async () => {
    const big = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(big.container.querySelector(".dom .ink")).not.toBeNull());
    expect(big.container.querySelector(".dom .ink")!.classList.contains("s12")).toBe(true);
    big.unmount();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(max-width:1400px)", media: q, addEventListener() {}, removeEventListener() {} }));
    try {
      const small = mount(jst(2026, 10, 20, 18, 45));
      await waitFor(() => expect(small.container.querySelector(".dom .ink")).not.toBeNull());
      expect(small.container.querySelector(".dom .ink")!.classList.contains("s10")).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("a malformed month-hours answer reads as not loaded, not a crash (the strip sits on the home page)", async () => {
    const q = vi.spyOn(api, "statsSessions").mockResolvedValue([] as unknown as StatsSessions);
    const { container } = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(q).toHaveBeenCalled());
    await act(async () => { await q.mock.results[0].value; });
    expect(ink(container)).toContain("记录 -/20 天");
  });

  it("the date block: one dominant cell, and the ephemeris cells", async () => {
    const { container } = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(ink(container)).toContain("记录 2/20 天"));
    const dom = container.querySelectorAll(".dom");
    expect(dom).toHaveLength(1);
    expect(dom[0].textContent).toContain("2026-10-20 火");
    expect(dom[0].querySelector("canvas")!.getAttribute("data-tier")).toBe("0");
    const tb = ink(container.querySelector(".tb")!);
    for (const s of ["令和8年", "W43", "FY2026 Q3", "营业日 13/21 剩 8", "记录", "日没 17:00", "日出 05:51"]) expect(tb).toContain(s);
  });

  it("the month calendar: 5 week rows, today marked, weekend days off, hour tiers", async () => {
    const { container } = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(container.querySelector('.day[data-date="2026-10-19"]')!.getAttribute("data-h")).toBe("4"));
    expect(container.querySelectorAll(".cal-g .wk-row")).toHaveLength(5);
    const day = (d: string) => container.querySelector(`.day[data-date="${d}"]`)!;
    expect(day("2026-10-20").classList.contains("today")).toBe(true);
    expect(container.querySelectorAll(".day.today")).toHaveLength(1);
    expect(day("2026-10-24").classList.contains("off")).toBe(true);
    expect(day("2026-10-25").classList.contains("off")).toBe(true);
    expect(day("2026-10-23").classList.contains("off")).toBe(false);
    expect(day("2026-10-12").classList.contains("hol")).toBe(true);   // スポーツの日
    expect(day("2026-10-12").classList.contains("off")).toBe(true);
    expect(day("2026-10-02").getAttribute("data-h")).toBe("2");
    expect(day("2026-10-21").classList.contains("future")).toBe(true);
    expect(container.querySelector(".tstrip")!.classList.contains("w6")).toBe(false);
  });

  it("a day off: 今天休息 instead of a business-day number, and the 周末 row reads 今天", async () => {
    const { container } = mount(jst(2026, 10, 24, 10, 0));
    await waitFor(() => expect(ink(container)).toContain("今天休息"));
    expect(ink(container)).not.toContain("营业日 0/");
    const rows = [...container.querySelectorAll(".eph .er:not(.hd2)")];
    const weekend = rows.find((r) => ink(r).includes("周末"))!;
    expect(ink(weekend)).toContain("今天");
  });

  it("a 6-week month (2026-08): 6 grid rows and the compressed .w6 strip", async () => {
    const { container } = mount(jst(2026, 8, 10, 12, 0));
    await waitFor(() => expect(ink(container)).toContain("給料日"));
    expect(container.querySelectorAll(".cal-g .wk-row")).toHaveLength(6);
    expect(container.querySelector(".tstrip")!.classList.contains("w6")).toBe(true);
  });

  it("表: an ISO-week column in the calendar", async () => {
    act(() => applyWorld("omote"));
    const { container } = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(ink(container.querySelector(".cal-g")!)).toContain("W43"));
    expect(ink(container.querySelector(".cal-g")!)).toContain("W40");
    expect(container.querySelectorAll(".cal-g .iso")).toHaveLength(6);   // the head + one per week row
  });

  it("ura: no ISO column", async () => {
    const { container } = mount(jst(2026, 10, 20, 18, 45));
    await waitFor(() => expect(ink(container)).toContain("給料日"));
    expect(container.querySelectorAll(".cal-g .iso")).toHaveLength(0);
  });
});

// The 8px pixel font's "20" and "2" as the browser draws them (probe 10/20): 6 lit rows in an 8-row em box.
const bm = (rows: string[]): Bitmap => ({ w: rows[0].length, h: rows.length, on: Uint8Array.from(rows.join("").split(""), (c) => (c === "#" ? 1 : 0)) });
const B20 = bm([".##...##..", "#..#.#..#.", "...#.#.##.", ".##..##.#.", "#....#..#.", "####..##..", "..........", ".........."]);
const B2 = bm([".##..", "#..#.", "...#.", ".##..", "#....", "####.", ".....", "....."]);
const fakeBits = (s: string) => (s.length > 1 ? B20 : B2);

describe("glyphOrigin: the digit centred by its lit dots, not its em box", () => {
  it("a 2-digit day in an 11 × 7 patch sits one column in and on the patch's top row", () => {
    expect(glyphOrigin(B20, 0, 10, 0, 6)).toEqual({ ox: 1, oy: 0 });
  });
  it("a 1-digit day in an 11 × 7 patch", () => {
    expect(glyphOrigin(B2, 0, 10, 0, 6)).toEqual({ ox: 3, oy: 0 });
  });
  it("an empty bitmap keeps the patch origin", () => {
    expect(glyphOrigin({ w: 0, h: 8, on: new Uint8Array(0) }, 4, 14, 2, 8)).toEqual({ ox: 4, oy: 2 });
  });
});

describe("drawUraMonth: today stays legible (T10 verdict 5, F2)", () => {
  const cell = (d: number, over: Partial<DayCell> = {}): DayCell => ({ date: `2026-10-${String(d).padStart(2, "0")}`, d, dow: 2, off: false, holiday: null, today: false, future: false, ...over });
  // one week row; today is either 20 (2-digit) or 2 (1-digit), in the second column
  const week = (td: number) => [[cell(19), cell(td, { today: true }), cell(21, { future: true }), cell(22, { future: true }), cell(23, { future: true }), cell(24, { future: true, off: true }), cell(25, { future: true, off: true })]];
  const warmDots = (calls: ReturnType<typeof rec>["calls"]) => calls.filter((c) => c.op === "arc" && c.fill === C.WARM).map((c) => ({ x: c.args[0] as number, y: c.args[1] as number, a: c.alpha }));
  const lit = (b: Bitmap) => b.on.reduce((n, v) => n + v, 0);
  for (const [td, B] of [[20, B20], [2, B2]] as const) for (const [rowH, offX, offY] of [[27, 0, 0], [27, 1, 2], [27, 2, 1], [22.5, 0, 0], [22.5, 2, 2]] as const) {
    it(`today ${td}: digit at full brightness, inside the row's clear-dot margin, nothing lit touching it (row ${rowH}px, lattice ${offX}/${offY})`, () => {
      const { ctx, calls } = rec();
      drawUraMonth(ctx, week(td), () => 0, 7 * 36, rowH, offX, offY, fakeBits);
      const today = warmDots(calls).filter((p) => p.x > 36 && p.x < 72);
      const glyph = today.filter((p) => p.a === 1), rest = today.filter((p) => p.a !== 1);
      expect(glyph).toHaveLength(lit(B));
      // the patch's dot centres keep 2.6px from the hairlines; a 27px row holds the 6-row digit inside it.
      // A 22.5px row's patch is 5–6 dots, so the digit may use the margin there, but never crosses the hairline.
      const m = rowH >= 27 ? 2.6 : 0;
      for (const p of glyph) { expect(p.y).toBeGreaterThanOrEqual(m); expect(p.y).toBeLessThanOrEqual(rowH - m); }   // dot centres, as the patch rule
      for (const p of rest) expect(p.a).toBeLessThanOrEqual(0.25);         // a dim field, no ring on the glyph's edge
      const others = warmDots(calls).filter((p) => p.x <= 36 || p.x >= 72);
      expect(Math.max(...others.map((p) => p.a))).toBeLessThan(1);           // today is the brightest digit
    });
  }
  it("today with hours keeps its hour tier under the warm hue (review I1)", () => {
    const field = (tier: number) => {
      const { ctx, calls } = rec();
      drawUraMonth(ctx, week(20), () => tier, 7 * 36, 27, 0, 0, fakeBits);
      return Math.max(...warmDots(calls).filter((p) => p.x > 36 && p.x < 72 && p.a < 1).map((p) => p.a));
    };
    expect(field(0)).toBeCloseTo(0.2);
    expect(field(4)).toBeCloseTo(0.4);       // LV[4]: the tier still reads
    expect(field(3)).toBeCloseTo(0.27);
  });
});
