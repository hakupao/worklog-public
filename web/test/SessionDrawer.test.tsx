import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "../src/components/Toast";
import { TimelinePage } from "../src/pages/TimelinePage";
import { J } from "../src/predict/fixtures";
import { hideResultText } from "../src/pages/timeline/SessionDrawer";
import { Drawer } from "../src/ui/Drawer";
import { V2TestProvider } from "./helpers";
import { conflict, tlServer } from "./tl-serve";

const page = (hash: string, lang?: "zh" | "ja" | "en") => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><TimelinePage /><ToastHost /></V2TestProvider>);
};
const drawer = () => document.querySelector<HTMLElement>(".v2-drawer")!;
const toasts = () => [...document.querySelectorAll(".toast")].map((t) => t.textContent ?? "").join("|");
/** Toasts raised since `n` were on screen (the toast store is module-level: earlier tests' toasts linger). */
const newToasts = (n: number) => [...document.querySelectorAll(".toast")].slice(n).map((t) => t.textContent ?? "").join("|");

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.location.hash = ""; });

describe("Drawer", () => {
  it("stays one element across open / close; Esc and the scrim close it; Tab stays inside", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Drawer open onClose={onClose} label="x"><button>a</button><button>b</button></Drawer>);
    const el = drawer();
    expect(el.classList.contains("on")).toBe(true);
    fireEvent.keyDown(el, { key: "Escape" });
    fireEvent.click(document.querySelector(".v2-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    const [a, b] = screen.getAllByRole("button");
    b.focus();
    fireEvent.keyDown(b, { key: "Tab" });
    expect(document.activeElement).toBe(a);
    rerender(<Drawer open={false} onClose={onClose} label="x"><button>a</button></Drawer>);
    expect(drawer()).toBe(el);
    expect(el.classList.contains("on")).toBe(false);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector("button")).toBeNull();
  });
  it("Shift+Tab from the panel itself (focus right after opening) goes to its last control, not behind the scrim", () => {
    render(<Drawer open onClose={() => {}} label="x"><button>a</button><button>b</button></Drawer>);
    const el = drawer();
    el.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "b" }));
  });
  it("Shift+Tab on a panel with nothing focusable inside stays on the panel", () => {
    render(<Drawer open onClose={() => {}} label="x"><p>empty</p></Drawer>);
    const el = drawer();
    el.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el);
  });
  it("Tab in another floating layer (the dock's 补记 panel) is left alone while the drawer is open", () => {
    render(<><input aria-label="outside" /><Drawer open onClose={() => {}} label="x"><button>a</button></Drawer></>);
    const input = screen.getByLabelText("outside");
    input.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
  });
  it("an Esc that an inner field consumed (stopPropagation) does not close it", () => {
    const onClose = vi.fn();
    render(<Drawer open onClose={onClose} label="x"><input onKeyDown={(e) => e.stopPropagation()} /></Drawer>);
    fireEvent.keyDown(drawer().querySelector("input")!, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SessionDrawer", () => {
  it("?s= opens it on the session: task, when, facts, summary; × closes it and drops ?s=", async () => {
    tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().querySelector(".dw-title")!.textContent).toBe("alpha 改修");
    const head = drawer().querySelector<HTMLElement>(".dw-h")!;
    expect((await within(head).findByRole("img", { name: "A" })).getAttribute("height")).toBe("56");   // the L badge ...
    expect(head.querySelector(".code")!.textContent).toBe("A");                                    // ... and the code
    expect((await within(drawer().querySelector<HTMLElement>(".cur")!).findByRole("img", { name: "A" })).getAttribute("height")).toBe("16");
    expect(drawer().querySelector(".dw-when")!.textContent).toContain("10/1（四）10:00–11:00");
    expect(drawer().querySelector(".fields")!.textContent).toContain("/w/a");
    expect(drawer().querySelector(".prose")!.textContent).toBe("設計の見直し");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?day=2026-10-01");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(false));
  });
  it("an unlinked session: a suggestion from its directory links it in one click", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=u1");
    await waitFor(() => expect(drawer().querySelector(".opt.sug")).not.toBeNull());
    expect(drawer().querySelector(".dw-title")!.textContent).toBe("未关联");
    expect(drawer().querySelector(".hint")!.textContent).toContain("週報会少记 30 分钟");
    const sug = drawer().querySelector<HTMLElement>(".opt.sug")!;
    expect(await within(sug).findByRole("img", { name: "A" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开案件 A alpha 改修" })).toBe(sug);
    fireEvent.click(sug);
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0]).toMatchObject({ method: "PATCH", url: "/api/sessions/u1", body: { task_id: "A" } });
    await waitFor(() => expect(drawer().querySelector(".dw-title")!.textContent).toBe("alpha 改修"));
    expect(toasts()).toContain("已关联到 A");
  });
  it("a linked one: 解除关联 sends task_id null; 更改 opens the picker, focused", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-02&s=b1");
    await waitFor(() => expect(drawer().querySelector(".cur")).not.toBeNull());
    // sub4: the linked 案件 opens on the v2 案件 page
    expect(screen.getByRole("link", { name: "打开案件 B beta 調査" }).getAttribute("href")).toBe("#/v2/tasks/B");
    fireEvent.click(screen.getByRole("button", { name: "更改" }));
    const sel = drawer().querySelector<HTMLSelectElement>("select.task-select")!;
    expect(document.activeElement).toBe(sel);
    fireEvent.change(sel, { target: { value: "A" } });
    await waitFor(() => expect(api.calls.at(-1)).toMatchObject({ url: "/api/sessions/b1", body: { task_id: "A" } }));
    fireEvent.click(await screen.findByRole("button", { name: "解除关联" }));
    await waitFor(() => expect(api.calls.at(-1)).toMatchObject({ url: "/api/sessions/b1", body: { task_id: null } }));
    await waitFor(() => expect(drawer().querySelector(".dw-title")!.textContent).toBe("未关联"));
  });
  it("a 409 says the row was changed elsewhere", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-02&s=b1");
    await waitFor(() => expect(drawer().querySelector(".cur")).not.toBeNull());
    const cur = { ...api.db.sessions[2], task_id: "A", updated_at: "2026-10-02T06:00:00Z" };
    api.failNext((m) => (m === "PATCH" ? conflict(cur) : null));
    fireEvent.click(screen.getByRole("button", { name: "解除关联" }));
    await waitFor(() => expect(toasts()).toContain("这条记录已在别处被修改，已刷新为最新内容，请确认后再保存"));
  });
  it("closing returns focus to the row it was opened from", async () => {
    tlServer();
    const { container } = page("#/v2/timeline/2026-W40?day=2026-10-01");
    await waitFor(() => expect(container.querySelector('.srow[data-id="a1"]')).not.toBeNull());
    const row = container.querySelector<HTMLElement>('.srow[data-id="a1"]')!;
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    fireEvent.keyDown(drawer(), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('.srow[data-id="a1"]')));
  });
});

