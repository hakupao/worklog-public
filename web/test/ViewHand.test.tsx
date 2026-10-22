import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import type { Lang } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { rec, type Call } from "./canvas-rec";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { VIZ, VIZ_TASKS } from "./viz-fixture";
import { viewOf } from "./view-canvas";

// the ECharts views on the same page never load the real chunk in jsdom
vi.mock("../src/pages/stats/viz/echarts", () => ({
  init: () => ({ setOption() {}, dispose() {}, isDisposed: () => false, resize() {}, on() {}, off() {}, dispatchAction() {} }),
}));

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (lang?: Lang) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider lang={lang}><StatsPage /></V2TestProvider>);
};
/** The fixture under the page's default range (近 4 周 = 9/5–10/2 on 10/2): X (Sunday 9/20 20:00–21:00) joins in,
 *  so 7 sessions, wall clock 510, summed 630; active 9/20–9/22 (3 / 28 days, one streak of 3). Work days (≥ 60 min):
 *  9/20 (starts 15h after 05:00, finishes 16h), 9/21 (4, 24), 9/22 (0, 8.5) → median start 09:00, finish 21:00. */
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
/** Whatever the page asks, answer for one day (9/21). */
const oneDay = () => stServer({ sessions: () => ({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-21" } }), tasks: VIZ_TASKS });
const cellText = (sec: Element, k: string) => ink(sec.querySelector(`.hc[data-cell="${k}"]`)!);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); window.location.hash = ""; });

describe("headlines — 洞察头条", () => {
  it("里: ten cells in order with their figures and lines; the session count as the key figure", async () => {
    serve();
    page();
    const sec = await viewOf("洞察头条");
    await waitFor(() => expect(sec.querySelectorAll(".hc")).toHaveLength(10));
    expect([...sec.querySelectorAll(".hc")].map((c) => c.getAttribute("data-cell"))).toEqual(["wall", "peak", "dense", "long", "start", "end", "wd", "cost", "tok", "days"]);
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|7 个会话");
    expect(cellText(sec, "wall")).toBe("墙钟时长|8.5h|会话累计 10.5h|并行多出 24%");
    expect(cellText(sec, "peak")).toBe("最高并行|×3|9/21 10:30|同时开着 3 个");
    expect(cellText(sec, "dense")).toBe("最满的一天|8h|9/21 会话累计|墙钟只有 6h");
    expect(cellText(sec, "start")).toBe("开工中位|09:00|3 天的中位|满 1 小时的天");
    expect(cellText(sec, "end")).toBe("收工中位|21:00|3 天的中位|5:00 前算前一天");
    expect(cellText(sec, "wd")).toBe("最忙的星期|周一|日均墙钟 1.5h|最闲 周三 0h");
    expect(cellText(sec, "cost")).toBe("最贵会话|$6.00|9/21 215K tok|未关联");
    expect(cellText(sec, "tok")).toBe("Token|416K|缓存读取 91.5%|输出只占 1.83%");
    expect(cellText(sec, "days")).toBe("活跃天数|3/28|最长连续 3 天|9/20–9/22");
  });

  it("a cell naming a task carries its data-task (the page's hover lights it); the unlinked costliest session none", async () => {
    serve();
    page();
    const sec = await viewOf("洞察头条");
    await waitFor(() => expect(sec.querySelector('.hc[data-cell="long"]')).not.toBeNull());
    const long = sec.querySelector('.hc[data-cell="long"]')!;
    expect(long.getAttribute("data-task")).toBe("T1");
    expect(ink(long)).toBe("最长单会话|2h00m|9/21 09:00 开始|案件 一");       // B3b: the code is the inline S badge
    expect(sec.querySelector('.hc[data-cell="cost"]')!.hasAttribute("data-task")).toBe(false);
    const hb = long.querySelector<HTMLElement>('.hl-task > .tbadge[data-task="T1"]')!;
    expect(hb.style.height).toBe("16px");
    expect(hb.nextElementSibling!.getAttribute("data-task")).toBe("T1");   // title Led keeps the hover
    expect(sec.querySelector('.hc[data-cell="cost"] .tbadge')).toBeNull();                       // 未关联: text, no badge
  });

  it("a task without a title keeps its code in the line (the badge alone would leave an empty Led)", async () => {
    stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: [] });
    page();
    const sec = await viewOf("洞察头条");
    await waitFor(() => expect(sec.querySelector('.hc[data-cell="long"]')).not.toBeNull());
    const long = sec.querySelector('.hc[data-cell="long"]')!;
    expect(ink(long)).toBe("最长单会话|2h00m|9/21 09:00 开始|T1");
  });

  it("表 with 统计 · AI 费用 hidden (the default): nine cells, no amount anywhere in the view", async () => {
    applyWorld("omote");
    serve();
    page();
    const sec = await viewOf("洞察头条");
    await waitFor(() => expect(sec.querySelectorAll(".hc")).toHaveLength(9));
    expect(sec.querySelector('.hc[data-cell="cost"]')).toBeNull();
    expect(sec.textContent).not.toContain("$");
    expect(sec.querySelector(".v2-sr")!.textContent).not.toContain("最贵会话");
  });

  it("表 with the cost module shown: ten again", async () => {
    applyWorld("omote");
    serve();
    window.location.hash = "#/v2/stats";
    render(<V2TestProvider prefs={{ omote: { ...DEFAULT_PREFS.omote, hide: [] } }}><StatsPage /></V2TestProvider>);
    const sec = await viewOf("洞察头条");
    await waitFor(() => expect(sec.querySelectorAll(".hc")).toHaveLength(10));
  });

  it("en: the summary reads every cell", async () => {
    serve();
    page("en");
    const sec = await viewOf("Headlines");
    await waitFor(() => expect(sec.querySelector(".v2-sr")).not.toBeNull());
    const sr = sec.querySelector(".v2-sr")!.textContent!;
    expect(sr.startsWith("WALL CLOCK 8.5h (summed 10.5h; parallel +24%); PEAK PARALLEL ×3 (9/21 10:30; 3 open at once)")).toBe(true);
    expect(sr).toContain("COSTLIEST SESSION $6.00 (9/21 215K tok; Unlinked)");
    expect(sr.endsWith("ACTIVE DAYS 3/28 (streak 3 d; 9/20–9/22)")).toBe(true);
  });

  it("no wall clock in the range: one dim line", async () => {
    stServer();
    page();
    const sec = await viewOf("洞察头条");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
    expect(sec.querySelector(".hc")).toBeNull();
  });

  it("one day still has its headlines", async () => {
    oneDay();
    page();
    const sec = await viewOf("洞察头条");
    await waitFor(() => expect(sec.querySelectorAll(".hc")).toHaveLength(10));
    expect(cellText(sec, "days")).toBe("活跃天数|1/1|最长连续 1 天|9/21–9/21");
  });
});

