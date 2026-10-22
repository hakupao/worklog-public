import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang, Prefs } from "../src/prefs/types";
import { STATS_VIEWS } from "../src/prefs/types";
import { STATS_VIEW_NEEDS } from "../src/prefs/statsViews";
import { SUB7_VIEWS, VIEW_META } from "../src/pages/stats/registry";
import { VIEW_COMPONENTS } from "../src/pages/stats/Views";
import { taskMap, vizBase } from "../src/pages/stats/useViz";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { inkOf } from "../src/ui/palette";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { fail, json, stServer } from "./st-serve";
import { canvases } from "./view-canvas";
import { VIZ, VIZ_TASKS } from "./viz-fixture";

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (hash = "#/v2/stats", o: { lang?: Lang; prefs?: Partial<Prefs> } = {}) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={o.lang} prefs={o.prefs}><StatsPage /></V2TestProvider>);
};
/** The views on screen, in order: number and id. */
const frames = (c: Element) => [...c.querySelectorAll("section.sv")].map((s) => `${ink(s.querySelector(".sv-h .no")!)} ${s.getAttribute("data-view")}`);
const ready = async (c: Element) => { await screen.findByRole("region", { name: "时间花在哪" }); return frames(c); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("registry", () => {
  it("needs come from prefs STATS_VIEW_NEEDS; ECharts and 累计 per the brief; every id has an entry", () => {
    expect(Object.keys(VIEW_META)).toEqual([...STATS_VIEWS]);
    for (const id of STATS_VIEWS) expect(VIEW_META[id].needs).toBe(STATS_VIEW_NEEDS[id]);
    expect(STATS_VIEWS.filter((id) => VIEW_META[id].echarts)).toEqual(["hours24", "weekday", "sankey", "graph", "parallel"]);
    expect(STATS_VIEWS.filter((id) => VIEW_META[id].cumulative)).toEqual(["time", "share", "rhythm", "ai"]);
  });

  it("every view outside the sub-project 7 blocks has a component, and nothing else does (no view left pending)", () => {
    expect(Object.keys(VIEW_COMPONENTS)).toEqual(STATS_VIEWS.filter((id) => !(SUB7_VIEWS as readonly string[]).includes(id)));
  });

  it("inkOf: a line colour mixed 28% toward the 表 ink #0f1c2e", () => {
    expect(inkOf("#ffffff")).toBe("#bcbfc4");
    expect(inkOf("#0f1c2e")).toBe("#0f1c2e");
    expect(inkOf("#25e0c8")).toBe("#1fa99d");
  });
});

describe("useViz value", () => {
  it("vizBase: prepare / segments / perDay over the range; taskMap: the tasks by id", () => {
    const v = vizBase(VIZ), tasks = taskMap(VIZ_TASKS);
    expect(v.prep.sessions.map((s) => s.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(v.days.map((d) => [d.date, d.union, d.sum])).toEqual([["2026-09-21", 360, 480], ["2026-09-22", 90, 90]]);
    expect(v.segs.reduce((m, s) => m + (s.b - s.a) / 60_000, 0)).toBe(450);
    expect(v.plans).toBe(VIZ.plans);
    expect(tasks.get("T2")?.requester).toBe("佐藤、鈴木");
    expect(taskMap(undefined).size).toBe(0);
  });
});

describe("StatsPage — the view area", () => {
  it("里, default prefs: the built views (no sessions: each new one thin) and the five sub-project 7 blocks numbered in order", async () => {
    stServer();
    const { container } = page();
    expect(await ready(container)).toEqual(["01 headlines", "02 waterfall", "03 river", "04 dial", "05 stream", "06 stars", "07 fingerprint", "08 hours24", "09 weekday", "10 calendar", "11 terrain", "12 contour", "13 compute", "14 density", "15 sunburst", "16 sankey", "17 graph", "18 parallel", "19 plans", "20 time", "21 share", "22 rhythm", "23 ai", "24 review"]);
    expect(container.querySelector(".st-cols")).toBeNull();
  });

  it("one title per block: the frame's (name + 累计); 依頼元与产出 keeps 按依頼元 and 产出 inside; 周复盘 has no 累计", async () => {
    stServer();
    page();
    await screen.findByRole("region", { name: "按依頼元" });                      // the dashboard is in
    const time = screen.getByRole("region", { name: "时间花在哪" });
    expect(ink(time).split("|").filter((s) => s === "时间花在哪")).toHaveLength(1);
    expect(ink(time.querySelector(".sv-h")!)).toBe("20|时间花在哪|累计|案件账本、未关联的时间和每周合计");
    for (const name of ["工作节奏", "AI 使用效率"]) {
      const sec = screen.getByRole("region", { name });
      expect(ink(sec).split("|").filter((s) => s === name)).toHaveLength(1);
      expect(ink(sec.querySelector(".sv-h")!)).toContain(`${name}|累计`);
    }
    const share = screen.getByRole("region", { name: "依頼元与产出" });
    expect(within(share).getByRole("region", { name: "按依頼元" })).toBeTruthy();
    expect(within(share).getByRole("region", { name: "产出" })).toBeTruthy();
    const rv = await screen.findByRole("region", { name: "周复盘" });
    expect(ink(rv.querySelector(".sv-h")!)).toBe("24|周复盘|AI 写的每周复盘");
    expect(screen.queryByRole("region", { name: "每周复盘" })).toBeNull();
  });

  it("prefs.stats: the user's order, the views turned off left out, numbers close up", async () => {
    stServer();
    const { container } = page("#/v2/stats", { prefs: { stats: { order: ["review", "rhythm", "headlines", "time"], off: ["share"] } } });
    expect(await ready(container)).toEqual(["01 review", "02 rhythm", "03 headlines", "04 time", "05 waterfall", "06 river", "07 dial", "08 stream", "09 stars", "10 fingerprint", "11 hours24", "12 weekday", "13 calendar", "14 terrain", "15 contour", "16 compute", "17 density", "18 sunburst", "19 sankey", "20 graph", "21 parallel", "22 plans", "23 ai"]);
  });

  it("表 with the default hide: compute, ai and review (needs stats.cost / stats.review) are not rendered, no amount in the view area", async () => {
    applyWorld("omote");
    stServer();
    const { container } = page();
    expect(await ready(container)).toEqual(["01 headlines", "02 waterfall", "03 river", "04 dial", "05 stream", "06 stars", "07 fingerprint", "08 hours24", "09 weekday", "10 calendar", "11 terrain", "12 contour", "13 density", "14 sunburst", "15 sankey", "16 graph", "17 parallel", "18 plans", "19 time", "20 share", "21 rhythm"]);
    for (const s of container.querySelectorAll("section.sv")) expect(s.textContent).not.toContain("$");
  });

  it("表 with stats.cost shown in the settings: compute and ai are back; the user's off still wins in both worlds", async () => {
    applyWorld("omote");
    stServer();
    const { container } = page("#/v2/stats", { prefs: { omote: { font: "plex", hide: ["now.cost"] }, stats: { order: [], off: ["time"] } } });
    await screen.findByRole("region", { name: "依頼元与产出" });
    expect(frames(container)).toEqual(["01 headlines", "02 waterfall", "03 river", "04 dial", "05 stream", "06 stars", "07 fingerprint", "08 hours24", "09 weekday", "10 calendar", "11 terrain", "12 contour", "13 compute", "14 density", "15 sunburst", "16 sankey", "17 graph", "18 parallel", "19 plans", "20 share", "21 rhythm", "22 ai", "23 review"]);
  });

  it("the sessions failing: an alert in the view area with 重试; the blocks stay", async () => {
    const { failNext } = stServer();
    failNext((u) => (u.startsWith("/api/stats/sessions") ? fail(400) : null));   // a 400 is not retried
    const { container } = page();
    const alert = await waitFor(() => { const a = container.querySelector(".sv-fail"); expect(a).not.toBeNull(); return a!; });
    expect(alert.getAttribute("role")).toBe("alert");
    await waitFor(() => expect(ink(alert)).toBe("统计视图加载失败|重试"));
    expect(screen.getByRole("region", { name: "时间花在哪" })).toBeTruthy();
  });
});

describe("StatsPage — the blocks before the dashboard (R4)", () => {
  it("the dashboard not yet in: each block holds its place and number, saying 读取中; the numbers do not move when it lands", async () => {
    const { db, failNext } = stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
    let land: () => void = () => {};
    failNext((u) => {
      if (!u.startsWith("/api/dashboard")) return null;
      const q = new URLSearchParams(u.split("?")[1]);
      return new Promise<Response>((res) => { land = () => res(json(db.dash(q.get("from")!, q.get("to")!))); });
    });
    const { container } = page("#/v2/stats", { prefs: { stats: { order: ["time", "headlines"], off: [] } } });
    await screen.findByRole("region", { name: "洞察头条" });
    const want = ["01 time", "02 headlines"];
    expect(frames(container).slice(0, 2)).toEqual(want);
    const time = screen.getByRole("region", { name: "时间花在哪" });
    expect(time.querySelector(".sv-b [role=status]")).not.toBeNull();
    await waitFor(() => expect(ink(time.querySelector(".sv-b")!)).toBe("读取中…"));
    land();
    await waitFor(() => expect(time.querySelector(".sv-b [role=status]")).toBeNull());
    await waitFor(() => expect(time.querySelectorAll(".sv-b [data-task]").length).toBeGreaterThan(0));
    expect(frames(container).slice(0, 2)).toEqual(want);
  });

  it("the dashboard failing: the blocks keep their places with one dim line (重试 is at the top), not 读取中", async () => {
    const { failNext } = stServer();
    failNext((u) => (u.startsWith("/api/dashboard") ? fail(400) : null));    // a 400 is not retried
    const { container } = page();
    await waitFor(() => expect(container.querySelector(".st-wait[role=alert]")).not.toBeNull());
    const time = screen.getByRole("region", { name: "时间花在哪" });
    await waitFor(() => expect(ink(time.querySelector(".sv-b")!)).toBe("统计加载失败"));
    expect(time.querySelector(".sv-b [role=status]")).toBeNull();
    expect(time.querySelector(".sv-b button")).toBeNull();
    expect(frames(container).slice(-5)).toEqual(["20 time", "21 share", "22 rhythm", "23 ai", "24 review"]);
  });
});

describe("StatsPage — the new views wait for the task table too (A5)", () => {
  beforeEach(() => { canvases({ "sv-stream": [600, 200] }); });
  afterEach(() => { vi.restoreAllMocks(); });
  it("sessions in, tasks not yet: the views say 读取中 (no ids first, titles after); the tasks land: titles", async () => {
    const { db, calls, failNext } = stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
    let land: () => void = () => {};
    failNext((u) => (u === "/api/tasks" ? new Promise<Response>((res) => { land = () => res(json(db.tasks)); }) : null));
    page("#/v2/stats", { prefs: { stats: { order: ["stream"], off: STATS_VIEWS.filter((v) => v !== "stream") } } });
    const view = () => screen.getByRole("region", { name: "案件时间流" });
    await waitFor(() => expect(calls.some((u) => u.startsWith("/api/stats/sessions"))).toBe(true));
    await new Promise((r) => setTimeout(r, 100));                                   // the sessions have landed by now
    expect(view().querySelector(".sv-pend")).not.toBeNull();
    expect(view().querySelector(".sv-leg")).toBeNull();
    land();
    await waitFor(() => expect(ink(view().querySelector(".sv-leg")!)).toContain("案件 一|2.3h"));
  });

  it("the task table failing: the views draw anyway, with ids", async () => {
    const { failNext } = stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
    failNext((u) => (u === "/api/tasks" ? fail(400) : null));                        // a 400 is not retried
    page("#/v2/stats", { prefs: { stats: { order: ["stream"], off: STATS_VIEWS.filter((v) => v !== "stream") } } });
    await waitFor(() => expect(ink(screen.getByRole("region", { name: "案件时间流" }).querySelector(".sv-leg")!)).toContain("T1|2.3h"));          // no title: the id stands in; the code itself is the S badge
  });
});

describe("StatsPage — before 5:00", () => {
  it("今天 between 0:00 and 5:00: one dim line that the night counts to the day before, with ◀ to yesterday", async () => {
    vi.setSystemTime(new Date(J("2026-10-02 03:20")));
    stServer();
    page("#/v2/stats?range=day");
    const line = await waitFor(() => { const l = document.querySelector(".sv-before"); expect(l).not.toBeNull(); return l!; });
    expect(ink(line)).toBe("5:00 前的工作算前一天|◀ 看昨天");
    fireEvent.click(within(line as HTMLElement).getByRole("button", { name: "◀ 看昨天" }));
    expect(window.location.hash).toBe("#/v2/stats?range=day&back=1");
  });

  it("not after 5:00, and not for a range that does not start today", async () => {
    stServer();
    const { container, unmount } = page("#/v2/stats?range=day");
    await ready(container);
    expect(container.querySelector(".sv-before")).toBeNull();
    unmount();
    vi.setSystemTime(new Date(J("2026-10-02 03:20")));
    const second = page("#/v2/stats");
    await ready(second.container);
    expect(second.container.querySelector(".sv-before")).toBeNull();
  });
});
