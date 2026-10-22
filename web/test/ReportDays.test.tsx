import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridRow } from "../src/api/types";
import type { Lang } from "../src/prefs/types";
import { ReportPage } from "../src/pages/ReportPage";
import { readRp } from "../src/pages/report/state";
import { J, session, task } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { dayRow, fail, preview, rpServer, taskRow } from "./rp-serve";
import { note, weekTl } from "./tl-fixtures";

// report week 2026-W40: Saturday 09-26 … Friday 10-02 (Mon–Fri 09-28 … 10-02); today = Friday 10-02
const T1 = { ...task("T20260901-01", "alpha 改修"), thinking: "まず影響範囲を洗う" };
const T2 = task("T20260915-01", "beta 調査");
const TASKS = [T1, T2];
const UN = "その他・調査";
// Sessions the week's (empty) timeline no longer has: each row is placed by its 案件 title.
const DAYS = [
  dayRow("S:d1", "2026-09-28", "alpha 改修", "帳票の修正", 60),
  dayRow("S:d2", "2026-09-29", UN, "調べもの", 30),
  dayRow("S:d3", "2026-09-30", "alpha 改修", "テスト; レビュー", 90),
  dayRow("S:d4", "2026-09-30", "beta 調査", "調査", 120),
];
const TASK_ROWS = [taskRow(T1, 2.5), taskRow(T2, 2)];

