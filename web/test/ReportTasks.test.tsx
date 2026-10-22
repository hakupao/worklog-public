import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GridRow, ReportPreview } from "../src/api/types";
import { ToastHost } from "../src/components/Toast";
import type { Lang } from "../src/prefs/types";
import { ReportPage } from "../src/pages/ReportPage";
import { J, task } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { fail, json, preview, rpServer, taskRow } from "./rp-serve";

// 2026-W40: Monday 09-28 … Sunday 10-04; today = Friday 10-02
const LONG = "まず影響範囲を洗い出してから、帳票の修正方針を決めて、関係者とレビューの段取りを組む";
const T1 = {
  ...task("T20260901-01", "alpha 改修"), requester: "営業部", project: "基幹", received_at: "2026-09-01",
  thinking: LONG, deliverables: ["docs/a.md", "src/b.ts"],
};
const T2 = { ...task("T20260915-01", "beta 調査", "hold"), requester: "経理", thinking: "短い" };
const T3 = { ...task("T20260920-02", "gamma 完了", "done"), done_at: "2026-09-30" };
const SESS = [{ id: "s1", started_at: J("2026-09-29 10:00"), summary: "帳票を直した", minutes: 90, task_id: T1.id }];
const ROWS = (): GridRow[] => [{ ...taskRow(T1, 2.5), sessions: SESS }, taskRow(T2, 2), taskRow(T3, 0.25)];
const KEY = "2026-W40/weekly";

const ink = (el: Element | null) => (el ? [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|") : "");
const page = (hash: string, lang?: Lang) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><ReportPage /><ToastHost /></V2TestProvider>);
};
const serve = (p: ReportPreview = preview("2026-W40", { tasks: ROWS() })) =>
  rpServer({ previews: { [KEY]: p }, tasks: [T1, T2, T3] });
