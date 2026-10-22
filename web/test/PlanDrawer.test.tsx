import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "../src/components/Toast";
import { PlanPage } from "../src/pages/PlanPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { conflict, plServer } from "./pl-serve";

const page = (hash: string) => {
  window.location.hash = hash;
  return render(<V2TestProvider><PlanPage /><ToastHost /></V2TestProvider>);
};
/** The drawer once its item has loaded (it opens on 加载中 while the day is fetched). */
async function dayDrawer() {
  const d = await screen.findByRole("dialog", { name: /今日安排条目/ });
  await within(d).findByRole("radiogroup", { name: "判定" });
  return d;
}
const sent = (s: ReturnType<typeof plServer>, kind = "/api/day-plan-items/") => s.calls.filter((c) => c.url.startsWith(kind));

let srv: ReturnType<typeof plServer>;
beforeEach(() => { srv = plServer(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("今日安排 drawer", () => {
  it("opens from the address: the day, the text, the verdict, the tasks, and the AI's evidence", async () => {
    page("#/v2/plan?day=D1");
    const d = await dayDrawer();
    await within(d).findByText("worklog 上线验证");
    expect(d.querySelector(".kind")!.textContent).toBe("今日安排条目 · 10/2");
    expect(within(d).getByRole("radio", { name: "自动 · 完成" }).getAttribute("aria-checked")).toBe("true");
    expect(within(d).getByText("alpha 改修")).toBeTruthy();
    expect(d.textContent).toContain("AI 判定 依据 1 个会话");
    expect(d.textContent).toContain("当天关联案件 1.5h、1 个会话 → 判定为「完成」");
    expect(within(d).getByText("约 51 轮")).toBeTruthy();
    expect(within(d).getByRole("link", { name: "在时间线打开 10/2 10:00" }).getAttribute("href")).toBe("#/v2/timeline/2026-W40?day=2026-10-02&s=a1");
  });

  it("判定: yours overrides the AI's, 自动 goes back to it — the second write carries the first one's updated_at", async () => {
    page("#/v2/plan?day=D1");
    const d = await dayDrawer();
    const u0 = srv.db.days["2026-10-02"]!.items[0].updated_at;
    fireEvent.click(within(d).getByRole("radio", { name: "部分" }));
    await waitFor(() => expect(within(d).getByRole("radio", { name: "部分" }).getAttribute("aria-checked")).toBe("true"));
    const u1 = srv.db.days["2026-10-02"]!.items[0].updated_at;
    fireEvent.click(within(d).getByRole("radio", { name: "自动 · 完成" }));
    await waitFor(() => expect(sent(srv)).toHaveLength(2));
    expect(sent(srv).map((c) => c.body)).toEqual([{ updated_at: u0, manual_status: "partial" }, { updated_at: u1, manual_status: null }]);
  });

  it("部分 then at once 自动: both are sent and it ends on 自动 (final review: the guard is the last choice, not the render)", async () => {
    page("#/v2/plan?day=D1");
    const d = await dayDrawer();
    fireEvent.click(within(d).getByRole("radio", { name: "部分" }));
    fireEvent.click(within(d).getByRole("radio", { name: "自动 · 完成" }));
    await waitFor(() => expect(sent(srv)).toHaveLength(2));
    expect(sent(srv).map((c) => c.body!.manual_status)).toEqual(["partial", null]);
    await waitFor(() => expect(within(d).getByRole("radio", { name: "自动 · 完成" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("a double click sends one PATCH", async () => {
    page("#/v2/plan?day=D1");
    const d = await dayDrawer();
    const b = within(d).getByRole("radio", { name: "未做" });
    fireEvent.click(b); fireEvent.click(b);
    await waitFor(() => expect(b.getAttribute("aria-checked")).toBe("true"));
    expect(sent(srv)).toHaveLength(1);
  });

  it("案件: the picker leaves out the linked ones; picking links, × unlinks and focus moves on", async () => {
    page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    const sel = within(d).getByRole("combobox", { name: "案件" }) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBeGreaterThan(2));
    expect([...sel.options].map((o) => o.textContent)).toEqual(["＋ 案件", "T20260901-01 alpha 改修", "＋ 新建案件…"]);
    fireEvent.change(sel, { target: { value: "T20260901-01" } });
    await waitFor(() => expect(within(d).getByText("alpha 改修")).toBeTruthy());
    expect(sent(srv)[0].body!.task_ids).toEqual(["T20260915-01", "T20260920-01", "T20260901-01"]);
    expect(await within(d).findByRole("img", { name: "0915-01" })).toBeTruthy();
    const x = within(d).getByRole("button", { name: "移除案件 0915-01" });
    x.focus();
    fireEvent.click(x);
    await waitFor(() => expect(within(d).queryByRole("button", { name: "移除案件 0915-01" })).toBeNull());
    expect(sent(srv)[1].body!.task_ids).toEqual(["T20260920-01", "T20260901-01"]);
    expect(document.activeElement).toBe(within(d).getByRole("button", { name: "移除案件 0920-01" }));
  });

  it("具体要求: saved on blur when changed; an untouched focus sends nothing", async () => {
    page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    const box = within(d).getByRole("textbox", { name: "具体要求" }) as HTMLTextAreaElement;
    expect(box.value).toBe("至少 1 个 domain");
    fireEvent.focus(box); fireEvent.blur(box);
    expect(sent(srv)).toHaveLength(0);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "至少 2 个 domain" } });
    fireEvent.blur(box);
    await waitFor(() => expect(sent(srv)).toHaveLength(1));
    expect(sent(srv)[0].body).toMatchObject({ detail: "至少 2 个 domain" });
  });

  it("具体要求 saved on blur, then 判定 clicked at once: both are sent, in that order (preflight R1)", async () => {
    page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    const box = within(d).getByRole("textbox", { name: "具体要求" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "两轮" } });
    fireEvent.blur(box);
    fireEvent.click(within(d).getByRole("radio", { name: "完成" }));        // while the detail's write is in flight
    await waitFor(() => expect(sent(srv)).toHaveLength(2));
    expect(sent(srv).map((c) => Object.keys(c.body!).filter((k) => k !== "updated_at"))).toEqual([["detail"], ["manual_status"]]);
    // the second carries the first one's answer, so neither 409s
    await waitFor(() => expect(within(d).getByRole("radio", { name: "完成" }).getAttribute("aria-checked")).toBe("true"));
    expect(srv.db.days["2026-10-02"]!.items[1].detail).toBe("两轮");
  });

  it("具体要求 typed and then Esc: the drawer closes and the text is saved, not lost (preflight R2)", async () => {
    page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    const box = within(d).getByRole("textbox", { name: "具体要求" });
    box.focus();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "Esc 前输入的" } });
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(window.location.hash).toBe("#/v2/plan"));
    await waitFor(() => expect(sent(srv)).toHaveLength(1));
    expect(sent(srv)[0].body).toMatchObject({ detail: "Esc 前输入的" });
  });

  it("Esc on the 案件 picker closes the drawer (preflight R11)", async () => {
    page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    fireEvent.keyDown(within(d).getByRole("combobox", { name: "案件" }), { key: "Escape" });
    await waitFor(() => expect(window.location.hash).toBe("#/v2/plan"));
  });

  it("the day failing to load: the drawer says so and retries, not \"loading\" for ever (preflight R10)", async () => {
    srv.failNext((_m, u) => (u.startsWith("/api/day-plans/2026-10-02") ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null));
    page("#/v2/plan?day=D1");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("加载失败");
    fireEvent.click(within(d).getByRole("button", { name: "重试" }));
    await within(d).findByRole("radiogroup", { name: "判定" });
  });

  it("具体要求 being typed is not overwritten by a refresh (a judgement landing meanwhile)", async () => {
    page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    const box = within(d).getByRole("textbox", { name: "具体要求" }) as HTMLTextAreaElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "打字中" } });
    srv.db.days["2026-10-02"]!.items[1].detail = "别处改的";
    fireEvent.click(within(d).getByRole("radio", { name: "部分" }));        // its refetch brings 别处改的
    await waitFor(() => expect(within(d).getByRole("radio", { name: "部分" }).getAttribute("aria-checked")).toBe("true"));
    expect(box.value).toBe("打字中");
  });

  it("a rename that fails keeps the field open with the draft (preflight R4)", async () => {
    page("#/v2/plan?day=D3");
    const d = await dayDrawer();
    srv.failNext((m) => (m === "PATCH" ? new Response(JSON.stringify({ error: "boom" }), { status: 400 }) : null));
    fireEvent.click(within(d).getByRole("button", { name: /条目内容/ }));
    const f = await within(d).findByRole("textbox", { name: "条目内容" });
    fireEvent.change(f, { target: { value: "新的名字" } });
    fireEvent.keyDown(f, { key: "Enter" });
    await waitFor(() => expect(sent(srv)).toHaveLength(1));
    await waitFor(() => expect((within(d).getByRole("textbox", { name: "条目内容" }) as HTMLInputElement).value).toBe("新的名字"));
  });

  it("the text: renamed in place; an emptied one is refused with a hint", async () => {
    page("#/v2/plan?day=D3");
    const d = await dayDrawer();
    fireEvent.click(within(d).getByRole("button", { name: /条目内容/ }));
    let f = await within(d).findByRole("textbox", { name: "条目内容" });
    fireEvent.change(f, { target: { value: "  " } });
    fireEvent.keyDown(f, { key: "Enter" });
    expect(await screen.findByText("条目内容不能为空")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: /条目内容/ }));
    f = await within(d).findByRole("textbox", { name: "条目内容" });
    fireEvent.change(f, { target: { value: " 电话确认 2 " } });
    fireEvent.keyDown(f, { key: "Enter" });
    await waitFor(() => expect(sent(srv)).toHaveLength(1));
    expect(sent(srv)[0].body).toMatchObject({ text: "电话确认 2" });
  });

  it("顺序: ↑ / ↓ renumber the day to the shown order; the first has no ↑", async () => {
    const { container } = page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    fireEvent.click(within(d).getByRole("button", { name: "↓ 下移" }));
    await waitFor(() => expect([...container.querySelectorAll<HTMLElement>(".drow[data-id]")].map((r) => r.dataset.id)).toEqual(["D1", "D3", "D2"]));
    expect(sent(srv).map((c) => [c.url, c.body!.sort])).toEqual([["/api/day-plan-items/D3", 1], ["/api/day-plan-items/D2", 2]]);
    fireEvent.click(within(d).getByRole("button", { name: "↓ 下移" }));
    // now last: ↓ is off
    await waitFor(() => expect((within(d).getByRole("button", { name: "↓ 下移" }) as HTMLButtonElement).disabled).toBe(true));
    window.location.hash = "#/v2/plan?day=D1";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const d1 = await screen.findByRole("dialog", { name: /worklog 上线验证/ });
    await within(d1).findByRole("radiogroup", { name: "判定" });
    expect((within(d1).getByRole("button", { name: "↑ 上移" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("two quick ↓ move two places: each move reads the order when its turn comes (review A)", async () => {
    const { container } = page("#/v2/plan?day=D1");
    const d = await dayDrawer();
    const down = within(d).getByRole("button", { name: "↓ 下移" });
    fireEvent.click(down); fireEvent.click(down);
    await waitFor(() => expect([...container.querySelectorAll<HTMLElement>(".drow[data-id]")].map((r) => r.dataset.id)).toEqual(["D2", "D3", "D1"]));
  });

  it("删除这条: one confirm step; the drawer closes, the row is gone, focus lands on the day board", async () => {
    const { container } = page("#/v2/plan?day=D3");
    const d = await dayDrawer();
    fireEvent.click(within(d).getByRole("button", { name: "删除这条" }));
    expect(document.activeElement).toBe(within(d).getByRole("button", { name: "取消" }));
    fireEvent.keyDown(within(d).getByRole("alertdialog"), { key: "Escape" });
    expect(within(d).getByRole("button", { name: "删除这条" })).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "删除这条" }));
    fireEvent.click(within(d).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(window.location.hash).toBe("#/v2/plan"));
    await waitFor(() => expect(container.querySelector('.drow[data-id="D3"]')).toBeNull());
    expect(srv.calls.find((c) => c.method === "DELETE")!.url).toMatch(/^\/api\/day-plan-items\/D3\?updated_at=/);
    expect(await screen.findByText("已删除")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(container.querySelector(".pl-day")));
  });

  it("changed elsewhere (409): the conflict is said in the interface language and the row is refreshed", async () => {
    page("#/v2/plan?day=D1");
    const d = await dayDrawer();
    srv.failNext((m, u) => {
      if (m !== "PATCH" || !u.includes("/D1")) return null;
      const it = srv.db.days["2026-10-02"]!.items[0];
      it.manual_status = "none"; it.final_status = "none"; it.updated_at = "2026-10-02T06:00:00.000Z";
      return conflict(it);
    });
    fireEvent.click(within(d).getByRole("radio", { name: "部分" }));
    expect(await screen.findByText(/这条记录已在别处被修改/)).toBeTruthy();
    await waitFor(() => expect(within(d).getByRole("radio", { name: "未做" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("00:00 Tokyo with a 今日安排 drawer open on bare #/v2/plan: the day moves on and the drawer closes (preflight R12)", async () => {
    // the minute tick (useMinute) is a setTimeout: fake it from the start, still letting real time run for the queries
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 23:59")));
    page("#/v2/plan?day=D1");
    await dayDrawer();
    await act(async () => { vi.advanceTimersByTime(61_000); });
    await waitFor(() => expect(window.location.hash).toBe("#/v2/plan"));
  });

  it("back in history to a day with its drawer in the address: the drawer stays (review B — only 00:00 closes it)", async () => {
    page("#/v2/plan?day=D1");
    await dayDrawer();
    window.location.hash = "#/v2/plan/2026-10-01";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /今日安排条目/ })).toBeNull());
    window.location.hash = "#/v2/plan?day=D1";                     // what 后退 restores
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await dayDrawer();
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe("#/v2/plan?day=D1");
  });

  it("a missing item says so (deleted elsewhere, an old link); 来自计划条目 opens the plan item", async () => {
    page("#/v2/plan?day=DX");
    const d = await screen.findByRole("dialog");
    await within(d).findByText("这条不存在（可能已被删除）");
    window.location.hash = "#/v2/plan?day=D2";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const d2 = await screen.findByRole("dialog", { name: /HARBOR2/ });
    await within(d2).findByRole("radiogroup", { name: "判定" });
    fireEvent.click(within(d2).getByRole("button", { name: "来自计划条目 →" }));
    expect(window.location.hash).toBe("#/v2/plan?item=P3");
  });
});

describe("计划条目 drawer", () => {
  async function itemDrawer() {
    const d = await screen.findByRole("dialog", { name: /计划条目/ });
    await within(d).findByRole("radiogroup", { name: "档位" });
    return d;
  }
  const items = () => sent(srv, "/api/plan-items/");

  it("opens from the address: the horizon, tasks, 截止日, this week's run, the order", async () => {
    page("#/v2/plan?item=P1");
    const d = await itemDrawer();
    expect(d.querySelector(".kind")!.textContent).toBe("计划条目 · 每日");
    expect(within(d).getByRole("radio", { name: "每日" }).getAttribute("aria-checked")).toBe("true");
    expect(within(d).getByText("alpha 改修")).toBeTruthy();
    expect((within(d).getByLabelText("截止日") as HTMLInputElement).value).toBe("2026-10-09");
    // 90 min on its task on Friday 10/2
    await waitFor(() => expect([...d.querySelectorAll(".wkline span")].map((s) => s.textContent)).toEqual(["–一", "–二", "–三", "–四", "1.5五"]));
    expect((within(d).getByRole("button", { name: "↑ 上移" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("上周遗留: 留在本周 moves it to this week, 下放近期 to near; the banner goes", async () => {
    page("#/v2/plan?item=P4");
    const d = await itemDrawer();
    expect(within(d).getByRole("status").textContent).toContain("上周遗留（2026-W39）");
    fireEvent.click(within(d).getByRole("button", { name: "留在本周" }));
    await waitFor(() => expect(within(d).queryByRole("button", { name: "留在本周" })).toBeNull());
    expect(items()[0].body).toMatchObject({ week: "2026-W40" });
  });

  it("档位: another horizon is one PATCH; the kind follows", async () => {
    page("#/v2/plan?item=P3");
    const d = await itemDrawer();
    fireEvent.click(within(d).getByRole("radio", { name: "近期" }));
    await waitFor(() => expect(d.querySelector(".kind")!.textContent).toBe("计划条目 · 近期"));
    expect(items().map((c) => c.body!.horizon)).toEqual(["near"]);
    expect(within(d).queryByLabelText("截止日")).toBeNull();          // only daily items have one
  });

  it("截止日: saved once on blur, cleared to null; out of period it says 不在期", async () => {
    page("#/v2/plan?item=P2");
    const d = await itemDrawer();
    expect(within(d).getByText("不在期")).toBeTruthy();
    const f = within(d).getByLabelText("截止日") as HTMLInputElement;
    fireEvent.focus(f); fireEvent.blur(f);
    expect(items()).toHaveLength(0);
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: "2026-10-30" } });
    fireEvent.blur(f);
    await waitFor(() => expect(within(d).queryByText("不在期")).toBeNull());
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: "" } });
    fireEvent.blur(f);
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(items().map((c) => c.body!.until_date)).toEqual(["2026-10-30", null]);
  });

  it("截止日 changed and then Esc: saved, not lost (preflight R2)", async () => {
    page("#/v2/plan?item=P1");
    const d = await itemDrawer();
    const f = within(d).getByLabelText("截止日") as HTMLInputElement;
    f.focus();
    fireEvent.focus(f);
    fireEvent.change(f, { target: { value: "2026-10-20" } });
    fireEvent.keyDown(f, { key: "Escape" });
    await waitFor(() => expect(window.location.hash).toBe("#/v2/plan"));
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(items()[0].body).toMatchObject({ until_date: "2026-10-20" });
  });

  it("a closed item opens even while the active list is failing (preflight R10)", async () => {
    srv.failNext((_m, u) => (u === "/api/plan-items" ? new Response(JSON.stringify({ error: "boom" }), { status: 404 }) : null));
    page("#/v2/plan?item=P9");
    const d = await screen.findByRole("dialog");
    await within(d).findByRole("button", { name: "恢复" });
  });

  it("完成 closes it — the drawer stays, says so and offers 恢复, which puts it back", async () => {
    const { container } = page("#/v2/plan?item=P3");
    const d = await itemDrawer();
    fireEvent.click(within(d).getByRole("button", { name: "完成" }));
    await within(d).findByRole("button", { name: "恢复" });
    expect(d.textContent).toContain("已完成（10/2）");
    await waitFor(() => expect(container.querySelector('.pl-tt .ttrow[data-id="P3"]')).toBeNull());
    fireEvent.click(within(d).getByRole("button", { name: "恢复" }));
    await within(d).findByRole("button", { name: "完成" });
    expect(items().map((c) => c.body!.status)).toEqual(["done", "active"]);
  });

  it("转成案件 (远期 only): the new task is linked and the item closed in one write", async () => {
    page("#/v2/plan?item=P5");
    const d = await itemDrawer();
    expect(within(d).getByRole("button", { name: "放弃" })).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "转成案件" }));
    const form = await screen.findByRole("dialog", { name: "新建案件" });
    expect((within(form).getByLabelText("案件名") as HTMLInputElement).value).toBe("Go 采集器");
    fireEvent.change(within(form).getByLabelText("依頼元"), { target: { value: "自分" } });
    fireEvent.click(within(form).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(items()).toHaveLength(1));
    const newId = srv.db.tasks[srv.db.tasks.length - 1].id;
    expect(items()[0].body).toMatchObject({ task_ids: [newId], status: "done" });
    await within(d).findByRole("button", { name: "恢复" });
  });

  it("only 远期 offers 转成案件; a missing item says so", async () => {
    page("#/v2/plan?item=P3");
    const d = await itemDrawer();
    expect(within(d).queryByRole("button", { name: "转成案件" })).toBeNull();
    window.location.hash = "#/v2/plan?item=PX";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await within(await screen.findByRole("dialog")).findByText("这条不存在（可能已被删除）")).toBeTruthy();
  });
});