const ink = (el: Element | null) => (el ? [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|") : "");
const page = (hash: string, lang?: Lang) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><ReportPage /></V2TestProvider>);
};
const view = (c: Element) => c.querySelector(".rp-view[data-sheet=days]")!;
const head = (c: Element) => [...c.querySelectorAll(".mx-h > *")].map((e) => ink(e));
const blocks = (c: Element) => [...c.querySelectorAll(".blk")];
/** Each block's LED row: code | title | day cells… | week total (code and title share the `.id` slot). */
const ledRow = (b: Element) => [...b.querySelector(".lr")!.children].flatMap((e) => (e.classList.contains("id") ? [...e.children] : [e])).map((e) => ink(e));
const cellsOf = (b: Element) => ({ led: [...b.querySelectorAll(".lr .cell")], prose: [...b.querySelectorAll(".pr .cell")] });
const serve = (days: GridRow[] = DAYS, extra: Record<string, ReturnType<typeof preview>> = {}) => rpServer({
  previews: { "2026-W40/weekly": preview("2026-W40", { days, tasks: TASK_ROWS }), ...extra },
  tasks: TASKS,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("日別作業 — matrix", () => {
  it("columns Mon–Fri in the header, today (Friday) marked; a weekend column only when it has records", async () => {
    serve();
    const { container, unmount } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    expect(head(container)).toEqual(["案件", "", "周一 9/28", "周二 9/29", "周三 9/30", "周四 10/1", "周五 10/2", "合計"]);
    const tds = [...container.querySelectorAll(".mx-h .td")];
    expect(tds.map((e) => e.classList.contains("today"))).toEqual([false, false, false, false, true]);
    expect((view(container).firstElementChild as HTMLElement).style.getPropertyValue("--nd")).toBe("5");
    unmount();

    // the report week is Sat 9/26 → Fri 10/2: Saturday / Sunday only with records, and before Monday
    serve([...DAYS, dayRow("S:d5", "2026-09-27", "beta 調査", "休日対応", 45)]);
    const b = page("#/v2/report").container;
    await waitFor(() => expect(head(b)).toContain("周日 9/27"));
    expect(head(b)).not.toContain("周六 9/26");
    expect(head(b)).toEqual(["案件", "", "周日 9/27", "周一 9/28", "周二 9/29", "周三 9/30", "周四 10/1", "周五 10/2", "合計"]);
    expect((view(b).firstElementChild as HTMLElement).style.getPropertyValue("--nd")).toBe("6");
  });

  it("rows by week minutes with 未割当 last and dimmer; cells show hours or --, the row its week total; 考え方 under the title", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    const [a, b, u] = blocks(container);
    expect(await within(a as HTMLElement).findByRole("img", { name: "0901-01" })).toBeTruthy();
    expect(ledRow(a)).toEqual(["", "alpha 改修", "1.0H", "--", "1.5H", "--", "--", "2.5H"]);
    expect(await within(b as HTMLElement).findByRole("img", { name: "0915-01" })).toBeTruthy();
    expect(ledRow(b)).toEqual(["", "beta 調査", "--", "--", "2.0H", "--", "--", "2.0H"]);
    expect(ledRow(u)).toEqual(["--", "未割当", "--", "0.5H", "--", "--", "--", "0.5H"]);
    expect(u.classList.contains("un")).toBe(true);
    expect(a.classList.contains("un")).toBe(false);
    expect((a as HTMLElement).style.getPropertyValue("--lc")).toMatch(/^#/);
    expect(a.getAttribute("data-task")).toBe("T20260901-01");
    expect(a.querySelector(".lr canvas[data-task='T20260901-01']")).not.toBeNull();
    // prose row: 考え方 first, then one cell per day, then the 合計 column's spacer
    expect(a.querySelector(".pr .think")!.textContent).toBe("まず影響範囲を洗う");
    expect(a.querySelector(".pr")!.children).toHaveLength(1 + 5 + 1);
    expect(cellsOf(a).prose.map((e) => e.textContent)).toEqual(["帳票の修正60′", "", "テスト; レビュー90′", "", ""]);
    expect(cellsOf(a).prose[0].querySelector(".txt")!.getAttribute("lang")).toBeNull();   // data text inherits the display language (S1)
    expect(u.querySelector(".pr .think")!.textContent).toBe("");
    expect(cellsOf(u).prose[1].textContent).toBe("調べもの30′");
  });

  it("an edited cell: amber dot on the figure and ✎ before the text", async () => {
    const s = serve();
    s.db.edits["2026-W40/weekly"] = new Map([["days\u0000S:d3\u0000text", "書き直した"]]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    const { led, prose } = cellsOf(blocks(container)[0]);
    expect(led.map((e) => !!e.querySelector(".ov"))).toEqual([false, false, true, false, false]);
    expect(prose[2].querySelector(".pen")!.textContent).toBe("✎");
    expect(prose[2].textContent).toBe("✎書き直した90′");
    expect(prose[0].querySelector(".pen")).toBeNull();
  });

  it("合計: each day over every row (未割当 included), the week in big figures, a bar per day; the footer", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    const tot = container.querySelector(".tot:not(.bar)")!;
    expect([...tot.children].map((e) => ink(e))).toEqual(["稼働", "", "1.0H", "0.5H", "3.5H", "0.0H", "0.0H", "5.0"]);
    expect(tot.querySelector(".r .ink")!.className).toContain("x2");
    expect(container.querySelectorAll(".tot.bar canvas.db")).toHaveLength(5);
    expect(ink(container.querySelector(".rp-foot"))).toBe("2 个案件 · 本周工作 5.0H · 累计 5.0H · 点任意单元格可修改|✎ = 已手动修改");
  });

  it("G4: 当日案件 titles are one line (class tt, styled to ellipsis) with the full title on hover", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    const lis = [...container.querySelectorAll(".dgr .dt li")];
    expect(lis.length).toBeGreaterThan(0);
    for (const li of lis) {
      const sp = li.querySelector("span.tt")!;
      expect(sp).not.toBeNull();
      expect(sp.getAttribute("title")).toBe(sp.textContent);
    }
    expect(lis.map((li) => li.querySelector("span.tt")!.getAttribute("title"))).toContain("alpha 改修");
  });
});

describe("日別作業 — 累計 beside 稼働 (user 10/9)", () => {
  it("a 累計 row under 稼働 when parallel sessions make a day differ; the footer carries both", async () => {
    const p = preview("2026-W40", { days: DAYS, tasks: TASK_ROWS });
    serve(DAYS, { "2026-W40/weekly": { ...p, day_sum_minutes: { "2026-09-28": 60, "2026-09-29": 30, "2026-09-30": 390 } } });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(container.querySelector(".tot.cum")).not.toBeNull());
    expect([...container.querySelector(".tot.cum")!.children].map((e) => ink(e))).toEqual(["累计", "", "1.0H", "0.5H", "6.5H", "0.0H", "0.0H", "8.0H"]);
    expect(ink(container.querySelector(".rp-foot"))).toBe("2 个案件 · 本周工作 5.0H · 累计 8.0H · 点任意单元格可修改|✎ = 已手动修改");
  });
  it("no 累計 row when it equals 稼働 every day", async () => {
    const p = preview("2026-W40", { days: DAYS, tasks: TASK_ROWS });
    serve(DAYS, { "2026-W40/weekly": { ...p, day_sum_minutes: { "2026-09-28": 60, "2026-09-29": 30, "2026-09-30": 210 } } });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    expect(container.querySelector(".tot.cum")).toBeNull();
  });
});

