// web/test/m/Now.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMRoute } from "../../src/m/route";
import { Now } from "../../src/m/pages/Now";
import { J } from "../../src/predict/fixtures";
import { scenarioInput } from "../../src/predict/scenarios";
import { buildSnapshot, type SnapInput } from "../../src/predict/snapshot";
import { V2TestProvider } from "../helpers";
import { json, route } from "./serve";

const TL = (i: SnapInput) => ({ week: "2026-W40", days: [{ date: "2026-10-01", minutes: 200, wall_minutes: 150, sessions: [], notes: [] }, { date: "2026-10-02", minutes: 380, wall_minutes: 312, sessions: i.sessions, notes: [] }], total_minutes: 580, unassigned: 0, hidden: 0 });
const BY_TASK = [["A", 300], ["B", 600], ["C", 120], ["D", 480], ["E", 60], ["F", 30]].map(([title, minutes], k) => ({ task_id: `T${k}`, title, minutes }));
const RUNS = [{ name: "macmini", hours: Array.from({ length: 24 }, (_, h) => h === 23), last_run_at: J("2026-10-02 14:00") }, { name: "win11", hours: Array(24).fill(false), last_run_at: null }];
type Table = Parameters<typeof route>[0];
/** /api/machines/runs is listed before /api/machines: the prefix table answers the first match. `over` rows win. */
function serve(i: SnapInput | null, fail = false, over: Table = []) {
  const never = () => new Promise<Response>(() => {});
  if (!i) return route([["/api/", never]]);
  route([
    ...over,
    ["/api/machines/runs", RUNS],
    ["/api/machines", fail ? () => json({ error: "boom" }, 404) : i.machines],
    ["/api/dashboard", { time: { by_project: [], by_requester: [], by_task: BY_TASK, unlinked_minutes: 0, unlinked_note_minutes: 0, weekly: [] } }],
    ["/api/weeks/2026-W40/timeline", TL(i)],
    ["/api/weeks/", { week: "x", days: [], total_minutes: 0, unassigned: 0, hidden: 0 }],
    ["/api/tasks", i.tasks],
    ["/api/plan-items", i.planItems],
    ["/api/day-plans/", () => (i.dayPlan ? json(i.dayPlan) : json({ error: "no plan" }, 404))],
    ["/api/report-downloads", i.downloads],
  ]);
}
const page = () => render(<V2TestProvider><Now route={parseMRoute("#/m/now")} /></V2TestProvider>);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("此刻 (phone)", () => {
  it("shows running sessions, today's two figures, the day plan and the collection state", async () => {
    const input = scenarioInput("day");
    serve(input);
    const { container } = page();
    const running = buildSnapshot(input, 10).running.length;
    await waitFor(() => expect(container.querySelectorAll(".m-spin")).toHaveLength(running));
    expect(screen.getByRole("img", { name: "5:12" })).toBeInTheDocument();          // wall
    expect(screen.getByRole("img", { name: "6:20" })).toBeInTheDocument();          // sum
    expect(container.querySelectorAll(".m-x")).toHaveLength(input.dayPlan?.items.length ?? 0);
    expect(screen.getByText("采集 · 过去 24 小时")).toBeInTheDocument();
  });
  it("本周案件: top five of this week's dashboard, one dot bar each", async () => {
    serve(scenarioInput("day"));
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".m-rk")).toHaveLength(5));
    const rows = [...container.querySelectorAll(".m-rk")];
    expect(rows.map((r) => r.firstElementChild!.textContent)).toEqual(["B", "D", "A", "C", "E"]);   // F (6th) is not shown, nor an "other" row
    expect(rows.map((r) => r.querySelector(".m-side")!.textContent)).toEqual(["10.0h", "8.0h", "5.0h", "2.0h", "1.0h"]);
    rows.forEach((r) => expect(r.querySelectorAll("svg.m-dots")).toHaveLength(1));
    expect(screen.getByText("本周案件").closest(".m-cap")).toHaveTextContent("7.7h");   // the week's wall minutes from the timeline: 150 + 312
    const fetched = vi.mocked(globalThis.fetch).mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith("/api/dashboard"));
    expect(fetched[0]).toBe("/api/dashboard?from=2026-09-28&to=2026-10-04");
  });
  it("采集: one row per machine with 24 dots and the last run time; stale is orange", async () => {
    serve(scenarioInput("day"));
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".m-up svg")).not.toBeNull());
    const rows = [...container.querySelectorAll(".m-up")];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("MAC");
    expect(rows[0].querySelectorAll("svg circle")).toHaveLength(24);
    expect(rows[0].querySelector(".m-side")).toHaveTextContent("14:00");
    expect(rows[0].querySelector(".m-side")).not.toHaveClass("m-warn");
    expect(rows[1]).toHaveTextContent("WIN");
    expect(rows[1]).toHaveTextContent("采集器未更新");
    expect(rows[1].querySelector("svg")).toBeNull();
  });
  it("采集: a machine whose last run is over two hours old is shown in the warning colour", async () => {
    const input = scenarioInput("day");
    serve(input, false, [["/api/machines/runs", [{ name: "macmini", hours: Array(24).fill(true), last_run_at: J("2026-10-02 11:00") }, RUNS[1]]]]);
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".m-up .m-side")).toHaveTextContent("11:00"));
    expect(container.querySelector(".m-up .m-side")).toHaveClass("m-warn");
  });
  it("runs or dashboard failing leaves the page up: 采集 falls back, 本周案件 hides", async () => {
    const boom = () => json({ error: "boom" }, 500);
    serve(scenarioInput("day"), false, [["/api/machines/runs", boom], ["/api/dashboard", boom]]);
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".m-up")).toHaveLength(2));
    expect(screen.getByRole("img", { name: "5:12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新载入" })).toBeNull();
    expect(container.querySelectorAll(".m-rk")).toHaveLength(0);
    expect(screen.queryByText("本周案件")).toBeNull();
    const rows = [...container.querySelectorAll(".m-up")];
    expect(rows.map((r) => r.querySelector("b")!.textContent)).toEqual(["MAC", "WIN"]);
    rows.forEach((r) => { expect(r).toHaveTextContent("采集器未更新"); expect(r.querySelector("svg")).toBeNull(); });
    expect(screen.getByText("14:00")).toBeInTheDocument();   // 同步 falls back to /api/machines' last_seen
  });
  it("runs or dashboard in an unexpected shape leaves the page up too", async () => {
    serve(scenarioInput("day"), false, [
      ["/api/machines/runs", { runs: RUNS }],                                     // not an array
      ["/api/dashboard", { time: {} }],                                            // no by_task
    ]);
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".m-up")).toHaveLength(2));
    expect(screen.getByRole("img", { name: "5:12" })).toBeInTheDocument();
    expect(container.querySelectorAll(".m-rk")).toHaveLength(0);
    container.querySelectorAll(".m-up").forEach((r) => expect(r).toHaveTextContent("采集器未更新"));
    serve(scenarioInput("day"), false, [
      ["/api/machines/runs", [{ name: "macmini", hours: null, last_run_at: J("2026-10-02 14:00") }, { name: "win11", last_run_at: "not a time" }, null]],
      ["/api/dashboard", { time: { by_task: [{ title: "A", minutes: "x" }, null, { title: "B", minutes: 60 }] } }],
    ]);
    const second = page().container;
    await waitFor(() => expect(second.querySelectorAll(".m-rk")).toHaveLength(1));
    expect(second.querySelector(".m-rk")).toHaveTextContent("B");
    expect(second.querySelectorAll(".m-up")).toHaveLength(2);
    second.querySelectorAll(".m-up").forEach((r) => { expect(r).toHaveTextContent("采集器未更新"); expect(r.querySelector("svg")).toBeNull(); });
  });
  it("同步 shows the newest run (or last_seen) with a cursor", async () => {
    serve(scenarioInput("day"), false, [["/api/machines/runs", [{ ...RUNS[0], last_run_at: J("2026-10-02 14:10") }, RUNS[1]]]]);
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".m-cap .m-cur")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".m-cur")!.parentElement).toHaveTextContent("同步 14:10"));
    expect(container.querySelector(".m-cur")!.previousElementSibling).toHaveClass("m-sn");
  });
  it("同步 uses last_seen when it is newer than the last run", async () => {
    serve(scenarioInput("day"), false, [
      ["/api/machines/runs", [{ ...RUNS[0], last_run_at: J("2026-10-02 14:10") }, RUNS[1]]],
      ["/api/machines", [{ name: "macmini", last_seen_at: J("2026-10-02 14:15") }]],
    ]);
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".m-cur")!.parentElement).toHaveTextContent("同步 14:15"));
  });
  it("opens a running session read-only", async () => {
    const input = scenarioInput("day");
    serve(input);
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".m-spin")).not.toBeNull());
    fireEvent.click(container.querySelector(".m-spin")!.closest("button")!);
    expect(screen.getByRole("dialog")).toHaveTextContent("只读");
  });
  it("loading, then error with retry", async () => {
    serve(null);
    const { container, unmount } = page();
    expect(container.querySelector(".m-skel")).not.toBeNull();
    unmount();
    serve(scenarioInput("day"), true);
    page();
    expect(await screen.findByRole("button", { name: "重新载入" })).toBeInTheDocument();
  });
  it("today's plan rows are checkable from 此刻", async () => {
    const input = scenarioInput("day");
    serve(input);
    page();
    const boxes = await screen.findAllByRole("button", { name: "切换完成" });
    expect(boxes).toHaveLength(input.dayPlan?.items.length ?? 0);
    expect(screen.getByRole("link", { name: "全部 ›" })).toHaveAttribute("href", "#/m/plan");
  });
  it("a day-plan box on 此刻 sends one PATCH with only manual_status", async () => {
    const input = scenarioInput("day");
    serve(input);
    const base = globalThis.fetch;
    const patches: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      if (init?.method !== "PATCH") return base(u, init);
      patches.push({ url: String(u), body: JSON.parse(String(init.body)) });
      return json({ ...input.dayPlan!.items[0], manual_status: "done", final_status: "done" });
    }));
    page();
    const boxes = await screen.findAllByRole("button", { name: "切换完成" });
    fireEvent.click(boxes[0]);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].url).toMatch(/^\/api\/day-plan-items\/[^/?]+$/);
    expect(Object.keys(patches[0].body).sort()).toEqual(["manual_status", "updated_at"]);
  });
  it("just after 0:00 JST, a box on yesterday's still-shown plan is not dropped", async () => {
    vi.setSystemTime(new Date(Date.parse(J("2026-10-02 23:59")) + 59_700));       // the minute ticks ~0.3s of real time later
    const input = scenarioInput("day");
    serve(input);
    const base = globalThis.fetch;
    const patches: string[] = [];
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      seen.push(String(u));
      if (String(u).startsWith("/api/day-plans/2026-10-03")) return new Promise<Response>(() => {});   // today's plan still loading
      if (init?.method !== "PATCH") return base(u, init);
      patches.push(String(u));
      return json({ ...input.dayPlan!.items[0], manual_status: "done", final_status: "done" });
    }));
    page();
    await screen.findAllByRole("button", { name: "切换完成" });
    vi.setSystemTime(new Date(Date.parse(J("2026-10-03 00:00")) + 1000));
    await waitFor(() => expect(seen).toContain("/api/day-plans/2026-10-03"), { timeout: 3000 });
    const boxes = await screen.findAllByRole("button", { name: "切换完成" });   // yesterday's items, kept while today's load
    fireEvent.click(boxes[0]);
    await waitFor(() => expect(patches).toHaveLength(1));
  });
});
