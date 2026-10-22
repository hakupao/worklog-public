import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as queries from "../src/api/queries";
import { TasksPage } from "../src/pages/TasksPage";
import { J, session, task } from "../src/predict/fixtures";
import type { LedProps } from "../src/ui/Led";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { tkServer } from "./tk-serve";

// Boards and strips draw on canvas (absent in jsdom): stand-ins that expose what each slot was given.
vi.mock("../src/ui/Led", () => ({
  Led: ({ text, tier = 1 }: LedProps) => <i data-tier={tier}>{typeof text === "string" ? text : text.map((s) => s.t).join("")}</i>,
}));
vi.mock("../src/pages/tasks/DayStrip", () => ({
  DayStrip: ({ max, color }: { max: number; color: string }) => <b className="strip" data-max={max} data-color={color} />,
}));
vi.mock("../src/api/queries", async (orig) => {
  const m = await orig<typeof import("../src/api/queries")>();
  return { ...m, useTaskTotals: vi.fn(m.useTaskTotals) };
});

const page = (hash: string) => { window.location.hash = hash; return render(<V2TestProvider><TasksPage /></V2TestProvider>); };
const row = (c: Element, id: string) => c.querySelector<HTMLElement>(`.trow[data-id="${id}"]`);
const strip = (c: Element, id: string) => row(c, id)!.querySelector<HTMLElement>(".strip")!.dataset;

let srv: ReturnType<typeof tkServer>;
beforeEach(() => {
  srv = tkServer({
    tasks: [task("T20260901-01", "alpha 改修"), { ...task("T20260915-02", "gamma 完了", "done"), received_at: "2026-09-15" }],
    sessions: [
      session("a1", "2026-09-29 10:00", "2026-09-29 11:30", { task_id: "T20260901-01" }),
      session("g1", "2026-09-30 09:00", "2026-09-30 14:00", { task_id: "T20260915-02" }),
    ],
    notes: [],
  });
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20")));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("TasksPage rows", () => {
  it("each slot keeps its tier whatever the status (a 完了 row dims by its .done class, not by a rebuilt board)", async () => {
    const { container } = page("#/v2/tasks?status=all");
    await waitFor(() => expect(row(container, "T20260915-02")).not.toBeNull());
    const tiers = (id: string) => [...row(container, id)!.querySelectorAll<HTMLElement>("[data-tier]")].map((e) => e.dataset.tier);
    expect(row(container, "T20260915-02")!.classList.contains("done")).toBe(true);
    expect(tiers("T20260915-02")).toEqual(tiers("T20260901-01"));
  });
  it("the 每日 strip scales to the rows shown: a filtered-out 完了 task's big day no longer flattens the rest", async () => {
    const { container } = page("#/v2/tasks?status=all");
    await waitFor(() => expect(row(container, "T20260915-02")).not.toBeNull());
    expect(strip(container, "T20260901-01").max).toBe("300");
    window.location.hash = "#/v2/tasks";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(row(container, "T20260915-02")).toBeNull());
    expect(strip(container, "T20260901-01").max).toBe("90");
  });
  it("a 完了 row's strip: warm grey in 里, the prototype's #c4cbd4 in 表", async () => {
    const { container, unmount } = page("#/v2/tasks?status=all");
    await waitFor(() => expect(row(container, "T20260915-02")).not.toBeNull());
    expect(strip(container, "T20260915-02").color).toBe("#6d6150");
    unmount();
    applyWorld("omote");
    const c2 = page("#/v2/tasks?status=all").container;
    await waitFor(() => expect(row(c2, "T20260915-02")).not.toBeNull());
    expect(strip(c2, "T20260915-02").color).toBe("#c4cbd4");
  });
  it("the empty state is a list item of the list", async () => {
    const { container } = page("#/v2/tasks?status=hold");
    await waitFor(() => expect(container.querySelector(".trow.empty")).not.toBeNull());
    expect(container.querySelector(".trow.empty")!.getAttribute("role")).toBe("listitem");
  });
  it("an odd /api/tasks answer (not an array) is not loaded, not a crash", async () => {
    srv.failNext((_m, u) => (u === "/api/tasks" ? new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }) : null));
    const { container } = page("#/v2/tasks");
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".tk-wait")).not.toBeNull();
  });
  it("while loading the title has no count and no trailing space", () => {
    const { container } = page("#/v2/tasks");
    expect(container.querySelector(".sec [data-tier]")!.textContent).toBe("案件");
  });
  it("累计 reads through useTaskTotals (the one hook on [\"task-totals\"])", async () => {
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(row(container, "T20260901-01")).not.toBeNull());
    expect(vi.mocked(queries.useTaskTotals)).toHaveBeenCalled();
  });
});
