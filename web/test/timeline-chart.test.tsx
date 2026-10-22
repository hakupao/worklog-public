import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bitmap } from "../src/led/bits";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { bandHeight, drawBandOmote, drawBandUra, drawRulerOmote, drawRulerUra, hitBand, trackYs, weekGeom } from "../src/pages/timeline/chart";
import { WeekChart } from "../src/pages/timeline/WeekChart";
import { layoutWeek } from "../src/pages/timeline/week";
import { J, machine, session, task } from "../src/predict/fixtures";
import { __resetHoverForTests, getHoverTask } from "../src/ui/hover";
import { lineColor } from "../src/ui/palette";
import { TipHost } from "../src/ui/TipHost";
import { rec } from "./canvas-rec";
import { V2TestProvider } from "./helpers";
import { weekTl } from "./tl-fixtures";

const T = (s: string) => Date.parse(J(s));
const tasks = [task("A", "alpha"), task("B", "beta")];
const byId = Object.fromEntries(tasks.map((x) => [x.id, x]));
const L = layoutWeek({
  timeline: weekTl("2026-W40", "2026-09-28", [
    session("s1", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "A" }),
    session("s2", "2026-10-01 13:00", "2026-10-01 13:30"),
    session("s3", "2026-10-02 13:30", "2026-10-02 14:10", { task_id: "B" }),
  ]),
  tasks, machines: [machine("macmini", "2026-10-02 14:12")], now: T("2026-10-02 14:20"), runningMin: 10,
});
const thu = L.bands[3], fri = L.bands[4];
const noBits = (): Bitmap => ({ w: 1, h: 1, on: new Uint8Array([1]) });
afterEach(() => { __resetHoverForTests(); vi.restoreAllMocks(); });

describe("week chart drawing", () => {
  it("band height grows with its rows, on the lattice, never below one board row", () => {
    expect([bandHeight(0), bandHeight(2), bandHeight(6), bandHeight(7)]).toEqual([45, 45, 51, 57]);
  });
  it("rows sit 6px apart around the band's middle", () => {
    const g = weekGeom(L, 1000, 45, PITCH);
    const ys = trackYs(2, g);
    expect(ys[1] - ys[0]).toBe(6);
    expect(Math.abs((ys[0] + ys[1]) / 2 - 45 / 2)).toBeLessThanOrEqual(PITCH / 2);   // snapped to a dot centre
    const y3 = trackYs(2, weekGeom(L, 1000, 45, OMOTE_UNIT));                          // 表's 3px grid: still centred
    expect((y3[0] + y3[1]) / 2).toBeCloseTo(22.5, 0);
  });
  it("hitBand finds the session under the pointer and its track; nothing between rows", () => {
    const g = weekGeom(L, 1000, bandHeight(thu.tracks.length), PITCH), ys = trackYs(thu.tracks.length, g);
    const x10 = g.dotX((10 * 60 + 30 - L.h0 * 60) / 5);
    expect(hitBand(L, thu, g, x10, ys[0])?.session?.id).toBe("s1");
    expect(hitBand(L, thu, g, x10, ys[1])?.track.taskId).toBeNull();
    expect(hitBand(L, thu, g, x10, ys[1])?.session).toBeNull();     // 10:30 on the 未关联 row: nothing there
    expect(hitBand(L, thu, g, x10, ys[1] + 20)).toBeNull();
  });
  it("里: lit dots in the line colour; today stops at now and marks the running track", () => {
    const { ctx, calls } = rec(), g = weekGeom(L, 1000, bandHeight(fri.tracks.length), PITCH);
    drawBandUra(ctx, L, fri, g, undefined, false);
    // jsdom has no sprites, so a lit LED is a flat disc in its colour (chart/canvas.ts lit())
    const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
    const litX = fills.map((c, i) => (c.fill === lineColor("B") ? arcs[i].args[0] as number : null)).filter((v): v is number => v !== null);
    expect(litX.length).toBe(8);                                 // 13:30–14:10 = 8 dots
    expect(Math.max(...litX)).toBeLessThanOrEqual(g.dotX(L.nowIdx!));
    expect(fills.some((c) => c.fill === "#fff6dc")).toBe(true);  // B is running: lit at now
    expect(fills.some((c) => c.fill === "rgba(255,173,58,.42)")).toBe(true);   // the now column
  });
  it("里: hovering one line dims the others; the 未关联 filter dims every linked track", () => {
    const g = weekGeom(L, 1000, bandHeight(thu.tracks.length), PITCH);
    const alphas = (hover: string | null | undefined, only: boolean) => {
      const { ctx, calls } = rec();
      drawBandUra(ctx, L, thu, g, hover, only);
      return [...new Set(calls.filter((c) => c.op === "drawImage" || c.op === "fill").map((c) => Math.round(c.alpha * 100)))];
    };
    expect(Math.min(...alphas("A", false))).toBeLessThan(20);
    expect(Math.min(...alphas(undefined, true))).toBeLessThan(20);
    expect(Math.min(...alphas(undefined, false))).toBeGreaterThan(30);
  });
  it("表: one solid bar per run of activity in the line colour; the 未关联 bar is grey ink; teal now line on today", () => {
    const { ctx, calls } = rec(), g = weekGeom(L, 1000, bandHeight(thu.tracks.length), OMOTE_UNIT);
    drawBandOmote(ctx, L, thu, g, undefined, false);
    const bars = calls.filter((c) => c.op === "fillRect" && c.fill !== "rgba(15,28,46,.08)");
    expect(bars.map((c) => c.fill)).toEqual([lineColor("A"), "#6f7d8e"]);
    const r2 = rec();
    drawBandOmote(r2.ctx, L, fri, weekGeom(L, 1000, 45, OMOTE_UNIT), undefined, false);
    expect(r2.calls.some((c) => c.op === "fillRect" && c.fill === "#0e7c86")).toBe(true);
  });
  it("表 under the 未关联 filter: the 未关联 bar turns amber (user 10/6), linked bars fade", () => {
    const { ctx, calls } = rec(), g = weekGeom(L, 1000, bandHeight(thu.tracks.length), OMOTE_UNIT);
    drawBandOmote(ctx, L, thu, g, undefined, true);
    const bars = calls.filter((c) => c.op === "fillRect" && c.fill !== "rgba(15,28,46,.08)");
    expect(bars.map((c) => [c.fill, c.alpha < 0.5])).toEqual([[lineColor("A"), true], ["#b07a1e", false]]);
  });
  it("rulers: an hour label per hour, now's time when today is in the week", () => {
    const g = weekGeom(L, 1000, 33, PITCH), g3 = weekGeom(L, 1000, 33, OMOTE_UNIT);
    const o = rec(); drawRulerOmote(o.ctx, L, g3);
    const texts = o.calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
    expect(texts).toContain("09"); expect(texts).toContain("21"); expect(texts).toContain("14:20");
    const u = rec(); drawRulerUra(u.ctx, L, g, noBits);
    // one stub dot per label: 13 hours (9–21), those within 16 dots of now give way to "14:20" — at PITCH 2 only 14
    // (≈29px off; 15 is ≈49px off, past the 32px clearance), so 12 hours + the clock
    expect(u.calls.filter((c) => c.op === "drawImage" || c.op === "fill").length).toBe(13);
    const past = layoutWeek({ timeline: weekTl("2026-W39", "2026-09-21", []), tasks, machines: [], now: T("2026-10-02 14:20"), runningMin: 10 });
    const p = rec(); drawRulerOmote(p.ctx, past, g3);
    expect(p.calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).not.toContain("14:20");
  });
});

