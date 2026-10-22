import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../src/api/queries";
import MobileApp from "../../src/m/MobileApp";
import { PlanRow } from "../../src/m/pages/PlanRow";
import { __resetMobileOptOutForTests } from "../../src/m/route";
import { DEFAULT_PREFS } from "../../src/prefs/defaults";
import { dayItem, task } from "../../src/predict/fixtures";
import { taskBadgeOf } from "../../src/ui/taskBadges";
import { V2TestProvider } from "../helpers";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const T = [{ ...task("T20261001-01", "alpha 改修"), badge_obj: "phosphor:cat", badge_color: 3 }];
let calls: string[] = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u), p = url.split("?")[0];
    calls.push(p);
    if (p.startsWith("/api/prefs")) return json(DEFAULT_PREFS);
    if (p === "/api/tasks") return json(T);
    if (p === "/api/tasks/totals") return json([]);
    if (p === "/api/tasks/T20261001-01") return json({ task: T[0], notes: [], total_minutes: 0, sessions: [], auto_deliverables: [] });
    if (p.startsWith("/api/weeks/")) return json({ week: "x", days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    if (p.startsWith("/api/day-plans/")) return json({ error: "no plan" }, 404);
    return json([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); __resetMobileOptOutForTests(); window.location.hash = ""; });
const app = (hash: string) => { window.location.hash = hash; return render(<QueryClientProvider client={createQueryClient()}><MobileApp /></QueryClientProvider>); };
const badge = () => screen.findByRole("img", { name: "1001-01" }, { timeout: 5000 }) as Promise<HTMLImageElement>;

describe("phone badges", () => {
  it("the shell loads the task list on any page (#/m/plan) so badges resolve", async () => {
    app("#/m/plan");
    await waitFor(() => expect(taskBadgeOf("T20261001-01")?.color).toBe(3));
    expect(calls).toContain("/api/tasks");
  });
  it("task rows: a badge before the title, the title text unchanged", async () => {
    const { container } = app("#/m/tasks");
    await badge();
    const row = container.querySelector(".m-row")!;
    expect(row.querySelector(".tbadge")!.getAttribute("data-task")).toBe("T20261001-01");
    expect(row.querySelector(".m-t1")!.textContent).toBe("alpha 改修");
  });
  it("the phone theme picks the material: light → 表, dark → 里", async () => {
    localStorage.setItem("wl-m-theme", "light");
    const a = app("#/m/tasks");
    expect(decodeURIComponent((await badge()).src)).toContain("sand-");
    a.unmount();
    localStorage.setItem("wl-m-theme", "dark");
    app("#/m/tasks");
    expect(decodeURIComponent((await badge()).src)).not.toContain("sand-");
  });
  it("task sheet: an L badge in the body, the dialog still named by the title", async () => {
    app("#/m/tasks/T20261001-01");
    const dlg = await screen.findByRole("dialog", { name: "alpha 改修" }, { timeout: 5000 });
    expect((await within(dlg).findByRole("img", { name: "1001-01" }, { timeout: 5000 })).getAttribute("height")).toBe("56");
  });
  it("plan row: linked tasks as first badge + k, outside the text column", async () => {
    const item = dayItem({ id: "d1", text: "x", tasks: [
      { id: "T20261001-01", title: "a", status: "open" }, { id: "T20261002-01", title: "b", status: "open" }] });
    const { container } = render(<V2TestProvider><PlanRow item={item} /></V2TestProvider>);
    await badge();
    expect(container.querySelector(".m-col .tbadge")).toBeNull();
    expect(container.querySelector(".tb-more")!.textContent).toBe("+1");
  });
});
