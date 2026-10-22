import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../src/api/types";
import { TasksPage } from "../src/pages/TasksPage";
import { J, machine, session, task } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { note, weekTl } from "./tl-fixtures";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const recv = (t: Task, received_at: string): Task => ({ ...t, received_at });
const TASKS = [
  recv(task("T20260901-01", "alpha 改修"), "2026-09-01"),
  recv(task("T20260915-01", "beta 調査", "hold"), "2026-09-15"),
  recv(task("T20260915-02", "gamma 完了", "done"), "2026-09-15"),
  recv(task("T20260920-01", "delta 設計"), "2026-09-20"),
];
const W40 = [
  session("a1", "2026-09-29 10:00", "2026-09-29 11:30", { task_id: "T20260901-01" }),
  session("d1", "2026-10-02 13:30", "2026-10-02 14:15", { task_id: "T20260920-01" }),
];
let failTotals = false;
function serve() {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (url.startsWith("/api/machines")) return json([machine("macmini", "2026-10-02 14:18")]);
    if (url.startsWith("/api/weeks/2026-W40/timeline")) return json(weekTl("2026-W40", "2026-09-28", W40, [note("n1", "2026-10-01T12:00:00", { minutes: 30, task_id: "T20260915-01" })]));
    // 404, not 500: a 500 is retried with back-off (seconds), a 404 fails at once — same UI either way
    if (url === "/api/tasks/totals") return failTotals ? json({ error: "not found" }, 404)
      : json([{ id: "T20260901-01", total_minutes: 1260, last_date: "2026-09-29" }, { id: "T20260915-01", total_minutes: 30, last_date: "2026-10-01" }]);
    if (url.startsWith("/api/tasks")) return json(TASKS);
    if (url.startsWith("/api/requesters")) return json([]);
    return json({});
  }));
}
const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const rows = (c: Element) => [...c.querySelectorAll<HTMLElement>(".trow[data-id]")].map((r) => r.dataset.id);
const page = (hash: string) => { window.location.hash = hash; return render(<V2TestProvider><TasksPage /></V2TestProvider>); };

beforeEach(() => { failTotals = false; serve(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("TasksPage (#/v2/tasks)", () => {
  it("进行中 + 保留 by default, newest received first; counts on the keys; the week and its total in the foot", async () => {
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(rows(container)).toEqual(["T20260920-01", "T20260915-01", "T20260901-01"]));
    const text = ink(container);
    expect(text).toContain("案件 4");
    expect(text).toContain("进行中 2");
    expect(text).toContain("保留 1");
    expect(text).toContain("完了 1");
    expect(text).toContain("本周 9/28–10/2");
    // 45 + 30 (the note) + 90 minutes = 2.75 h
    expect(text).toContain("显示 3 / 4 件 · 本周合计 2.8H");
  });
  it("a row: status, code, received, name, 本周, 累计, 最近 (运行中 beats a date)", async () => {
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const row = (id: string) => ink(container.querySelector(`.trow[data-id="${id}"]`)!);
    await waitFor(() => expect(row("T20260901-01")).toContain("21.0"));
    expect(row("T20260901-01")).toBe(["进行中", "9/1", "alpha 改修", "r", "1.5", "21.0", "9/29"].join("|"));
    expect(await within(container.querySelector<HTMLElement>('.trow[data-id="T20260901-01"]')!).findByRole("img", { name: "0901-01" })).toBeTruthy();
    expect(row("T20260901-01")).not.toContain("0901-01");
    expect(row("T20260920-01")).toContain("运行中");
    // no totals row yet for a task (created after they were computed): 0, never "--"
    expect(row("T20260920-01")).toContain("|0.0|");
    expect(row("T20260915-01")).toContain("保留");
    expect(container.querySelector('.trow[data-id="T20260915-01"] .lamp.amber')).not.toBeNull();
  });
  it("the filter keys write ?status=, keep at least one on, and 全部 shows 完了 too", async () => {
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: /进行中/ }));
    await waitFor(() => expect(window.location.hash).toBe("#/v2/tasks?status=hold"));
    expect(rows(container)).toEqual(["T20260915-01"]);
    fireEvent.click(screen.getByRole("button", { name: /保留/ }));       // the last one on: stays on
    expect(window.location.hash).toBe("#/v2/tasks?status=hold");
    fireEvent.click(screen.getByRole("button", { name: "全部" }));
    await waitFor(() => expect(rows(container)).toHaveLength(4));
    expect(window.location.hash).toBe("#/v2/tasks?status=all");
    expect(container.querySelector('.trow[data-id="T20260915-02"]')!.classList.contains("done")).toBe(true);
  });
  it("a row opens its task in the address, by click or Enter; ?world= stays", async () => {
    const { container } = page("#/v2/tasks?world=omote");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(container.querySelector('.trow[data-id="T20260901-01"]')!);
    expect(window.location.hash).toBe("#/v2/tasks/T20260901-01?world=omote");
    fireEvent.keyDown(container.querySelector('.trow[data-id="T20260920-01"]')!, { key: "Enter" });
    expect(window.location.hash).toBe("#/v2/tasks/T20260920-01?world=omote");
  });
  it("totals failing on their own: the rows stay, 累计 / 最近 read --, and the board says why", async () => {
    failTotals = true;
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(ink(container)).toContain("累计加载失败"), { timeout: 4000 });
    const r = ink(container.querySelector('.trow[data-id="T20260901-01"]')!).split("|");
    expect(r.slice(-2)).toEqual(["--", "9/29"]);       // 最近 still knows this week's day
  });
  it("＋ 新建案件 opens the create form", async () => {
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新建案件" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
  it("the create form closed by 取消 or Esc hands focus back to ＋ 新建案件", async () => {
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const btn = screen.getByRole("button", { name: "＋ 新建案件" });
    for (const close of [() => fireEvent.click(screen.getByRole("button", { name: "取消" })),
                         () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })]) {
      btn.focus();
      fireEvent.click(btn);
      await screen.findByRole("dialog");
      close();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(btn));
    }
  });
});