const rows = (c: Element) => [...c.querySelectorAll(".rp-tasks .trw")];
const ready = async (c: Element, n = 3) => { await waitFor(() => expect(rows(c)).toHaveLength(n)); };
/** The LED row slot by slot (status, code, title, requester, project, recv, done, hours). */
const slots = (r: Element) => [...r.querySelector(".tr")!.children].map((e) => ink(e));
const slot = (r: Element, col: string) => r.querySelector(`.tr [data-col=${col}]`)!;
const writes = (s: ReturnType<typeof rpServer>) => s.calls.map((c) => `${c.method} ${c.method === "PUT" ? JSON.stringify(c.body) : decodeURIComponent(c.url.split("?")[1] ?? "")}`);
const put = (row_key: string, column: string, value: string) => `PUT ${JSON.stringify({ sheet: "tasks", row_key, column, value })}`;
const del = (row_key: string, column: string) => `DELETE sheet=tasks&row_key=${row_key}&column=${column}`;
const toasts = () => [...document.querySelectorAll(".toast")].map((e) => (e.textContent ?? "").replace(/✕$/, ""));
const edit = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("案件一覧 — layout", () => {
  it("a header in the interface language and one LED row per grid row, slots by column key", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    expect([...container.querySelectorAll(".rp-tasks .th > *")].map((e) => ink(e)))
      .toEqual(["状態", "线路", "案件名", "依頼元", "プロジェクト", "受領日", "完了日", "工数(h)"]);
    const [a, b, c] = rows(container);
    expect(await within(slot(a, "code") as HTMLElement).findByRole("img", { name: "0901-01" })).toBeTruthy();
    expect(await within(slot(b, "code") as HTMLElement).findByRole("img", { name: "0915-01" })).toBeTruthy();
    expect(await within(slot(c, "code") as HTMLElement).findByRole("img", { name: "0920-02" })).toBeTruthy();
    expect(slots(a)).toEqual(["対応中", "", "alpha 改修", "営業部", "基幹", "9/1", "--", "2.50"]);
    expect(slots(b)).toEqual(["保留", "", "beta 調査", "経理", "", "9/1", "--", "2.00"]);
    expect(slots(c)).toEqual(["完了", "", "gamma 完了", "r", "", "9/1", "9/30", "0.25"]);
  });

  it("en: header and status words in English", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=tasks", "en");
    await ready(container);
    expect(ink(container.querySelector(".rp-tasks .th"))).toBe("STATUS|LINE|TASK|REQUESTER|PROJECT|RECV|DONE|HOURS");
    expect(rows(container).map((r) => ink(slot(r, "status")))).toEqual(["OPEN", "HOLD", "DONE"]);
  });

  it("a grid that lacks a column (and orders them differently): that slot is empty, the others still in place", async () => {
    const p = preview("2026-W40", { tasks: ROWS() });
    const g = p.sheets.find((x) => x.key === "tasks")!;
    const keep = ["hours", "title", "status", "requester", "received_at", "done_at", "deliverables", "thinking"]; // no project
    g.columns = keep.map((k) => g.columns.find((c) => c.key === k)!);
    g.rows = g.rows.map((r) => ({ ...r, cells: keep.map((k) => r.cells.find((c) => c.column === k)!) }));
    serve(p);
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    expect(ink(container.querySelector(".rp-tasks .th [data-col=project]"))).toBe("");
    const [a] = rows(container);
    expect(slots(a)).toEqual(["対応中", "", "alpha 改修", "営業部", "", "9/1", "--", "2.50"]);
    expect(slot(a, "project").children).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^プロジェクト：/ })).toBeNull();
  });

  it("status lamps: open live, hold amber, done dim — and the done row's line is dimmer", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    const lamps = rows(container).map((r) => r.querySelector(".st .lamp")!.className);
    expect(lamps).toEqual(["lamp live", "lamp amber", "lamp dim"]);
    expect(rows(container).map((r) => r.classList.contains("done"))).toEqual([false, false, true]);
  });

  it("the code badge, the row and its LEDs carry data-task for hover pairing", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    const [a] = rows(container);
    expect(a.getAttribute("data-task")).toBe("T20260901-01");
    expect((a as HTMLElement).style.getPropertyValue("--lc")).toMatch(/^#/);
    expect(slot(a, "code").querySelector(".tbadge[data-task='T20260901-01']")).not.toBeNull();
    expect(slot(a, "title").querySelector("canvas[data-task='T20260901-01']")).not.toBeNull();
  });

  it("the prose row: 備考 as type, 成果物 one path per line with its title", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    const [a] = rows(container);
    expect(a.querySelector(".tp .think")!.textContent).toBe(LONG);
    expect(a.querySelector(".tp .think")!.getAttribute("lang")).toBeNull();   // data text inherits the display language (S1)
    const lines = [...a.querySelectorAll(".tp .dl .rp-ed > div")];
    expect(lines.map((e) => e.textContent)).toEqual(["docs/a.md", "src/b.ts"]);
    expect(lines.map((e) => e.getAttribute("title"))).toEqual(["docs/a.md", "src/b.ts"]);
    // preflight R5: the paths are data (Japanese file names), whatever the interface language
    expect(a.querySelector(".tp .dl")!.getAttribute("lang")).toBe("ja");
  });

  it("renders in 表 too", async () => {
    applyWorld("omote");
    serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    expect(slots(rows(container)[0])[2]).toBe("alpha 改修");
  });

  it("S2c §1: 案件名 / 依頼元 / プロジェクト show their full text — 里 cut into LED lines, 表 type that wraps", async () => {
    serve();
    const { container, unmount } = page("#/v2/report?sheet=tasks");
    await ready(container);
    for (const col of ["title", "requester", "project"]) expect(slot(rows(container)[0], col).querySelector(".ledlines")).not.toBeNull();
    unmount();
    applyWorld("omote");
    serve();
    const o = page("#/v2/report?sheet=tasks").container;
    await ready(o);
    for (const col of ["title", "requester", "project"]) {
      const ink = slot(rows(o)[0], col).querySelector(".ink")!;
      expect(ink.classList.contains("iwrap")).toBe(true);
      expect(ink.classList.contains("iblk")).toBe(false);
    }
  });
});

