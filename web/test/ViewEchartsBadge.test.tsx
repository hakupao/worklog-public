import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { VIZ, VIZ_TASKS } from "./viz-fixture";
import { viewOf } from "./view-canvas";

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

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); applyWorld("ura"); window.location.hash = ""; });

describe("ECharts tooltips pick the badge image up after the chart was built", () => {
  it("the formatter set on the chart before the image load resolved shows the <img> once it has (sankey, graph, parallel)", async () => {
    stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
    window.location.hash = "#/v2/stats";
    render(<V2TestProvider><StatsPage /></V2TestProvider>);
    const chartOf = (name: string) => {
      const sec = viewSec(name);
      const r = [...ec.made].reverse().find((m) => sec?.contains(m.el));
      return r?.set[r.set.length - 1] as Record<string, any>;
    };
    const secs: Record<string, Element> = {};
    const viewSec = (n: string) => secs[n];
    for (const n of ["流向", "并行关系网", "会话平行坐标"]) secs[n] = await viewOf(n);
    await waitFor(() => { for (const n of Object.keys(secs)) expect(chartOf(n)).toBeDefined(); });
    const first = Object.fromEntries(Object.keys(secs).map((n) => [n, chartOf(n)]));   // the options as first set
    const probe: Record<string, () => string> = {
      "流向": () => first["流向"].tooltip.formatter({ name: "t:T1", value: 90, data: {} }),
      "并行关系网": () => first["并行关系网"].tooltip.formatter({ name: "T1", value: 90, data: {} }),
      "会话平行坐标": () => first["会话平行坐标"].tooltip.formatter({ data: { sid: "A" } }),
    };
    for (const n of Object.keys(probe)) await waitFor(() => expect(probe[n]()).toContain('<img class="tbimg"'));
  });
  it("sankey / graph: the option is set again when the glyph chunk arrives — task labels become {g<i>|}{c|code} with rich images", async () => {
    stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
    window.location.hash = "#/v2/stats";
    render(<V2TestProvider><StatsPage /></V2TestProvider>);
    const secs: Record<string, Element> = {};
    for (const n of ["流向", "并行关系网"]) secs[n] = await viewOf(n);
    const live = (n: string) => { const r = [...ec.made].reverse().find((m) => secs[n].contains(m.el)); return r?.set[r.set.length - 1] as Record<string, any> | undefined; };
    for (const [n, probe] of [["流向", "t:T1"], ["并行关系网", "T1"]] as const) {
      await waitFor(() => expect(live(n)?.series[0].label.rich).toBeDefined());
      const l = live(n)!.series[0].label;
      expect(l.formatter({ name: probe })).toMatch(/^\{g\d+\|\}\{c\|.+\}$/);
      expect(Object.keys(l.rich).some((k) => /^g\d+$/.test(k))).toBe(true);
    }
  });
});
