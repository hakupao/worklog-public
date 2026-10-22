import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EChart } from "../src/pages/stats/EChart";
import { V2TestProvider } from "./helpers";

// F5: the ECharts chunk failing to load (a network blip). Its own file: EChart keeps the loaded chunk for the page, so
// the failure has to be the first load in the module.
const ec = vi.hoisted(() => {
  const st = { fail: true, loads: 0 };
  const init = vi.fn(() => ({ setOption() {}, dispose() {}, isDisposed: () => false, resize() {}, on() {}, off() {}, dispatchAction() {} }));
  return { st, init };
});
vi.mock("../src/pages/stats/viz/echarts", () => {
  ec.st.loads++;
  if (ec.st.fail) throw new Error("Failed to fetch dynamically imported module");
  return { init: ec.init };
});

const opt = () => ({ series: [{ type: "bar", data: [1, 2, 3] }] });
const mount = () => render(<V2TestProvider><EChart option={opt} height={220} label="24 小时分布" /></V2TestProvider>);

describe("EChart — the chunk fails to load (F5)", () => {
  it("one dim failure line in place of the chart; the next mount (the view entered again) loads it again and builds the chart", async () => {
    const a = mount();
    await waitFor(() => expect(screen.getByText("统计视图加载失败")).toBeInTheDocument());
    expect(screen.queryByRole("img", { name: "24 小时分布" })).toBeNull();
    expect(ec.init).not.toHaveBeenCalled();
    a.unmount();
    ec.st.fail = false;
    mount();
    await waitFor(() => expect(ec.init).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("img", { name: "24 小时分布" })).toBeInTheDocument();
    expect(screen.queryByText("统计视图加载失败")).toBeNull();
    expect(ec.st.loads).toBe(2);
  });
});
