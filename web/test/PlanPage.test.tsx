import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "../src/components/Toast";
import { PlanPage } from "../src/pages/PlanPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { plServer } from "./pl-serve";

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const rows = (c: Element) => [...c.querySelectorAll<HTMLElement>(".drow[data-id]")].map((r) => r.dataset.id);
const row = (c: Element, id: string) => c.querySelector<HTMLElement>(`.drow[data-id="${id}"]`)!;
const page = (hash: string) => { window.location.hash = hash; return render(<V2TestProvider><PlanPage /></V2TestProvider>); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("PlanPage — 今日安排 (#/v2/plan[/<date>])", () => {
  it("today: the date with 今天, one row per item — status, item, task codes, who judged it", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toEqual(["D1", "D2", "D3"]));
    expect(ink(container.querySelector(".pl-day .sec")!)).toContain("10/2 周五 · 今天");
    expect(ink(row(container, "D1"))).toBe(["完成", "worklog 上线验证", "AI"].join("|"));
    expect(ink(row(container, "D2"))).toBe(["未做", "HARBOR2 Mapping", "未对账"].join("|"));
    expect(ink(row(container, "D3"))).toBe(["部分", "电话确认", "未关联", "手动"].join("|"));
    expect(await within(row(container, "D1")).findByRole("img", { name: "0901-01" })).toBeTruthy();
    const d2 = row(container, "D2");
    expect(await within(d2).findByRole("img", { name: "0915-01" })).toBeTruthy();
    expect(within(d2).queryByRole("img", { name: "0920-01" })).toBeNull();
    expect(d2.querySelector(".tb-more")!.textContent).toBe("+1");
    expect(d2.querySelector(".tbadges")!.getAttribute("title")).toBe("0915-01 0920-01");
    expect(row(container, "D1").querySelector(".tbadge.dim")).toBeNull();      // a judged row keeps full-strength badges
    expect(d2.querySelector(".tbadge.dim")).not.toBeNull();                      // an undone (tier 2) row dims them
    expect(row(container, "D1").querySelector(".lamp.live")).not.toBeNull();
    expect(row(container, "D3").querySelector(".lamp.amber")).not.toBeNull();
    expect(row(container, "D2").querySelector(".lamp.dim")).not.toBeNull();
  });

  it("‹ › move a day (a history entry) and close any drawer; 回到今天 comes back to plain #/v2/plan", async () => {
    plServer();
    const { container } = page("#/v2/plan?day=D1");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    await waitFor(() => expect(rows(container)).toEqual(["D0"]));
    expect(window.location.hash).toBe("#/v2/plan/2026-10-01");
    expect(ink(container.querySelector(".pl-day .sec")!)).toContain("10/1 周四");
    fireEvent.click(screen.getByRole("button", { name: "回到今天" }));
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    expect(window.location.hash).toBe("#/v2/plan");
    expect(screen.queryByRole("button", { name: "回到今天" })).toBeNull();
  });

  it("a day not started: the daily items in effect, then 开始这天 starts it and the rows replace the preview", async () => {
    const s = plServer();
    const { container } = page("#/v2/plan/2026-10-05");
    const btn = await screen.findByRole("button", { name: "开始这天" });
    const pv = ink(container.querySelector(".preview")!);
    expect(pv).toContain("还没开始");
    expect(pv).toContain("BEACON 每天推进一点");
    expect(pv).not.toContain("过期的每日");           // out of its period: not brought in
    fireEvent.click(btn);
    fireEvent.click(btn);                             // a double click starts it once
    await waitFor(() => expect(rows(container)).toHaveLength(1));
    expect(s.calls.filter((c) => c.url.endsWith("/start"))).toHaveLength(1);
    expect(s.calls[0].url).toBe("/api/day-plans/2026-10-05/start");
  });

  it("started elsewhere meanwhile (409 exists): no error, the refetch shows that plan", async () => {
    const s = plServer({ days: {} });
    const err = vi.spyOn(toast, "error");
    const { container } = page("#/v2/plan");
    const btn = await screen.findByRole("button", { name: "开始今天" });
    s.db.days["2026-10-02"] = null;
    s.failNext((m, u) => {
      if (m !== "POST" || !u.endsWith("/start")) return null;
      s.db.days["2026-10-02"] = { date: "2026-10-02", started_at: J("2026-10-02 09:00"), judged_at: null, judge_machine: null, judge_model: null, updated_at: J("2026-10-02 09:00"),
        items: [{ id: "DX", date: "2026-10-02", plan_item_id: null, tasks: [], text: "另一台机器的", detail: "", sort: 0, ai_status: null, ai_progress: null, ai_evidence: [], ai_note: null, manual_status: null, updated_at: "u", final_status: "none" }] };
      return new Response(JSON.stringify({ error: "exists" }), { status: 409 });
    });
    fireEvent.click(btn);
    await waitFor(() => expect(rows(container)).toEqual(["DX"]));
    expect(err).not.toHaveBeenCalled();
  });

  it("nothing in effect yet: the preview says what starting brings, still offers 开始", async () => {
    plServer({ items: [], days: {} });
    const { container } = page("#/v2/plan");
    await screen.findByRole("button", { name: "开始今天" });
    expect(ink(container.querySelector(".preview")!)).toContain("现在没有每日条目");
  });

  it("＋ 临时加一条: Enter adds it and keeps the box open for the next; Esc closes; blank is ignored", async () => {
    const s = plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "＋ 临时加一条" }));
    const box = screen.getByRole("textbox", { name: /临时加一条/ }) as HTMLInputElement;
    fireEvent.keyDown(box, { key: "Enter" });
    expect(s.calls).toHaveLength(0);
    fireEvent.change(box, { target: { value: " 回电话 " } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(rows(container)).toHaveLength(4));
    expect(s.calls[0]).toMatchObject({ method: "POST", url: "/api/day-plans/2026-10-02/items", body: { text: "回电话" } });
    expect(box.value).toBe("");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /临时加一条/ })).toBeNull();
  });

  it("an Esc that cancels an IME composition keeps the box and its text (preflight R3)", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "＋ 临时加一条" }));
    const box = screen.getByRole("textbox", { name: /临时加一条/ }) as HTMLInputElement;
    fireEvent.compositionStart(box);
    fireEvent.change(box, { target: { value: "会議" } });
    fireEvent.keyDown(box, { key: "Escape", isComposing: true });
    expect(screen.getByRole("textbox", { name: /临时加一条/ })).toBe(box);
    expect(box.value).toBe("会議");
    fireEvent.compositionEnd(box);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: /临时加一条/ })).toBeNull();
  });

  it("the plan items failing: the preview and 从计划添加 say so — never \"no daily items\" (preflight R8)", async () => {
    const s = plServer();
    s.db.days["2026-10-05"] = null;
    const fail = (_m: string, u: string) => (u === "/api/plan-items" ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null);
    s.failNext(fail);
    const { container } = page("#/v2/plan/2026-10-05");
    await screen.findByRole("button", { name: "开始这天" });
    await waitFor(() => expect(ink(container.querySelector(".preview")!)).toContain("计划条目读取失败"));
    expect(ink(container.querySelector(".preview")!)).not.toContain("没有每日条目");
  });

  it("the same text added twice in a row is two items (final review)", async () => {
    const s = plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "＋ 临时加一条" }));
    const box = screen.getByRole("textbox", { name: /临时加一条/ });
    fireEvent.change(box, { target: { value: "回电话" } }); fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "回电话" } }); fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(rows(container)).toHaveLength(5));
    expect(s.calls.map((c) => c.body)).toEqual([{ text: "回电话" }, { text: "回电话" }]);
  });

  it("an add, then 从计划添加 at once: both are sent; text typed meanwhile is kept (review B)", async () => {
    const s = plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "＋ 临时加一条" }));
    const box = screen.getByRole("textbox", { name: /临时加一条/ }) as HTMLInputElement;
    const sel = screen.getByRole("combobox", { name: "从计划添加…" }) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    fireEvent.change(box, { target: { value: "A" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "B 还在打" } });       // typed while A is in flight
    fireEvent.change(sel, { target: { value: "P5" } });
    await waitFor(() => expect(rows(container)).toHaveLength(5));
    expect(s.calls.map((c) => c.body)).toEqual([{ text: "A" }, { plan_item_id: "P5" }]);
    expect(box.value).toBe("B 还在打");
  });

  it("the week not loaded: a row's second line says loading, not \"no related sessions\" (review B)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    const s = plServer();
    s.failNext((_m, u) => (u.startsWith("/api/weeks/2026-W40") ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null));
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    act(() => { vi.advanceTimersByTime(8000); });
    await waitFor(() => expect(ink(row(container, "D3").querySelectorAll(".nm")[0])).toBe("读取中…"));
  });

  it("从计划添加 lists active items not already in the day, by horizon, and adds the picked one", async () => {
    const s = plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const sel = screen.getByRole("combobox", { name: "从计划添加…" }) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(1));
    expect([...sel.options].map((o) => o.textContent)).toEqual(["从计划添加…", "每日 · BEACON 每天推进一点", "每日 · 过期的每日", "本周 · LEDGER 验证", "远期 · Go 采集器"]);
    fireEvent.change(sel, { target: { value: "P5" } });
    await waitFor(() => expect(rows(container)).toHaveLength(4));
    expect(s.calls[0].body).toEqual({ plan_item_id: "P5" });
  });

  it("a row opens its drawer in the address (no history entry); Enter does too", async () => {
    plServer();
    const { container } = page("#/v2/plan/2026-10-01?world=omote");
    await waitFor(() => expect(rows(container)).toEqual(["D0"]));
    const before = window.history.length;
    fireEvent.click(row(container, "D0"));
    expect(window.location.hash).toBe("#/v2/plan/2026-10-01?world=omote&day=D0");
    expect(window.history.length).toBe(before);
    expect(row(container, "D0").classList.contains("sel")).toBe(true);
  });

  it("a day that fails to load says so and retries; it is never shown as not started", async () => {
    const s = plServer();
    s.failNext((_m, u) => (u.startsWith("/api/day-plans/2026-10-02") ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null));
    const { container } = page("#/v2/plan");
    await screen.findByRole("button", { name: "重试" });
    expect(ink(container.querySelector(".pl-day")!)).toContain("读取失败");
    expect(screen.queryByRole("button", { name: "开始今天" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(rows(container)).toHaveLength(3));
  });
});