describe("日別作業 — cells open the drawer", () => {
  it("a click on either half, or Enter / Space on the figure, puts the cell in the address; each figure is a named button", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    const len = window.history.length;
    const btn = screen.getByRole("button", { name: "0901-01 9/30 1.5H" });
    expect(btn.tabIndex).toBe(0);
    expect(btn.getAttribute("data-cell")).toBe("T20260901-01|2026-09-30");
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(readRp(window.location.hash).cell).toEqual({ taskId: "T20260901-01", date: "2026-09-30" });
    expect(window.history.length).toBe(len);
    // an empty cell is still a cell (the drawer says there is nothing that day)
    fireEvent.keyDown(screen.getByRole("button", { name: "0915-01 10/1 --" }), { key: " " });
    expect(readRp(window.location.hash).cell).toEqual({ taskId: "T20260915-01", date: "2026-10-01" });
    // 未割当 by its localized name; the prose half opens it too
    expect(screen.getByRole("button", { name: "未割当 9/29 0.5H" })).toBeTruthy();
    fireEvent.click(cellsOf(blocks(container)[2]).prose[1]);
    expect(readRp(window.location.hash).cell).toEqual({ taskId: null, date: "2026-09-29" });
    fireEvent.click(cellsOf(blocks(container)[1]).led[2]);
    expect(readRp(window.location.hash).cell).toEqual({ taskId: "T20260915-01", date: "2026-09-30" });
    // other keys do nothing
    fireEvent.keyDown(btn, { key: "a" });
    expect(readRp(window.location.hash).cell).toEqual({ taskId: "T20260915-01", date: "2026-09-30" });
  });

  it("hovering either half lights both halves of that day only", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    const { led, prose } = cellsOf(blocks(container)[0]);
    const lit = () => [led, prose].map((l) => l.map((e) => e.classList.contains("hov")));
    fireEvent.mouseEnter(prose[2]);
    expect(lit()).toEqual([[false, false, true, false, false], [false, false, true, false, false]]);
    fireEvent.mouseLeave(prose[2]);
    fireEvent.mouseEnter(led[0]);
    expect(lit()).toEqual([[true, false, false, false, false], [true, false, false, false, false]]);
    fireEvent.mouseLeave(led[0]);
    expect(lit().flat().some(Boolean)).toBe(false);
    // the other rows are untouched
    expect(container.querySelectorAll(".cell.hov")).toHaveLength(0);
  });
});