describe("案件 chips under quick clicks (review C)", () => {
  it("two × before the first answer: both tasks end unlinked — the second does not re-link the first", async () => {
    page("#/v2/plan?day=D2");
    const d = await screen.findByRole("dialog", { name: /今日安排条目/ });
    await within(d).findByRole("radiogroup", { name: "判定" });
    fireEvent.click(within(d).getByRole("button", { name: "移除案件 0915-01" }));
    fireEvent.click(within(d).getByRole("button", { name: "移除案件 0920-01" }));     // same render: 0915-01 still shown
    await waitFor(() => expect(sent(srv)).toHaveLength(2));
    await waitFor(() => expect(srv.db.days["2026-10-02"]!.items[1].tasks).toEqual([]));
    expect(sent(srv).map((c) => c.body!.task_ids)).toEqual([["T20260920-01"], []]);
  });
});

describe("input polish marks", () => {
  it("今日安排 drawer: 润 after the text and the 具体要求; none without meta", async () => {
    const d2 = srv.db.days["2026-10-02"]!.items.find((i) => i.id === "D2")!;
    Object.assign(d2, { _polish: { text: { raw: "えぬせ", pinned: false }, detail: { raw: "ドメイン", pinned: false } } });
    page("#/v2/plan?day=D2");
    const d = await dayDrawer();
    expect(within(d).getAllByRole("button", { name: "已润色" })).toHaveLength(2);
    // 具体要求 stays ONE grid item of .fields: its textarea and mark share one wrapper that is a direct child
    const box = within(d).getByLabelText("具体要求");
    expect(box.parentElement!.parentElement!.classList.contains("fields")).toBe(true);
    expect(box.parentElement!.querySelector(".pm")).not.toBeNull();
  });
  it("今日安排 drawer without meta shows no mark", async () => {
    page("#/v2/plan?day=D1");
    const d = await dayDrawer();
    await within(d).findByText("worklog 上线验证");
    expect(within(d).queryByRole("button", { name: "已润色" })).toBeNull();
  });
  it("计划条目 drawer: 润 after the text; none without meta", async () => {
    Object.assign(srv.db.items.find((i) => i.id === "P1")!, { _polish: { text: { raw: "でぃーえすぴー", pinned: false } } });
    const a = page("#/v2/plan?item=P1");
    const d = await screen.findByRole("dialog", { name: /计划条目/ });
    await within(d).findByRole("radiogroup", { name: "档位" });
    expect(within(d).getAllByRole("button", { name: "已润色" })).toHaveLength(1);
    a.unmount();
    delete (srv.db.items.find((i) => i.id === "P1") as { _polish?: unknown })._polish;
    page("#/v2/plan?item=P1");
    const d2 = await screen.findByRole("dialog", { name: /计划条目/ });
    await within(d2).findByRole("radiogroup", { name: "档位" });
    expect(within(d2).queryByRole("button", { name: "已润色" })).toBeNull();
  });
});
