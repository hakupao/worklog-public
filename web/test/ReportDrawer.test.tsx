import { QueryClient, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { keys } from "../src/api/queries";
import type { GridRow, ReportPreview } from "../src/api/types";
import { ToastHost } from "../src/components/Toast";
import type { Lang } from "../src/prefs/types";
import { ReportPage } from "../src/pages/ReportPage";
import { readRp } from "../src/pages/report/state";
import { putCell, useReportWrite, type CellRef, type ReportWrite } from "../src/pages/report/write";
import { J, session, task } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { dayRow, fail, json, preview, rpServer, taskRow } from "./rp-serve";
import { note, weekTl } from "./tl-fixtures";

// 2026-W40: Monday 09-28 … Sunday 10-04; today = Friday 10-02 14:20
const T1 = task("T20260901-01", "alpha 改修");
const T2 = task("T20260915-01", "beta 調査");
const TASKS = [T1, T2];
// One source per cell. a1 / a3 are on the timeline; x1 and a2 are not (hidden since): placed by their 案件 title,
// その他 being no 案件's title, so 未割当.
const K28 = "S:a1", C28 = "T20260901-01|2026-09-28", K30 = "S:a2";
const DAYS = [
  dayRow(K28, "2026-09-28", "alpha 改修", "帳票の修正", 60),
  dayRow("S:x1", "2026-09-29", "その他", "調べもの", 30),
  dayRow(K30, "2026-09-30", "alpha 改修", "テスト", 90),
  dayRow("S:a3", "2026-10-02", "alpha 改修", "仕上げ", 25),
];
/** The labels of the 9/28 entry's fields (its session's time and machine), and of the 9/30 one's (no source: —). */
const MIN28 = "分钟 10:00–11:00 MAC", TXT28 = "作業内容 10:00–11:00 MAC", MIN30 = "分钟 —", TXT30 = "作業内容 —";
const SESSIONS = [
  session("a1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id, summary: "帳票の修正" }),
  session("a3", "2026-10-02 13:50", "2026-10-02 14:15", { task_id: T1.id, summary: "仕上げ中" }),
];
const NOTES = [note("n1", "2026-09-28 18:00:00", { task_id: T1.id, text: "電話で確認", minutes: 10, machine: "win11" })];

const KEY = "2026-W40/weekly";
const serve = (days: GridRow[] = DAYS) => rpServer({
  previews: { [KEY]: preview("2026-W40", { days, tasks: [taskRow(T1, 2.9), taskRow(T2, 0)] }) },
  timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", SESSIONS, NOTES) },
  tasks: TASKS,
  machines: [{ name: "macmini", last_seen_at: J("2026-10-02 14:18") }],
});

const ink = (el: Element | null) => (el ? [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|") : "");
const page = (hash: string, lang?: Lang) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={lang}><ReportPage /><ToastHost /></V2TestProvider>);
};
const dw = () => document.querySelector<HTMLElement>(".v2-drawer.on .rp-dw");
const open = async (hash: string, lang?: Lang) => {
  const r = page(hash, lang);
  await waitFor(() => expect(dw()?.querySelector(".dw-title")).toBeTruthy());
  return r;
};
const ledCell = (c: Element, cell: string) => c.querySelector<HTMLElement>(`.rp-days .cell[data-cell="${cell}"]`);
const writes = (s: ReturnType<typeof rpServer>) => s.calls.map((c) => `${c.method} ${c.method === "PUT" ? JSON.stringify(c.body) : decodeURIComponent(c.url.split("?")[1] ?? "")}`);
const btn = (name: string) => screen.getByRole("button", { name });
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const toasts = () => [...document.querySelectorAll(".toast")].map((e) => (e.textContent ?? "").replace(/✕$/, ""));
const put = (row_key: string, column: string, value: string) => `PUT ${JSON.stringify({ sheet: "days", row_key, column, value })}`;
const del = (row_key: string, column: string) => `DELETE sheet=days&row_key=${row_key}&column=${column}`;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("格子抽屉 — opening and closing", () => {
  it("opens from ?cell=: code, date, title, the entry's minutes and 作業内容, sources; ✕ returns focus to the cell", async () => {
    serve();
    const { container } = await open("#/v2/report?cell=T20260901-01|2026-09-28");
    const d = dw()!;
    expect(d.querySelector(".dw-h .code")).toBeNull();                       // B3b: no duplicate chip after the L badge
    expect(d.querySelector(".dw-h .tcode")!.textContent).toBe("0901-01");    // the code as plain text
    const hb = await within(d.querySelector(".dw-h") as HTMLElement).findByRole("img", { name: "0901-01" });
    expect(hb.getAttribute("height")).toBe("56");
    expect(d.querySelector(".dw-h .dt")!.textContent).toBe("9/28（周一）");
    expect(d.querySelector(".dw-title")!.textContent).toBe("alpha 改修");
    expect(d.querySelector(".dw-title")!.getAttribute("lang")).toBeNull();   // data text inherits the display language (S1)
    expect(d.querySelector(".dw-sub")!.textContent).toBe("日別作業");
    expect(d.querySelectorAll(".ent")).toHaveLength(1);
    const minutes = screen.getByLabelText<HTMLInputElement>(MIN28);
    expect(minutes.value).toBe("60");
    expect(minutes.placeholder).toBe("60");
    expect(screen.getByLabelText<HTMLTextAreaElement>(TXT28).value).toBe("帳票の修正");
    expect(screen.queryByRole("button", { name: "恢复自动值" })).toBeNull();   // nothing edited
    // 来源: the day's session and note of this task, with the hint
    expect(d.querySelector("h3 .n")!.textContent).toBe("2");
    expect(d.textContent).toContain("这个格子由下面的会话和补记汇总而来");
    const ss = [...d.querySelectorAll(".dw-b > .ss")].map((e) => e.textContent);
    expect(ss).toEqual(["10:00–11:00MAC · 60 分钟帳票の修正", "补记WIN · 10 分钟電話で確認"]);
    // the cell is drawn by now: closing puts the focus on its LED half
    fireEvent.click(btn("关闭"));
    expect(readRp(window.location.hash).cell).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(ledCell(container, C28)));
    expect(dw()).toBeNull();
  });

  it("opened by a click, the focus goes back to that cell; 未割当 and a running session", async () => {
    serve();
    const { container } = page("#/v2/report");
    await waitFor(() => expect(ledCell(container, "-|2026-09-29")).toBeTruthy());
    const c = ledCell(container, "-|2026-09-29")!;
    c.focus();
    fireEvent.click(c);
    await waitFor(() => expect(dw()?.querySelector(".dw-title")!.textContent).toBe("未割当"));
    expect(dw()!.querySelector(".dw-title")!.getAttribute("lang")).toBeNull();
    expect(dw()!.querySelector(".dw-h .tcode")!.textContent).toBe("--");
    fireEvent.keyDown(dw()!.closest(".v2-drawer")!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(c));

    fireEvent.click(ledCell(container, "T20260901-01|2026-10-02")!);
    await waitFor(() => expect(dw()?.textContent).toContain("运行中"));
    expect(dw()!.querySelector(".ss .live")!.textContent).toBe("运行中");
  });

  it("a day without a row says so and offers no editor", async () => {
    serve();
    await open("#/v2/report?cell=T20260901-01|2026-10-01");
    expect(dw()!.textContent).toContain("这一天没有记录");
    expect(dw()!.querySelector(".ent")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });

  it("a ?cell= no row / column has: 没有这一格 with a close button; a matrix still waiting for its timeline: 读取中", async () => {
    serve();
    const { unmount } = page("#/v2/report?cell=T29990101-01|2026-09-28");
    await waitFor(() => expect(dw()?.textContent).toContain("没有这一格"));
    fireEvent.click(btn("关闭"));
    expect(readRp(window.location.hash).cell).toBeNull();
    unmount();

    const s = rpServer({ previews: { "2026-W40/weekly": preview("2026-W40", { days: [dayRow("S:a1", "2026-09-28", "alpha 改修", "x", 60)] }) }, tasks: TASKS });
    s.failNext((m, u) => (u.startsWith("/api/weeks/") ? new Promise<Response>(() => {}) : null));
    page("#/v2/report?cell=T20260901-01|2026-09-28");
    await waitFor(() => expect(dw()?.querySelector("[role=status]")?.textContent).toBe("读取中…"));
  });
});

describe("格子抽屉 — writes", () => {
  it("minutes save and close; the cell then shows 1.5H with the edit dot", async () => {
    const s = serve();
    const { container } = await open("#/v2/report?cell=T20260901-01|2026-09-28");
    type(screen.getByLabelText(MIN28), "90");
    fireEvent.click(btn("保存"));
    expect(readRp(window.location.hash).cell).toBeNull();
    await waitFor(() => expect(writes(s)).toEqual([put(K28, "minutes", "90")]));
    await waitFor(() => expect(ink(ledCell(container, C28))).toBe("1.5H"));
    expect(ledCell(container, C28)!.querySelector(".ov")).not.toBeNull();
  });

  it("作業内容 saves the text cell; an edited entry shows ✎ 已修改 and its 自动值", async () => {
    const s = serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    type(screen.getByLabelText(TXT28), "帳票の修正と確認");
    fireEvent.click(btn("保存"));
    await waitFor(() => expect(writes(s)).toEqual([put(K28, "text", "帳票の修正と確認")]));
    await settle();
    window.location.hash = "#/v2/report?cell=T20260901-01|2026-09-28";
    await waitFor(() => expect(dw()?.querySelector(".auto")?.textContent).toBe("自动值帳票の修正"));
    expect(dw()!.querySelector(".ent .ovtag")!.textContent).toBe("✎ 已修改");
    expect(screen.getByLabelText<HTMLTextAreaElement>(TXT28).value).toBe("帳票の修正と確認");
  });

  it("the computed value typed back: restores an edited cell, writes nothing on an untouched one", async () => {
    const s = serve();
    s.db.edits[KEY] = new Map([[`days\u0000${K28}\u0000minutes`, "90"]]);
    const { unmount } = await open("#/v2/report?cell=T20260901-01|2026-09-28");
    const minutes = screen.getByLabelText<HTMLInputElement>(MIN28);
    expect(minutes.value).toBe("90");
    expect(dw()!.querySelector(".ent .ovtag")).not.toBeNull();
    type(minutes, "60");
    fireEvent.click(btn("保存"));
    await waitFor(() => expect(writes(s)).toEqual([del(K28, "minutes")]));
    unmount();

    const s2 = serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    type(screen.getByLabelText(MIN28), "60");
    type(screen.getByLabelText(TXT28), "帳票の修正");
    fireEvent.click(btn("保存"));
    await settle();
    expect(s2.calls).toEqual([]);
  });

  it("恢复自动值 deletes both edits of the entry; it is not offered once nothing is edited", async () => {
    const s = serve();
    s.db.edits[KEY] = new Map([[`days\u0000${K28}\u0000minutes`, "90"], [`days\u0000${K28}\u0000text`, "書き直し"]]);
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    type(screen.getByLabelText(TXT28), "typed, then restored");
    fireEvent.click(btn("恢复自动值"));
    await waitFor(() => expect(writes(s)).toEqual([del(K28, "minutes"), del(K28, "text")]));
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>(TXT28).value).toBe("帳票の修正"));
    expect(screen.queryByRole("button", { name: "恢复自动值" })).toBeNull();
    // the typing went with the restore: closing writes nothing more
    fireEvent.click(btn("关闭"));
    await settle();
    expect(writes(s)).toHaveLength(2);
  });

  it("minutes that are not a whole number: an inline error, no request, the drawer stays", async () => {
    const s = serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28", "en");
    const minutes = screen.getByLabelText("Minutes 10:00–11:00 MAC");
    type(minutes, "1h30");
    fireEvent.click(btn("Save"));
    expect(screen.getByRole("alert").textContent).toBe("Enter whole minutes");
    expect(minutes.getAttribute("aria-invalid")).toBe("true");
    expect(readRp(window.location.hash).cell).not.toBeNull();
    await settle();
    expect(s.calls).toEqual([]);
    // typing again clears it
    type(minutes, "120");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed save: a toast in the interface language, and the cell goes back", async () => {
    const s = serve();
    const { container } = await open("#/v2/report?cell=T20260901-01|2026-09-28", "en");
    let release!: () => void;
    s.failNext((m) => (m === "PUT" ? new Promise<Response>((r) => { release = () => r(fail(500)); }) : null));
    type(screen.getByLabelText("Minutes 10:00–11:00 MAC"), "120");
    fireEvent.click(btn("Save"));
    // optimistic first
    await waitFor(() => expect(ink(ledCell(container, C28))).toBe("2.0H"));
    await act(async () => { release(); });
    await waitFor(() => expect(toasts()).toContain("Couldn't save"));
    await waitFor(() => expect(ink(ledCell(container, C28))).toBe("1.0H"));
    expect(ledCell(container, C28)!.querySelector(".ov")).toBeNull();
  });
});

