import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "../src/components/Toast";
import { TasksPage } from "../src/pages/TasksPage";
import type { AutoDeliverable } from "../src/api/types";
import { J, session } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { tkServer } from "./tk-serve";

const page = (hash: string) => {
  window.location.hash = hash;
  return render(<V2TestProvider><TasksPage /><ToastHost /></V2TestProvider>);
};
const drawer = () => screen.getByRole("dialog", { name: /案件 0901-01/ });
const patches = (calls: ReturnType<typeof tkServer>["calls"]) => calls.filter((c) => c.method === "PATCH" && c.url.startsWith("/api/tasks/")).map((c) => { const { updated_at: _u, ...b } = c.body!; return b; });
/** InlineEdit: click the resting text, type, press Enter. */
async function edit(label: string, value: string) {
  const d = drawer();
  fireEvent.click(within(d).getByRole("button", { name: new RegExp(label) }));
  const f = await within(d).findByRole("textbox", { name: label }).catch(() => within(d).getByLabelText(label));
  fireEvent.change(f, { target: { value } });
  fireEvent.keyDown(f, { key: "Enter" });
}

let srv: ReturnType<typeof tkServer>;
beforeEach(() => { srv = tkServer(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("案件 drawer — fields", () => {
  it("opens from the address with the task's fields, 合计 without the hidden session, and this week's bars", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog", { name: /案件 0901-01/ });
    await within(d).findByText("alpha 改修");
    expect(within(d).getByText("T20260901-01")).toBeTruthy();
    const img = await within(d.querySelector<HTMLElement>(".dw-h")!).findByRole("img", { name: "0901-01" });
    expect(img.getAttribute("height")).toBe("56");
    expect(d.querySelector(".dw-h .code")!.textContent).toBe("0901-01");
    expect(within(d).getByText("田中さん")).toBeTruthy();
    expect(within(d).getByText("order")).toBeTruthy();
    expect(within(d).getByText("まず帳票から")).toBeTruthy();
    // 90 min + 30 min note; the hidden 30 min session is 不计入
    expect(d.querySelector(".sum .big")!.textContent).toBe("2.0h 合计");
    await waitFor(() => expect(d.textContent).toContain("本周 2.0h · 2 个会话"));
    // cost: only the not-hidden session's $2
    expect(d.textContent).toContain("AI 费用 $2.00");
    expect([...d.querySelectorAll(".wk .d b")].map((b) => b.textContent)).toEqual(["–", "1.5", "0.5", "–", "–"]);
    await waitFor(() => expect(document.activeElement).toBe(d));
  });
  it("案件名: saved trimmed; an emptied one is refused with a hint and nothing sent", async () => {
    page("#/v2/tasks/T20260901-01");
    await within(await screen.findByRole("dialog")).findByText("alpha 改修");
    await edit("案件名", "   ");
    expect(await screen.findByText("案件名不能为空")).toBeTruthy();
    expect(patches(srv.calls)).toEqual([]);
    await edit("案件名", "  alpha 改修 v2 ");
    await waitFor(() => expect(patches(srv.calls)).toEqual([{ title: "alpha 改修 v2" }]));
  });
  it("依頼元: Enter adds (not while composing), × removes, the last one has no ×; saved as one 、-joined string", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("田中さん");
    expect(within(d).queryByRole("button", { name: "删除依頼元 田中さん" })).toBeNull();
    const box = within(d).getByRole("combobox", { name: "追加依頼元" });
    fireEvent.change(box, { target: { value: "佐藤さん" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(patches(srv.calls)).toEqual([]);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(patches(srv.calls)).toEqual([{ requester: "田中さん、佐藤さん" }]));
    await waitFor(() => expect((box as HTMLInputElement).value).toBe(""));
    fireEvent.click(await within(d).findByRole("button", { name: "删除依頼元 田中さん" }));
    await waitFor(() => expect(patches(srv.calls).at(-1)).toEqual({ requester: "佐藤さん" }));
  });
  it("status: the transitions out of 进行中; done_at is never sent; a double click sends one PATCH", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    const done = await within(d).findByRole("button", { name: "标为完了" });
    expect(within(d).getByRole("button", { name: "保留" })).toBeTruthy();
    fireEvent.click(done); fireEvent.click(done);
    await waitFor(() => expect(within(d).getByRole("button", { name: "改回进行中" })).toBeTruthy());
    expect(patches(srv.calls)).toEqual([{ status: "done" }]);
    expect(within(d).getByText("2026-10-02")).toBeTruthy();            // the server's done_at, read back
  });
  it("status: from 完了 back to 进行中 (primary) or straight to 保留, like the old drawer", async () => {
    srv.db.tasks[0].status = "done";
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    const reopen = await within(d).findByRole("button", { name: "改回进行中" });
    expect(reopen.classList.contains("pri")).toBe(true);
    const hold = within(d).getByRole("button", { name: "保留" });
    expect(hold.classList.contains("pri")).toBe(false);
    fireEvent.click(hold);
    await waitFor(() => expect(patches(srv.calls)).toEqual([{ status: "hold" }]));
  });
  it("依頼元 ×: a double click sends one PATCH", async () => {
    srv.db.tasks[0].requester = "田中さん、佐藤さん、鈴木さん";
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    const x = await within(d).findByRole("button", { name: "删除依頼元 佐藤さん" });
    fireEvent.click(x); fireEvent.click(x);
    await waitFor(() => expect(patches(srv.calls)).toEqual([{ requester: "田中さん、鈴木さん" }]));
    await new Promise((r) => setTimeout(r, 50));
    expect(patches(srv.calls)).toHaveLength(1);
  });
  it("本周 reads -- when the week is not loaded (never 0.0h)", async () => {
    srv.failNext((_m, u) => (u.startsWith("/api/weeks/") ? new Response(JSON.stringify({ error: "not found" }), { status: 404 }) : null));
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("alpha 改修");
    expect(d.querySelector(".sum .sit")!.textContent).toMatch(/^本周 -- · /);
  });
  it("status: the clicked button goes away, focus lands on the row's first transition (not on the page)", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    const done = await within(d).findByRole("button", { name: "标为完了" });
    done.focus();
    fireEvent.click(done);
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("button", { name: "改回进行中" })));
  });
  it("依頼元 ×: focus moves to the next ×, else the previous one, else the add box", async () => {
    srv.db.tasks[0].requester = "田中さん、佐藤さん、鈴木さん";
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    fireEvent.click(await within(d).findByRole("button", { name: "删除依頼元 佐藤さん" }));
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("button", { name: "删除依頼元 鈴木さん" })));
    fireEvent.click(within(d).getByRole("button", { name: "删除依頼元 鈴木さん" }));
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("combobox", { name: "追加依頼元" })));
  });
  it("手动工时 is HOURS for the whole task (past 24h is fine); ↺ goes back to automatic", async () => {
    page("#/v2/tasks/T20260901-01");
    await within(await screen.findByRole("dialog")).findByText("自动（按会话计算）");
    await edit("手动工时", "120");
    await waitFor(() => expect(patches(srv.calls)).toEqual([{ hours_manual: 120 }]));
    await within(drawer()).findByText(/120\.0h/);
    fireEvent.click(within(drawer()).getByRole("button", { name: /手动工时/ }));
    fireEvent.mouseDown(await within(drawer()).findByRole("button", { name: "↺ 恢复自动工时" }));
    fireEvent.click(within(drawer()).getByRole("button", { name: "↺ 恢复自动工时" }));
    await waitFor(() => expect(patches(srv.calls).at(-1)).toEqual({ hours_manual: null }));
  });
  it("a task that does not exist says so; Esc closes back to the list with focus on a stable place", async () => {
    const { container } = page("#/v2/tasks/T19990101-01");
    const d = await screen.findByRole("dialog");
    expect(await within(d).findByText("案件不存在（可能已被删除）")).toBeTruthy();
    act(() => { fireEvent.keyDown(d, { key: "Escape" }); });
    await waitFor(() => expect(window.location.hash).toBe("#/v2/tasks"));
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(".tk-list")));
  });
  it("closing returns focus to the row it was opened from", async () => {
    const { container } = page("#/v2/tasks");
    await waitFor(() => expect(container.querySelector('.trow[data-id="T20260901-01"]')).not.toBeNull());
    const row = container.querySelector<HTMLElement>('.trow[data-id="T20260901-01"]')!;
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    const d = await screen.findByRole("dialog", { name: /案件 0901-01/ });
    await waitFor(() => expect(document.activeElement).toBe(d));
    fireEvent.click(within(d).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });
});

