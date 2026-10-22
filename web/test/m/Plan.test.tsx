// web/test/m/Plan.test.tsx
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "../../src/components/Toast";
import { Plan } from "../../src/m/pages/Plan";
import { PlanGoneError, usePlanActions } from "../../src/m/pages/planActions";
import { PlanSheet } from "../../src/m/pages/PlanSheet";
import { dayItem } from "../../src/predict/fixtures";
import { parseMRoute } from "../../src/m/route";
import { J } from "../../src/predict/fixtures";
import { V2TestProvider } from "../helpers";
import { conflict, plServer } from "../pl-serve";

const page = (hash = "#/m/plan") => render(<V2TestProvider><Plan route={parseMRoute(hash)} /><ToastHost /></V2TestProvider>);
const rows = (c: HTMLElement) => [...c.querySelectorAll(".m-open .m-t1")].map((e) => e.firstChild?.textContent);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); window.location.hash = "#/m/plan"; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.location.hash = ""; });

describe("计划 (phone)", () => {
  it("lists today's items in order with goal / AI lines", async () => {
    plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toEqual(["worklog 上线验证", "HARBOR2 Mapping", "电话确认"]));
    expect(screen.getByText("目标：至少 1 个 domain")).toBeInTheDocument();
    expect(screen.getByText("10/2 周五 · 今天")).toBeInTheDocument();
  });
  it("the box toggles 完成 ↔ 未做 as a manual status", async () => {
    const s = plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const boxes = screen.getAllByRole("button", { name: "切换完成" });
    fireEvent.click(boxes[1]);                                       // D2: none → done
    await waitFor(() => expect(s.calls).toHaveLength(1));
    expect(s.calls[0]).toMatchObject({ method: "PATCH", url: "/api/day-plan-items/D2", body: { manual_status: "done" } });
    fireEvent.click(boxes[0]);                                       // D1: AI done → none
    await waitFor(() => expect(s.calls).toHaveLength(2));
    expect(s.calls[1].body).toMatchObject({ manual_status: "none" });
  });
  it("double tap sends one PATCH", async () => {
    const s = plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    let release!: () => void;
    s.failNext((m) => (m === "PATCH" ? new Promise<Response>((res) => { release = () => {
      const it = Object.assign(s.db.days["2026-10-02"]!.items[1], { manual_status: "done" as const, final_status: "done" as const, updated_at: "2026-09-01T00:00:01.000Z" });   // the server applies it, then answers
      res(new Response(JSON.stringify(it), { status: 200, headers: { "Content-Type": "application/json" } }));
    }; }) : null));
    const box = screen.getAllByRole("button", { name: "切换完成" })[1];
    fireEvent.click(box);
    await waitFor(() => expect(s.calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    fireEvent.click(box);                                            // dropped: the same toggle is still in flight
    release();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "切换完成" })[1]).toHaveAttribute("aria-pressed", "true"));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(s.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });
  it("adds an item and keeps the cursor in the box; IME Enter does not submit", async () => {
    const s = plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const input = screen.getByRole("textbox", { name: "新增一条…" });
    fireEvent.change(input, { target: { value: "にほんご" } });
    expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 229 })).toBe(false);   // default prevented: no implicit submit
    expect(s.calls).toHaveLength(0);
    fireEvent.change(input, { target: { value: "新的一条" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(s.calls[0]).toMatchObject({ method: "POST", url: "/api/day-plans/2026-10-02/items", body: { text: "新的一条" } }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(document.activeElement).toBe(input);
  });
  it("two rapid submits add one row", async () => {
    const s = plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const input = screen.getByRole("textbox", { name: "新增一条…" });
    fireEvent.change(input, { target: { value: "只加一次" } });
    const form = input.closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(input).toHaveValue(""));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "再加一条" } });      // a later add of other text still works
    fireEvent.submit(form);
    await waitFor(() => expect(s.calls.filter((c) => c.method === "POST")).toHaveLength(2));
  });
  it("Enter during an IME composition (compositionstart seen) does not submit", async () => {
    plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const input = screen.getByRole("textbox", { name: "新增一条…" });
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 13 })).toBe(false);
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 13 })).toBe(true);
  });
  it("edits only the changed fields; 按 AI sends manual_status null", async () => {
    const s = plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(container.querySelectorAll(".m-open")[2]);       // D3 (manual partial)
    const dlg = screen.getByRole("dialog", { name: "编辑安排" });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "电话确认（客户）" } });
    fireEvent.click(screen.getByRole("button", { name: "按 AI" }));
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    await waitFor(() => expect(s.calls).toHaveLength(1));
    expect(s.calls[0].body).toEqual({ updated_at: expect.any(String), text: "电话确认（客户）", manual_status: null });
    await waitFor(() => expect(dlg).not.toBeInTheDocument());
  });
  it("409 keeps the draft and says it was refreshed", async () => {
    const s = plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(container.querySelectorAll(".m-open")[2]);
    fireEvent.change(screen.getByLabelText("具体目标（完成到什么程度）"), { target: { value: "打给两家" } });
    const d3 = s.db.days["2026-10-02"]!.items[2];
    d3.text = "电话确认（服务器改过）"; d3.updated_at = "2026-09-01T00:00:09.000Z";   // changed elsewhere: the token the page holds is stale
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    expect(await screen.findByText(/已在别处被修改/)).toBeInTheDocument();
    await waitFor(() => expect(rows(container)).toContain("电话确认（服务器改过）"));   // the list shows the server's row
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("具体目标（完成到什么程度）")).toHaveValue("打给两家");
    expect(screen.getByLabelText("内容")).toHaveValue("电话确认（服务器改过）");   // untouched field follows the server
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));                  // saving again sends only the user's change
    await waitFor(() => expect(s.calls).toHaveLength(2));
    expect(s.calls[1].body).toEqual({ updated_at: "2026-09-01T00:00:09.000Z", detail: "打给两家" });
    expect(d3.text).toBe("电话确认（服务器改过）");
  });
  it("an edit made elsewhere while the sheet is open is not overwritten by untouched fields", () => {
    const save = vi.fn().mockResolvedValue({});
    const v1 = dayItem({ id: "D3", text: "电话确认", detail: "旧目标", manual_status: "partial", updated_at: "2026-10-02T00:00:00Z" });
    const ui = (item: typeof v1) => <V2TestProvider><PlanSheet item={item} act={{ save } as never} onClose={() => {}} /><ToastHost /></V2TestProvider>;
    const { rerender } = render(ui(v1));
    fireEvent.change(screen.getByLabelText("具体目标（完成到什么程度）"), { target: { value: "我的目标" } });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    rerender(ui({ ...v1, text: "电话确认（桌面改过）", detail: "桌面目标", updated_at: "2026-10-02T00:00:05Z" }));   // a refetch brings the desktop's edit
    expect(screen.getByLabelText("内容")).toHaveValue("电话确认（桌面改过）");
    expect(screen.getByLabelText("具体目标（完成到什么程度）")).toHaveValue("我的目标");      // the user's typing stays
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    expect(save).toHaveBeenCalledWith("D3", { detail: "我的目标", manual_status: "done" });
  });
  it("B8: a trailing space alone is not an edit, so the untouched field follows the server", () => {
    const save = vi.fn().mockResolvedValue({});
    const v1 = dayItem({ id: "D3", text: "电话确认", detail: "", manual_status: null, updated_at: "2026-10-02T00:00:00Z" });
    const ui = (item: typeof v1) => <V2TestProvider><PlanSheet item={item} act={{ save } as never} onClose={() => {}} /><ToastHost /></V2TestProvider>;
    const { rerender } = render(ui(v1));
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "电话确认 " } });   // only a trailing space
    rerender(ui({ ...v1, text: "电话确认（桌面改过）", updated_at: "2026-10-02T00:00:05Z" }));
    expect(screen.getByLabelText("内容")).toHaveValue("电话确认（桌面改过）");
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    expect(save).not.toHaveBeenCalled();   // nothing changed here: no PATCH at all, so no text in one
  });
  it("B8: a stored detail with a trailing newline, untouched, still follows the server", () => {
    const save = vi.fn().mockResolvedValue({});
    const v1 = dayItem({ id: "D3", text: "电话确认", detail: "x\n", manual_status: null, updated_at: "2026-10-02T00:00:00Z" });
    const ui = (item: typeof v1) => <V2TestProvider><PlanSheet item={item} act={{ save } as never} onClose={() => {}} /><ToastHost /></V2TestProvider>;
    const { rerender } = render(ui(v1));
    rerender(ui({ ...v1, detail: "新目标", updated_at: "2026-10-02T00:00:05Z" }));
    expect(screen.getByLabelText("具体目标（完成到什么程度）")).toHaveValue("新目标");
  });
  it("B8: a stored detail with a trailing newline, untouched, is not sent when only the text changes", () => {
    const save = vi.fn().mockResolvedValue({});
    const v1 = dayItem({ id: "D3", text: "电话确认", detail: "x\n", manual_status: null, updated_at: "2026-10-02T00:00:00Z" });
    render(<V2TestProvider><PlanSheet item={v1} act={{ save } as never} onClose={() => {}} /><ToastHost /></V2TestProvider>);
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "电话确认（改）" } });
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    expect(save).toHaveBeenCalledWith("D3", { text: "电话确认（改）" });
  });
  it("B8: a trailing space on the text plus a real detail edit sends only the detail", () => {
    const save = vi.fn().mockResolvedValue({});
    const v1 = dayItem({ id: "D3", text: "电话确认", detail: "旧目标", manual_status: null, updated_at: "2026-10-02T00:00:00Z" });
    render(<V2TestProvider><PlanSheet item={v1} act={{ save } as never} onClose={() => {}} /><ToastHost /></V2TestProvider>);
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "电话确认 " } });
    fireEvent.change(screen.getByLabelText("具体目标（完成到什么程度）"), { target: { value: "新目标" } });
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    expect(save).toHaveBeenCalledWith("D3", { detail: "新目标" });
  });
  it("the status is a segmented control; 部分 then 保存 sends manual_status partial", async () => {
    const save = vi.fn().mockResolvedValue({});
    render(<V2TestProvider><PlanSheet item={dayItem({ id: "D1", text: "x", manual_status: null })} act={{ save } as never} onClose={() => {}} /><ToastHost /></V2TestProvider>);
    const grp = screen.getByRole("group", { name: "状态" });
    fireEvent.click(within(grp).getByRole("button", { name: "部分" }));
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    expect(save).toHaveBeenCalledWith("D1", { manual_status: "partial" });
  });
  it("the add button reads [添加]", async () => {
    plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    expect(screen.getByRole("button", { name: "[添加]" })).toBeInTheDocument();
  });
  it("a swipe inside the edit sheet changes neither the date nor the draft", async () => {
    plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(container.querySelectorAll(".m-open")[2]);
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "草稿" } });
    const sheet = screen.getByRole("dialog");
    fireEvent.touchStart(sheet, { touches: [{ clientX: 300, clientY: 400 }] });
    fireEvent.touchEnd(sheet, { changedTouches: [{ clientX: 100, clientY: 405 }] });
    expect(window.location.hash).toBe("#/m/plan");
    expect(screen.getByLabelText("内容")).toHaveValue("草稿");
  });
  it("a row deleted elsewhere: save is not reported as saved", async () => {
    const { result } = renderHook(() => usePlanActions("2026-10-02"), { wrapper: V2TestProvider });   // nothing cached: the row is gone
    await expect(result.current.save("D1", { text: "x" })).rejects.toBeInstanceOf(PlanGoneError);
    await expect(result.current.remove("D1")).resolves.toBeUndefined();
    const save = vi.fn().mockRejectedValue(new PlanGoneError());
    render(<V2TestProvider><PlanSheet item={dayItem({ id: "D1", text: "worklog 上线验证" })} act={{ save } as never} onClose={() => {}} /><ToastHost /></V2TestProvider>);
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "改了" } });
    fireEvent.click(screen.getByRole("button", { name: "[保存]" }));
    expect(await screen.findByText("这条已在别处删除")).toBeInTheDocument();
    expect(screen.queryByText("已保存")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("delete needs a second tap", async () => {
    const s = plServer();
    const { container } = page();
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(container.querySelectorAll(".m-open")[0]);
    fireEvent.click(screen.getByRole("button", { name: "[删除]" }));
    expect(s.calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "[再点一次删除]" }));
    await waitFor(() => expect(s.calls[0]).toMatchObject({ method: "DELETE" }));
    expect(s.calls[0].url).toMatch(/^\/api\/day-plan-items\/D1\?updated_at=/);
  });
  it("tomorrow is not started until asked; past +7 days the address falls back to today", async () => {
    const s = plServer();
    page("#/m/plan/2026-10-03");
    fireEvent.click(await screen.findByRole("button", { name: "[开始安排明天]" }));
    fireEvent.click(screen.getByRole("button", { name: "[开始安排明天]" }));      // double tap
    await waitFor(() => expect(s.calls[0]).toMatchObject({ method: "POST", url: "/api/day-plans/2026-10-03/start" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(s.calls.filter((c) => c.url.endsWith("/start"))).toHaveLength(1);
    render(<V2TestProvider><Plan route={parseMRoute("#/m/plan/2026-10-20")} /></V2TestProvider>);
    expect(await screen.findAllByText("10/2 周五 · 今天")).not.toHaveLength(0);
  });
  it("› stops at today + 7", async () => {
    plServer();
    page("#/m/plan/2026-10-09");
    await screen.findByText(/10\/9/);
    expect(screen.getByRole("button", { name: "后一天" })).toBeDisabled();
  });
});