describe("格子抽屉 — minutes typed over with text (group review B3)", () => {
  it("the matrix cell and the minutes box show the text, not 0; nothing is written unless it is changed", async () => {
    const s = serve();
    s.db.edits[KEY] = new Map([[`days\u0000${K28}\u0000minutes`, "半日"]]);
    const { container } = await open("#/v2/report?cell=T20260901-01|2026-09-28");
    expect(ink(ledCell(container, C28))).toBe("半日");
    expect(ledCell(container, C28)!.getAttribute("aria-label")).toContain("半日");
    expect(screen.getByLabelText<HTMLInputElement>(MIN28).value).toBe("半日");
    fireEvent.click(btn("关闭"));
    await settle();
    expect(s.calls).toEqual([]);
  });
});

describe("格子抽屉 — an edited 日付 / 案件 (preflight R2)", () => {
  it("the matrix flags the cell; the drawer says what it became, and its 恢复日付 / 案件 deletes just those edits", async () => {
    const s = serve();
    s.db.edits[KEY] = new Map([[`days\u0000${K28}\u0000date`, "2026-09-29"], [`days\u0000${K28}\u0000task`, "alpha 改修（旧）"]]);
    const { container } = await open("#/v2/report?cell=T20260901-01|2026-09-28");
    expect(ledCell(container, C28)!.querySelector(".ov")).not.toBeNull();
    const mv = dw()!.querySelector(".moved")!;
    expect([...mv.querySelectorAll(".mv")].map((e) => e.textContent)).toEqual(["日付2026-09-28 → 2026-09-29", "案件alpha 改修 → alpha 改修（旧）"]);
    expect(mv.getAttribute("lang")).toBeNull();
    expect(mv.querySelector(".mv .v")!.getAttribute("lang")).toBeNull();
    // group review B4 / D3: the moved block's restore says what it restores, apart from the minutes / 作業内容 one
    // (which is not offered: those are not edited)
    expect(mv.querySelector("button")!.textContent).toBe("恢复日付 / 案件");
    expect(mv.classList.contains("auto")).toBe(false);
    expect(screen.queryByRole("button", { name: "恢复自动值" })).toBeNull();
    fireEvent.click(btn("恢复日付 / 案件"));
    await waitFor(() => expect(writes(s)).toEqual([del(K28, "date"), del(K28, "task")]));
    await waitFor(() => expect(dw()!.querySelector(".moved")).toBeNull());
    expect(ledCell(container, C28)!.querySelector(".ov")).toBeNull();
  });

  it("per entry, in the three languages", async () => {
    const SITE = [dayRow("S:a1", "2026-09-28", "alpha 改修", "帳票の修正", 60), dayRow("S:a2", "2026-09-28", "alpha 改修", "見直し", 30)];
    const serve = () => {
      const s = rpServer({
        previews: { "2026-W40/weekly": preview("2026-W40", { days: SITE }) },
        timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", [
          session("a1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id }),
          session("a2", "2026-09-28 13:00", "2026-09-28 13:30", { task_id: T1.id }),
        ]) },
        tasks: TASKS,
      });
      s.db.edits["2026-W40/weekly"] = new Map([["days\u0000S:a2\u0000task", "beta 調査"]]);
      return s;
    };
    const s = serve();
    const { unmount } = await open("#/v2/report?cell=T20260901-01|2026-09-28", "en");
    const [e1, e2] = [...dw()!.querySelectorAll(".ent")];
    expect(e1.querySelector(".moved")).toBeNull();
    expect(e2.querySelector(".moved b")!.textContent).toBe("Date / task edited:");
    expect(e2.querySelector(".moved .mv")!.textContent).toBe("Taskalpha 改修 → beta 調査");
    fireEvent.click(screen.getByRole("button", { name: "Restore date / task" }));
    await waitFor(() => expect(writes(s)).toEqual([del("S:a2", "task")]));
    unmount();
    serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28", "ja");
    expect(dw()!.querySelector(".moved b")!.textContent).toBe("日付・案件が修正されています：");
    expect(dw()!.querySelector(".moved .mv")!.textContent).toBe("案件alpha 改修 → beta 調査");
    expect(dw()!.querySelector(".moved button")!.textContent).toBe("日付・案件を戻す");
  });
});