describe("PlanPage — AI 对账", () => {
  it("done / items in big digits, when and where it was judged, and this week's bars", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const side = container.querySelector(".pl-side")!;
    expect(ink(side)).toContain("1/3");
    expect(ink(side)).toContain("上次对账 18:00 · MAC");
    expect(side.querySelector(".jline .lamp.live")).not.toBeNull();
    await waitFor(() => expect(side.querySelector(".v2-sr")!.textContent).toBe("9/28 --, 9/29 --, 9/30 --, 10/1 1/1, 10/2 1/3"));
  });
  it("the day failing to load: the check line says so, not \"not checked yet\" (preflight R9)", async () => {
    const s = plServer();
    s.failNext((_m, u) => (u.startsWith("/api/day-plans/2026-10-02") ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null));
    const { container } = page("#/v2/plan");
    await screen.findByRole("button", { name: "重试" });
    await waitFor(() => expect(ink(container.querySelector(".pl-side .jline")!)).toContain("读取失败"));
    expect(ink(container.querySelector(".pl-side")!)).not.toContain("尚未对账");
  });

  it("a day not started: --/-- and not judged yet", async () => {
    plServer();
    const { container } = page("#/v2/plan/2026-10-05");
    await screen.findByRole("button", { name: "开始这天" });
    const side = container.querySelector(".pl-side")!;
    expect(ink(side)).toContain("--/--");
    expect(ink(side)).toContain("尚未对账");
    expect(side.querySelector(".jline .lamp.dim")).not.toBeNull();
  });
  it("hidden in 表 (the 表 module setting): no column, the board takes the width", async () => {
    plServer();
    applyWorld("omote");
    window.location.hash = "#/v2/plan";
    const { container } = render(<V2TestProvider prefs={{ omote: { font: "plex", hide: ["plan.judge"] } }}><PlanPage /></V2TestProvider>);
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    expect(container.querySelector(".pl-side")).toBeNull();
    expect(container.querySelector(".pl-mid.solo")).not.toBeNull();
  });
});

