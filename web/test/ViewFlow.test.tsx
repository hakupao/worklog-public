import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { STRINGS } from "../src/i18n/strings";
import { EChart } from "../src/pages/stats/EChart";
import { J } from "../src/predict/fixtures";
import { __resetHoverForTests, getHoverTask, setHoverTask } from "../src/ui/hover";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { VIZ, VIZ_TASKS } from "./viz-fixture";
import { viewOf } from "./view-canvas";

/** The real ECharts never loads in jsdom: each init records its box, the options set, its handlers and actions. */
const ec = vi.hoisted(() => {
  type Fake = { el: HTMLElement; set: unknown[]; handlers: Map<string, (e: unknown) => void>; actions: unknown[] };
  const made: Fake[] = [];
  const init = vi.fn((el: HTMLElement) => {
    const r: Fake = { el, set: [], handlers: new Map(), actions: [] };
    made.push(r);
    return {
      setOption: (o: unknown) => r.set.push(o), dispose() {}, isDisposed: () => false, resize() {},
      on: (n: string, h: (e: unknown) => void) => r.handlers.set(n, h), off: (n: string) => r.handlers.delete(n),
      dispatchAction: (a: unknown) => r.actions.push(a),
    };
  });
  return { made, init };
});
vi.mock("../src/pages/stats/viz/echarts", () => ({ init: ec.init }));

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (hash = "#/v2/stats", lang?: Lang) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><StatsPage /></V2TestProvider>);
};
/** The fixture under the page's range (default 近 4 周 = 9/5–10/2: X, T3 Sunday 9/20 20:00–21:00, is inside, so the
 *  range's wall clock is 450 + 60 = 510). */
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
const chartIn = (sec: Element) => [...ec.made].reverse().find((m) => sec.contains(m.el));
const optionIn = (sec: Element) => { const r = chartIn(sec); return r?.set[r.set.length - 1] as Record<string, any> | undefined; };
const summary = (sec: Element) => sec.querySelector(".v2-sr")!.textContent;

beforeEach(() => { ec.made.length = 0; ec.init.mockClear(); __resetHoverForTests(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("sankey — 流向", () => {
  it("里: the largest agent's share as the key figure (Claude Code 435 of 510), every layer in the summary, the task layer the by-task split", async () => {
    serve();
    page();
    const sec = await viewOf("流向");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toContain("|Claude Code 85%"));
    expect(summary(sec)).toBe("墙钟 8.5h：机器 macmini 8.1h、win11 0.4h；agent Claude Code 7.3h、Codex 1.3h；案件 T2 3.3h、T1 2.3h、未关联 2h、T3 1h");
    await waitFor(() => expect(optionIn(sec)).toBeDefined());
    const s = optionIn(sec)!.series[0];
    expect(s.links.filter((l: { source: string }) => l.source.startsWith("a:")).reduce((a: number, l: { value: number }) => a + l.value, 0)).toBe(510);
    expect(s.label.formatter({ name: "t:" })).toBe("未关联");
  });

  it("linked hover: hovering a task node writes the page's hover task; the page's hover highlights that task's node", async () => {
    serve();
    page();
    const sec = await viewOf("流向");
    await waitFor(() => expect(chartIn(sec)?.handlers.has("mouseover")).toBe(true));
    const c = chartIn(sec)!, s = optionIn(sec)!.series[0];
    act(() => c.handlers.get("mouseover")!({ data: s.data.find((n: { task?: string }) => n.task === "T1") }));
    expect(getHoverTask()).toBe("T1");
    act(() => c.handlers.get("mouseout")!({}));
    expect(getHoverTask()).toBeNull();
    c.actions.length = 0;
    act(() => setHoverTask("T2"));
    const at = s.data.findIndex((n: { task?: string }) => n.task === "T2");
    expect(c.actions).toContainEqual({ type: "highlight", seriesIndex: 0, dataIndex: [at] });
  });
});

describe("EChart — keeps the user's interaction while the data holds", () => {
  const data = (v: number) => () => ({ series: [{ type: "sankey", data: [{ name: "t:T1", task: "T1", value: v }], label: { formatter: (p: { name: string }) => p.name } }] });
  const chart = (option: () => Record<string, unknown>) => <V2TestProvider><EChart option={option} height={200} label="x" onHoverTask /></V2TestProvider>;
  it("a new option function with the same content (a refetch deriving the same data) sets nothing; changed content sets it again", async () => {
    const r = render(chart(data(1)));
    await waitFor(() => expect(ec.made[0]?.set.length).toBeGreaterThan(0));
    await act(async () => { await new Promise((f) => setTimeout(f, 20)); });       // the pixel font's re-set, if any
    const n = ec.made[0].set.length;
    r.rerender(chart(data(1)));
    r.rerender(chart(data(1)));
    expect(ec.made[0].set.length).toBe(n);
    r.rerender(chart(data(2)));
    expect(ec.made[0].set.length).toBe(n + 1);
    expect((ec.made[0].set[n] as any).series[0].data[0].value).toBe(2);
  });
  it("mouseout clears only a hover this chart wrote: leaving a machine node keeps another view's task", async () => {
    render(chart(data(1)));
    await waitFor(() => expect(ec.made[0]?.handlers.has("mouseout")).toBe(true));
    const c = ec.made[0];
    act(() => setHoverTask("T2"));
    act(() => c.handlers.get("mouseover")!({ data: { name: "m:macmini" } }));
    act(() => c.handlers.get("mouseout")!({}));
    expect(getHoverTask()).toBe("T2");
    act(() => c.handlers.get("mouseover")!({ data: { name: "t:T1", task: "T1" } }));
    expect(getHoverTask()).toBe("T1");
    act(() => c.handlers.get("mouseout")!({}));
    expect(getHoverTask()).toBeNull();
  });
});

describe("graph — 并行关系网", () => {
  it("里: the most parallel pair as the key figure, pairs in the summary; nodes seeded on a circle, one edge T1 + T2 90", async () => {
    serve();
    page();
    const sec = await viewOf("并行关系网");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toContain("|最常并行 T1 + T2"));
    expect(summary(sec)).toBe("3 个案件，1 对同时开过：T1 + T2 1.5h");
    await waitFor(() => expect(optionIn(sec)).toBeDefined());
    const s = optionIn(sec)!.series[0];
    expect(s.data.map((n: { task: string; value: number }) => [n.task, n.value])).toEqual([["T1", 135], ["T2", 195], ["T3", 60]]);
    expect(s.links.map((l: { source: string; target: string; value: number }) => [l.source, l.target, l.value])).toEqual([["T1", "T2", 90]]);
    expect(s.data[0]).toMatchObject({ x: 200, y: 0 });
  });

  it("only tasks that never overlap: the key figure says so", async () => {
    stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to }, sessions: VIZ.sessions.filter((x) => ["A", "X"].includes(x.id)) }), tasks: VIZ_TASKS });
    page();
    const sec = await viewOf("并行关系网");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toContain("|没有同时开着的案件"));
    expect(summary(sec)).toBe("2 个案件，0 对同时开过：没有同时开着的案件");
  });
});