describe("格子抽屉 — a refused write says why (preflight R7)", () => {
  it("a 400 ValidationError: the interface-language prefix and the server's reason; other failures keep their text", async () => {
    const s = serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28", "en");
    s.failNext((m) => (m === "PUT" ? json({ error: "invalid", issues: [{ path: "value", message: "値が長すぎます" }] }, 400) : null));
    type(screen.getByLabelText("Work done 10:00–11:00 MAC"), "x");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(toasts()).toContain("Couldn't save: 値が長すぎます"));
    // a 400 without issues is a plain ApiError: the generic text
    act(() => { window.location.hash = "#/v2/report?cell=T20260901-01|2026-09-30"; });
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("Work done —").value).toBe("テスト"));
    s.failNext((m) => (m === "PUT" ? json({ error: "invalid week" }, 400) : null));
    type(screen.getByLabelText("Work done —"), "y");
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(toasts().filter((x) => x === "Couldn't save")).toHaveLength(1));
  });
});

describe("格子抽屉 — polished 作業内容 (input polish)", () => {
  const polishedDays = (meta?: { raw: string; pinned: boolean }): GridRow[] =>
    DAYS.map((r) => (r.row_key === K28 ? { ...r, cells: r.cells.map((c) => (c.column === "text" && meta ? { ...c, polish: meta } : c)) } : r));

  it("a polished text cell shows 润; 还原 pins the override by its server id", async () => {
    serve(polishedDays({ raw: "ちょうひょうなおす", pinned: false }));
    const pin = vi.spyOn(api, "pinPolish").mockResolvedValue({ pinned: true, raw: "x" } as never);
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    fireEvent.click(btn("已润色"));
    expect(screen.getByText("原文：ちょうひょうなおす")).toBeTruthy();
    await act(async () => { fireEvent.click(btn("还原")); });
    expect(pin).toHaveBeenCalledWith("report_override", "2026-W40\u001fweekly\u001fdays\u001fS:a1\u001ftext", "value", true);
    pin.mockRestore();
  });

  it("no mark without polish meta", async () => {
    serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    expect(dw()!.querySelector(".pm")).toBeNull();
  });
});