describe("PlanPage — 计划 · 时刻表", () => {
  const trows = (c: Element, sel = ".pl-tt") => [...c.querySelectorAll<HTMLElement>(`${sel} .ttrow[data-id]`)].map((r) => r.dataset.id);
  const trow = (c: Element, id: string) => c.querySelector<HTMLElement>(`.ttrow[data-id="${id}"]`)!;

  it("four groups in horizon order with their counts; tags, 截止日 and per-horizon order numbers", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(trows(container)).toEqual(["P1", "P2", "P3", "P4", "P5"]));
    const heads = [...container.querySelectorAll(".pl-tt .ghead")].map(ink);
    expect(heads.slice(0, 4)).toEqual(["每日 2|每个工作日发车", "本周 2|本周内到站", "近期 0|这几周", "远期 1|有空再排"]);
    expect(ink(trow(container, "P1"))).toBe(["BEACON 每天推进一点", "至 10/9", "01"].join("|"));
    expect(ink(trow(container, "P2"))).toBe(["过期的每日", "不在期", "未关联", "至 9/30", "02"].join("|"));
    expect(trow(container, "P2").classList.contains("idle")).toBe(true);
    expect(ink(trow(container, "P4"))).toBe(["LEDGER 验证", "上周遗留", "未关联", "", "02"].join("|"));
  });

  it("done / dropped behind the toggle, with their count; a closed row has no order number", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    const btn = await screen.findByRole("button", { name: "查看已完成 / 已放弃 1" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(trows(container, ".closed")).toEqual(["P9"]));
    expect(ink(trow(container, "P9"))).toBe(["已做完的", "已完成", "未关联", "", ""].join("|"));
    fireEvent.click(screen.getByRole("button", { name: "收起已完成 / 已放弃" }));
    expect(container.querySelector(".closed")).toBeNull();
  });

  it("a row opens the item's drawer (?item=)", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(trows(container)).toHaveLength(5));
    fireEvent.keyDown(trow(container, "P3"), { key: "Enter" });
    expect(window.location.hash).toBe("#/v2/plan?item=P3");
    expect(trow(container, "P3").classList.contains("sel")).toBe(true);
  });

  it("＋ 新增条目: pick a horizon, Enter creates it and opens it; Esc backs out to the key", async () => {
    const s = plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(trows(container)).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增条目" }));
    fireEvent.click(await screen.findByRole("radio", { name: "远期" }));      // the key's text arrives with its font
    expect(screen.getByRole("radio", { name: "远期" }).getAttribute("aria-checked")).toBe("true");
    const box = screen.getByRole("textbox", { name: /条目内容/ });
    fireEvent.change(box, { target: { value: " 新的远期 " } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(window.location.hash).toBe("#/v2/plan?item=P11"));
    expect(s.calls[0]).toMatchObject({ method: "POST", url: "/api/plan-items", body: { horizon: "far", text: "新的远期" } });
    await waitFor(() => expect(trows(container)).toContain("P11"));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增条目" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: /条目内容/ }), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "＋ 新增条目" })));
  });

  it("＋ 新增条目: an Esc that cancels an IME composition keeps the box (preflight R3)", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(trows(container)).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增条目" }));
    const box = screen.getByRole("textbox", { name: /条目内容/ });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Escape", isComposing: true });
    expect(screen.getByRole("textbox", { name: /条目内容/ })).toBe(box);
  });

  it("the closed list failing: opening it says so and retries (review B)", async () => {
    const s = plServer();
    s.failNext((_m, u) => (u.includes("status=closed") ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null));
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(trows(container)).toHaveLength(5));
    fireEvent.click(await screen.findByRole("button", { name: "查看已完成 / 已放弃" }));
    await waitFor(() => expect(ink(container.querySelector(".pl-tt")!)).toContain("读取失败"));
    fireEvent.click(container.querySelector<HTMLElement>(".pl-tt .pl-wait button")!);
    await waitFor(() => expect(trows(container, ".closed")).toEqual(["P9"]));
  });

  it("＋ 新增条目: a horizon key does not take focus from the box (Safari / macOS Firefox would blur it to nothing — final review)", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(trows(container)).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增条目" }));
    const key = await screen.findByRole("radio", { name: "远期" });
    const down = createEvent.mouseDown(key);
    fireEvent(key, down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("＋ 新增条目 left empty (a click elsewhere) backs out (review B)", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(trows(container)).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "＋ 新增条目" }));
    fireEvent.blur(screen.getByRole("textbox", { name: /条目内容/ }), { relatedTarget: document.body });
    expect(screen.queryByRole("textbox", { name: /条目内容/ })).toBeNull();
  });

  it("the plan items failing to load: the timetable says so and retries; the day board still shows", async () => {
    const s = plServer();
    s.failNext((_m, u) => (u === "/api/plan-items" ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null));
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    await waitFor(() => expect(ink(container.querySelector(".pl-tt")!)).toContain("读取失败"));
    fireEvent.click(container.querySelector<HTMLElement>(".pl-tt .pl-wait button")!);
    await waitFor(() => expect(trows(container)).toHaveLength(5));
  });
});

