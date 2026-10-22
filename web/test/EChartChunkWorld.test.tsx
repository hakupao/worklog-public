import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EChart } from "../src/pages/stats/EChart";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";

// F5 follow-up: after a failed chunk load, a world switch (which re-runs the chart effect) builds the chart. Its own
// file, as EChartChunk.test.tsx: the loaded chunk is kept for the module.
const ec = vi.hoisted(() => {
  const st = { fail: true };
  const init = vi.fn(() => ({ setOption() {}, dispose() {}, isDisposed: () => false, resize() {}, on() {}, off() {}, dispatchAction() {} }));
  return { st, init };
});
vi.mock("../src/pages/stats/viz/echarts", () => {
  if (ec.st.fail) throw new Error("Failed to fetch dynamically imported module");
  return { init: ec.init };
});

const opt = () => ({ series: [{ type: "bar", data: [1, 2, 3] }] });
afterEach(() => applyWorld("ura"));

describe("EChart — a failed chunk, then a world switch", () => {
  it("drops the failure line and builds the chart on the new world's theme", async () => {
    render(<V2TestProvider><EChart option={opt} height={220} label="24 小时分布" /></V2TestProvider>);
    await waitFor(() => expect(screen.getByText("统计视图加载失败")).toBeInTheDocument());
    ec.st.fail = false;
    act(() => applyWorld("omote"));
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("img", { name: "24 小时分布" })).toBeInTheDocument();
    expect(screen.queryByText("统计视图加载失败")).toBeNull();
  });
});