describe("parallel — 会话平行坐标", () => {
  it("里: the session count as the key figure; six axes, one line per session", async () => {
    serve();
    page();
    const sec = await viewOf("会话平行坐标");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toContain("|7 个会话"));
    expect(summary(sec)).toBe("7 个会话，每条线一个会话，6 个轴：开始、时长、轮数、文件、token、费用；在轴上拖动可筛选");
    await waitFor(() => expect(optionIn(sec)).toBeDefined());
    const o = optionIn(sec)!;
    expect(o.parallelAxis).toHaveLength(6);
    expect(o.series.reduce((a: number, s: { data: unknown[] }) => a + s.data.length, 0)).toBe(7);
  });

  it("表 with the default hide (stats.cost hidden): the cost axis is gone (five), no amount in the view", async () => {
    applyWorld("omote");
    serve();
    page();
    const sec = await viewOf("会话平行坐标");
    await waitFor(() => expect(optionIn(sec)).toBeDefined());
    expect(optionIn(sec)!.parallelAxis).toHaveLength(5);
    expect(summary(sec)).toBe("7 个会话，每条线一个会话，5 个轴：开始、时长、轮数、文件、token；在轴上拖动可筛选");
    // the description line names no cost axis and no axis count, in any language
    expect(ink(sec.querySelector(".sv-h")!)).toContain("每条线 = 一个会话");
    for (const l of ["zh", "ja", "en"] as const) expect(STRINGS["sv.parallel.desc"][l]).not.toMatch(/费用|費用|[Cc]ost|六|6|six/);
    expect(sec.textContent).not.toContain("$");
    for (const name of ["流向", "并行关系网"]) expect(screen.getByRole("region", { name }).textContent).not.toContain("$");
  });

  it("en: the key figure and summary in English", async () => {
    serve();
    page("#/v2/stats", "en");
    const sec = await viewOf("Session parallel coordinates");
    expect(summary(sec)).toBe("7 sessions, one line each, on 6 axes: Start, Length, Turns, Files, Tokens, Cost; drag along an axis to filter");
  });
});

describe("no sessions in the range", () => {
  it("all three: one dim line, no chart", async () => {
    stServer();
    page();
    for (const name of ["流向", "并行关系网", "会话平行坐标"]) {
      const sec = await viewOf(name);
      await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
      expect(sec.querySelector(".sv-ec")).toBeNull();
    }
  });
});
