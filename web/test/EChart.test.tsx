import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EChart } from "../src/pages/stats/EChart";
import type { World } from "../src/prefs/types";
import { __resetHoverForTests, getHoverTask, setHoverTask } from "../src/ui/hover";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";

/** A fake ECharts instance per init call; the real module never loads in jsdom. */
const ec = vi.hoisted(() => {
  type Fake = { theme: unknown; el: HTMLElement; setOption: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>;
    dispatchAction: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; handlers: Map<string, (e: unknown) => void>;
    isDisposed: () => boolean; afterDispose: string[] };
  const made: Fake[] = [];
  const init = vi.fn((el: HTMLElement, theme: unknown) => {
    const handlers = new Map<string, (e: unknown) => void>();
    // like ECharts, a call on a disposed instance does nothing (ECharts logs "Instance … has been disposed"): recorded here
    let gone = false;
    const afterDispose: string[] = [];
    const live = <A extends unknown[]>(name: string, f: (...a: A) => unknown) => (...a: A) => (gone ? void afterDispose.push(name) : f(...a));
    const f: Fake = { theme, el, setOption: vi.fn(live("setOption", () => { if (!el.querySelector("canvas")) el.appendChild(document.createElement("canvas")); })),
      dispose: vi.fn(() => { gone = true; }), resize: vi.fn(live("resize", () => undefined)), dispatchAction: vi.fn(live("dispatchAction", () => undefined)),
      on: vi.fn(live("on", (n: string, h: (e: unknown) => void) => handlers.set(n, h))), off: vi.fn(live("off", (n: string) => handlers.delete(n))), handlers,
      isDisposed: () => gone, afterDispose };
    made.push(f);
    return f;
  });
  return { made, init };
});
vi.mock("../src/pages/stats/viz/echarts", () => ({ init: ec.init }));
const enter = vi.hoisted(() => vi.fn());
vi.mock("../src/ink/fx", async (orig) => ({ ...(await orig<typeof import("../src/ink/fx")>()), enter }));

const opt = (world: World, cost: boolean) => ({
  series: [{ type: "bar", data: [{ value: 1, task: "T1" }, { value: 2, task: "T2" }, { value: 3, task: "T1" }] }],
  title: { text: `${world} ${cost}` },
});
const mount = (o: { hover?: boolean; option?: typeof opt; prefs?: Parameters<typeof V2TestProvider>[0]["prefs"] } = {}) =>
  render(<V2TestProvider prefs={o.prefs}><EChart option={o.option ?? opt} height={220} label="24 小时分布" onHoverTask={o.hover} /></V2TestProvider>);
const last = () => ec.made[ec.made.length - 1];

beforeEach(() => { ec.made.length = 0; ec.init.mockClear(); enter.mockClear(); __resetHoverForTests(); });
afterEach(() => { vi.unstubAllGlobals(); applyWorld("ura"); });

