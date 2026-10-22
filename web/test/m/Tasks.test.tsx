// web/test/m/Tasks.test.tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoDeliverable, Task } from "../../src/api/types";
import { Tasks } from "../../src/m/pages/Tasks";
import { parseMRoute } from "../../src/m/route";
import { session, task } from "../../src/predict/fixtures";
import { V2TestProvider } from "../helpers";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const T: Task[] = [{ ...task("T1", "alpha 改修"), requester: "営業部", deliverables: ["手順書.docx"] }, { ...task("T2", "beta 調査", "hold"), requester: "経理部" }, task("T3", "gamma 設計", "done")];
const auto = (key: string, verdict: AutoDeliverable["verdict"]): AutoDeliverable => ({ kind: "file", key, keys: [key], title: null, verdict, source: "rule", reason: "", sessions: [], last_at: "2026-10-01T00:00:00Z" });
function serve() {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u).split("?")[0];
    if (url === "/api/tasks/totals") return json([{ id: "T1", total_minutes: 600, last_date: "2026-10-02" }, { id: "T2", total_minutes: 60, last_date: "2026-09-20" }]);
    if (url === "/api/tasks") return json(T);
    if (url === "/api/tasks/T1") return json({ task: T[0], notes: [], total_minutes: 600,
      sessions: Array.from({ length: 12 }, (_, i) => session(`s${i}`, `2026-09-${String(10 + i).padStart(2, "0")} 10:00`, `2026-09-${String(10 + i).padStart(2, "0")} 11:00`, { task_id: "T1", summary: `第${i}回` })),
      auto_deliverables: [auto("/w/out/report.xlsx", "in"), auto("/w/tmp/scratch.txt", "out")] });
    if (url.startsWith("/api/tasks/")) return json({ error: "not found" }, 404);
    return json({});
  }));
}
function Follow() {
  const [h, setH] = useState(window.location.hash);
  useEffect(() => { const f = () => setH(window.location.hash); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return <Tasks route={parseMRoute(h)} />;
}
const page = (hash: string) => render(<V2TestProvider><Tasks route={parseMRoute(hash)} /></V2TestProvider>);

beforeEach(() => { window.location.hash = "#/m/tasks"; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.location.hash = ""; });

describe("案件 (phone)", () => {
  it("shows open tasks by default, most recent first; chips and search filter locally", async () => {
    serve();
    const { container } = page("#/m/tasks");
    await waitFor(() => expect([...container.querySelectorAll(".m-row .m-t1")].map((e) => e.textContent)).toEqual(["alpha 改修"]));
    expect(container.querySelector(".m-row .m-side")).toHaveTextContent("10.0h");
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(container.querySelectorAll(".m-row")).toHaveLength(3);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "経理" } });
    expect([...container.querySelectorAll(".m-row .m-t1")].map((e) => e.textContent)).toEqual(["beta 調査"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("没有符合的案件")).toBeInTheDocument();
  });
  it("tapping a task puts it in the address", async () => {
    serve();
    const { container } = page("#/m/tasks");
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(1));
    fireEvent.click(container.querySelector(".m-row")!);
    expect(window.location.hash).toBe("#/m/tasks/T1");
  });
  it("status filter is a labelled Seg; rows carry DotBar and a chevron", async () => {
    serve();
    const { container } = page("#/m/tasks");
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(1));
    expect(screen.getByRole("group", { name: "状态" })).toBeInTheDocument();
    expect(container.querySelector(".m-row .m-dots")).not.toBeNull();
    expect(container.querySelector(".m-row .m-chev")).toHaveTextContent("›");
  });
  it("B1: closing a sheet opened from the list goes back once", async () => {
    serve();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { container } = render(<V2TestProvider><Follow /></V2TestProvider>);
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(1));
    fireEvent.click(container.querySelector(".m-row")!);
    expect(window.location.hash).toBe("#/m/tasks/T1");
    fireEvent.click(await screen.findByRole("button", { name: "关闭" }));
    expect(back).toHaveBeenCalledTimes(1);
  });
  it("B1: Back from a list-opened sheet clears the flag, so a later deep link closes by replace", async () => {
    serve();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { container } = render(<V2TestProvider><Follow /></V2TestProvider>);
    await waitFor(() => expect(container.querySelectorAll(".m-row")).toHaveLength(1));
    fireEvent.click(container.querySelector(".m-row")!);
    await screen.findByRole("dialog");
    act(() => { window.location.hash = "#/m/tasks"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => { window.location.hash = "#/m/tasks/T2"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    fireEvent.click(await screen.findByRole("button", { name: "关闭" }));
    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/m/tasks");
  });
  it("B1: a deep-linked sheet closes by replacing the hash, not history.back", async () => {
    serve();
    window.location.hash = "#/m/tasks/T1";
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    page("#/m/tasks/T1");
    fireEvent.click(await screen.findByRole("button", { name: "关闭" }));
    expect(back).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/m/tasks");
  });
  it("the sheet: total, the 10 latest sessions, hand-picked and accepted automatic deliverables", async () => {
    serve();
    page("#/m/tasks/T1");
    const dlg = await screen.findByRole("dialog", { name: "alpha 改修" });
    await waitFor(() => expect(dlg.querySelector(".m-kv")).toHaveTextContent("10.0h"));   // same format as the list
    expect(dlg).toHaveTextContent("第11回");
    expect(dlg).not.toHaveTextContent("第1回");
    expect(dlg).toHaveTextContent("手順書.docx");
    expect(dlg).toHaveTextContent("report.xlsx");
    expect(dlg).not.toHaveTextContent("scratch.txt");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.location.hash).toBe("#/m/tasks");
  });
  it("unknown task id: error with retry, and the sheet still closes", async () => {
    serve();
    page("#/m/tasks/NOPE");
    expect(await screen.findByRole("button", { name: "重新载入" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.location.hash).toBe("#/m/tasks");
  });
});
