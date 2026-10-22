import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NowPage } from "../src/pages/NowPage";
import { SIM_KEY, simEnabled } from "../src/pages/now/sim";
import { J } from "../src/predict/fixtures";
import { V2TestProvider } from "./helpers";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
/** Live data: an empty Monday morning, so it never suggests anything. */
function serveEmpty() {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (url.startsWith("/api/day-plans/")) return json({ error: "no plan" }, 404);
    if (url.startsWith("/api/weeks/")) return json({ week: "x", days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    return json([]);
  }));
}
const rules = (c: Element) => [...c.querySelectorAll<HTMLElement>(".row.next[data-rule]")].map((r) => r.dataset.rule);
const page = () => render(<V2TestProvider><NowPage /><input aria-label="field" /></V2TestProvider>);
const key = (k: string, o: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(window, { key: k, ...o }); });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-05 09:00"))); serveEmpty(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.location.hash = ""; localStorage.clear(); });

describe("simEnabled", () => {
  it("?sim=1 in the hash, or the localStorage switch; a throwing storage reads as off", () => {
    expect([simEnabled("#/v2/now?sim=1"), simEnabled("#/v2/now?world=omote&sim=1"), simEnabled("#/v2/now"), simEnabled("#/v2/now?sim=0")]).toEqual([true, true, false, false]);
    localStorage.setItem(SIM_KEY, "1");
    expect(simEnabled("#/v2/now")).toBe(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(simEnabled("#/v2/now")).toBe(false);
  });
});

describe("情境模拟 on the now page", () => {
  it("off by default: no rail, digits do nothing", async () => {
    window.location.hash = "#/v2/now";
    const { container } = page();
    await waitFor(() => expect(container.textContent).toContain("没有建议"));
    key("2");
    expect(screen.queryByRole("navigation", { name: "情境模拟" })).toBeNull();
    expect(rules(container)).toEqual([]);
  });

  it("?sim=1: the rail; 1–4 switch moments on the real rules; 0 goes back to live data", async () => {
    window.location.hash = "#/v2/now?sim=1";
    const { container } = page();
    await screen.findByRole("navigation", { name: "情境模拟" });
    key("2");
    await waitFor(() => expect(rules(container)).toEqual(["unlinked.stale", "week.unlinked", "dayplan.untouched"]));
    expect(screen.getByRole("button", { name: "2 · 14:20 白天" }).getAttribute("aria-pressed")).toBe("true");
    key("4");
    await waitFor(() => expect(rules(container)).toEqual(["week.unlinked", "report.undownloaded", "dayplan.confirm"]));
    key("0");
    await waitFor(() => expect(rules(container)).toEqual([]));
  });

  it("ignores digits typed into a field, auto-repeat and modifier chords", async () => {
    window.location.hash = "#/v2/now?sim=1";
    const { container } = page();
    await screen.findByRole("navigation", { name: "情境模拟" });
    act(() => { fireEvent.keyDown(screen.getByRole("textbox", { name: "field" }), { key: "1" }); });
    key("1", { repeat: true });
    key("1", { ctrlKey: true });
    expect(rules(container)).toEqual([]);
  });

  it("the localStorage switch and the rail buttons work too", async () => {
    localStorage.setItem(SIM_KEY, "1");
    window.location.hash = "#/v2/now";
    const { container } = page();
    fireEvent.click(await screen.findByRole("button", { name: "3 · 16:30 週報" }));
    await waitFor(() => expect(rules(container)).toEqual(["week.unlinked", "report.undownloaded", "plan.stale"]));
  });
});
