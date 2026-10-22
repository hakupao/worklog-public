import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PITCH } from "../src/led/lattice";
import type { Lang } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { __resetHoverForTests, getHoverTask, setHoverTask } from "../src/ui/hover";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { canvases, seeAll, viewOf } from "./view-canvas";
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
/** The fixture under the page's default range (近 4 周 = 9/5–10/2 on 10/2): X (9/20 20:00–21:00) joins in; active
 *  days 9/20 (60 min), 9/21 (360, ×3 at 10:30 — the peak day), 9/22 (90). */
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
const oneDay = () => stServer({ sessions: () => ({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-21" } }), tasks: VIZ_TASKS });

const frames = () => vi.useFakeTimers({ toFake: ["Date", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); __resetHoverForTests(); window.location.hash = ""; });

describe("里 entrance: the end state is drawn once and the canvas fades in (no per-frame redraw)", () => {
  for (const [name, cls] of [["作息瀑布", "sv-wf"], ["日历热力", "sv-cal"]] as const) {
    it(name, async () => {
      frames();
      vi.setSystemTime(new Date(J("2026-10-02 14:20")));
      const cv = canvases({ [cls]: [306, 360] });
      serve();
      page();
      const sec = await viewOf(name);
      const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>(`canvas.${cls}`)!);
      await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
      const n = cv.draws(el);
      expect(Number(el.style.opacity)).toBeLessThan(0.2);
      act(() => { vi.advanceTimersByTime(300); });
      const mid = Number(el.style.opacity);
      expect(mid).toBeGreaterThan(0.2);
      expect(mid).toBeLessThan(1);
      act(() => { vi.advanceTimersByTime(700); });
      expect(el.style.opacity).toBe("");
      expect(cv.draws(el)).toBe(n);
    });
  }
});

const tip = () => screen.getByRole("tooltip");
const keys = (sec: HTMLElement) => within(sec.querySelector<HTMLElement>(".sv-days")!);

describe("river — 并行编队", () => {
  it("里: the peak as the key figure; the peak day opened (5 lanes); the summary; canvases aria-hidden", async () => {
    serve();
    page();
    const sec = await viewOf("并行编队");
    await waitFor(() => expect(sec.querySelector("canvas.sv-ln")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|×3 9/21");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("28 天的并行度；最高 ×3（9/21 10:30）。展开 9/21：5 个会话，墙钟 6h，累计 8h");
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toContain("9/21 一"));
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toContain("5 个会话 · 最高 ×3 10:30"));
    const ln = sec.querySelector<HTMLCanvasElement>("canvas.sv-ln")!;
    expect(ln.style.height).toBe(`${(22 + 5 * 9 + 12) * 3}px`);
    for (const c of sec.querySelectorAll("canvas.sv-rv, canvas.sv-ov, canvas.sv-ln")) expect(c.getAttribute("aria-hidden")).toBe("true");
  });

  it("the day keys are buttons (keyboard): ◀ ▶ skip days without sessions and stop at the ends; 峰值日 comes back", async () => {
    serve();
    page();
    const sec = await viewOf("并行编队");
    const k = await waitFor(() => keys(sec));
    expect(k.getByRole("button", { name: "峰值日" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(k.getByRole("button", { name: "后一个有会话的日子" }));
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toContain("9/22 二"));
    expect(sec.querySelector<HTMLCanvasElement>("canvas.sv-ln")!.style.height).toBe(`${(22 + 2 * 9 + 12) * 3}px`);
    expect(k.getByRole("button", { name: "后一个有会话的日子" })).toBeDisabled();       // 9/23–10/2 are empty
    expect(k.getByRole("button", { name: "峰值日" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(k.getByRole("button", { name: "前一个有会话的日子" }));
    fireEvent.click(k.getByRole("button", { name: "前一个有会话的日子" }));
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toContain("9/20 日"));
    expect(k.getByRole("button", { name: "前一个有会话的日子" })).toBeDisabled();      // nothing before 9/20 in the range
    fireEvent.click(k.getByRole("button", { name: "峰值日" }));
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toContain("9/21 一"));
  });

  it("表: a click on the river opens that day; an empty day does nothing; the tip names the day and its ≥ k minutes", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-rv": [600, 252], "sv-ln": [600, 237] });
    serve();
    page();
    const sec = await viewOf("并行编队");
    const rv = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-rv")!);
    await waitFor(() => expect(cv.draws(rv)).toBeGreaterThan(0));
    const xOf = (i: number) => 100 + 126 + (i + 0.5) * (408 / 28);              // 9/5 + i
    fireEvent.pointerMove(rv, { clientX: xOf(16), clientY: 100 });
    expect(tip().querySelector(".h")!.textContent).toBe("2026-09-21（一）");
    expect(tip().querySelector(".m")!.textContent).toBe("墙钟 6h · 累计 8h · ×3");
    expect(tip().querySelector(".s")!.textContent).toBe("×1 以上 6h · ×2 以上 1.5h · ×3 以上 0.5h");
    fireEvent.click(rv, { clientX: xOf(15), clientY: 100 });
    await waitFor(() => expect(ink(sec.querySelector(".sv-cap")!)).toContain("9/20 日"));
    expect(sec.querySelector(".v2-sr")!.textContent).toContain("展开 9/20：1 个会话");
    fireEvent.click(rv, { clientX: xOf(5), clientY: 100 });                       // 9/10: no sessions
    expect(sec.querySelector(".v2-sr")!.textContent).toContain("展开 9/20：1 个会话");
    fireEvent.pointerLeave(rv);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("表 lanes: hover sets the page's hovered task and shows the session (no amount); the other tasks' lanes drop to .3; leave clears both", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-rv": [600, 252], "sv-ln": [600, 237] });
    serve();
    page();
    const sec = await viewOf("并行编队");
    const ln = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-ln")!);
    const rv = sec.querySelector<HTMLCanvasElement>("canvas.sv-rv")!;
    await waitFor(() => expect(cv.draws(ln)).toBeGreaterThan(0));
    const river = cv.draws(rv), lanes = cv.draws(ln);
    fireEvent.pointerMove(ln, { clientX: 300, clientY: 50 + 66 + 5 });            // lane 0: A
    expect(getHoverTask()).toBe("T1");
    expect(tip().querySelector(".h")!.textContent).toBe("T1案件 一");
    expect(tip().querySelector(".h .tbadge[data-task=\"T1\"]")!.getAttribute("style")).toContain("height: 16px");
    expect(tip().querySelector(".h .tcode")!.textContent).toBe("T1");
    expect(tip().querySelector(".h .code")).toBeNull();
    expect(tip().querySelector(".m")!.textContent).toBe("09:00–11:00 · 当日 2h00m · 10 轮 · 108K token");
    expect(tip().querySelector(".s")!.textContent).toBe("summary A · macmini · claude-code");
    expect(cv.draws(ln)).toBe(lanes + 1);
    expect(cv.calls(ln).some((c) => c.op === "fillRect" && c.alpha === 0.3)).toBe(true);
    expect(cv.draws(rv)).toBe(river);                                              // the river does not follow hover
    fireEvent.pointerMove(ln, { clientX: 300, clientY: 50 + 66 + 3 * 27 + 5 });   // lane 3: D, unlinked
    expect(getHoverTask()).toBeNull();
    expect(tip().querySelector(".h")!.textContent).toBe("未关联");
    expect(tip().querySelector(".h .tbadge")).toBeNull();
    fireEvent.pointerLeave(ln);
    expect(getHoverTask()).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("里 lanes: the amount shows; hover from elsewhere on the page redraws the lanes", async () => {
    const cv = canvases({ "sv-ln": [600, 237] });
    serve();
    page();
    const sec = await viewOf("并行编队");
    const ln = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-ln")!);
    await waitFor(() => expect(cv.draws(ln)).toBeGreaterThan(0));
    fireEvent.pointerMove(ln, { clientX: 300, clientY: 50 + 22 * PITCH + 5 });   // 里: lanes from row 22 on the PITCH lattice
    expect(tip().querySelector(".m")!.textContent).toBe("09:00–11:00 · 当日 2h00m · 10 轮 · 108K token · $3.00");
    fireEvent.pointerLeave(ln);
    const n = cv.draws(ln);
    act(() => { setHoverTask("T2"); });
    expect(cv.draws(ln)).toBe(n + 1);
  });

  it("one day (今天) or nothing in the range: one dim line", async () => {
    oneDay();
    page();
    const sec = await viewOf("并行编队");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
    expect(sec.querySelector("canvas.sv-rv, canvas.sv-ln")).toBeNull();
  });
});

describe("river — the ripple (the one moving thing)", () => {
  it("里, on screen: the overlay redraws every frame; the static river is drawn once (no per-frame static redraw)", async () => {
    frames();
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    seeAll();
    const cv = canvases({ "sv-rv": [600, 252], "sv-ov": [600, 252] });
    serve();
    page();
    const sec = await viewOf("并行编队");
    const rv = await waitFor(() => { const c = sec.querySelector<HTMLCanvasElement>("canvas.sv-rv"); expect(c).not.toBeNull(); return c!; });
    const ov = sec.querySelector<HTMLCanvasElement>("canvas.sv-ov")!;
    await waitFor(() => expect(cv.draws(rv)).toBeGreaterThan(0));
    const n = cv.draws(rv), clears = () => cv.every(ov).filter((c) => c.op === "clearRect").length;
    // the loop starts once the river reports itself on screen (a passive effect): step frames until it does
    await waitFor(() => { act(() => { vi.advanceTimersByTime(20); }); expect(clears()).toBeGreaterThan(0); });
    const c0 = clears();
    for (let i = 0; i < 5; i++) act(() => { vi.advanceTimersByTime(100); });
    expect(clears()).toBeGreaterThan(c0 + 3);
    expect(cv.draws(rv)).toBe(n);
  });

  it("not off screen (no IntersectionObserver), not in reduced motion, and no overlay in 表", async () => {
    frames();
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    const cv = canvases({ "sv-rv": [600, 252], "sv-ov": [600, 252] });
    serve();
    const { unmount } = page();
    let sec = await viewOf("并行编队");
    await waitFor(() => expect(cv.draws(sec.querySelector("canvas.sv-rv")!)).toBeGreaterThan(0));
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(100); });
    expect(cv.every(sec.querySelector("canvas.sv-ov")!)).toEqual([]);
    unmount();
    seeAll();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    const second = page();
    sec = await viewOf("并行编队");
    await waitFor(() => expect(cv.draws(sec.querySelector("canvas.sv-rv")!)).toBeGreaterThan(0));
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(100); });
    expect(cv.every(sec.querySelector("canvas.sv-ov")!)).toEqual([]);
    second.unmount();
    vi.unstubAllGlobals();
    seeAll();
    applyWorld("omote");
    serve();
    page();
    sec = await viewOf("并行编队");
    await waitFor(() => expect(sec.querySelector("canvas.sv-rv")).not.toBeNull());
    expect(sec.querySelector("canvas.sv-ov")).toBeNull();
  });
});

describe("dial — 大圆表盘", () => {
  it("里: the latest day with ≥ 3h opens (9/21); its wall clock as the key figure (not today: R3); the summary; the side figures", async () => {
    serve();
    page();
    const sec = await viewOf("大圆表盘");
    await waitFor(() => expect(sec.querySelector("canvas.sv-dl")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toMatch(/\|墙钟 6h$/);
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("9/21 一：墙钟 6h，累计 8h，最高并行 ×3；5 个会话排成 3 道");
    expect(ink(sec.querySelector(".side")!)).toBe("◀|9/21 一|▶|峰值日|今天|墙钟 6h|累计 8h · 最高 ×3|5 个会话 · 3 道");
    for (const c of sec.querySelectorAll("canvas.sv-dl, canvas.sv-hand")) expect(c.getAttribute("aria-hidden")).toBe("true");
  });

  it("day keys: ◀ ▶ skip empty days, 今天 opens today (in the range, empty), 峰值日", async () => {
    serve();
    page();
    const sec = await viewOf("大圆表盘");
    const k = await waitFor(() => keys(sec));
    fireEvent.click(k.getByRole("button", { name: "前一个有会话的日子" }));
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("9/20 日：墙钟 1h，累计 1h，最高并行 ×1；1 个会话排成 1 道");
    fireEvent.click(k.getByRole("button", { name: "后一个有会话的日子" }));
    fireEvent.click(k.getByRole("button", { name: "后一个有会话的日子" }));
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("9/22 二：墙钟 1.5h，累计 1.5h，最高并行 ×1；2 个会话排成 1 道");
    expect(k.getByRole("button", { name: "后一个有会话的日子" })).toBeDisabled();
    fireEvent.click(k.getByRole("button", { name: "今天" }));
    expect(k.getByRole("button", { name: "今天" }).getAttribute("aria-pressed")).toBe("true");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("10/2 五：墙钟 0h，累计 0h，最高并行 ×0；0 个会话排成 0 道");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!).split("|").at(-1)).toBe("此刻 14:20"));   // today: the time now
    fireEvent.click(k.getByRole("button", { name: "峰值日" }));
    expect(sec.querySelector(".v2-sr")!.textContent!.startsWith("9/21 一")).toBe(true);
  });

  it("今天 is disabled when the range does not hold today", async () => {
    stServer({ sessions: () => ({ ...VIZ }), tasks: VIZ_TASKS });            // answers 9/21–9/22 whatever is asked
    page();
    const sec = await viewOf("大圆表盘");
    const k = await waitFor(() => keys(sec));
    expect(k.getByRole("button", { name: "今天" })).toBeDisabled();
  });

  it("表: an arc under the pointer lights its task and shows the session; the ring shows the time and the count", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-dl": [600, 510] });
    serve();
    page();
    const sec = await viewOf("大圆表盘");
    const dl = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-dl")!);
    await waitFor(() => expect(cv.draws(dl)).toBeGreaterThan(0));
    // 表 face: centre (300, 255), 3px a unit; 09:30 on lane 0 (r 28)
    const at = (h: number, r: number) => { const a = (h / 24) * Math.PI * 2; return { clientX: 100 + 300 + Math.sin(a) * r * 3, clientY: 50 + 255 - Math.cos(a) * r * 3 }; };
    const n = cv.draws(dl);
    fireEvent.pointerMove(dl, at(9.5, 28));
    expect(getHoverTask()).toBe("T1");
    expect(tip().querySelector(".m")!.textContent).toBe("09:00–11:00 · 当日 2h00m · 10 轮 · 108K token");
    expect(cv.draws(dl)).toBe(n + 1);                                    // the other tasks' arcs drop to .3
    expect(cv.calls(dl).some((c) => c.op === "stroke" && c.alpha === 0.3)).toBe(true);
    fireEvent.pointerMove(dl, at(10.75, 64));
    expect(getHoverTask()).toBeNull();
    expect(tip().textContent).toBe("10:45 并行 ×3");
    fireEvent.pointerLeave(dl);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("the hand: only on today's face, moved when the minute turns — on its overlay; the face is not redrawn", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    applyWorld("omote");
    const cv = canvases({ "sv-dl": [600, 510], "sv-hand": [600, 510] });
    serve();
    page();
    const sec = await viewOf("大圆表盘");
    const dl = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-dl")!);
    const hand = sec.querySelector<HTMLCanvasElement>("canvas.sv-hand")!;
    await waitFor(() => expect(cv.draws(hand)).toBeGreaterThan(0));
    expect(cv.calls(hand).map((c) => c.op)).toEqual(["setTransform", "clearRect"]);   // 9/21 is not today: no hand
    fireEvent.click(keys(sec).getByRole("button", { name: "今天" }));
    expect(cv.calls(hand).find((c) => c.op === "fillText")!.args[0]).toBe("14:20");
    const face = cv.draws(dl), hands = cv.draws(hand);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(cv.draws(hand)).toBe(hands + 1);
    expect(cv.calls(hand).find((c) => c.op === "fillText")!.args[0]).toBe("14:21");
    expect(cv.draws(dl)).toBe(face);
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toContain("|此刻 14:21"));
  });

  it("nothing in the range: one dim line; one day still has its dial", async () => {
    stServer();
    const { unmount } = page();
    let sec = await viewOf("大圆表盘");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
    unmount();
    oneDay();
    page();
    sec = await viewOf("大圆表盘");
    await waitFor(() => expect(sec.querySelector("canvas.sv-dl")).not.toBeNull());
  });
});