describe("日別作業 — sources on the timeline (task from the timeline)", () => {
  const sessions = [
    session("a1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id, summary: "帳票の修正" }),
    session("a2", "2026-09-28 13:00", "2026-09-28 13:30", { task_id: T1.id, summary: "見直し" }),
    session("x1", "2026-09-29 09:00", "2026-09-29 09:20", { task_id: null, summary: "雑務" }),
  ];
  const notes = [note("n1", "2026-09-29T15:00:00", { task_id: T2.id, minutes: 40, text: "電話" })];
  const days = [
    dayRow("S:a1", "2026-09-28", "alpha 改修", "帳票の修正", 60),
    dayRow("S:a2", "2026-09-28", "alpha 改修", "見直し", 30),
    dayRow("S:x1", "2026-09-29", UN, "雑務", 20),
    dayRow("N:n1", "2026-09-29", "beta 調査", "電話", 0),
  ];
  const serveSite = () => rpServer({
    previews: { "2026-W40/weekly": preview("2026-W40", { days, tasks: TASK_ROWS }) },
    timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", sessions, notes) },
    tasks: TASKS,
  });

  it("a cell lists each source's text with its minutes; an edited entry gets ✎", async () => {
    const s = serveSite();
    s.db.edits["2026-W40/weekly"] = new Map([["days\u0000S:a2\u0000text", "見直し（修正）"]]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    const [a, b, u] = blocks(container);
    expect(await within(a as HTMLElement).findByRole("img", { name: "0901-01" })).toBeTruthy();
    expect(ledRow(a)).toEqual(["", "alpha 改修", "1.5H", "--", "--", "--", "--", "1.5H"]);
    const lis = [...cellsOf(a).prose[0].querySelectorAll("li")];
    expect(lis.map((li) => li.textContent)).toEqual(["帳票の修正60′", "✎見直し（修正）30′"]);
    expect(lis.map((li) => li.querySelector(".m")?.textContent)).toEqual(["60′", "30′"]);
    expect(cellsOf(a).led[0].querySelector(".ov")).not.toBeNull();
    // no minutes on the entry → no minutes mark
    expect(cellsOf(b).prose[1].querySelector("li")!.textContent).toBe("電話");
    expect(cellsOf(b).prose[1].querySelector(".m")).toBeNull();
    expect(u.classList.contains("un")).toBe(true);
    expect(cellsOf(u).prose[1].textContent).toBe("雑務20′");
  });

  it("before the week's timeline arrives: 读取中, not a matrix with every row in 未割当", async () => {
    const s = serveSite();
    let open!: () => void;
    const g = new Promise<void>((r) => { open = r; });
    s.failNext((m, u) => (m === "GET" && u.startsWith("/api/weeks/2026-W40") ? g.then(() => new Response(JSON.stringify(s.db.timelines["2026-W40"]), { status: 200, headers: { "Content-Type": "application/json" } })) : null));
    const { container } = page("#/v2/report");
    await waitFor(() => expect(view(container).querySelector("[role=status]")).not.toBeNull());
    expect(ink(view(container))).toBe("读取中…");
    expect(blocks(container)).toHaveLength(0);
    await act(async () => { open(); });
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
  });

  it("preflight R6: ▶ with the next week's timeline first and its preview later — the shown matrix stays, no 读取中", async () => {
    const s = serveSite();
    s.db.previews["2026-W41/weekly"] = preview("2026-W41", {});
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    let open!: () => void;
    const g = new Promise<void>((r) => { open = r; });
    s.failNext((m, u) => (m === "GET" && u === "/api/reports/2026-W41/weekly" ? g.then(() => new Response(JSON.stringify(s.db.previews["2026-W41/weekly"]), { status: 200, headers: { "Content-Type": "application/json" } })) : null));
    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    // the next week's timeline has arrived; its preview has not
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u).startsWith("/api/weeks/2026-W41"))).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(view(container).querySelector("[role=status]")).toBeNull();
    expect(blocks(container)).toHaveLength(3);
    expect(head(container)).toContain("周一 9/28");
    // final review: the kept matrix's cells are not buttons, and a click leaves the address alone
    expect(container.querySelectorAll('.rp-days .cell[role="button"]')).toHaveLength(0);
    const before = window.location.hash;
    fireEvent.click(container.querySelector(".rp-days .cell")!);
    expect(window.location.hash).toBe(before);
    await act(async () => { open(); });
    await waitFor(() => expect(ink(view(container))).toBe("本周没有作業记录"));
  });

  it("the timeline fails (after the app's retries): a failure line with 重试, which reloads it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    serveSite();
    const real = vi.mocked(fetch).getMockImplementation()!;
    let broken = true;
    vi.mocked(fetch).mockImplementation(async (u, i) => (broken && String(u).startsWith("/api/weeks/") ? fail(500) : real(u, i)));
    const { container } = page("#/v2/report");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await waitFor(() => expect(view(container).querySelector("[role=alert]")).not.toBeNull());
    expect(ink(view(container))).toBe("读取时间线失败，无法确定各行的案件|重试");
    expect(blocks(container)).toHaveLength(0);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
  });
});

