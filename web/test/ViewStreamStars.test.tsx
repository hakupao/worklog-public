import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PITCH } from "../src/led/lattice";
import type { Lang, Prefs } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { angOf } from "../src/pages/stats/viz/fingerprint";
import { J } from "../src/predict/fixtures";
import { __resetHoverForTests, getHoverTask, setHoverTask } from "../src/ui/hover";
import { applyWorld } from "../src/world/store";
import type { Call } from "./canvas-rec";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { canvases, seeAll, viewOf } from "./view-canvas";
import { jst, VIZ, VIZ_TASKS } from "./viz-fixture";

// the ECharts views on the same page never load the real chunk in jsdom
vi.mock("../src/pages/stats/viz/echarts", () => ({
  init: () => ({ setOption() {}, dispose() {}, isDisposed: () => false, resize() {}, on() {}, off() {}, dispatchAction() {} }),
}));

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (o: { lang?: Lang; prefs?: Partial<Prefs> } = {}) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider lang={o.lang} prefs={o.prefs}><StatsPage /></V2TestProvider>);
};
/** The fixture under the page's default range (近 4 周 = 9/5–10/2 on 10/2): X (Sunday 9/20 20:00–21:00) joins in. */
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
const oneDay = () => stServer({ sessions: () => ({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-21" } }), tasks: VIZ_TASKS });

const frames = () => vi.useFakeTimers({ toFake: ["Date", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
const tip = () => screen.getByRole("tooltip");
const texts = (calls: Call[]) => calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); __resetHoverForTests(); window.location.hash = ""; });

describe("stream — 案件时间流", () => {
  it("里: the task with the most wall clock as the key figure; the summary names the weeks the range cuts; the legend by range total", async () => {
    serve();
    page();
    const sec = await viewOf("案件时间流");
    await waitFor(() => expect(sec.querySelector("canvas.sv-stream")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|最多 T2");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("5 周，4 项（含未关联）；最多 T2，墙钟 3.3h；被区间截断的周 W36、W40");
    await waitFor(() => expect(ink(sec.querySelector(".sv-leg")!)).toBe("案件 二|3.3h|案件 一|2.3h|--|未关联|2h|案件 三|1h"));
    expect([...sec.querySelectorAll(".sv-leg .st-r")].map((r) => r.getAttribute("data-task"))).toEqual(["T2", "T1", null, "T3"]);
    expect(sec.querySelector("canvas.sv-stream")!.getAttribute("aria-hidden")).toBe("true");
    // B3b: S badges (22 px) lead the task rows; the 未关联 row keeps its dim `--` Led
    const leg = [...sec.querySelectorAll<HTMLElement>(".sv-leg .st-r")];
    for (const r of leg.filter((x) => x.dataset.task)) {
      const b = r.querySelector<HTMLElement>(`.tbadge[data-task="${r.dataset.task}"]`)!;
      expect(b.style.height).toBe("22px");
      expect(r.firstElementChild!.contains(b)).toBe(true);
    }
    expect(leg[2].querySelector(".tbadge")).toBeNull();
    expect(ink(leg[2].firstElementChild!)).toBe("--");
  });

  it("表: a band under the pointer lights its task and shows the week (cut or not) and the range total; others drop; leave clears", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-stream": [600, 348] });
    serve();
    page();
    const sec = await viewOf("案件时间流");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-stream")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    await waitFor(() => expect(cv.calls(el).some((c) => c.op === "fill" && typeof c.args[0] === "object" && c.args[0] !== null)).toBe(true));   // B3b: in-band silhouettes once the glyph chunk is in
    const n = cv.draws(el);
    // 表: columns 12…588px over 5 weeks; W39 (index 3) centred at 12 + 3.5 / 5 · 576; centre line at 156px — T1's band
    // (order "", T1, T3, T2: −225…−105, −105…30, 30…30, 30…225 minutes)
    fireEvent.pointerMove(el, { clientX: 100 + 12 + (3.5 / 5) * 576, clientY: 50 + 156 });
    expect(getHoverTask()).toBe("T1");
    expect(tip().querySelector(".h")!.textContent).toBe("T1案件 一");
    expect(tip().querySelector(".h .tbadge[data-task=\"T1\"]")!.getAttribute("style")).toContain("height: 16px");
    expect(tip().querySelector(".h .tcode")!.textContent).toBe("T1");
    expect(tip().querySelector(".h .code")).toBeNull();
    expect(tip().querySelector(".m")!.textContent).toBe("W39 · 9/21–9/27 · 墙钟 2.3h");
    expect(tip().querySelector(".s")!.textContent).toBe("区间合计 2.3h");
    expect(cv.draws(el)).toBe(n + 1);
    expect(cv.calls(el).filter((c) => c.op === "fill" && typeof c.args[0] !== "object").map((c) => c.alpha)).toEqual([0.88 * 0.3, 0.88, 0.88 * 0.3, 0.88 * 0.3]);
    fireEvent.pointerMove(el, { clientX: 100 + 12 + (4.5 / 5) * 576, clientY: 50 + 156 + 6 });   // W40: nothing
    expect(getHoverTask()).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerMove(el, { clientX: 100 + 12 + (0.5 / 5) * 576 + 40, clientY: 50 + 156 });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerMove(el, { clientX: 100 + 12 + (3.5 / 5) * 576, clientY: 50 + 156 - 165 * (300 / 450) });   // the unlinked band (−225…−105)
    expect(getHoverTask()).toBeNull();
    expect(tip().querySelector(".h")!.textContent).toBe("未关联");
    expect(tip().querySelector(".h .tbadge")).toBeNull();
    expect(tip().querySelector(".m")!.textContent).toBe("W39 · 9/21–9/27 · 墙钟 2h");
    fireEvent.pointerLeave(el);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a cut week says so in its tip; hover from elsewhere on the page redraws the bands", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-stream": [600, 348] });
    stServer({ sessions: () => ({ ...VIZ }), tasks: VIZ_TASKS });            // 9/21–9/22: W39 cut
    page();
    const sec = await viewOf("案件时间流");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-stream")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    fireEvent.pointerMove(el, { clientX: 100 + 300, clientY: 50 + 156 + 20 });                   // order T2, T1, "": T1 at −30…105
    expect(tip().querySelector(".m")!.textContent).toBe("W39 · 9/21–9/27（区间截断） · 墙钟 2.3h");
    fireEvent.pointerLeave(el);
    const n = cv.draws(el);
    act(() => { setHoverTask("T2"); });
    expect(cv.draws(el)).toBe(n + 1);
  });

  it("one day (今天) or nothing in the range: one dim line", async () => {
    oneDay();
    page();
    const sec = await viewOf("案件时间流");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});

describe("stars — 会话星图", () => {
  /** 表 star centres: x over 66…588px across the 28-day window from 9/5 05:00; y = (3 + (1 − log m / log 1440)·159)·3. */
  const at = (t0: string, min: number) => ({
    clientX: 100 + 66 + 522 * ((jst(t0) - jst("2026-09-05T05:00")) / (28 * 86_400_000)),
    clientY: 50 + (3 + (1 - Math.log(min) / Math.log(1440)) * 159) * 3,
  });

  it("里: count and biggest token count as the key figure; the summary with the longest and the costliest", async () => {
    serve();
    page();
    const sec = await viewOf("会话星图");
    await waitFor(() => expect(sec.querySelector("canvas.sv-stars")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|7 个会话 · 最多 215K token");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("7 个会话；最长 2h00m（9/21）；token 最多 215K；最贵 $6.00（9/21）");
    for (const c of sec.querySelectorAll("canvas")) expect(c.getAttribute("aria-hidden")).toBe("true");
  });

  it("表 with stats.cost hidden: no amount in the summary, the tip or on the canvas; a star lights its task and the others drop to .3", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-stars": [600, 528] });
    serve();
    page();
    const sec = await viewOf("会话星图");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-stars")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("7 个会话；最长 2h00m（9/21）；token 最多 215K");
    expect(texts(cv.calls(el)).some((s) => s.includes("$"))).toBe(false);
    const n = cv.draws(el);
    fireEvent.pointerMove(el, at("2026-09-21T09:00", 120));                     // A
    expect(getHoverTask()).toBe("T1");
    expect(tip().querySelector(".h")!.textContent).toBe("T1案件 一");
    expect(tip().querySelector(".h .tbadge[data-task=\"T1\"]")!.getAttribute("style")).toContain("height: 16px");
    expect(tip().querySelector(".h .tcode")!.textContent).toBe("T1");
    expect(tip().querySelector(".h .code")).toBeNull();
    expect(tip().querySelector(".m")!.textContent).toBe("9/21 09:00–11:00 · 区间内 2h00m · 10 轮 · 108K token");
    expect(cv.draws(el)).toBe(n + 1);
    expect(cv.calls(el).some((c) => c.op === "fill" && c.alpha === 0.3)).toBe(true);
    expect(texts(cv.calls(el)).some((s) => s.includes("$"))).toBe(false);
    fireEvent.pointerMove(el, at("2026-09-21T23:30", 120));                     // D, unlinked
    expect(getHoverTask()).toBeNull();
    expect(tip().querySelector(".h")!.textContent).toBe("未关联");
    expect(tip().querySelector(".h .tbadge")).toBeNull();
    fireEvent.pointerMove(el, { clientX: 100 + 580, clientY: 50 + 10 });        // empty sky
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerLeave(el);
    expect(getHoverTask()).toBeNull();
  });

  it("里: the amount shows in the tip", async () => {
    const cv = canvases({ "sv-stars": [600, 528] });
    serve();
    page();
    const sec = await viewOf("会话星图");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-stars")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    // 里 star centres sit on the PITCH lattice: x = 100 + (22 + x · cols) · PITCH + PITCH / 2, y = 50 + (3 + (1 − y) · 159) · PITCH + PITCH / 2,
    // cols = the canvas's 600px in dots less the 22 + 4 gutters
    const cols = Math.floor(600 / PITCH) - 22 - 4;
    const x = (jst("2026-09-21T09:00") - jst("2026-09-05T05:00")) / (28 * 86_400_000), y = Math.log(120) / Math.log(1440);
    fireEvent.pointerMove(el, { clientX: 100 + (22 + x * cols) * PITCH, clientY: 50 + (3 + (1 - y) * 159) * PITCH });
    expect(tip().querySelector(".m")!.textContent).toBe("9/21 09:00–11:00 · 区间内 2h00m · 10 轮 · 108K token · $3.00");
  });

  it("里 twinkle, on screen: the overlay redraws every frame; the static stars are drawn once; none in 表 / reduced motion / off screen", async () => {
    frames();
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    seeAll();
    const cv = canvases({ "sv-stars": [600, 528], "sv-ov": [600, 528] });
    serve();
    const first = page();
    let sec = await viewOf("会话星图");
    const el = await waitFor(() => { const c = sec.querySelector<HTMLCanvasElement>("canvas.sv-stars"); expect(c).not.toBeNull(); return c!; });
    const ov = sec.querySelector<HTMLCanvasElement>("canvas.sv-ov")!;
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    const n = cv.draws(el), clears = () => cv.every(ov).filter((c) => c.op === "clearRect").length;
    await waitFor(() => { act(() => { vi.advanceTimersByTime(20); }); expect(clears()).toBeGreaterThan(0); });
    const c0 = clears();
    for (let i = 0; i < 5; i++) act(() => { vi.advanceTimersByTime(100); });
    expect(clears()).toBeGreaterThan(c0 + 3);
    expect(cv.draws(el)).toBe(n);
    first.unmount();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    const second = page();
    sec = await viewOf("会话星图");
    await waitFor(() => expect(cv.draws(sec.querySelector("canvas.sv-stars")!)).toBeGreaterThan(0));
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(100); });
    expect(cv.every(sec.querySelector("canvas.sv-ov")!)).toEqual([]);
    second.unmount();
    vi.unstubAllGlobals();                                                       // (the fetch stub too)
    serve();
    const third = page();                                                        // no IntersectionObserver: never on screen
    sec = await viewOf("会话星图");
    await waitFor(() => expect(cv.draws(sec.querySelector("canvas.sv-stars")!)).toBeGreaterThan(0));
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(100); });
    expect(cv.every(sec.querySelector("canvas.sv-ov")!)).toEqual([]);
    third.unmount();
    seeAll();
    applyWorld("omote");
    page();
    sec = await viewOf("会话星图");
    await waitFor(() => expect(sec.querySelector("canvas.sv-stars")).not.toBeNull());
    expect(sec.querySelector("canvas.sv-ov")).toBeNull();
  });

  it("nothing in the range: one dim line", async () => {
    stServer();
    page();
    const sec = await viewOf("会话星图");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});

describe("fingerprint — 节律指纹", () => {
  it("里: the brightest weekday-hour as the key figure (÷ 4 of each weekday in 28 days); the summary; the weekday averages beside", async () => {
    serve();
    page();
    const sec = await viewOf("节律指纹");
    await waitFor(() => expect(sec.querySelector("canvas.sv-fpr")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|最常 周一 00:00");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("最常工作的时段 周一 00:00（平均每天 15 分钟）；最忙的小时 00:00，合计 1h；最忙的星期 周一，平均 1.5h / 天");
    await waitFor(() => expect(ink(sec.querySelector(".side")!)).toContain("周一|1.5h / 天|周二|0.4h / 天|周三|0h / 天"));
    expect(ink(sec.querySelector(".side")!)).toContain("周日|0.3h / 天|各小时合计 0 → 23");
    for (const c of sec.querySelectorAll("canvas.sv-fpr, canvas.sv-fph")) expect(c.getAttribute("aria-hidden")).toBe("true");
  });

  it("表: a cell's tip — the weekday ring (Monday inside) and the clock hour, average per day, total and days; the hour strip's tip", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-fpr": [600, 588], "sv-fph": [240, 54] });
    serve();
    page();
    const sec = await viewOf("节律指纹");
    const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-fpr")!);
    await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
    // 表 rings: centre (300, 294), R = 588 / 3 / 2 − 12 = 86 dots, R0 = .3R, ring width (R − R0) / 7; 3px a dot
    const R = 86, R0 = R * 0.3, w = (R - R0) / 7;
    const cell = (wd: number, h: number) => { const a = angOf(h + 0.5), r = (R0 + (wd + 0.5) * w) * 3; return { clientX: 100 + 300 + Math.sin(a) * r, clientY: 50 + 294 - Math.cos(a) * r }; };
    fireEvent.pointerMove(el, cell(0, 9));
    expect(tip().querySelector(".h")!.textContent).toBe("周一 09:00–10:00");
    expect(tip().querySelector(".m")!.textContent).toBe("平均 15 分钟 / 天");
    expect(tip().querySelector(".s")!.textContent).toBe("合计 1h（4 天）");
    fireEvent.pointerMove(el, cell(6, 20));
    expect(tip().querySelector(".h")!.textContent).toBe("周日 20:00–21:00");
    fireEvent.pointerMove(el, { clientX: 100 + 300, clientY: 50 + 294 });
    expect(screen.queryByRole("tooltip")).toBeNull();
    const hs = sec.querySelector<HTMLCanvasElement>("canvas.sv-fph")!;
    fireEvent.pointerMove(hs, { clientX: 100 + 9.5 * 10, clientY: 60 });
    expect(tip().querySelector(".h")!.textContent).toBe("09:00–10:00");
    expect(tip().querySelector(".m")!.textContent).toBe("墙钟 1h");
    fireEvent.pointerLeave(hs);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("fewer than 7 days (every weekday needed): one dim line", async () => {
    stServer({ sessions: () => ({ ...VIZ }), tasks: VIZ_TASKS });
    page();
    const sec = await viewOf("节律指纹");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
    expect(sec.querySelector("canvas.sv-fpr")).toBeNull();
  });
});