describe("案件一覧 — editing in place", () => {
  it("editing a title puts it on tasks/<row_key>/title, and the row shows it with ✎", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    fireEvent.click(edit(/^案件名：alpha 改修/));
    const box = screen.getByRole("textbox", { name: "案件名" });
    expect(box.tagName).toBe("INPUT");
    expect(box.getAttribute("type")).toBe("text");
    fireEvent.change(box, { target: { value: "alpha 改修 v2" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(writes(s)).toEqual([put("T20260901-01", "title", "alpha 改修 v2")]));
    await waitFor(() => expect(ink(slot(rows(container)[0], "title"))).toBe("alpha 改修 v2"));
    expect(slot(rows(container)[0], "title").querySelector(".pen")!.getAttribute("title")).toBe("已修改，自动值：alpha 改修");
  });

  it("typing the computed value back into an edited cell restores it (DELETE); unchanged → nothing", async () => {
    const s = serve();
    s.db.edits[KEY] = new Map([["tasks\u0000T20260915-01\u0000requester", "総務"]]);
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    expect(ink(slot(rows(container)[1], "requester"))).toBe("総務");
    fireEvent.click(edit(/^依頼元：総務/));
    const box = screen.getByRole("textbox", { name: "依頼元" });
    fireEvent.change(box, { target: { value: "経理" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(writes(s)).toEqual([del("T20260915-01", "requester")]));
    await waitFor(() => expect(slot(rows(container)[1], "requester").querySelector(".pen")).toBeNull());
    expect(ink(slot(rows(container)[1], "requester"))).toBe("経理");
  });

  it("↺ 恢复自动值 only on an edited cell, and it deletes the edit", async () => {
    const s = serve();
    s.db.edits[KEY] = new Map([["tasks\u0000T20260901-01\u0000hours", "3"]]);
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    fireEvent.click(edit(/^案件名：alpha 改修/));
    expect(screen.queryByRole("button", { name: "↺ 恢复自动值" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "案件名" }), { key: "Escape" });
    expect(ink(slot(rows(container)[0], "hours"))).toBe("3.00");
    fireEvent.click(edit(/^工数\(h\)：3/));
    fireEvent.click(screen.getByRole("button", { name: "↺ 恢复自动值" }));
    await waitFor(() => expect(writes(s)).toEqual([del("T20260901-01", "hours")]));
    await waitFor(() => expect(ink(slot(rows(container)[0], "hours"))).toBe("2.50"));
  });

  it("dates edit with a date picker; long 備考 in a textarea, short in a one-line box", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    fireEvent.click(within(slot(rows(container)[0], "received_at") as HTMLElement).getByRole("button"));
    expect(screen.getByLabelText("受領日").getAttribute("type")).toBe("date");
    fireEvent.keyDown(screen.getByLabelText("受領日"), { key: "Escape" });
    fireEvent.click(within(rows(container)[0].querySelector(".tp .think") as HTMLElement).getByRole("button"));
    expect(screen.getByLabelText("備考").tagName).toBe("TEXTAREA");
    fireEvent.keyDown(screen.getByLabelText("備考"), { key: "Escape" });
    fireEvent.click(within(rows(container)[1].querySelector(".tp .think") as HTMLElement).getByRole("button"));
    expect(screen.getByLabelText("備考").tagName).toBe("INPUT");
  });

  it("the status cell edits its text", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    fireEvent.click(edit(/^状態：対応中/));
    const box = screen.getByRole("textbox", { name: "状態" });
    fireEvent.change(box, { target: { value: "確認待ち" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(writes(s)).toEqual([put("T20260901-01", "status", "確認待ち")]));
    // the text is what the xlsx will say; the lamp stays the 案件's own state
    await waitFor(() => expect(ink(slot(rows(container)[0], "status"))).toBe("確認待ち"));
    expect(rows(container)[0].querySelector(".st .lamp")!.className).toBe("lamp live");
  });

  it("a failed save keeps the draft in the field and says so in the interface language", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=tasks", "en");
    await ready(container);
    s.failNext((m) => (m === "PUT" ? fail(500) : null));
    fireEvent.click(edit(/^案件名：alpha 改修/));
    const box = screen.getByRole("textbox", { name: "案件名" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "alpha X" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(toasts()).toContain("Couldn't save"));
    expect(toasts()).not.toContain("保存失败");
    const still = await screen.findByRole("textbox", { name: "案件名" }) as HTMLInputElement;
    expect(still.value).toBe("alpha X");
  });

  it("group review C3: a 400 the server refuses with a reason is said beside the field, without a toast", async () => {
    const s = serve();
    const { container } = page("#/v2/report?sheet=tasks", "en");
    await ready(container);
    s.failNext((m) => (m === "PUT" ? json({ error: "invalid", issues: [{ path: "value", message: "値が長すぎます" }] }, 400) : null));
    fireEvent.click(edit(/^案件名：alpha 改修/));
    const box = screen.getByRole("textbox", { name: "案件名" }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: "alpha X" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("値が長すぎます"));
    expect((screen.getByRole("textbox", { name: "案件名" }) as HTMLInputElement).value).toBe("alpha X");
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(toasts()).toEqual([]);
  });

  it("switching the sheet tab while editing saves the cell first", async () => {
    const user = userEvent.setup();
    const s = serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    await user.click(edit(/^工数\(h\)：2\.5/));
    const box = screen.getByRole("textbox", { name: "工数(h)" });
    await user.clear(box);
    await user.type(box, "9");
    await user.click(within(screen.getByRole("navigation", { name: "工作表" })).getByRole("button", { name: "稼働" }));
    await waitFor(() => expect(writes(s)).toEqual([put("T20260901-01", "hours", "9")]));
    expect(container.querySelector(".rp-view[data-sheet=hours]")).not.toBeNull();
  });
});

describe("案件一覧 — editing across a week switch (group review C1 / C2)", () => {
  const W39 = "2026-W39/weekly";
  const serve2 = () => rpServer({
    previews: { [KEY]: preview("2026-W40", { tasks: ROWS() }), [W39]: preview("2026-W39", { tasks: ROWS() }) },
    tasks: [T1, T2, T3],
  });
  /** The next GET of the W39 preview waits until the returned function is called. */
  const gateW39 = (s: ReturnType<typeof rpServer>) => {
    let release!: () => void;
    const g = new Promise<void>((r) => { release = r; });
    s.failNext((m, u) => (m === "GET" && u === "/api/reports/2026-W39/weekly"
      ? g.then(() => new Response(JSON.stringify(s.db.previews[W39]), { status: 200, headers: { "Content-Type": "application/json" } }))
      : null));
    return release;
  };

  it("while the kept W40 preview is on screen nothing edits; once W39 lands a save goes to W39", async () => {
    const s = serve2();
    const { container } = page("#/v2/report/2026-W40?sheet=tasks");
    await ready(container);
    expect(edit(/^案件名：alpha 改修/)).toBeTruthy();
    const release = gateW39(s);
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(screen.getByText("更新中…")).toBeTruthy());
    expect(rows(container)).toHaveLength(3);                                   // the W40 rows stay on screen
    expect(screen.queryByRole("button", { name: /^案件名：/ })).toBeNull();
    expect(container.querySelectorAll(".rp-tasks .rp-ed.ro").length).toBeGreaterThan(0);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByText("更新中…")).toBeNull());
    fireEvent.click(edit(/^案件名：alpha 改修/));
    const box = screen.getByRole("textbox", { name: "案件名" });
    fireEvent.change(box, { target: { value: "alpha W39" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(writes(s)).toEqual([put("T20260901-01", "title", "alpha W39")]));
    expect(s.calls[0].url).toBe("/api/reports/2026-W39/weekly/cells");
  });

  it("a field open on one week does not survive a switch to another (cached) week: its draft never lands there", async () => {
    const s = serve2();
    const { container } = page("#/v2/report/2026-W39?sheet=tasks");
    await ready(container);
    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    await waitFor(() => expect(container.querySelector(".rp-view")?.getAttribute("data-sheet")).toBe("tasks"));
    await waitFor(() => expect(screen.queryByText("更新中…")).toBeNull());
    const before = container.querySelector(".rp-view");
    fireEvent.click(edit(/^案件名：alpha 改修/));
    fireEvent.change(screen.getByRole("textbox", { name: "案件名" }), { target: { value: "W40 の下書き" } });
    // back to W39, already in the cache: no kept-preview phase, the W39 rows come at once
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(container.querySelector(".rp-view")).not.toBe(before));
    expect(screen.queryByRole("textbox", { name: "案件名" })).toBeNull();
    fireEvent.click(edit(/^案件名：alpha 改修/));
    expect((screen.getByRole("textbox", { name: "案件名" }) as HTMLInputElement).value).toBe("alpha 改修");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "案件名" }), { key: "Enter" });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(s.calls).toEqual([]);
  });
});