describe("案件 drawer — new task", () => {
  it("＋ 新建案件: after 创建 the drawer opens on the new task and a toast names it", async () => {
    page("#/v2/tasks");
    fireEvent.click(await screen.findByRole("button", { name: "＋ 新建案件" }));
    const form = await screen.findByRole("dialog", { name: "新建案件" });
    fireEvent.change(within(form).getByLabelText("依頼元"), { target: { value: "佐藤さん" } });
    fireEvent.change(within(form).getByLabelText("案件名"), { target: { value: "epsilon 新規" } });
    fireEvent.click(within(form).getByRole("button", { name: "创建" }));
    expect(await screen.findByText("已新建 1002-01")).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe("#/v2/tasks/T20261002-01"));
    const d = await screen.findByRole("dialog", { name: /案件 1002-01/ });
    expect(await within(d).findByText("epsilon 新規")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "新建案件" })).toBeNull();
  });
});

describe("案件 drawer — 成果物", () => {
  const auto = (key: string, over: Partial<AutoDeliverable> = {}): AutoDeliverable => ({
    kind: "file", key, keys: [key], title: null, verdict: "in", source: "rule", reason: "dir:deliverable",
    sessions: ["a1"], last_at: "2026-09-29T02:30:00Z", ...over,
  });
  it("自动成果物: in and pending ones listed (relative to the session's cwd, with where the verdict came from), × takes one out, ＋ on 已排除 puts it back", async () => {
    srv = tkServer({ auto: { "T20260901-01": [
      auto("/w/repo/成果物/設計.xlsx"),
      auto("/w/repo/docs/spec.md", { verdict: "pending", source: null, reason: "" }),
      auto("https://claude.ai/artifact/A1", { kind: "artifact", title: "週報ページ", reason: "artifact" }),
      auto("/w/repo/notes.md", { verdict: "out", source: "model", reason: "调查笔记" }),
    ] } });
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    expect(await within(d).findByText("成果物/設計.xlsx")).toBeTruthy();
    const h = within(d).getByRole("heading", { name: /成果物/ });
    // counted as the 週報 counts them: in only (the pending one is listed, tagged, not counted)
    expect(h.querySelector(".n")!.textContent).toBe("2");
    expect(within(d).getByText("docs/spec.md").closest("li")!.textContent).toContain("待判定");
    const link = within(d).getByRole("link", { name: "週報ページ" });
    expect(link.getAttribute("href")).toBe("https://claude.ai/artifact/A1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(within(d).queryByText("notes.md")).toBeNull();

    fireEvent.click(within(d).getByRole("button", { name: "排除成果物 成果物/設計.xlsx" }));
    await waitFor(() => expect(srv.calls.filter((c) => c.url === "/api/deliverable-verdicts").map((c) => c.body))
      .toEqual([{ key: "/w/repo/成果物/設計.xlsx", kind: "file", verdict: "out" }]));
    await waitFor(() => expect(within(d).queryByText("成果物/設計.xlsx")).toBeNull());
    expect(patches(srv.calls)).toEqual([]);

    fireEvent.click(within(d).getByRole("button", { name: "已排除（2）" }));
    expect(within(d).getByText("notes.md").closest("li")!.textContent).toContain("AI 判定");
    fireEvent.click(within(d).getByRole("button", { name: "收回成果物 notes.md" }));
    await waitFor(() => expect(srv.calls.filter((c) => c.url === "/api/deliverable-verdicts").at(-1)!.body)
      .toEqual({ key: "/w/repo/notes.md", kind: "file", verdict: "in" }));
    await waitFor(() => expect(within(d).getByText("notes.md").closest("li")!.textContent).toContain("已确认"));
    // ＋ on the last excluded one folds the list and hands focus to the add box
    fireEvent.click(within(d).getByRole("button", { name: "收回成果物 成果物/設計.xlsx" }));
    await waitFor(() => expect(within(d).queryByRole("button", { name: /已排除/ })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("textbox", { name: "新增成果物" })));
  });
  it("a server without auto_deliverables (before the migration) shows the hand-picked list alone", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    expect(await within(d).findByText("还没有成果物")).toBeTruthy();
    expect(within(d).queryByRole("button", { name: /已排除/ })).toBeNull();
  });
  it("add by Enter (trimmed, not while composing), × removes; two quick writes send one (they would clobber)", async () => {
    srv.db.tasks[0].deliverables = ["a.md", "b.md"];
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    const box = await within(d).findByRole("textbox", { name: "新增成果物" });
    fireEvent.change(box, { target: { value: " c.md " } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(patches(srv.calls)).toEqual([]);
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(within(d).getByRole("button", { name: "删除成果物 a.md" }));
    await waitFor(() => expect(patches(srv.calls)).toEqual([{ deliverables: ["a.md", "b.md", "c.md"] }]));
    await waitFor(() => expect((box as HTMLInputElement).value).toBe(""));
    fireEvent.click(within(d).getByRole("button", { name: "删除成果物 a.md" }));
    await waitFor(() => expect(patches(srv.calls).at(-1)).toEqual({ deliverables: ["b.md", "c.md"] }));
  });
  it("成果物 ×: focus moves to the next ×, else the previous one, else the add box", async () => {
    srv.db.tasks[0].deliverables = ["a.md", "b.md", "c.md"];
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    const x = (f: string) => within(d).getByRole("button", { name: `删除成果物 ${f}` });
    fireEvent.click(await within(d).findByRole("button", { name: "删除成果物 b.md" }));
    await waitFor(() => expect(document.activeElement).toBe(x("c.md")));
    fireEvent.click(x("c.md"));
    await waitFor(() => expect(document.activeElement).toBe(x("a.md")));
    fireEvent.click(x("a.md"));
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("textbox", { name: "新增成果物" })));
  });
});

