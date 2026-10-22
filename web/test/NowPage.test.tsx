import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NowPage } from "../src/pages/NowPage";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { J } from "../src/predict/fixtures";
import { scenarioInput } from "../src/predict/scenarios";
import type { SnapInput } from "../src/predict/snapshot";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
/** Serves a SnapInput the way the API would: everything in this week's timeline, last week empty. */
function serve(i: SnapInput | null, over: (url: string) => Response | null = () => null) {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u), o = over(url);
    if (o) return o;
    if (!i) return new Promise<Response>(() => {});                    // never answers: loading
    if (url.startsWith("/api/machines")) return json(i.machines);
    if (url.startsWith("/api/weeks/2026-W40/timeline")) return json({ week: "2026-W40", days: [{ date: "2026-10-02", minutes: 0, sessions: i.sessions, notes: [] }], total_minutes: 0, unassigned: 0, hidden: 0 });
    if (url.startsWith("/api/weeks/")) return json({ week: "x", days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    if (url.startsWith("/api/tasks")) return json(i.tasks);
    if (url.startsWith("/api/plan-items")) return json(i.planItems);
    if (url.startsWith("/api/day-plans/")) return i.dayPlan ? json(i.dayPlan) : json({ error: "no plan" }, 404);
    if (url.startsWith("/api/report-downloads")) return json(i.downloads);
    if (url.startsWith("/api/stats/sessions")) {                       // the title block's month hours: none
      const q = new URL(url, "http://x").searchParams;
      return json({ range: { from: q.get("from"), to: q.get("to") }, day_start: "05:00", plans: [], sessions: [] });
    }
    return json({});
  }));
}
const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (prefs = {}) => render(<V2TestProvider prefs={prefs}><NowPage /></V2TestProvider>);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); });