describe("格子抽屉 — closing keeps what was typed", () => {
  it("Esc and the scrim save the draft; 取消 drops it; Esc during IME composition does nothing", async () => {
    const s = serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    const text = screen.getByLabelText(TXT28);
    type(text, "Esc で閉じた");
    fireEvent.keyDown(text, { key: "Escape", keyCode: 229 });
    fireEvent.keyDown(text, { key: "Escape", isComposing: true });
    expect(readRp(window.location.hash).cell).not.toBeNull();
    fireEvent.keyDown(text, { key: "Escape" });
    expect(readRp(window.location.hash).cell).toBeNull();
    await waitFor(() => expect(writes(s)).toEqual([put(K28, "text", "Esc で閉じた")]));
    await settle();

    window.location.hash = "#/v2/report?cell=T20260901-01|2026-09-30";
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>(TXT30).value).toBe("テスト"));
    type(screen.getByLabelText(MIN30), "120");
    fireEvent.click(document.querySelector(".v2-scrim")!);
    await waitFor(() => expect(writes(s)).toEqual([put(K28, "text", "Esc で閉じた"), put(K30, "minutes", "120")]));
    await settle();

    window.location.hash = "#/v2/report?cell=T20260901-01|2026-09-28";
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>(TXT28).value).toBe("Esc で閉じた"));
    type(screen.getByLabelText(TXT28), "捨てる");
    type(screen.getByLabelText(MIN28), "180");
    fireEvent.click(btn("取消"));
    expect(readRp(window.location.hash).cell).toBeNull();
    await settle();
    expect(writes(s)).toHaveLength(2);
  });

  it("the address moving on (another week) saves the draft to the week it was typed in", async () => {
    const s = serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    type(screen.getByLabelText(TXT28), "週を変えた");
    const reads = () => vi.mocked(fetch).mock.calls.filter(([u, i]) => String(u) === "/api/reports/2026-W40/weekly" && (i?.method ?? "GET") === "GET").length;
    const before = reads();
    fireEvent.click(btn("下一周"));
    await waitFor(() => expect(writes(s)).toEqual([put(K28, "text", "週を変えた")]));
    expect(s.calls[0].url).toContain("/api/reports/2026-W40/weekly/cells");
    // group review B1: W40 is no longer on screen, and its report is still re-read after the write. At least once:
    // under load (the TZ reruns) react-query can read it a second time, which is not what this guards.
    await waitFor(() => expect(reads()).toBeGreaterThanOrEqual(before + 1));
  });

  it("an invalid draft left at close is dropped with a toast; the valid one is saved", async () => {
    const s = serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28", "ja");
    type(screen.getByLabelText("分 10:00–11:00 MAC"), "abc");
    type(screen.getByLabelText(TXT28), "残す");
    fireEvent.click(btn("閉じる"));
    await waitFor(() => expect(writes(s)).toEqual([put(K28, "text", "残す")]));
    expect(toasts()).toContain("保存されなかった入力があります：形式が正しくないか、その行がこのセルにもうありません");
  });
});