describe("SessionDrawer edits", () => {
  const open = async (id = "a1", day = "2026-10-01") => {
    const api = tlServer();
    page(`#/v2/timeline/2026-W40?day=${day}&s=${id}`);
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    return api;
  };
  const edit = (label: string) => fireEvent.click(drawer().querySelector<HTMLElement>(`[role="button"][aria-label^="${label}："]`)!);
  it("摘要: Enter saves the trimmed text; an emptied box sends nothing and says how to restore", async () => {
    const api = await open();
    edit("摘要");
    const box = drawer().querySelector("textarea")!;
    fireEvent.change(box, { target: { value: "  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(toasts()).toContain("摘要不能为空"));
    expect(api.calls).toEqual([]);
    edit("摘要");
    fireEvent.change(drawer().querySelector("textarea")!, { target: { value: " 新しい要約 " } });
    fireEvent.keyDown(drawer().querySelector("textarea")!, { key: "Enter" });
    await waitFor(() => expect(api.calls[0]).toMatchObject({ url: "/api/sessions/a1", body: { summary_edited: "新しい要約" } }));
    await waitFor(() => expect(drawer().textContent).toContain("✎ 已修改"));
    edit("摘要");
    fireEvent.click(screen.getByRole("button", { name: "↺ 恢复自动摘要" }));
    await waitFor(() => expect(api.calls[1]).toMatchObject({ body: { summary_edited: null } }));
  });
  it("本日工时: hours in, minutes out (0 is a value); a bad figure is refused before any request", async () => {
    const api = await open();
    edit("本日工时");
    const box = drawer().querySelector<HTMLInputElement>("input")!;
    expect(box.value).toBe("1");
    fireEvent.change(box, { target: { value: "abc" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(drawer().querySelector('[role="alert"]')).not.toBeNull());
    expect(api.calls).toEqual([]);
    fireEvent.change(box, { target: { value: "1.5" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(api.calls[0]).toMatchObject({ body: { minutes_override: 90 } }));
    await waitFor(() => expect(drawer().textContent).toContain("1:30"));
  });
  it("隐藏 closes the drawer and offers 撤销 with the hide's fresh updated_at", async () => {
    const api = await open();
    const before = api.db.sessions[0].updated_at;
    fireEvent.click(screen.getByRole("button", { name: "隐藏此会话" }));
    await waitFor(() => expect(api.calls[0]).toMatchObject({ url: "/api/sessions/a1", body: { hidden: true, updated_at: before } }));
    await waitFor(() => expect(window.location.hash).toBe("#/v2/timeline/2026-W40?day=2026-10-01"));
    // its row is gone: focus lands on the day list, not on <body>
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".tl-day")));
    const after = api.db.sessions[0].updated_at;
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    await waitFor(() => expect(api.calls[1]).toMatchObject({ body: { hidden: false, updated_at: after } }));
  });
  it("a hidden session (已隐藏 on) offers 恢复显示", async () => {
    const api = tlServer();
    api.db.sessions[0].hidden = 1;
    page("#/v2/timeline/2026-W40?day=2026-10-01&hidden=1&s=a1");
    fireEvent.click(await screen.findByRole("button", { name: "恢复显示" }));
    await waitFor(() => expect(api.calls[0]).toMatchObject({ body: { hidden: false } }));
  });
});

describe("SessionDrawer directory", () => {
  it("只看此目录 sets the page filter; again clears it", async () => {
    tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
    fireEvent.click(await screen.findByRole("button", { name: "只看此目录" }));
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?day=2026-10-01&s=a1&dir=%2Fw%2Fa");
    fireEvent.click(await screen.findByRole("button", { name: "取消只看" }));
    expect(window.location.hash).toBe("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
  });
  it("隐藏本周此目录: counts the week's visible sessions there, confirms, hides each in order, reports", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
    fireEvent.click(await screen.findByRole("button", { name: "隐藏本周此目录下的全部 2 条" }));
    expect(drawer().textContent).toContain("将隐藏 2 条");
    fireEvent.click(screen.getByRole("button", { name: "确认隐藏" }));
    await waitFor(() => expect(api.calls.map((c) => [c.url, c.body?.hidden])).toEqual([["/api/sessions/a1", true], ["/api/sessions/u1", true]]));
    await waitFor(() => expect(toasts()).toContain("已隐藏 2 条"));
  });
  it("a conflict in the batch is named apart from other failures", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
    fireEvent.click(await screen.findByRole("button", { name: "隐藏本周此目录下的全部 2 条" }));
    api.failNext((m, url) => (m === "PATCH" && url.endsWith("/a1") ? conflict({ ...api.db.sessions[0], updated_at: "2026-10-02T09:00:00Z" }) : null));
    fireEvent.click(screen.getByRole("button", { name: "确认隐藏" }));
    await waitFor(() => expect(toasts()).toContain("已隐藏 1 条，1 条已在别处被修改，请重试"));
  });
  it("from the cross-week 未关联 list a session of another week offers no week-wide hide", async () => {
    const old = (await import("../src/predict/fixtures")).session("u0", "2026-09-20 10:00", "2026-09-20 11:00", { cwd: "/w/a" });
    tlServer({ unlinked: [old] });
    page("#/v2/timeline/2026-W40?unlinked=1&s=u0");
    await screen.findByRole("button", { name: "只看此目录" });
    expect(screen.queryByRole("button", { name: /隐藏本周此目录/ })).toBeNull();
  });
});

describe("hideResultText", () => {
  it("every outcome in each language", () => {
    expect(hideResultText("zh", { hidden: ["a", "b"], conflicted: [], errored: [] })).toBe("已隐藏 2 条");
    expect(hideResultText("zh", { hidden: [], conflicted: ["a"], errored: ["b"] })).toBe("未能隐藏：1 条已在别处被修改，1 条因网络或服务器错误失败，请重试");
    expect(hideResultText("ja", { hidden: ["a"], conflicted: [], errored: ["b"] })).toBe("1 件を非表示にしました。1 件は通信・サーバーエラー。もう一度試してください");
    expect(hideResultText("en", { hidden: [], conflicted: ["a"], errored: [] })).toBe("Nothing hidden: 1 changed elsewhere — try again");
  });
});

describe("drawer focus (preflight R1, R3)", () => {
  it("leaving the picker (Esc or a pick) puts focus back on 更改; Esc then closes the drawer", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-02&s=b1");
    fireEvent.click(await screen.findByRole("button", { name: "更改" }));
    const sel = drawer().querySelector("select")!;
    fireEvent.keyDown(sel, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "更改" })));
    expect(drawer().classList.contains("on")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "更改" }));
    fireEvent.change(drawer().querySelector("select")!, { target: { value: "A" } });
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "更改" })));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(false));
  });
  it("focus that fell to <body> while it is open: Esc still closes, Tab goes back into the drawer", async () => {
    tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-02&s=b1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Tab" });
    expect(document.activeElement).toBe(drawer());
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(false));
  });
  it("the directory confirm takes focus on 取消; Esc there cancels only the confirm", async () => {
    tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
    fireEvent.click(await screen.findByRole("button", { name: "隐藏本周此目录下的全部 2 条" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消" })).toBeNull());
    expect(drawer().classList.contains("on")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "只看此目录" }));
  });
  it("closing returns focus to the row even when the row never had focus (a mouse click)", async () => {
    tlServer();
    const { container } = page("#/v2/timeline/2026-W40?day=2026-10-01");
    await waitFor(() => expect(container.querySelector('.srow[data-id="a1"]')).not.toBeNull());
    fireEvent.click(container.querySelector('.srow[data-id="a1"]')!);
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    fireEvent.click(drawer().querySelector<HTMLElement>("button.ib")!);
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector('.srow[data-id="a1"]')));
  });
});

