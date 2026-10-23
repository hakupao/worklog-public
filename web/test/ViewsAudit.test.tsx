import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatsPage } from "../src/pages/StatsPage";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { STATS_VIEWS, type Prefs, type StatsView } from "../src/prefs/types";
import { J } from "../src/predict/fixtures";
import { __resetHoverForTests, getHoverTask, setHoverTask } from "../src/ui/hover";
import { Shell } from "../src/ui/Shell";
import { applyWorld } from "../src/world/store";
import { rec, type Call } from "./canvas-rec";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { VIZ, VIZ_TASKS } from "./viz-fixture";

// Page-wide audits over every 统计 view at once (Task 12): the linked task hover, and 表's amount rule.

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

/** Every canvas on the page (not the LED text twins, not off-screen sprites) gets a 600px-wide box at (100, 50), as
 *  tall as its style says, and a recording context; `draws(el)` counts its full draws. */
function stubCanvases() {
  const all = new Map<HTMLCanvasElement, Call[][]>();
  const ours = (el: HTMLCanvasElement) => el.isConnected && !el.hasAttribute("data-tier");
  const box = HTMLCanvasElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLCanvasElement) {
    if (!ours(this)) return box.call(this);
    const h = parseFloat(this.style.height) || 200;
    return { width: 600, height: h, left: 100, top: 50, right: 700, bottom: 50 + h, x: 100, y: 50 } as DOMRect;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    if (!ours(this)) return null;
    const r = rec();
    all.set(this, [...(all.get(this) ?? []), r.calls]);
    return r.ctx;
  } as never);
  return {
    draws: (el: Element) => all.get(el as HTMLCanvasElement)?.length ?? 0,
    texts: () => [...all.values()].flat(2).filter((c) => c.op === "fillText").map((c) => String(c.args[0])),
  };
}

const page = (prefs: Partial<Prefs> = {}) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider prefs={prefs}><Shell page="stats" titleKey="nav.stats"><StatsPage /></Shell></V2TestProvider>);
};
/** 表 with nothing hidden: every view on the page (the default hides stats.cost / stats.review). */
const SHOW_ALL: Partial<Prefs> = { omote: { ...DEFAULT_PREFS.omote, hide: [] } };
/** The fixture under the default range (近 4 周 = 9/5–10/2; X / T3 joins in). */
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
const sec = (c: HTMLElement, id: StatsView) => c.querySelector<HTMLElement>(`section.sv[data-view="${id}"]`);
const chartIn = (s: Element) => [...ec.made].reverse().find((m) => s.contains(m.el));
const optionIn = (s: Element) => { const r = chartIn(s); return r?.set[r.set.length - 1] as Record<string, any> | undefined; };

/** Views that draw tasks, by how: on a canvas (the main one), in an ECharts chart, as [data-task] rows / cells. */
const CANVAS: Partial<Record<StatsView, string>> = {
  river: "canvas.sv-ln", dial: "canvas.sv-dl", stream: "canvas.sv-stream", stars: "canvas.sv-stars",
  density: "canvas.sv-den", plans: "canvas.sv-pl", sunburst: "canvas.sv-sun",
};
const ECHART: StatsView[] = ["sankey", "graph", "parallel"];
const DOM: Partial<Record<StatsView, string>> = { headlines: ".hc[data-task]", time: "[data-task]", share: "[data-task]", ai: "[data-task]" };
/** Views with no task in them (per day / hour / weekday / machine figures, the dashboard's rhythm, the review text). */
const NO_TASK: StatsView[] = ["waterfall", "calendar", "hours24", "weekday", "fingerprint", "terrain", "contour", "compute", "rhythm", "review"];

/** Moves over the canvas on a grid until something writes the page's hover task; that task, or null. */
function scan(el: HTMLElement, onEach?: () => void, [sx, sy] = [5, 4]): string | null {
  const r = el.getBoundingClientRect();
  for (let y = 2; y < r.height; y += sy) for (let x = 2; x < r.width; x += sx) {
    fireEvent.pointerMove(el, { clientX: r.left + x, clientY: r.top + y });
    onEach?.();
    const k = getHoverTask();
    if (k !== null && !onEach) return k;
  }
  return null;
}