describe("格子抽屉 — a draft whose entry leaves the cell (group review B2)", () => {
  it("is reported with the dropped toast on 保存, and the other writes still go", async () => {
    const SITE = [dayRow("S:a1", "2026-09-28", "alpha 改修", "帳票の修正", 60), dayRow("S:a2", "2026-09-28", "alpha 改修", "見直し", 30)];
    const s = rpServer({
      previews: { "2026-W40/weekly": preview("2026-W40", { days: SITE }) },
      timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", [
        session("a1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id }),
        session("a2", "2026-09-28 13:00", "2026-09-28 13:30", { task_id: T1.id }),
      ]) },
      tasks: TASKS,
    });
    s.db.edits["2026-W40/weekly"] = new Map([["days\u0000S:a1\u0000text", "書き直し"]]);
    await open("#/v2/report?cell=T20260901-01|2026-09-28", "en");
    const ents = () => [...dw()!.querySelectorAll(".ent")];
    expect(ents()).toHaveLength(2);
    type(ents()[1].querySelector("textarea")!, "消える下書き");
    // S:a2 goes elsewhere (linked to another 案件 on 时间线); the restore's re-read brings that in
    s.db.previews["2026-W40/weekly"] = preview("2026-W40", { days: [SITE[0]] });
    fireEvent.click(btn("Restore auto"));
    await waitFor(() => expect(ents()).toHaveLength(1));
    fireEvent.click(btn("Save"));
    await waitFor(() => expect(toasts()).toContain("An entry was not saved: invalid, or no longer in this cell"));
    await settle();
    expect(writes(s)).toEqual([del("S:a1", "text")]);
  });
});

