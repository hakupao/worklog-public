import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { vizBase } from "../src/pages/stats/useViz";
import { contourHeight, drawTerrainOmote, NB, terrainOf, TERRAIN_HEIGHT, turn, VIEW0, zAt } from "../src/pages/stats/viz/terrain";
import { J } from "../src/predict/fixtures";
import { __resetHoverForTests } from "../src/ui/hover";
import { applyWorld } from "../src/world/store";
import { rec } from "./canvas-rec";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { canvases, viewOf } from "./view-canvas";
import { VIZ, VIZ_TASKS } from "./viz-fixture";

// the ECharts views on the same page never load the real chunk in jsdom
vi.mock("../src/pages/stats/viz/echarts", () => ({
  init: () => ({ setOption() {}, dispose() {}, isDisposed: () => false, resize() {}, on() {}, off() {}, dispatchAction() {} }),
}));

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (lang?: Lang) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider lang={lang}><StatsPage /></V2TestProvider>);
};
/** The fixture under the page's default range (近 4 周 = 9/5–10/2 on 10/2): X (9/20 20:00–21:00) joins in; the true
 *  peak is ×3 at 9/21 10:30 — 30 minutes, which the smoothing flattens to ≈1.1. */
const RANGE = { from: "2026-09-05", to: "2026-10-02" };
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
const oneDay = () => stServer({ sessions: () => ({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-21" } }), tasks: VIZ_TASKS });
const land = () => { const b = vizBase({ ...VIZ, range: RANGE }); return terrainOf(b.segs, b.days); };
const tip = () => screen.getByRole("tooltip");
const NOTE = "高度经过平滑（15 分钟格 + 模糊），读数低于实际：地形最高 ≈1.1，实际最高并行 ×3（9/21 10:30）";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); __resetHoverForTests(); window.location.hash = ""; });

describe("terrain — 地形 · 立体", () => {
  it("里: the true peak as the key figure; the summary and the line under the relief say the heights are smoothed", async () => {
    serve();
    page();
    const sec = await viewOf("地形 · 立体");
    await waitFor(() => expect(sec.querySelector("canvas.sv-terr")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|实际最高 ×3 9/21");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe(`28 天 × 24 小时的并行度地形；平滑后的山峰 —。${NOTE}`);
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toBe(NOTE));
    expect(land().zmax.toFixed(1)).toBe("1.1");
    const wrap = sec.querySelector(".sv-tw")!;
    expect([wrap.getAttribute("role"), wrap.getAttribute("tabindex"), wrap.getAttribute("aria-label")]).toEqual(["group", "0", "地形视角：拖动，或 ← → 横移、↑ ↓ 调高度"]);
    expect(sec.querySelector("canvas.sv-terr")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("en: the same statement in English", async () => {
    serve();
    page("en");
    const sec = await viewOf("Terrain · relief");
    await waitFor(() => expect(sec.querySelector(".v2-sr")!.textContent).toContain("Heights are smoothed (15-minute bins + blur) and read lower than they were: the land tops out at ≈1.1, the true peak is ×3 (9/21 10:30)"));
  });

  it("arrow keys on the focused relief turn it (the page does not scroll); the height stops at 2.2; other keys do nothing", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-terr": [600, TERRAIN_HEIGHT] });
    serve();
    page();
    const sec = await viewOf("地形 · 立体");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-terr")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    const wrap = sec.querySelector<HTMLElement>(".sv-tw")!, n = cv.draws(el);
    wrap.focus();
    expect(fireEvent.keyDown(wrap, { key: "ArrowRight" })).toBe(false);          // default prevented
    expect(cv.draws(el)).toBe(n + 1);
    expect(fireEvent.keyDown(wrap, { key: "a" })).toBe(true);
    expect(cv.draws(el)).toBe(n + 1);
    for (let k = 0; k < 20; k++) fireEvent.keyDown(wrap, { key: "ArrowUp" });       // 1 → 2.2 in twelve steps
    expect(cv.draws(el)).toBe(n + 13);
    fireEvent.keyDown(wrap, { key: "ArrowLeft" });
    fireEvent.keyDown(wrap, { key: "ArrowDown" });
    expect(cv.draws(el)).toBe(n + 15);
  });

  it("表: a point on a row tips the day, the smoothed height there and the day's own figures; a drag turns the relief with no tip, once per frame", async () => {
    vi.useFakeTimers({ toFake: ["Date", "requestAnimationFrame", "cancelAnimationFrame"] });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    applyWorld("omote");
    const cv = canvases({ "sv-terr": [600, TERRAIN_HEIGHT] });
    serve();
    page();
    const sec = await viewOf("地形 · 立体");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-terr")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    // where 9/21 (day 16 of 28) lies, from the same projection
    const g = drawTerrainOmote(rec().ctx, land(), VIEW0, { w: 600, h: TERRAIN_HEIGHT }, () => "11px x");
    // on 9/21's drawn face (C1: the hit follows the face, not the nearest base line — nearer hills cover that line)
    const sc = g.w[16] / g.w[27], at = (f: number) => ({ clientX: 100 + (g.x0[16] + f * g.w[16]) * 3, clientY: 50 + (g.base[16] - zAt(land(), 16, f * (NB - 1)) * g.hS * sc + 0.5) * 3 });
    fireEvent.pointerMove(el, at(5.5 / 24));                                         // 10:30
    expect(tip().querySelector(".h")!.textContent).toBe("2026-09-21（一）");
    expect(tip().querySelector(".m")!.textContent).toMatch(/^10:30 并行 ≈1\.\d（平滑）$/);
    expect(tip().querySelector(".s")!.textContent).toBe("墙钟 6h · 累计 8h · ×3");
    const n = cv.draws(el);
    fireEvent.pointerDown(el, at(0.5));
    expect(screen.queryByRole("tooltip")).toBeNull();
    for (const dx of [20, 50, 80]) fireEvent.pointerMove(el, { clientX: at(0.5).clientX + dx, clientY: at(0.5).clientY - dx / 2 });
    expect(cv.draws(el)).toBe(n);                                                     // coalesced into the next frame
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(cv.draws(el)).toBe(n + 1);                                                 // one redraw, at the last pointer
    const r = rec();
    drawTerrainOmote(r.ctx, land(), turn(VIEW0, 80 / 160, 20 / 200), { w: 600, h: TERRAIN_HEIGHT }, () => "11px x");
    expect(JSON.stringify(cv.calls(el).filter((c) => c.op === "lineTo").slice(0, 40))).toBe(JSON.stringify(r.calls.filter((c) => c.op === "lineTo").slice(0, 40)));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerUp(el);
    fireEvent.pointerMove(el, { clientX: 100 + 3, clientY: 50 + 3 });                 // left of every row
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(cv.draws(el)).toBe(n + 1);
  });

  it("里: a drag draws the relief coarse (P1), the release draws it whole again — the arrow keys draw it whole", async () => {
    vi.useFakeTimers({ toFake: ["Date", "requestAnimationFrame", "cancelAnimationFrame"] });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    const cv = canvases({ "sv-terr": [600, TERRAIN_HEIGHT] });
    serve();
    page();
    const sec = await viewOf("地形 · 立体");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-terr")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    const dots = () => cv.calls(el).filter((c) => c.op === "arc").length;
    const whole = dots(), n = cv.draws(el);
    fireEvent.pointerDown(el, { clientX: 300, clientY: 200 });
    fireEvent.pointerMove(el, { clientX: 340, clientY: 190 });
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(cv.draws(el)).toBe(n + 1);
    expect(dots()).toBeLessThan(whole / 2);                                            // coarse while dragging
    fireEvent.pointerMove(el, { clientX: 360, clientY: 190 });                         // a frame still pending at release
    fireEvent.pointerUp(el);
    expect(cv.draws(el)).toBe(n + 2);                                                  // one whole redraw, at the last pointer
    expect(dots()).toBeGreaterThan(whole / 2);
    act(() => { vi.advanceTimersToNextFrame(); });
    expect(cv.draws(el)).toBe(n + 2);                                                  // the pending frame was folded in
    fireEvent.keyDown(sec.querySelector(".sv-tw")!, { key: "ArrowLeft" });
    expect(cv.draws(el)).toBe(n + 3);
    expect(dots()).toBeGreaterThan(whole / 2);
  });

  it("one day (今天): one dim line", async () => {
    oneDay();
    page();
    const sec = await viewOf("地形 · 立体");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});

describe("contour — 地形 · 等高线", () => {
  it("里: the same key figure and smoothed-heights line; a canvas row per day", async () => {
    serve();
    page();
    const sec = await viewOf("地形 · 等高线");
    await waitFor(() => expect(sec.querySelector("canvas.sv-cont")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|实际最高 ×3 9/21");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe(`同一地形的等高线；平滑后的山峰 —。${NOTE}`);
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toBe(NOTE));
    expect(sec.querySelector<HTMLCanvasElement>("canvas.sv-cont")!.style.height).toBe(`${contourHeight(28)}px`);
  });

  it("表: a point tips the day and the smoothed height", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-cont": [600, contourHeight(28)] });
    serve();
    page();
    const sec = await viewOf("地形 · 等高线");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-cont")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    // 表: hours across x 90…570px (30 dots left, 10 right), days down from y 39px, 9px a day
    fireEvent.pointerMove(el, { clientX: 100 + 90 + 480 * (5.5 / 24), clientY: 50 + 39 + 16 * 9 + 4 });
    expect(tip().querySelector(".h")!.textContent).toBe("2026-09-21（一）");
    expect(tip().querySelector(".m")!.textContent).toMatch(/^10:30 并行 ≈1\.\d（平滑）$/);
    fireEvent.pointerMove(el, { clientX: 100 + 60, clientY: 50 + 39 + 4 });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("one day (今天): one dim line", async () => {
    oneDay();
    page();
    const sec = await viewOf("地形 · 等高线");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});