/** The first task the pointer finds on the canvas: a coarse pass, then the fine grid where the coarse one finds none. */
const find = (el: HTMLElement) => scan(el, undefined, [20, 12]) ?? scan(el);

beforeEach(() => { ec.made.length = 0; ec.init.mockClear(); __resetHoverForTests(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); __resetHoverForTests(); window.location.hash = ""; });

/** An IntersectionObserver under the test's control: a view band (section.sv) is on screen as soon as it is observed,
 *  so every view opens; any other element starts off screen until `show(el, on)` reports it. */
function screenIO() {
  const cbs = new Map<Element, IntersectionObserverCallback[]>();
  class IO {
    cb: IntersectionObserverCallback;
    els: Element[] = [];
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
    observe(el: Element) {
      if (el.matches("section.sv")) { this.cb([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); return; }
      this.els.push(el);
      cbs.set(el, [...(cbs.get(el) ?? []), this.cb]);
      this.cb([{ target: el, isIntersecting: false } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() { for (const el of this.els) cbs.set(el, (cbs.get(el) ?? []).filter((f) => f !== this.cb)); }
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", IO);
  return {
    show: (el: Element, on: boolean) => act(() => { for (const f of cbs.get(el) ?? []) f([{ target: el, isIntersecting: on } as IntersectionObserverEntry], {} as IntersectionObserver); }),
  };
}

// Each test that renders all 24 views; on a loaded machine or a 2-core CI runner one takes over the 20 s default.
const HEAVY = 60_000;

describe("linked hover off screen (R1)", () => {
  it("a canvas view off screen does not redraw when the hover task changes; it catches up once back on screen", async () => {
    const cv = stubCanvases(), io = screenIO();
    serve();
    const { container: c } = page();
    await waitFor(() => { for (const [id, s] of Object.entries(CANVAS)) expect([id, cv.draws(sec(c, id as StatsView)!.querySelector(s)!) > 0]).toEqual([id, true]); });
    await waitFor(() => expect(c.querySelector(".sv-pend")).toBeNull());
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });   // the page settled (tasks, fonts)
    const el = (id: string) => sec(c, id as StatsView)!.querySelector(CANVAS[id as StatsView]!)!;
    const draws = () => Object.keys(CANVAS).map((id) => [id, cv.draws(el(id))] as const);
    const at = draws();
    act(() => setHoverTask("T1"));
    expect(draws()).toEqual(at);                                    // all off screen: nothing redrawn
    for (const id of Object.keys(CANVAS)) io.show(el(id), true);
    expect(draws()).toEqual(at.map(([id, n]) => [id, n + 1]));       // back on screen: one redraw each, with T1
    act(() => setHoverTask("T2"));
    expect(draws()).toEqual(at.map(([id, n]) => [id, n + 2]));       // on screen: follows
    io.show(el("stream"), false);
    act(() => setHoverTask(null));
    expect(draws()).toEqual(at.map(([id, n]) => [id, n + (id === "stream" ? 2 : 3)]));
    io.show(el("stream"), true);
    io.show(el("stream"), true);                                    // a second report with nothing changed: no redraw
    expect(cv.draws(el("stream"))).toBe(at.find(([id]) => id === "stream")![1] + 3);
  }, HEAVY);
});

it("every view is classified: a new view must say how it takes part in the linked hover", () => {
  const classified = [...Object.keys(CANVAS), ...ECHART, ...Object.keys(DOM), ...NO_TASK];
  expect([...classified].sort()).toEqual([...STATS_VIEWS].sort());
  expect(new Set(classified).size).toBe(STATS_VIEWS.length);
});

// The linked hover audit, split so each test stays a few seconds (F6): follows, then writes from the canvases, then
// writes from the charts and rows. Each renders the page in the world with every view shown.
describe.each(["ura", "omote"] as const)("linked hover across every view (%s)", (world) => {
  /** The page in `world` with every view on it, each canvas view drawn and each chart listening. */
  async function loaded() {
    applyWorld(world);
    const cv = stubCanvases();
    serve();
    const { container: c } = page(SHOW_ALL);
    await waitFor(() => expect(STATS_VIEWS.every((id) => sec(c, id))).toBe(true));
    await waitFor(() => { for (const [id, s] of Object.entries(CANVAS)) expect([id, cv.draws(sec(c, id as StatsView)!.querySelector(s)!) > 0]).toEqual([id, true]); });
    await waitFor(() => { for (const id of ECHART) expect(chartIn(sec(c, id)!)?.handlers.has("mouseover")).toBe(true); });
    return { c, cv };
  }

  it("each task-bearing view follows the page's hover task", async () => {
    const { c, cv } = await loaded();
    // T1 from the store redraws every canvas view, highlights T1's items in every chart, lights T1's rows
    const before = Object.entries(CANVAS).map(([id, s]) => cv.draws(sec(c, id as StatsView)!.querySelector(s)!));
    for (const id of ECHART) chartIn(sec(c, id)!)!.actions.length = 0;
    act(() => setHoverTask("T1"));
    Object.entries(CANVAS).forEach(([id, s], i) => expect([id, cv.draws(sec(c, id as StatsView)!.querySelector(s)!)]).toEqual([id, before[i] + 1]));
    for (const id of ECHART) {
      const ser = optionIn(sec(c, id)!)!.series as { data: { task?: string | null }[] }[];
      const want = ser.flatMap((x, seriesIndex) => {
        const dataIndex = x.data.flatMap((d, i) => (d?.task === "T1" ? [i] : []));
        return dataIndex.length ? [{ type: "highlight", seriesIndex, dataIndex }] : [];
      });
      expect([id, want.length > 0]).toEqual([id, true]);
      for (const a of want) expect(chartIn(sec(c, id)!)!.actions).toContainEqual(a);
    }
    for (const id of ["headlines", "stream"] as StatsView[]) expect([id, sec(c, id)!.querySelectorAll('[data-task="T1"].hl').length > 0]).toEqual([id, true]);
    // the dashboard blocks carry the dashboard's tasks: each lights its own first row's task
    for (const id of ["time", "share", "ai"] as StatsView[]) {
      const k = sec(c, id)!.querySelector<HTMLElement>("[data-task]")!.dataset.task!;
      act(() => setHoverTask(k));
      expect([id, sec(c, id)!.querySelector(`[data-task="${k}"]`)!.classList.contains("hl")]).toEqual([id, true]);
    }
  }, HEAVY);

  it("hovering a task on each canvas view writes the page's hover task; leaving clears it", async () => {
    const { c } = await loaded();
    for (const [id, s] of Object.entries(CANVAS)) {
      const el = sec(c, id as StatsView)!.querySelector<HTMLElement>(s)!;
      expect([id, find(el)]).toEqual([id, expect.any(String)]);
      fireEvent.pointerLeave(el);
      expect([id, getHoverTask()]).toEqual([id, null]);
    }
  }, HEAVY);

  it("hovering a task in each chart and on each task row writes the page's hover task", async () => {
    const { c } = await loaded();
    for (const id of ECHART) {
      const ch = chartIn(sec(c, id)!)!, ser = optionIn(sec(c, id)!)!.series as { data: { task?: string | null }[] }[];
      const item = ser.flatMap((x) => x.data).find((d) => d?.task === "T2");
      act(() => ch.handlers.get("mouseover")!({ data: item }));
      expect([id, getHoverTask()]).toEqual([id, "T2"]);
      act(() => ch.handlers.get("mouseout")!({}));
      expect([id, getHoverTask()]).toEqual([id, null]);
    }
    // stream also has a [data-task] legend
    const domSel: [StatsView, string][] = [...(Object.entries(DOM) as [StatsView, string][]), ["stream", ".sv-leg [data-task]"]];
    for (const [id, s] of domSel) {
      const el = sec(c, id)!.querySelector<HTMLElement>(s)!;
      fireEvent.pointerOver(el);
      expect([id, getHoverTask()]).toEqual([id, el.dataset.task]);
      act(() => setHoverTask(null));
    }
  }, HEAVY);
});

describe("表 with amounts hidden (default hide): no amount anywhere", () => {
  const AMOUNT = /\$|¥|￥|USD/;
  /** Every string in an ECharts option, and what its formatters return for the chart's own items and axis values. */
  function optionTexts(o: Record<string, any>): string[] {
    const out: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && !(v instanceof HTMLElement)) Object.values(v).forEach(walk);
    };
    walk(o);
    const call = (f: unknown, ...a: unknown[]) => { if (typeof f === "function") { const r = f(...a); if (typeof r === "string") out.push(r); } };
    for (const s of (o.series ?? []) as Record<string, any>[]) {
      for (const d of [...(s.data ?? []), ...(s.links ?? [])]) {
        const p = { data: d, name: d?.name ?? "", value: d?.value ?? (typeof d === "number" ? d : 0), dataType: d?.source ? "edge" : "node", seriesName: s.name, dataIndex: 0 };
        call(o.tooltip?.formatter, o.tooltip?.trigger === "axis" ? [p] : p);   // an axis tooltip gets the items at that axis value
        call(s.label?.formatter, p);
      }
    }
    for (const ax of [...(o.parallelAxis ?? []), ...[o.angleAxis, o.radiusAxis, o.xAxis, o.yAxis].flat().filter(Boolean)])
      for (const v of [0, 0.5, 1, 2, 5, 10, 24]) call(ax.axisLabel?.formatter, v);
    return out;
  }

  /** The tooltip sweep in three parts by view (F6: one sweep over the whole page ran past 10s), each over the page
   *  afresh; together they cover every view shown. */
  const PARTS: StatsView[][] = [
    ["headlines", "waterfall", "river", "dial", "stream"],
    ["stars", "fingerprint", "hours24", "weekday", "calendar", "terrain"],
    ["contour", "density", "sunburst", "sankey", "graph", "parallel", "plans", "time", "share", "rhythm"],
  ];
  it("the sweep parts cover every view 表 shows by default", () => {
    expect(PARTS.flat().sort()).toEqual(STATS_VIEWS.filter((id) => !["compute", "ai", "review"].includes(id)).sort());
  });

  it.each(PARTS.map((part, i) => [i + 1, part] as const))(
    "part %i: text, aria-labels, titles, canvas text, tooltips and chart options carry no amount; compute / ai / review are not rendered",
    async (_, part) => {
      applyWorld("omote");
      const cv = stubCanvases();
      serve();
      const { container: c } = page();
      const shown = STATS_VIEWS.filter((id) => !["compute", "ai", "review"].includes(id));
      await waitFor(() => expect(shown.every((id) => sec(c, id))).toBe(true));
      await waitFor(() => expect(c.querySelector(".sv-pend")).toBeNull());      // every view's data in (R4: wait lines first)
      for (const id of ["compute", "ai", "review"] as StatsView[]) expect([id, sec(c, id)]).toEqual([id, null]);
      expect(sec(c, "headlines")!.querySelectorAll(".hc")).toHaveLength(9);
      const charts: StatsView[] = [...ECHART, "hours24", "weekday"];          // every ECharts view's option (顺带: hours24 / weekday too)
      await waitFor(() => { for (const id of charts) expect(optionIn(sec(c, id)!)).toBeDefined(); });
      await waitFor(() => expect(sec(c, "stars")!.querySelector("canvas.sv-stars")).not.toBeNull());

      // tooltips: sweep every canvas of this part's views, gathering each tip that shows (a list bar, canvas.db, has
      // no pointer handler: no tip to find)
      const tips = new Set<string>();
      const tipNow = () => { const t = document.querySelector('[role="tooltip"]'); if (t?.textContent) tips.add(t.textContent); };
      for (const id of part)
        for (const el of sec(c, id)!.querySelectorAll<HTMLElement>("canvas:not([data-tier]):not(.db)")) if (cv.draws(el)) scan(el, tipNow, [40, 16]);
      expect(tips.size).toBeGreaterThan(2);

      const texts = [
        c.textContent ?? "",
        ...[...c.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")!),
        ...[...c.querySelectorAll("[title]")].map((e) => e.getAttribute("title")!),
        ...cv.texts(), ...tips,
        ...charts.flatMap((id) => optionTexts(optionIn(sec(c, id)!)!)),
      ];
      expect(texts.filter((s) => AMOUNT.test(s))).toEqual([]);
    },
    HEAVY,
  );
});
