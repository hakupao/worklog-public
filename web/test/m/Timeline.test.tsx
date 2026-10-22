// web/test/m/Timeline.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timeline } from "../../src/m/pages/Timeline";
import { parseMRoute } from "../../src/m/route";
import { J, session, task } from "../../src/predict/fixtures";
import { weekTl } from "../tl-fixtures";
import { V2TestProvider } from "../helpers";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
let S = [
  session("b", "2026-10-02 11:00", "2026-10-02 11:30", { task_id: null, summary: "未关联的调查" }),
  session("a", "2026-10-02 09:00", "2026-10-02 10:00", { task_id: "T1", summary: "帳票の修正" }),
];
const BASE = S;
function serve(fail = false) {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (fail) return json({ error: "boom" }, 404);
    if (url.startsWith("/api/weeks/2026-W40/timeline")) return json(weekTl("2026-W40", "2026-09-28", S));
    if (url.startsWith("/api/weeks/")) return json({ week: "x", days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    if (url.startsWith("/api/tasks")) return json([task("T1", "alpha 改修")]);
    return json({});
  }));
}
const page = (hash: string) => render(<V2TestProvider><Timeline route={parseMRoute(hash)} /></V2TestProvider>);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); window.location.hash = "#/m/tl"; });
afterEach(() => { S = BASE; vi.useRealTimers(); vi.unstubAllGlobals(); window.location.hash = ""; });

describe("时间线 (phone)", () => {
  it("lists the day's sessions by start time with their 案件", async () => {
    serve();
    const { container } = page("#/m/tl");
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(2));
    expect([...container.querySelectorAll(".m-time")].map((e) => e.textContent)).toEqual(["09:00", "11:00"]);
    await waitFor(() => expect(container.querySelector(".m-row .m-t1")).toHaveTextContent("alpha 改修"));
    expect(screen.getByText("10/2 周五 · 今天")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "后一天" })).toBeDisabled();
  });
  it("只看未关联 keeps the unlinked ones and writes it in the address", async () => {
    serve();
    const { container } = page("#/m/tl?un=1");
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(1));
    expect(container.querySelector(".m-row .m-t1")).toHaveTextContent("未关联");
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(window.location.hash).toBe("#/m/tl");
  });
  it("the previous day goes into the address; an empty day says so", async () => {
    serve();
    page("#/m/tl/2026-09-30");
    expect(await screen.findByText("这一天没有记录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    expect(window.location.hash).toBe("#/m/tl/2026-09-29");
  });
  it("a future date in the address shows today", async () => {
    serve();
    page("#/m/tl/2026-10-05");
    expect(await screen.findByText("10/2 周五 · 今天")).toBeInTheDocument();
  });
  it("opens a session read-only, full summary", async () => {
    serve();
    const { container } = page("#/m/tl");
    await waitFor(() => expect(container.querySelector(".m-row .m-t1")).toHaveTextContent("alpha 改修"));
    fireEvent.click(container.querySelectorAll(".m-row")[0]);
    expect(screen.getByRole("dialog", { name: "alpha 改修" })).toHaveTextContent("帳票の修正");
  });
  it("a swipe inside the open sheet neither changes the date nor closes it", async () => {
    serve();
    const { container } = page("#/m/tl");
    await waitFor(() => expect(container.querySelector(".m-row .m-t1")).toHaveTextContent("alpha 改修"));
    fireEvent.click(container.querySelectorAll(".m-row")[0]);
    const dlg = screen.getByRole("dialog", { name: "alpha 改修" });
    fireEvent.touchStart(dlg, { touches: [{ clientX: 300, clientY: 400 }] });
    fireEvent.touchEnd(dlg, { changedTouches: [{ clientX: 40, clientY: 405 }] });
    expect(window.location.hash).toBe("#/m/tl");
    expect(screen.getByRole("dialog", { name: "alpha 改修" })).toBeInTheDocument();
  });
  it("the filter is a segmented group named 筛选", async () => {
    serve();
    const { container } = page("#/m/tl");
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(2));
    const grp = screen.getByRole("group", { name: "筛选" });
    expect(grp).toHaveClass("m-seg");
    fireEvent.click(screen.getByRole("button", { name: "只看未关联" }));
    expect(window.location.hash).toBe("#/m/tl?un=1");
  });
  it("B2: a session cut by midnight shows the day's share against the whole", async () => {
    S = [session("c", "2026-10-01 21:21", "2026-10-02 00:41", { task_id: "T1", minutes_override: 200 })];
    serve();
    const { container } = page("#/m/tl");
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(1));
    fireEvent.click(container.querySelector(".m-row")!);
    expect(screen.getByRole("dialog")).toHaveTextContent("当天 41 分 · 全程 200 分");
  });
  it("B2: equal day and whole minutes show the single figure", async () => {
    S = [session("d", "2026-10-02 09:00", "2026-10-02 10:00", { task_id: "T1" })];
    serve();
    const { container } = page("#/m/tl");
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(1));
    fireEvent.click(container.querySelector(".m-row")!);
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveTextContent("60分");
    expect(dlg).not.toHaveTextContent("全程");
  });
  it("error with retry", async () => {
    serve(true);
    page("#/m/tl");
    expect(await screen.findByRole("button", { name: "重新载入" })).toBeInTheDocument();
  });
});