describe("格子抽屉 — one block per source", () => {
  const SITE_SESSIONS = [
    session("a1", "2026-09-28 10:00", "2026-09-28 11:00", { task_id: T1.id, summary: "帳票の修正" }),
    session("a2", "2026-09-28 13:00", "2026-09-28 13:30", { task_id: T1.id, summary: "見直し" }),
    session("z1", "2026-09-29 23:00", "2026-09-30 01:00", { task_id: T1.id, summary: "夜間対応" }),
  ];
  const SITE_DAYS = [
    dayRow("S:a1", "2026-09-28", "alpha 改修", "帳票の修正", 60),
    dayRow("S:a2", "2026-09-28", "alpha 改修", "見直し", 30),
    dayRow("S:z1", "2026-09-29", "alpha 改修", "夜間対応", 60),
    dayRow("S:z1", "2026-09-30", "alpha 改修", "夜間対応", 60),
  ];
  const serveSite = () => rpServer({
    previews: { "2026-W40/weekly": preview("2026-W40", { days: SITE_DAYS, tasks: [taskRow(T1, 3.5)] }) },
    timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", SITE_SESSIONS) },
    tasks: TASKS,
  });

  it("each entry has its own 作業内容 and minutes; one 保存 sends the changed fields in order", async () => {
    const s = serveSite();
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    expect(dw()!.querySelector(".dw-sub")!.textContent).toBe("日別作業");
    const ents = [...dw()!.querySelectorAll(".ent")];
    expect(ents.map((e) => e.querySelector(".ss")!.textContent)).toEqual(["10:00–11:00MAC · 60 分钟", "13:00–13:30MAC · 30 分钟"]);
    const m2 = screen.getByLabelText<HTMLInputElement>("分钟 13:00–13:30 MAC");
    expect(m2.value).toBe("30");
    type(screen.getByLabelText("作業内容 10:00–11:00 MAC"), "帳票の修正（完了）");
    type(m2, "45");
    expect(screen.queryByRole("button", { name: "恢复自动值" })).toBeNull();
    fireEvent.click(btn("保存"));
    await waitFor(() => expect(writes(s)).toEqual([put("S:a1", "text", "帳票の修正（完了）"), put("S:a2", "minutes", "45")]));
  });

  it("an edited entry shows ✎ and its 恢复自动值 removes only its own edits; bad minutes are refused inline", async () => {
    const s = serveSite();
    s.db.edits["2026-W40/weekly"] = new Map([["days\u0000S:a2\u0000text", "見直し（修正）"]]);
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    const [e1, e2] = [...dw()!.querySelectorAll(".ent")];
    expect(e1.querySelector(".ovtag")).toBeNull();
    expect(e2.querySelector(".ovtag")!.textContent).toBe("✎ 已修改");
    expect(e2.querySelector(".auto")!.textContent).toBe("自动值見直し");
    const restores = screen.getAllByRole("button", { name: "恢复自动值" });
    expect(restores).toHaveLength(1);
    fireEvent.click(restores[0]);
    await waitFor(() => expect(writes(s)).toEqual([del("S:a2", "text")]));
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("作業内容 13:00–13:30 MAC").value).toBe("見直し"));

    type(screen.getByLabelText("分钟 10:00–11:00 MAC"), "1.5");
    fireEvent.click(btn("保存"));
    expect(screen.getByRole("alert").textContent).toBe("请输入整数分钟");
    await settle();
    expect(writes(s)).toHaveLength(1);
  });

  it("a session over midnight is one row key on two days: the entry says the edit reaches the other day too", async () => {
    const s = serveSite();
    const { container } = await open("#/v2/report?cell=T20260901-01|2026-09-29");
    expect(dw()!.querySelector(".xday")!.textContent).toBe("这条会话跨天，修改会同时作用于 9/30 那一格");
    type(screen.getByLabelText("分钟 23:00–01:00 MAC"), "90");
    fireEvent.click(btn("保存"));
    await waitFor(() => expect(writes(s)).toEqual([put("S:z1", "minutes", "90")]));
    // the server applies one override to both rows
    await waitFor(() => expect(ink(ledCell(container, "T20260901-01|2026-09-30"))).toBe("1.5H"));
    expect(ink(ledCell(container, "T20260901-01|2026-09-29"))).toBe("1.5H");
  });

  it("the note in English and Japanese", async () => {
    serveSite();
    const { unmount } = await open("#/v2/report?cell=T20260901-01|2026-09-30", "en");
    expect(dw()!.querySelector(".xday")!.textContent).toBe("This session crosses midnight: edits also apply to the 9/29 cell");
    unmount();
    serveSite();
    await open("#/v2/report?cell=T20260901-01|2026-09-30", "ja");
    expect(dw()!.querySelector(".xday")!.textContent).toBe("このセッションは日をまたぐため、修正は 9/29 のセルにも反映されます");
    expect(dw()!.querySelector(".dw-h .dt")!.textContent).toBe("9/30（水）");
  });
});