describe("PlanPage — the 8 s flip (user ruling U4)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });

  it("every 8 s a row shows its second line: the AI's note, else the goal, else its time, else none; then back", async () => {
    const s = plServer();
    s.db.days["2026-10-02"]!.items.push({ ...s.db.days["2026-10-02"]!.items[2], id: "D4", text: "无备注", manual_status: null, ai_status: null, ai_note: null, tasks: [{ id: "T20260901-01", title: "alpha 改修", status: "open" }] });
    s.db.days["2026-10-02"]!.items.push({ ...s.db.days["2026-10-02"]!.items[2], id: "D5", text: "只有进度", ai_note: null, ai_progress: "进度一半" });
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(5));
    const mid = (id: string) => ink(row(container, id).querySelectorAll(".nm")[0]);
    expect(mid("D1")).toBe("worklog 上线验证");
    act(() => { vi.advanceTimersByTime(8000); });
    await waitFor(() => expect(mid("D4")).toBe("1.5h · 1 个会话  帳票の修正"));
    expect(mid("D1")).toBe("合并上线并在 prod 验证");
    expect(mid("D2")).toBe("至少 1 个 domain");
    expect(mid("D3")).toBe("这天没有相关会话");
    await waitFor(() => expect(mid("D5")).toBe("AI：进度一半"));   // only the AI's progress: the row shows it (preflight R5)
    act(() => { vi.advanceTimersByTime(8000); });
    await waitFor(() => expect(mid("D4")).toBe("无备注"));
    expect(mid("D1")).toBe("worklog 上线验证");
  });

  it("a hovered row stays on its item; an open drawer stops the flip", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const mid = (id: string) => ink(row(container, id).querySelectorAll(".nm")[0]);
    fireEvent.pointerEnter(row(container, "D1"));
    act(() => { vi.advanceTimersByTime(8000); });
    await waitFor(() => expect(mid("D2")).toBe("至少 1 个 domain"));
    expect(mid("D1")).toBe("worklog 上线验证");
    fireEvent.click(row(container, "D2"));
    await waitFor(() => expect(mid("D2")).toBe("HARBOR2 Mapping"));
    act(() => { vi.advanceTimersByTime(8000); });
    await new Promise((r) => setTimeout(r, 400));
    expect(mid("D2")).toBe("HARBOR2 Mapping");
  });

  it("减少动态效果 switched on while the page is open stops the flip at once (preflight R13)", async () => {
    const listeners: (() => void)[] = [];
    let reduce = false;
    vi.stubGlobal("matchMedia", (q: string) => ({ get matches() { return q.includes("reduce") && reduce; }, media: q,
      addEventListener: (_: string, h: () => void) => listeners.push(h), removeEventListener() {} }));
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    reduce = true;
    act(() => { listeners.forEach((h) => h()); });
    act(() => { vi.advanceTimersByTime(8000); });
    await new Promise((r) => setTimeout(r, 400));
    expect(ink(row(container, "D2").querySelectorAll(".nm")[0])).toBe("HARBOR2 Mapping");
  });

  it("a hidden tab does not flip (user ruling U4)", async () => {
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => { vi.advanceTimersByTime(8000); });
    await new Promise((r) => setTimeout(r, 400));
    expect(ink(row(container, "D2").querySelectorAll(".nm")[0])).toBe("HARBOR2 Mapping");
    hidden.mockRestore();
  });

  it("减少动态效果: no flip at all", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    plServer();
    const { container } = page("#/v2/plan");
    await waitFor(() => expect(rows(container)).toHaveLength(3));
    act(() => { vi.advanceTimersByTime(8000); });    // one flip: odd = the second line, if it flipped
    await new Promise((r) => setTimeout(r, 400));
    expect(ink(row(container, "D2").querySelectorAll(".nm")[0])).toBe("HARBOR2 Mapping");
  });
});