describe("案件 drawer — linked sessions and notes", () => {
  const sp = () => srv.calls.filter((c) => c.method === "PATCH" && c.url.startsWith("/api/sessions/")).map((c) => { const { updated_at: _u, ...b } = c.body!; return [c.url.split("/").pop(), b]; });
  it("by start day, newest first; a day's hours leave the hidden one out; each time opens the session on the timeline", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("帳票の修正");
    expect([...d.querySelectorAll(".day .dl")].map((e) => e.textContent)).toEqual(["10/1四0.0h", "9/29二1.5h"]);
    expect(d.querySelector('.ss[data-id="a2"]')!.classList.contains("hid")).toBe(true);
    expect(d.querySelector('.ss[data-id="a2"]')!.textContent).toContain("已隐藏 · 不计入");
    expect(within(d).getByRole("link", { name: "在时间线打开 9/29 10:00–11:30" }).getAttribute("href")).toBe("#/v2/timeline/2026-W40?day=2026-09-29&s=a1");
    expect(d.querySelector(".note")!.textContent).toBe("9/30電話0:30");
  });
  it("a hidden session's time asks the timeline to include hidden ones (else it drops the s= and opens nothing)", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("帳票の修正");
    expect(within(d).getByRole("link", { name: "在时间线打开 10/1 13:00–13:30" }).getAttribute("href")).toBe("#/v2/timeline/2026-W40?day=2026-10-01&s=a2&hidden=1");
    expect(within(d).getByRole("link", { name: "在时间线打开 9/29 10:00–11:30" }).getAttribute("href")).not.toContain("hidden");
  });
  it("解除关联 hands focus on: the same day's next row, else that day, else the section heading", async () => {
    const S = (id: string, a: string, b: string) => session(id, a, b, { task_id: "T20260901-01", summary: id });
    srv = tkServer({ sessions: [S("a1", "2026-09-29 10:00", "2026-09-29 10:30"), S("a3", "2026-09-29 12:00", "2026-09-29 12:30"), S("a4", "2026-09-29 14:00", "2026-09-29 14:30")], notes: [] });
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("a3");
    const unlink = (id: string) => fireEvent.click(within(d.querySelector<HTMLElement>(`.ss[data-id="${id}"]`)!).getByRole("button", { name: "解除关联" }));
    unlink("a3");
    await waitFor(() => expect(document.activeElement).toBe(d.querySelector('.ss[data-id="a4"] a.tm')));
    unlink("a4");
    await waitFor(() => expect(d.querySelector('.ss[data-id="a4"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(d.querySelector(".day")));
    unlink("a1");
    await waitFor(() => expect(d.querySelector(".day")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("heading", { name: /关联会话/ })));
  });
  it("隐藏 offers 撤销; 恢复显示 for a hidden one; 解除关联 sends task_id null", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("帳票の修正");
    const line = (id: string) => within(d.querySelector<HTMLElement>(`.ss[data-id="${id}"]`)!);
    fireEvent.click(line("a1").getByRole("button", { name: "隐藏" }));
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(() => expect(sp()).toEqual([["a1", { hidden: true }], ["a1", { hidden: false }]]));
    fireEvent.click(line("a2").getByRole("button", { name: "恢复显示" }));
    await waitFor(() => expect(sp().at(-1)).toEqual(["a2", { hidden: false }]));
    fireEvent.click(line("a2").getByRole("button", { name: "解除关联" }));
    await waitFor(() => expect(sp().at(-1)).toEqual(["a2", { task_id: null }]));
    expect(await screen.findByText("已解除关联")).toBeTruthy();
  });
  it("解除关联 / 隐藏: a double click sends one PATCH per line", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("帳票の修正");
    const line = (id: string) => within(d.querySelector<HTMLElement>(`.ss[data-id="${id}"]`)!);
    const hide = line("a1").getByRole("button", { name: "隐藏" });
    fireEvent.click(hide); fireEvent.click(hide);
    const un = line("a2").getByRole("button", { name: "解除关联" });
    fireEvent.click(un); fireEvent.click(un);
    await waitFor(() => expect(sp()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(sp().sort()).toEqual([["a1", { hidden: true }], ["a2", { task_id: null }]]);
  });
  it("运行中 on a running session (the week's 此刻 rule)", async () => {
    srv.db.sessions.push((await import("../src/predict/fixtures")).session("r1", "2026-10-02 13:30", "2026-10-02 14:10", { task_id: "T20260901-01" }));
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    await waitFor(() => expect(d.querySelector('.ss[data-id="r1"]')?.textContent).toContain("运行中"));
    expect(d.querySelector('.ss[data-id="a1"]')!.textContent).not.toContain("运行中");
  });
});

describe("案件 drawer — delete", () => {
  it("refused while sessions or notes are linked, and says why", async () => {
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    expect((await within(d).findByRole("button", { name: "删除案件" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(d).getByText("还关联着 2 个会话和 1 条备注，先解除关联才能删除")).toBeTruthy();
  });
  it("refused even when every linked session is hidden; the count still includes them", async () => {
    srv = tkServer({ sessions: [session("h1", "2026-10-01 13:00", "2026-10-01 13:30", { task_id: "T20260901-01", hidden: 1 })], notes: [] });
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog");
    expect((await within(d).findByRole("button", { name: "删除案件" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(d).getByText("还关联着 1 个会话和 0 条备注，先解除关联才能删除")).toBeTruthy();
  });
  it("English counts: 1 session, not \"1 sessions\" (summary line and the refusal)", async () => {
    srv = tkServer({ sessions: [session("s1", "2026-09-29 10:00", "2026-09-29 11:00", { task_id: "T20260901-01" })], notes: [] });
    window.location.hash = "#/v2/tasks/T20260901-01";
    render(<V2TestProvider lang="en"><TasksPage /><ToastHost /></V2TestProvider>);
    const d = await screen.findByRole("dialog");
    expect(await within(d).findByText("1 session and 0 notes are linked — unlink them first")).toBeTruthy();
    await waitFor(() => expect(d.querySelector(".sum")!.textContent).toMatch(/· 1 session(?!s)/));
  });
  it("one confirm step (focus on 取消, Esc backs out to the button); deleting closes to the list with no 404 refetch", async () => {
    const { container } = page("#/v2/tasks/T20260915-01");
    const d = await screen.findByRole("dialog", { name: /案件 0915-01/ });
    const del = await within(d).findByRole("button", { name: "删除案件" });
    fireEvent.click(del);
    const confirm = within(d).getByRole("alertdialog", { name: "删除 0915-01？删除后无法恢复。" });
    await waitFor(() => expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "取消" })));
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: /案件 0915-01/ })).toBeTruthy();       // only the confirm step closed
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("button", { name: "删除案件" })));
    fireEvent.click(within(d).getByRole("button", { name: "删除案件" }));
    const fetches = vi.mocked(fetch);
    fireEvent.click(within(d).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(window.location.hash).toBe("#/v2/tasks"));
    const at = fetches.mock.calls.findIndex(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
    expect(fetches.mock.calls.slice(at + 1).some(([u]) => String(u) === "/api/tasks/T20260915-01")).toBe(false);
    expect(await screen.findByText("已删除 0915-01")).toBeTruthy();
    await waitFor(() => expect(container.querySelector('.trow[data-id="T20260915-01"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(".tk-list")));
  });
  it("the server's 409 linked counts win (it also knows plan items)", async () => {
    page("#/v2/tasks/T20260915-01");
    const d = await screen.findByRole("dialog");
    fireEvent.click(await within(d).findByRole("button", { name: "删除案件" }));
    srv.failNext((m) => (m === "DELETE" ? new Response(JSON.stringify({ error: "linked", sessions: 0, notes: 0, plans: 2 }), { status: 409 }) : null));
    fireEvent.click(within(d).getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("还关联着 0 个会话、0 条备注和 2 条计划，先解除关联才能删除")).toBeTruthy();
    expect(window.location.hash).toBe("#/v2/tasks/T20260915-01");
    await waitFor(() => expect(document.activeElement).toBe(within(d).getByRole("button", { name: "删除案件" })));
  });
});

describe("案件 drawer — input polish", () => {
  it("shows 润 after a polished title and 考え方, with the raw text on demand", async () => {
    const srv = tkServer();
    Object.assign(srv.db.tasks[0], { _polish: { title: { raw: "alpha なおす", pinned: false }, thinking: { raw: "帳票から", pinned: false } } });
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog", { name: /案件 0901-01/ });
    await within(d).findByText("alpha 改修");
    const marks = within(d).getAllByRole("button", { name: "已润色" });
    expect(marks).toHaveLength(2);
    fireEvent.click(marks[0]);
    expect(within(d).getByText("原文：alpha なおす")).toBeTruthy();
  });
  it("shows no mark without meta", async () => {
    tkServer();
    page("#/v2/tasks/T20260901-01");
    const d = await screen.findByRole("dialog", { name: /案件 0901-01/ });
    await within(d).findByText("alpha 改修");
    expect(within(d).queryByRole("button", { name: "已润色" })).toBeNull();
  });
});