describe("格子抽屉 — a session over midnight with different minutes per day (preflight R1)", () => {
  // z1 runs 23:00–01:30: 60 minutes on 9/29, 90 on 9/30 — two rows, one row key
  const Z1 = session("z1", "2026-09-29 23:00", "2026-09-30 01:30", { task_id: T1.id, summary: "夜間対応" });
  const Z_DAYS = [
    dayRow("S:z1", "2026-09-29", "alpha 改修", "夜間対応", 60),
    dayRow("S:z1", "2026-09-30", "alpha 改修", "夜間対応", 90),
  ];
  const serveZ = () => rpServer({
    previews: { "2026-W40/weekly": preview("2026-W40", { days: Z_DAYS, tasks: [taskRow(T1, 2.5)] }) },
    timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", [Z1]) },
    tasks: TASKS,
  });
  const minutesOf = (p: ReportPreview | undefined) => p!.sheets.find((g) => g.key === "days")!.rows.map((r) => r.cells[3].value);

  it("the 9/30 cell typed with 9/29's computed 60 is a change there: a PUT", async () => {
    const s = serveZ();
    await open("#/v2/report?cell=T20260901-01|2026-09-30");
    type(screen.getByLabelText("分钟 23:00–01:30 MAC"), "60");
    fireEvent.click(btn("保存"));
    await waitFor(() => expect(writes(s)).toEqual([put("S:z1", "minutes", "60")]));
  });

  it("an edited row typed back to its own day's computed value is a restore: a DELETE", async () => {
    const s = serveZ();
    s.db.edits["2026-W40/weekly"] = new Map([["days\u0000S:z1\u0000minutes", "75"]]);
    await open("#/v2/report?cell=T20260901-01|2026-09-30");
    type(screen.getByLabelText("分钟 23:00–01:30 MAC"), "90");
    fireEvent.click(btn("保存"));
    await waitFor(() => expect(writes(s)).toEqual([del("S:z1", "minutes")]));
  });

  it("a write touches only its own day's row, and a failure rolls back only that row", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = keys.report("2026-W40", "weekly");
    qc.setQueryData(key, preview("2026-W40", { days: Z_DAYS }));
    let reject!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { reject = () => r(fail(500)); })));
    const ref: CellRef = { week: "2026-W40", sheet: "days", row_key: "S:z1", column: "minutes", date: "2026-09-30" };
    const p = putCell(qc, ref, "45");
    await waitFor(() => expect(minutesOf(qc.getQueryData(key))).toEqual([60, "45"]));
    reject();
    await expect(p).rejects.toThrow();
    expect(minutesOf(qc.getQueryData(key))).toEqual([60, 90]);
  }, 15_000); // several writes + re-reads: ~1.8 s alone, past the 5 s default when the machine is busy (verifier)
});

