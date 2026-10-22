import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { VIZ, VIZ_TASKS } from "./viz-fixture";
import { viewOf } from "./view-canvas";

/** The real ECharts never loads in jsdom: each init records the box it was given and the options set on it. */
const ec = vi.hoisted(() => {
  const made: { el: HTMLElement; set: unknown[] }[] = [];
  const init = vi.fn((el: HTMLElement) => {
    const r = { el, set: [] as unknown[] };
    made.push(r);
    return { setOption: (o: unknown) => r.set.push(o), dispose() {}, isDisposed: () => false, resize() {}, on() {}, off() {}, dispatchAction() {} };
  });
  return { made, init };
});
vi.mock("../src/pages/stats/viz/echarts", () => ({ init: ec.init }));

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (hash = "#/v2/stats", lang?: Lang) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><StatsPage /></V2TestProvider>);
};
/** The fixture's sessions under whatever range the page asks for (default 近 4 周 = 9/5–10/2: four of each weekday;
 *  X, Sunday 9/20 20:00–21:00, is inside this window, so the range totals 510 minutes). */
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
/** The last option set on the chart inside `sec`. */
const optionIn = (sec: Element) => {
  const r = [...ec.made].reverse().find((m) => sec.contains(m.el));
  return r?.set[r.set.length - 1] as Record<string, any> | undefined;
};

beforeEach(() => { ec.made.length = 0; ec.init.mockClear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("hours24 — 24 小时分布", () => {
  it("里: busiest hour as the key figure (the 00:00 tie goes first), a summary, the chart labelled and fed the clock-hour wall clock", async () => {
    serve();
    page();
    const sec = await viewOf("24 小时分布");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toContain("|最忙 00:00"));
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("最忙的小时 00:00，墙钟 1h；全区间合计 8.5h");
    expect(screen.getByRole("img", { name: "24 小时分布" })).toBeTruthy();
    await waitFor(() => expect(optionIn(sec)).toBeDefined());
    const o = optionIn(sec)!;
    expect(o.animation).toBe(false);
    expect(o.series[0].data.map((d: { value: number }) => d.value)).toEqual([1, 0.5, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0.5, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.5]);
  });

  it("en: the key figure and summary in English", async () => {
    serve();
    page("#/v2/stats", "en");
    const sec = await viewOf("24-hour profile");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("Busiest hour 00:00, 1h wall clock; 8.5h over the range");
  });

  it("表: the chart is rebuilt on the 表 theme with ink bars; no amount anywhere in the view", async () => {
    serve();
    page();
    const sec = await viewOf("24 小时分布");
    await waitFor(() => expect(optionIn(sec)).toBeDefined());
    act(() => applyWorld("omote"));
    await waitFor(() => expect(optionIn(sec)!.series[0].data[9].itemStyle).toEqual({ color: "#0f1c2e" }));
    expect(sec.textContent).not.toContain("$");
  });

  it("no wall clock in the range: one dim line, no chart", async () => {
    stServer();
    page();
    const sec = await viewOf("24 小时分布");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
    expect(sec.querySelector(".sv-ec")).toBeNull();
  });
});

describe("weekday — 星期均值", () => {
  it("近 4 周: Monday's 6h over four Mondays = 1.5h a day; the busiest weekday as the key figure; every weekday in the summary", async () => {
    serve();
    page();
    const sec = await viewOf("星期均值");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toContain("|最忙 周一"));
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("每天平均墙钟：一 1.5h、二 0.4h、三 0h、四 0h、五 0h、六 0h、日 0.3h");
    await waitFor(() => expect(optionIn(sec)).toBeDefined());
    const o = optionIn(sec)!;
    expect(o.yAxis.data).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
    expect(o.series[1].data.map((d: { value: number }) => d.value)).toEqual([1.5, 0.4, 0, 0, 0, 0, 0.3]);
  });

  it("fewer than seven days (one day, 9/21, with work in it): one dim line, no chart — hours24 still draws", async () => {
    serve();
    page("#/v2/stats?range=day&back=11");
    const sec = await viewOf("星期均值");
    await waitFor(() => expect(sec.querySelector(".sv-thin")).not.toBeNull());
    expect(sec.querySelector(".sv-ec")).toBeNull();
    expect(screen.getByRole("region", { name: "24 小时分布" }).querySelector(".sv-ec")).not.toBeNull();
  });
});
