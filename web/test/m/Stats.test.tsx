import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Stats } from "../../src/m/pages/Stats";
import { parseMRoute } from "../../src/m/route";
import { J } from "../../src/predict/fixtures";
import { V2TestProvider } from "../helpers";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const urls: string[] = [];
function serve() {
  urls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u); urls.push(url);
    if (url.startsWith("/api/dashboard")) return json({ overview: { minutes: 600, active_days: 3, sessions: 31, tasks_done: 1, tokens: 8_900_000, cost_usd: 12345.67, cost_partial: true },
      time: { by_project: [], by_requester: [], weekly: [], unlinked_note_minutes: 0, unlinked_minutes: 30,
        by_task: Array.from({ length: 8 }, (_, i) => ({ task_id: `T${i}`, title: `案件${i}`, minutes: 400 - i * 40 })) } });
    const w = /\/api\/weeks\/(\d{4}-W\d{2})\/timeline/.exec(url);
    if (w) return json({ week: w[1], days: w[1] === "2026-W40" ? [{ date: "2026-10-01", minutes: 300, wall_minutes: 240, sessions: [], notes: [] }, { date: "2026-10-02", minutes: 200, wall_minutes: 120, sessions: [], notes: [] }] : [], total_minutes: 0, unassigned: 0, hidden: 0 });
    return json({});
  }));
}
const page = (hash: string) => render(<V2TestProvider><Stats route={parseMRoute(hash)} /></V2TestProvider>);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("统计 (phone)", () => {
  it("this week: work time from the timeline, total / tokens / cost from the dashboard, 7 day columns", async () => {
    serve();
    const { container } = page("#/m/stats");
    expect(await screen.findByRole("img", { name: "6.0h" })).toBeInTheDocument();   // wall 240 + 120 min
    expect(screen.getByRole("img", { name: "10.0h" })).toBeInTheDocument();         // dashboard minutes 600
    expect(screen.getByRole("group", { name: "范围" })).toBeInTheDocument();
    expect(screen.getByText("8.9M")).toBeInTheDocument();
    expect(screen.getByText("$12,345.67+")).toBeInTheDocument();
    expect(screen.getByText(/部分 session 的费用未计入/)).toBeInTheDocument();
    expect(container.querySelectorAll(".m-cols > button")).toHaveLength(7);
    expect(container.querySelectorAll(".m-rk:not(.un)")).toHaveLength(6);   // top 5 + 其他
    expect(container.querySelectorAll(".m-rk:not(.un) .m-dots")).toHaveLength(6);
    const un = container.querySelector(".m-rk.un")!;                  // 未关联 kept out of the ranking
    expect(un.textContent).toContain("未关联");
    expect(un.textContent).toContain("0.5h");
    expect(urls.some((u) => u.startsWith("/api/dashboard?from=2026-09-28&to=2026-10-04"))).toBe(true);
  });
  it("tapping a day column shows its date and hours; tapping again clears", async () => {
    serve();
    const { container } = page("#/m/stats");
    await screen.findByRole("img", { name: "6.0h" });
    const cols = () => Array.from(container.querySelectorAll<HTMLButtonElement>(".m-cols > button"));
    fireEvent.click(cols()[3]);                                       // Thu 10/1
    expect(screen.getByText("10/1 · 4.0h")).toBeInTheDocument();
    expect(cols()[3]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cols()[3]);
    expect(screen.queryByText("10/1 · 4.0h")).toBeNull();
    expect(cols()[3]).toHaveAttribute("aria-pressed", "false");
  });
  it("a range change clears the selection, also when coming back to the range", async () => {
    serve();
    const ui = (hash: string) => <V2TestProvider><Stats route={parseMRoute(hash)} /></V2TestProvider>;
    const { container, rerender } = render(ui("#/m/stats"));
    await screen.findByRole("img", { name: "6.0h" });
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>(".m-cols > button")[3]);
    expect(screen.getByText("10/1 · 4.0h")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "本月" }));
    rerender(ui("#/m/stats?range=month"));
    await waitFor(() => expect(container.querySelectorAll(".m-cols > button")).toHaveLength(31));
    fireEvent.click(screen.getByRole("button", { name: "本周" }));
    rerender(ui("#/m/stats"));
    await waitFor(() => expect(container.querySelectorAll(".m-cols > button")).toHaveLength(7));
    expect(container.querySelectorAll(".m-cols > button[aria-pressed=true]")).toHaveLength(0);
    expect(container.querySelector(".m-pick")!.textContent!.trim()).toBe("");
    expect(screen.getByRole("button", { name: "10/1" })).toHaveAttribute("aria-pressed", "false");
  });
  it("this month asks every covering week and draws 31 columns; today draws none", async () => {
    serve();
    const { container, unmount } = page("#/m/stats?range=month");
    await waitFor(() => expect(container.querySelectorAll(".m-cols > button")).toHaveLength(31));
    for (const w of ["2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44"]) expect(urls.some((u) => u.includes(`/api/weeks/${w}/`))).toBe(true);
    unmount();
    const t = page("#/m/stats?range=today");
    await screen.findByRole("img", { name: "2.0h" });                                   // today's wall: 120 min
    expect(t.container.querySelector(".m-cols")).toBeNull();
  });
});