describe("drawer details (preflight R8, R9, R10, R11)", () => {
  it("opened from the cross-week list, a cross-day session shows its whole minutes, not one day's share", async () => {
    const { session } = await import("../src/predict/fixtures");
    const x = session("x", "2026-10-01 23:00", "2026-10-02 01:00");
    tlServer({ sessions: [x], notes: [] });
    page("#/v2/timeline/2026-W40?unlinked=1&s=x");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().querySelector(".dw-when")!.textContent).toContain("10/1（四）23:00–01:00");
    expect(drawer().querySelector(".dw-when")!.textContent).toContain("120 分钟");
  });
  it("a session hidden in a batch while its drawer is open leaves the address too", async () => {
    tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
    fireEvent.click(await screen.findByRole("button", { name: "隐藏本周此目录下的全部 2 条" }));
    fireEvent.click(screen.getByRole("button", { name: "确认隐藏" }));
    await waitFor(() => expect(window.location.hash).toBe("#/v2/timeline/2026-W40?day=2026-10-01"));
  });
  it("English: half-width brackets and the machine's short name; tokens with the subagent share", async () => {
    const { session } = await import("../src/predict/fixtures");
    const m = { input: 800, output: 400, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, reasoning: 0 };
    const x = session("x", "2026-10-02 10:00", "2026-10-02 11:00", { task_id: "A", tokens: { by_model: { m }, subagent: { m: { ...m, input: 300, output: 0 } }, cost_usd: 1, cost_partial: false } });
    tlServer({ sessions: [x], notes: [] });
    page("#/v2/timeline/2026-W40?day=2026-10-02&s=x", "en");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().querySelector(".dw-when")!.textContent).toContain("10/2 (FRI) 10:00–11:00 · MAC");
    expect(drawer().querySelector(".fields")!.textContent).toContain("1.2K tok · subagents 25%");
  });
});