describe("EChart", () => {
  it("a labelled image of the given height; loads the chunk, creates with the 里 theme, sets the option with notMerge and animation off", async () => {
    mount();
    const box = screen.getByRole("img", { name: "24 小时分布" });
    expect(box.style.height).toBe("220px");
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(1));
    expect(last().el).toBe(box);
    expect((last().theme as { textStyle: { fontFamily: string } }).textStyle.fontFamily).toContain("fp12");
    await waitFor(() => expect(last().setOption).toHaveBeenCalled());
    const [o, how] = last().setOption.mock.calls.at(-1)!;
    expect(o).toMatchObject({ animation: false, title: { text: "ura true" } });
    expect(how).toEqual({ notMerge: true });
  });

  it("a world switch disposes the chart and builds a new one on the 表 theme; the option sees 表 and the default hidden cost", async () => {
    mount();
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(1));
    const first = last();
    act(() => applyWorld("omote"));
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(2));
    expect(first.dispose).toHaveBeenCalled();
    expect((last().theme as { color: string[] }).color[0]).toBe("#0f1c2e");
    await waitFor(() => expect(last().setOption.mock.calls.at(-1)![0]).toMatchObject({ title: { text: "omote false" } }));
  });

  it("a world switch before the chunk has answered: only the new world's chart is built", async () => {
    mount();
    act(() => applyWorld("omote"));
    await waitFor(() => expect(ec.init).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(ec.init).toHaveBeenCalledTimes(1);
    expect((last().theme as { color: string[] }).color[0]).toBe("#0f1c2e");
  });

  it("entrance: 表 brings the chart's canvas in once, after the first paint; 里 does not (its box fades with the reveal); a later world switch does not", async () => {
    applyWorld("omote");
    mount();
    await waitFor(() => expect(enter).toHaveBeenCalledTimes(1));
    const [els] = enter.mock.calls[0] as [Element[]];
    expect(els).toHaveLength(1);
    expect(els[0]).toBe(last().el.querySelector("canvas"));
    act(() => applyWorld("ura"));
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(2));
    act(() => applyWorld("omote"));
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(last().setOption).toHaveBeenCalled());
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it("reduced motion: nothing moves — no enter() in 表, the 里 box at full opacity at once, ECharts' own animation off", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    applyWorld("omote");
    const a = mount();
    await waitFor(() => expect(last()?.setOption).toHaveBeenCalled());
    expect(last().setOption.mock.calls.at(-1)![0]).toMatchObject({ animation: false });
    expect(enter).not.toHaveBeenCalled();
    a.unmount();
    applyWorld("ura");
    mount();
    expect(screen.getByRole("img", { name: "24 小时分布" }).style.opacity).toBe("1");
    await waitFor(() => expect(last().setOption).toHaveBeenCalled());
    expect(enter).not.toHaveBeenCalled();
  });

  it("里: no enter()", async () => {
    mount();
    await waitFor(() => expect(last()?.setOption).toHaveBeenCalled());
    expect(enter).not.toHaveBeenCalled();
  });

  it("表 with stats.cost shown: cost = true", async () => {
    applyWorld("omote");
    mount({ prefs: { omote: { font: "plex", hide: [] } } });
    await waitFor(() => expect(last()?.setOption.mock.calls.at(-1)?.[0]).toMatchObject({ title: { text: "omote true" } }));
  });

  it("a new option function re-sets the option on the same chart (no rebuild)", async () => {
    const { rerender } = mount();
    await waitFor(() => expect(last()?.setOption).toHaveBeenCalled());
    const n = last().setOption.mock.calls.length;
    rerender(<V2TestProvider><EChart option={() => ({ series: [], title: { text: "two" } })} height={220} label="x" /></V2TestProvider>);
    await waitFor(() => expect(last().setOption.mock.calls.length).toBeGreaterThan(n));
    expect(last().setOption.mock.calls.at(-1)![0]).toMatchObject({ title: { text: "two" }, animation: false });
    expect(ec.init).toHaveBeenCalledTimes(1);
  });

  it("unmount disposes; unmounting before the chunk arrives never creates a chart", async () => {
    const a = mount();
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(1));
    a.unmount();
    expect(last().dispose).toHaveBeenCalled();
    ec.init.mockClear();
    const b = mount();
    b.unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(ec.init).not.toHaveBeenCalled();
  });

  it("ResizeObserver: a size change resizes the chart", async () => {
    const ros: { cb: () => void; off: boolean }[] = [];
    vi.stubGlobal("ResizeObserver", class { r: { cb: () => void; off: boolean }; constructor(cb: () => void) { this.r = { cb, off: false }; ros.push(this.r); } observe() {} disconnect() { this.r.off = true; } });
    const { unmount } = mount();
    await waitFor(() => expect(ros.length).toBe(1));
    ros[0].cb();
    expect(last().resize).toHaveBeenCalled();
    unmount();
    expect(ros[0].off).toBe(true);
  });

  it("onHoverTask: hovering an item writes its task to the page store (leaving clears only what it wrote); the store highlights every item of that task", async () => {
    mount({ hover: true });
    await waitFor(() => expect(last()?.handlers.has("mouseover")).toBe(true));
    const c = last();
    act(() => c.handlers.get("mouseover")!({ data: { value: 2, task: "T2" } }));
    expect(getHoverTask()).toBe("T2");
    expect(c.dispatchAction).toHaveBeenCalledWith({ type: "highlight", seriesIndex: 0, dataIndex: [1] });
    act(() => setHoverTask("T1"));
    expect(c.dispatchAction).toHaveBeenLastCalledWith({ type: "highlight", seriesIndex: 0, dataIndex: [0, 2] });
    act(() => c.handlers.get("mouseout")!({}));                                  // T1 came from elsewhere: kept
    expect(getHoverTask()).toBe("T1");
    act(() => c.handlers.get("mouseover")!({ data: { value: 2, task: "T2" } }));
    act(() => c.handlers.get("mouseout")!({}));                                  // its own T2: cleared
    expect(getHoverTask()).toBeNull();
    expect(c.dispatchAction).toHaveBeenLastCalledWith({ type: "downplay" });
  });

  it("a highlight survives a new option and a new chart (B1: setOption with notMerge clears it; the store is painted again after)", async () => {
    const hl = (c: ReturnType<typeof last>) => {
      const set = Math.max(...c.setOption.mock.invocationCallOrder);
      return c.dispatchAction.mock.calls.filter((call, i) => c.dispatchAction.mock.invocationCallOrder[i] > set && (call[0] as { type: string }).type === "highlight");
    };
    const { rerender } = mount({ hover: true });
    await waitFor(() => expect(last()?.handlers.has("mouseover")).toBe(true));
    act(() => setHoverTask("T1"));
    const c = last(), n = c.setOption.mock.calls.length;
    const two = () => ({ series: [{ type: "bar", data: [{ value: 5, task: "T2" }, { value: 6, task: "T1" }] }] });
    rerender(<V2TestProvider><EChart option={two} height={220} label="x" onHoverTask /></V2TestProvider>);
    await waitFor(() => expect(c.setOption.mock.calls.length).toBeGreaterThan(n));
    expect(hl(c)).toEqual([[{ type: "highlight", seriesIndex: 0, dataIndex: [1] }]]);
    act(() => applyWorld("omote"));
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(last().setOption).toHaveBeenCalled());
    await waitFor(() => expect(hl(last())).toEqual([[{ type: "highlight", seriesIndex: 0, dataIndex: [1] }]]));
  });

  it("unmount and a world switch call nothing on the disposed chart (ECharts would warn \"has been disposed\")", async () => {
    const { unmount } = mount({ hover: true });
    await waitFor(() => expect(last().on).toHaveBeenCalled());
    const first = last();
    act(() => applyWorld("omote"));
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(last().on).toHaveBeenCalled());
    unmount();
    expect(first.dispose).toHaveBeenCalled();
    expect(last().dispose).toHaveBeenCalled();
    expect(first.afterDispose).toEqual([]);
    expect(last().afterDispose).toEqual([]);
  });

  it("without onHoverTask: no handlers, the store is left alone", async () => {
    mount();
    await waitFor(() => expect(last()?.setOption).toHaveBeenCalled());
    expect(last().on).not.toHaveBeenCalled();
    act(() => setHoverTask("T1"));
    expect(last().dispatchAction).not.toHaveBeenCalled();
  });
});