describe("案件一覧 — expanding a row", () => {
  it("▸ shows the row's sessions of the week; a row with none says so", async () => {
    serve();
    const { container } = page("#/v2/report?sheet=tasks");
    await ready(container);
    const t1 = screen.getByRole("button", { name: "展开 alpha 改修" });
    expect(t1.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(t1);
    expect(t1.getAttribute("aria-expanded")).toBe("true");
    const li = rows(container)[0].querySelector(".rp-ss li")!;
    expect([...li.children].map((e) => e.textContent)).toEqual(["周二 9/29", "帳票を直した", "1.50h"]);
    expect(li.querySelector(".sm")!.getAttribute("lang")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开 beta 調査" }));
    expect(rows(container)[1].querySelector(".rp-ss")!.textContent).toBe("本周无关联会话");
    fireEvent.click(t1);
    expect(rows(container)[0].querySelector(".rp-ss")).toBeNull();
  });

  it("en / ja: the toggle's name and the empty text in the interface language", async () => {
    serve();
    const { container, unmount } = page("#/v2/report?sheet=tasks", "en");
    await ready(container);
    fireEvent.click(screen.getByRole("button", { name: "Expand beta 調査" }));
    expect(rows(container)[1].querySelector(".rp-ss")!.textContent).toBe("No linked sessions this week");
    unmount();
    const j = page("#/v2/report?sheet=tasks", "ja").container;
    await ready(j);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "beta 調査 を展開" })); });
    expect(rows(j)[1].querySelector(".rp-ss")!.textContent).toBe("今週の紐付けセッションはありません");
  });
});