describe("日別作業 — states and languages", () => {
  it("S2c §1: the 案件 title shows its full text — 里 cut into LED lines, 表 type that wraps", async () => {
    serve();
    const { container, unmount } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    expect(blocks(container)[0].querySelector(".lr .nm .ledlines")).not.toBeNull();
    unmount();
    applyWorld("omote");
    serve();
    const o = page("#/v2/report").container;
    await waitFor(() => expect(blocks(o)).toHaveLength(3));
    const ink = blocks(o)[0].querySelector(".lr .nm .ink")!;
    expect(ink.textContent).toBe("alpha 改修");
    expect(ink.classList.contains("iwrap")).toBe(true);
    expect(ink.classList.contains("iblk")).toBe(false);
  });

  it("while the next week loads, the shown week's matrix stays (no flash)", async () => {
    const s = serve(DAYS, { "2026-W41/weekly": preview("2026-W41", {}) });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(blocks(container)).toHaveLength(3));
    let open!: () => void;
    const g = new Promise<void>((r) => { open = r; });
    s.failNext((m, u) => (m === "GET" && u === "/api/reports/2026-W41/weekly" ? g.then(() => new Response(JSON.stringify(s.db.previews["2026-W41/weekly"]), { status: 200, headers: { "Content-Type": "application/json" } })) : null));
    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    await waitFor(() => expect(ink(container.querySelector(".rp-ctl"))).toContain("更新中…"));
    expect(blocks(container)).toHaveLength(3);
    expect(head(container)).toContain("周一 9/28");
    await act(async () => { open(); });
    await waitFor(() => expect(ink(view(container))).toBe("本周没有作業记录"));
    expect(blocks(container)).toHaveLength(0);
  });

  it("header and footer in ja and en", async () => {
    serve();
    const ja = page("#/v2/report", "ja");
    await waitFor(() => expect(blocks(ja.container)).toHaveLength(3));
    expect(head(ja.container)).toEqual(["案件", "", "月 9/28", "火 9/29", "水 9/30", "木 10/1", "金 10/2", "合計"]);
    expect(ink(ja.container.querySelector(".rp-foot"))).toBe("2 案件 · 今週の稼働 5.0H · 累計 5.0H · セルをクリックで修正|✎ = 手動で修正済み");
    expect(ledRow(blocks(ja.container)[2])[1]).toBe("未割当");
    ja.unmount();
    serve();
    const en = page("#/v2/report", "en");
    await waitFor(() => expect(blocks(en.container)).toHaveLength(3));
    expect(head(en.container)).toEqual(["TASK", "", "MON 9/28", "TUE 9/29", "WED 9/30", "THU 10/1", "FRI 10/2", "TOTAL"]);
    expect(ink(en.container.querySelector(".tot"))).toContain("HOURS");
    expect(ink(en.container.querySelector(".rp-foot"))).toBe("2 tasks · week worked 5.0H · sum 5.0H · click any cell to edit|✎ = edited by hand");
    expect(ledRow(blocks(en.container)[2])[1]).toBe("Unassigned");
    expect(screen.getByRole("button", { name: "Unassigned 9/29 0.5H" })).toBeTruthy();
  });
});