describe("waterfall / calendar", () => {
  it("作息瀑布: median start / finish as the key figure, a summary, one canvas (aria-hidden) sized to the 28 rows", async () => {
    serve();
    page();
    const sec = await viewOf("作息瀑布");
    await waitFor(() => expect(sec.querySelector("canvas.sv-wf")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|开工 09:00 · 收工 21:00");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("28 天；墙钟 8.5h，会话累计 10.5h；中位开工 09:00、收工 21:00");
    const cv = sec.querySelector<HTMLCanvasElement>("canvas.sv-wf")!;
    expect(cv.getAttribute("aria-hidden")).toBe("true");
    expect(cv.style.height).toBe(`${(13 + 28 * 3 + 4) * 3}px`);
  });

  it("日历热力: active days as the key figure; the summary names the weeks the range cuts", async () => {
    serve();
    page();
    const sec = await viewOf("日历热力");
    await waitFor(() => expect(sec.querySelector("canvas.sv-cal")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|活跃 3/28 天");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("5 周；活跃 3/28 天，最长连续 3 天；最长的一天 9/21，墙钟 6h；被区间截断的周 W36、W40");
  });

  it("one day (今天): both are one dim line", async () => {
    oneDay();
    page();
    for (const name of ["作息瀑布", "日历热力"]) {
      const sec = await viewOf(name);
      await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
      expect(sec.querySelector("canvas.sv-wf, canvas.sv-cal")).toBeNull();
    }
  });

  it("en / 表: no amount in either view", async () => {
    applyWorld("omote");
    serve();
    page("en");
    for (const name of ["Day waterfall", "Calendar"]) {
      const sec = await viewOf(name);
      await waitFor(() => expect(sec.querySelector("canvas.sv-wf, canvas.sv-cal")).not.toBeNull());
      expect(sec.textContent).not.toContain("$");
    }
  });
});

describe("hover tips (表)", () => {
  // jsdom boxes are 0×0: the chart canvas gets a 306px box at (100, 50) and a recording context
  const boxes = (cls: string, w: number, h: number) => {
    const drawn = new Map<HTMLCanvasElement, Call[]>();
    const box = HTMLCanvasElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLCanvasElement) {
      return this.classList.contains(cls) ? ({ width: w, height: h, left: 100, top: 50, right: 100 + w, bottom: 50 + h, x: 100, y: 50 } as DOMRect) : box.call(this);
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      if (!this.classList.contains(cls)) return null;
      const r = rec(); drawn.set(this, r.calls); return r.ctx;
    } as never);
    return drawn;
  };
  const tip = () => screen.getByRole("tooltip");

  it("作息瀑布: the day row and the moment under the pointer — 9/21 (row 16) at 10:45, three open", async () => {
    applyWorld("omote");
    const drawn = boxes("sv-wf", 306, 303);
    serve();
    page();
    const sec = await viewOf("作息瀑布");
    const cv = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-wf")!);
    await waitFor(() => expect(drawn.get(cv)?.length).toBeGreaterThan(0));
    // rows from y 39, 9px each; the 24 hours over x 90–162 (3px an hour): 10:45 = 5.75h after 05:00
    fireEvent.pointerMove(cv, { clientX: 100 + 90 + 5.75 * 3, clientY: 50 + 39 + 16 * 9 + 4 });
    expect(tip().querySelector(".h")!.textContent).toBe("2026-09-21（一）");
    expect(tip().querySelector(".m")!.textContent).toBe("09:00–05:00 · 墙钟 6h · 累计 8h · ×3");
    expect(tip().querySelector(".s")!.textContent).toBe("5 个会话 · 10:45 并行 ×3");
    fireEvent.pointerMove(cv, { clientX: 100 + 90 + 2 * 3, clientY: 50 + 39 + 9 + 4 });   // 9/6 07:00, idle
    expect(tip().querySelector(".m")!.textContent).toBe("—");
    expect(tip().querySelector(".s")!.textContent).toBe("0 个会话 · 07:00 没有会话");
    fireEvent.pointerMove(cv, { clientX: 100 + 10, clientY: 50 + 10 });                    // above the rows
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("日历热力: the day under the pointer — 9/21 is week 4 (of 5, 42px each from x 90), Monday", async () => {
    applyWorld("omote");
    const drawn = boxes("sv-cal", 306, 354);
    serve();
    page();
    const sec = await viewOf("日历热力");
    const cv = await waitFor(() => sec.querySelector<HTMLCanvasElement>("canvas.sv-cal")!);
    await waitFor(() => expect(drawn.get(cv)?.length).toBeGreaterThan(0));
    fireEvent.pointerMove(cv, { clientX: 100 + 90 + 3 * 42 + 5, clientY: 50 + 42 + 5 });
    expect(tip().querySelector(".h")!.textContent).toBe("2026-09-21（一）");
    expect(tip().querySelector(".m")!.textContent).toBe("09:00–05:00 · 墙钟 6h · 累计 8h · ×3");
    expect(tip().querySelector(".s")!.textContent).toBe("5 个会话");
    fireEvent.pointerMove(cv, { clientX: 100 + 90 + 5, clientY: 50 + 42 + 5 });              // Monday 8/31: before the range
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { fireEvent.pointerLeave(cv); });
  });
});