describe("NowPage", () => {
  it("renders the 14:20 board from the API: running, next, plan, status, cost, chart", async () => {
    serve(scenarioInput("day"));
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".row.run")).toHaveLength(2));
    expect([...container.querySelectorAll<HTMLElement>(".row.next")].map((r) => r.dataset.rule)).toEqual(["unlinked.stale", "week.unlinked", "dayplan.untouched"]);
    expect(container.querySelectorAll(".lamp.red")).toHaveLength(1);
    expect(container.querySelector('[data-mod="now.cost"]')).not.toBeNull();
    expect(container.querySelector("canvas.dia-cv")).not.toBeNull();
    await waitFor(() => expect(ink(container)).toContain("今日安排 1/2 完成"));
  });

  it("renders an empty day without crashing", async () => {
    vi.setSystemTime(new Date(J("2026-10-05 09:00")));
    serve({ now: 0, machines: [], sessions: [], tasks: [], planItems: [], dayPlan: null, downloads: [] });
    const { container } = page();
    await waitFor(() => expect(ink(container)).toContain("没有运行中的会话"));
    expect(ink(container)).toContain("没有建议");
    expect(ink(container)).toContain("还没有收集记录");
    expect(ink(container)).toContain("今天还没有会话");
    expect(container.querySelector(".lamp.red")).toBeNull();
  });

  it("shows a loading line until the data is in, an error line when a query fails for good", async () => {
    serve(null);
    const { container, unmount } = page();
    await waitFor(() => expect(ink(container)).toContain("读取中…"));
    unmount();
    serve(scenarioInput("day"), (url) => (url.startsWith("/api/machines") ? json({ error: "not found" }, 404) : null));
    const again = page();
    await waitFor(() => expect(ink(again.container)).toContain("读取失败，稍后自动重试"));
  });

  it("a failing download list does not blank the board (read as none)", async () => {
    serve(scenarioInput("day"), (url) => (url.startsWith("/api/report-downloads") ? json({ error: "not found" }, 404) : null));
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".row.run")).toHaveLength(2));
    expect(ink(container)).not.toContain("读取失败");
  });

  it("Sat 10:00: a download of the report week (Sat→Fri, W42) suppresses report.undownloaded", async () => {
    // 2026-10-10 Sat is ISO W41 but report week W42; the rule tests the report week, so must the query.
    vi.setSystemTime(new Date(J("2026-10-10 10:00")));
    const { rules } = DEFAULT_PREFS.predict;
    const prefs = { predict: { ...DEFAULT_PREFS.predict, rules: { ...rules, "report.undownloaded": { ...rules["report.undownloaded"], mode: "all" as const } } } };
    const empty: SnapInput = { now: 0, machines: [], sessions: [], tasks: [], planItems: [], dayPlan: null, downloads: [] };
    const dl = [{ week: "2026-W42", template: "standard", at: "2026-10-10T00:30:00Z" }];
    const rulesOf = (el: Element) => [...el.querySelectorAll<HTMLElement>(".row.next")].map((r) => r.dataset.rule);
    serve(empty, (url) => (url.startsWith("/api/report-downloads") ? json(url.includes("2026-W42") ? dl : []) : null));
    const { container, unmount } = page(prefs);
    await waitFor(() => expect(ink(container)).toContain("没有运行中的会话"));
    expect(rulesOf(container)).not.toContain("report.undownloaded");
    unmount();
    serve(empty, (url) => (url.startsWith("/api/report-downloads") ? json([]) : null));
    const none = page(prefs);
    await waitFor(() => expect(rulesOf(none.container)).toContain("report.undownloaded"));
  });

  it("one tooltip for the whole page", async () => {
    serve(scenarioInput("day"));
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".row.run")).toHaveLength(2));
    expect(document.body.querySelectorAll(".tip")).toHaveLength(1);
  });

  it("C3a layout: scene + run chart left, the five modules right, the title block below (relayout spec §2.1)", async () => {
    serve(scenarioInput("day"));
    const { container } = page();
    await waitFor(() => expect(container.querySelectorAll(".row.run")).toHaveLength(2));
    const top = container.querySelector(".now > .now-top")!;
    expect([...top.children].map((e) => e.className)).toEqual(["now-left", "vr", "side"]);
    const mods = (el: Element) => [...el.querySelectorAll<HTMLElement>("[data-mod]")].map((e) => e.dataset.mod);
    expect(mods(top.querySelector(".now-left")!)).toEqual(["now.scene", "now.dia"]);
    expect(mods(top.querySelector(".side")!)).toEqual(["now.run", "now.next", "now.plan", "now.info", "now.cost"]);
    expect(top.nextElementSibling!.getAttribute("data-mod")).toBe("now.time");
    expect(top.classList.contains("solo")).toBe(false);
  });

  describe("表: hidden modules and whole columns (spec §5.2)", () => {
    it("the left column collapses when the scene and the chart are hidden; 里 still shows everything", async () => {
      serve(scenarioInput("day"));
      applyWorld("omote");
      const { container } = page({ omote: { font: "plex", hide: ["now.scene", "now.dia"] } });
      await waitFor(() => expect(container.querySelectorAll(".row.run")).toHaveLength(2));
      expect(container.querySelector(".now-left")).toBeNull();
      expect(container.querySelector(".now-top")!.classList.contains("solo")).toBe(true);
      applyWorld("ura");
      await waitFor(() => expect(container.querySelector(".now-left")).not.toBeNull());
      expect(container.querySelector(".now-top")!.classList.contains("solo")).toBe(false);
    });
    it("the right column collapses too; with both gone only the title block is left", async () => {
      serve(scenarioInput("day"));
      applyWorld("omote");
      const right = page({ omote: { font: "plex", hide: ["now.run", "now.next", "now.plan", "now.info", "now.cost"] } });
      await waitFor(() => expect(right.container.querySelector('[data-mod="now.dia"]')).not.toBeNull());
      expect(right.container.querySelector(".side")).toBeNull();
      expect(right.container.querySelector(".now-top")!.classList.contains("solo")).toBe(true);
      right.unmount();
      const all = ["now.scene", "now.dia", "now.run", "now.next", "now.plan", "now.info", "now.cost"];
      const both = page({ omote: { font: "plex", hide: all } });
      await waitFor(() => expect(both.container.querySelector('[data-mod="now.time"]')).not.toBeNull());
      expect(both.container.querySelector(".now-top")).toBeNull();
    });
  });
});