describe("useReportWrite — the queue", () => {
  const REF: CellRef = { week: "2026-W40", sheet: "days", row_key: K28, column: "minutes" };
  let w: ReportWrite;
  function Probe() {
    w = useReportWrite();
    const q = useQuery({ queryKey: keys.report("2026-W40", "weekly"), queryFn: () => api.report("2026-W40", "weekly") });
    return <span data-testid="v">{q.data ? String(q.data.sheets.find((g) => g.key === "days")!.rows[0].cells[3].value) : ""}</span>;
  }

  it("two quick saves run in order, the second decided on the cache after the first is answered and re-read", async () => {
    const s = serve();
    render(<V2TestProvider><Probe /><ToastHost /></V2TestProvider>);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("60"));
    let release!: () => void;
    s.failNext((m) => (m === "PUT" ? new Promise<Response>((r) => { release = () => { s.db.edits[KEY] = new Map([[`days\u0000${K28}\u0000minutes`, "90"]]); r(json({ ok: true })); }; }) : null));
    let a!: Promise<unknown>, b!: Promise<unknown>;
    act(() => {
      a = w.save(REF, "90");
      // typed back to the computed value before the first is answered: at the click nothing is edited yet
      b = w.save(REF, "60");
    });
    await waitFor(() => expect(writes(s)).toEqual([put(K28, "minutes", "90")]));
    expect(screen.getByTestId("v").textContent).toBe("90");
    await settle();
    expect(writes(s)).toHaveLength(1);              // the second waits for the first
    await act(async () => { release(); });
    expect(await a).toBe("put");
    expect(await b).toBe("delete");
    expect(writes(s)).toEqual([put(K28, "minutes", "90"), del(K28, "minutes")]);
  });

  it("a failure is reported (or thrown with rethrow) and the next write still runs", async () => {
    const s = serve();
    render(<V2TestProvider lang="ja"><Probe /><ToastHost /></V2TestProvider>);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("60"));
    s.failNext((m) => (m === "PUT" ? fail(500) : null));
    let a!: Promise<unknown>, b!: Promise<unknown>;
    act(() => { a = w.save(REF, "75"); b = w.save({ ...REF, column: "text" }, "x", { rethrow: true }); });
    expect(await a).toBeUndefined();
    await waitFor(() => expect(toasts()).toContain("保存できませんでした"));
    expect(await b).toBe("put");
    s.failNext((m) => (m === "PUT" ? fail(500) : null));
    await expect(act(() => w.save({ ...REF, column: "text" }, "y", { rethrow: true }))).rejects.toThrow();
  });
});

describe("格子抽屉 — 表世界", () => {
  it("renders on paper", async () => {
    applyWorld("omote");
    serve();
    await open("#/v2/report?cell=T20260901-01|2026-09-28");
    expect(document.documentElement.getAttribute("data-world")).toBe("omote");
    expect(dw()!.querySelector(".dw-title")!.textContent).toBe("alpha 改修");
    expect(screen.getByLabelText(MIN28)).toBeTruthy();
  });
});