describe("WeekChart", () => {
  const view = (o: { sel?: string | null; onSelect?: (d: string) => void; only?: boolean } = {}) => (
    <V2TestProvider><TipHost>
      <WeekChart L={L} sel={o.sel ?? "2026-10-01"} onlyUnlinked={o.only ?? false} tasks={byId} onSelect={o.onSelect ?? (() => {})} onOpen={() => {}} />
    </TipHost></V2TestProvider>
  );
  const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
  it("a band per day with its date, weekday, today tag and hours; the selected day is pressed", async () => {
    const { container } = render(view());
    await waitFor(() => expect(ink(container)).toContain("10/2 五|今天"));
    const bands = [...container.querySelectorAll<HTMLElement>(".band")];
    expect(bands.map((b) => b.dataset.day)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(bands.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true", "false"]);
    expect(ink(bands[3])).toContain("1.5H");
    expect(bands[3].style.height).toBe("45px");
  });
  it("clicking or Enter on a band selects its day", () => {
    const onSelect = vi.fn();
    const { container } = render(view({ onSelect }));
    const bands = container.querySelectorAll<HTMLElement>(".band");
    fireEvent.click(bands[0]);
    fireEvent.keyDown(bands[2], { key: "Enter" });
    expect(onSelect.mock.calls).toEqual([["2026-09-28"], ["2026-09-30"]]);
  });
  it("the 未关联 filter presses no band", () => {
    const { container } = render(view({ only: true }));
    expect([...container.querySelectorAll(".band")].every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  });
  it("the legend lists the week's lines; hovering one lifts that task page-wide", async () => {
    const { container } = render(view());
    const keys = [...container.querySelectorAll<HTMLElement>(".legend .lgk")];
    expect(keys.map((k) => k.dataset.task ?? "-")).toEqual(["A", "B", "-"]);
    expect(await within(keys[0]).findByRole("img", { name: "A" })).toBeTruthy();   // the key is the badge
    expect(within(keys[2]).queryByRole("img")).toBeNull();                          // 未关联 stays a dim Led
    fireEvent.pointerEnter(keys[1]);
    expect(getHoverTask()).toBe("B");
    expect(container.querySelector(".lg")!.classList.contains("has-hl")).toBe(true);
    fireEvent.pointerLeave(keys[1]);
    expect(getHoverTask()).toBeNull();
    fireEvent.pointerEnter(keys[2]);                 // 未关联: local to the chart, not the page-wide link
    expect(getHoverTask()).toBeNull();
    expect(keys[2].classList.contains("on")).toBe(true);
  });
  it("a day with an unpriced session marks its cost with *", async () => {
    const L2 = layoutWeek({
      timeline: weekTl("2026-W40", "2026-09-28", [session("x", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "A" }, null)]),
      tasks, machines: [], now: T("2026-10-02 14:20"), runningMin: 10,
    });
    const { container } = render(<V2TestProvider><TipHost><WeekChart L={L2} sel={null} onlyUnlinked={false} tasks={byId} onSelect={() => {}} onOpen={() => {}} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container.querySelector('.band[data-day="2026-10-01"]')!)).toContain("$0.00*"));
    expect(ink(container.querySelector('.band[data-day="2026-09-30"]')!)).not.toContain("*");
  });
  describe("on the band canvas", () => {
    // jsdom boxes are 0×0, as the band sees them; a recording context lets it compute its geometry
    const onCanvas = () => {
      const { ctx } = rec();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        return this.closest(".band") ? ctx : null;
      } as never);
    };
    const L3 = layoutWeek({
      timeline: weekTl("2026-W40", "2026-09-28", [
        session("e", "2026-10-02 09:00", "2026-10-02 10:00", { task_id: "B" }),
        session("r", "2026-10-02 13:30", "2026-10-02 14:10", { task_id: "B" }),
      ]),
      tasks, machines: [machine("macmini", "2026-10-02 14:12")], now: T("2026-10-02 14:20"), runningMin: 10,
    });
    const at = (Lx: typeof L3, hh: number, mm: number) => {
      const g = weekGeom(Lx, 0, 0, PITCH), b = Lx.bands[4];
      return { clientX: g.dotX(((hh - Lx.h0) * 60 + mm) / 5), clientY: trackYs(b.tracks.length, g)[0] };
    };
    const view = (Lx: typeof L3, onOpen = vi.fn(), onSelect = vi.fn()) => (
      <V2TestProvider><TipHost><WeekChart L={Lx} sel={null} onlyUnlinked={false} tasks={byId} onSelect={onSelect} onOpen={onOpen} /></TipHost></V2TestProvider>
    );
    const cv = (c: Element) => c.querySelector('.band[data-day="2026-10-02"] .cv canvas')!;
    const tip = () => document.body.querySelector(".tip")!;
    it("the tip says 运行中 only for the session that runs, not for its finished sibling on the same line", async () => {
      onCanvas();
      const { container } = render(view(L3));
      fireEvent.pointerMove(cv(container), at(L3, 9, 30));
      expect(tip().classList.contains("on")).toBe(true);
      expect(await within(tip() as HTMLElement).findByRole("img", { name: "B" })).toBeTruthy();   // badge ...
      expect(tip().querySelector(".h .code")!.textContent).toBe("B");                          // ... and the code text
      expect(tip().textContent).not.toContain("运行中");
      fireEvent.pointerMove(cv(container), at(L3, 14, 0));
      expect(tip().textContent).toContain("运行中");
    });
    it("a click on a dot opens that session; a click off every dot selects the day", () => {
      onCanvas();
      const onOpen = vi.fn(), onSelect = vi.fn();
      const { container } = render(view(L3, onOpen, onSelect));
      fireEvent.click(cv(container), at(L3, 9, 30));
      expect(onOpen).toHaveBeenCalledWith("e", "2026-10-02");
      fireEvent.click(cv(container), { ...at(L3, 9, 30), clientY: 400 });
      expect(onSelect).toHaveBeenCalledWith("2026-10-02");
    });
    it("a new layout with the same sessions (the minute tick) keeps the tip; changed sessions drop it", () => {
      onCanvas();
      const { container, rerender } = render(view(L3));
      fireEvent.pointerMove(cv(container), at(L3, 9, 30));
      rerender(view({ ...L3, bands: L3.bands.map((b) => ({ ...b })) }));
      expect(tip().classList.contains("on")).toBe(true);
      const changed = L3.bands.map((b) => (b.date === "2026-10-02" ? { ...b, sessions: b.sessions.map((s) => ({ ...s, updated_at: "2026-10-02T06:00:00Z" })) } : b));
      rerender(view({ ...L3, bands: changed }));
      expect(tip().classList.contains("on")).toBe(false);
    });
  });
});