describe("sub3 review C", () => {
  it("a write in flight keeps ?s= even when its optimistic step takes the row out; a failure brings the drawer back", async () => {
    const { session } = await import("../src/predict/fixtures");
    const old = session("u0", "2026-09-20 10:00", "2026-09-20 11:00", { cwd: "/w/a" });
    const api = tlServer({ unlinked: [old] });
    page("#/v2/timeline/2026-W40?unlinked=1&s=u0");
    fireEvent.click(await screen.findByRole("button", { name: "选择案件…" }));
    // a slow failure: the optimistic step has long taken the row out of the list before the answer comes
    api.failNext((m) => (m === "PATCH" ? new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } })), 300)) : null));
    const n = document.querySelectorAll(".toast").length;
    fireEvent.change(drawer().querySelector("select")!, { target: { value: "A" } });
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(false));   // the row is out while the write is in flight
    expect(window.location.hash).toContain("s=u0");
    await waitFor(() => expect(newToasts(n)).toContain("保存失败"));
    expect(window.location.hash).toContain("s=u0");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
  });
  it("opened from a day, a cross-day session shows that day's part and the whole", async () => {
    const { session } = await import("../src/predict/fixtures");
    tlServer({ sessions: [session("x", "2026-10-01 23:00", "2026-10-02 01:00", { task_id: "A" })], notes: [] });
    page("#/v2/timeline/2026-W40?day=2026-10-02&s=x");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().querySelector(".dw-when")!.textContent).toContain("60 分钟");
    expect(drawer().querySelector(".fields")!.textContent).toContain("1:00 整段 2:00");
  });
  it("a write that fails for another reason than a conflict says 保存失败, not 'changed elsewhere'", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-02&s=b1");
    await screen.findByRole("button", { name: "解除关联" });
    const n = document.querySelectorAll(".toast").length;
    api.failNext((m) => (m === "PATCH" ? new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } }) : null));
    fireEvent.click(screen.getByRole("button", { name: "解除关联" }));
    await waitFor(() => expect(newToasts(n)).toContain("保存失败"));
    expect(newToasts(n)).not.toContain("别处被修改");
  });
  it("a double click on a suggestion sends one PATCH", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=u1");
    await waitFor(() => expect(drawer().querySelector(".opt.sug")).not.toBeNull());
    const b = drawer().querySelector<HTMLElement>(".opt.sug")!, n = document.querySelectorAll(".toast").length;
    fireEvent.click(b); fireEvent.click(b);
    await waitFor(() => expect(newToasts(n)).toContain("已关联到 A"));
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
  });
  it("login expiry mid-batch says how far it got (none / some)", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?day=2026-10-01&s=a1");
    fireEvent.click(await screen.findByRole("button", { name: "隐藏本周此目录下的全部 2 条" }));
    api.failNext((m) => (m === "PATCH" ? new Response(null, { status: 401 }) : null));
    const n = document.querySelectorAll(".toast").length;
    fireEvent.click(screen.getByRole("button", { name: "确认隐藏" }));
    await waitFor(() => expect(newToasts(n)).toContain("登录已过期，未能处理"));
  });
});


describe("SessionDrawer — input polish", () => {
  it("shows 润 after a polished summary; no mark without meta", async () => {
    const api = tlServer();
    Object.assign(api.db.sessions.find((s) => s.id === "a1")!, { _polish: { summary: { raw: "ちょうひょう", pinned: false } } });
    const a = page("#/v2/timeline/2026-W40?s=a1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().querySelector('button[aria-label="已润色"]')).toBeTruthy();
    a.unmount();
    delete (api.db.sessions.find((s) => s.id === "a1") as { _polish?: unknown })._polish;
    page("#/v2/timeline/2026-W40?s=a1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().textContent).toContain("設計の見直し");
    expect(drawer().querySelector('button[aria-label="已润色"]')).toBeNull();
  });
});
