import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeOut, ReportDownload } from "../src/api/types";
import type { Lang, Prefs } from "../src/prefs/types";
import { REFRESH_MS } from "../src/pages/now/useNowData";
import { ReportPage } from "../src/pages/ReportPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { fail, preview, rpServer } from "./rp-serve";

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (hash: string, o: { lang?: Lang; prefs?: Partial<Prefs> } = {}) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={o.lang} prefs={o.prefs}><ReportPage /></V2TestProvider>);
};
const tabs = (c: Element) => [...c.querySelectorAll(".rp-tabs button")].map((b) => ink(b));
const current = (c: Element) => [...c.querySelectorAll(".rp-tabs button[aria-current=page]")].map((b) => ink(b));
const view = (c: Element) => [...c.querySelectorAll(".rp-view")].map((v) => (v as HTMLElement).dataset.sheet);
/** The toolbar's ↓ xlsx key once the preview is shown (enabled). */
const dlKey = (c: Element) => c.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.xlsx:not([disabled])");
/** Opens the range panel and answers its 下载 link. */
const panelLink = async (c: Element) => {
  fireEvent.click(dlKey(c)!);
  return await within(await screen.findByRole("dialog", { name: "导出 xlsx" })).findByRole("link", { name: "下载" }) as HTMLAnchorElement;
};
const dlFetches = (week: string) => vi.mocked(fetch).mock.calls.filter(([u]) => String(u) === `/api/report-downloads?week=${week}`).length;
/** A click on the download link without jsdom trying to navigate (the page's onClick still runs). */
const clickDownload = (a: HTMLAnchorElement) => { const e = createEvent.click(a); e.preventDefault(); fireEvent(a, e); };
/** A server that has the previews of these weeks; `bounds` answers /api/reports/range/bounds. */
const serve = (weeks: string[], o: Parameters<typeof preview>[1] = {}, downloads: Record<string, ReportDownload[]> = {},
  bounds: { first: string | null; last: string } = { first: weeks[0] ?? null, last: "2026-W40" }) =>
  rpServer({
    previews: Object.fromEntries(weeks.map((w) => [`${w}/weekly`, preview(w, o)])),
    downloads,
    bounds,
  });
/** The next GET of `url` waits until the returned function is called. */
function gate(s: ReturnType<typeof rpServer>, url: string) {
  let open!: () => void;
  const g = new Promise<void>((r) => { open = r; });
  s.failNext((m, u) => (m === "GET" && u === url ? g.then(() => {
    const w = u.split("/")[3];
    return new Response(JSON.stringify(s.db.previews[`${w}/weekly`]), { status: 200, headers: { "Content-Type": "application/json" } });
  }) : null));
  return open;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("ReportPage — control line", () => {
  it("◀ ▶ move a week with a history entry, keep the sheet; 本周 only away from this week, back to bare #/v2/report", async () => {
    serve(["2026-W38", "2026-W39", "2026-W40"]);
    const { container } = page("#/v2/report/2026-W39?sheet=tasks");
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    const nav = screen.getByRole("group", { name: "周导航" });
    expect(ink(nav)).toContain("9/19–9/25 · 第 39 周");
    const len = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    expect(window.location.hash).toBe("#/v2/report/2026-W38?sheet=tasks");
    expect(window.history.length).toBe(len + 1);
    await waitFor(() => expect(ink(nav)).toContain("9/12–9/18 · 第 38 周"));
    expect(current(container)).toEqual(["案件一覧"]);
    fireEvent.click(screen.getByRole("button", { name: "下一周" }));
    expect(window.location.hash).toBe("#/v2/report/2026-W39?sheet=tasks");
    fireEvent.click(screen.getByRole("button", { name: "本周" }));
    expect(window.location.hash).toBe("#/v2/report?sheet=tasks");
    await waitFor(() => expect(ink(nav)).toContain("9/26–10/2 · 第 40 周"));
    expect(screen.queryByRole("button", { name: "本周" })).toBeNull();
  });

  it("the report week runs Sat→Fri: on Saturday 10/3 本周 is W41, and W40 is last week's report", async () => {
    vi.setSystemTime(new Date(J("2026-10-03 09:00")));
    serve(["2026-W40", "2026-W41"]);
    const { container } = page("#/v2/report/2026-W40");
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    const nav = screen.getByRole("group", { name: "周导航" });
    expect(ink(nav)).toContain("9/26–10/2 · 第 40 周");
    fireEvent.click(screen.getByRole("button", { name: "本周" }));
    expect(window.location.hash).toBe("#/v2/report");
    await waitFor(() => expect(ink(nav)).toContain("10/3–10/9 · 第 41 周"));
    expect(screen.queryByRole("button", { name: "本周" })).toBeNull();
  });

  it("preflight R8: ▶ with the drawer open drops ?cell= from the entry it leaves, so Back does not reopen it", async () => {
    serve(["2026-W39", "2026-W40"]);
    page("#/v2/report/2026-W39?cell=-|2026-09-22");
    await waitFor(() => expect(screen.getAllByRole("button", { name: "下一周" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "下一周" })[0]);
    expect(window.location.hash).toBe("#/v2/report");
    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).not.toBe("#/v2/report"));
    expect(window.location.hash).toBe("#/v2/report/2026-W39");
  });

  it("no template switch: an old ?tpl= is ignored, and the next change of sheet drops it", async () => {
    serve(["2026-W40"]);
    const { container } = page("#/v2/report?tpl=agency&sheet=deliverables");
    await waitFor(() => expect(current(container)).toEqual(["成果物"]));
    expect(screen.queryByRole("button", { name: "派遣元" })).toBeNull();
    expect(screen.queryByRole("button", { name: "現場" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "稼働" }));
    expect(window.location.hash).toBe("#/v2/report?sheet=hours");
  });

  it("↓ xlsx is a disabled key before the preview, an enabled key after; its panel links the range xlsx", async () => {
    serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    expect(dlKey(container)).toBeNull();
    const off = container.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.xlsx")!;
    expect(off).toBeDisabled();
    await waitFor(() => expect(off.textContent).toBe("↓ xlsx"));
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    const a = await panelLink(container);
    expect(a.getAttribute("href")).toBe("/api/reports/range/xlsx?from=2026-W40&to=2026-W40&lang=ja");
    expect(a.hasAttribute("download")).toBe(true);
    expect(a.getAttribute("download")).toBe("");
  });

  it("while another week loads: the old preview stays with 更新中… and the download is disabled; the new one brings the link back", async () => {
    const s = serve(["2026-W39", "2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    const open = gate(s, "/api/reports/2026-W39/weekly");
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(ink(screen.getByRole("status"))).toBe("更新中…");
    expect(dlKey(container)).toBeNull();
    expect(screen.getByRole("button", { name: "↓ xlsx" })).toBeDisabled();
    expect(tabs(container)).toHaveLength(5);                            // still the W40 preview on screen
    await act(async () => { open(); });
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    expect(screen.queryByText("更新中…")).toBeNull();
    expect(container.querySelector(".rp-ctl [role=status]")).toBeNull();
  });

  it("no 更新中… on a background refetch of the same week (the 5-minute refresh is not stale)", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    const s = serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    const open = gate(s, "/api/reports/2026-W40/weekly");
    const before = vi.mocked(fetch).mock.calls.filter(([u]) => String(u) === "/api/reports/2026-W40/weekly").length;
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u) === "/api/reports/2026-W40/weekly").length).toBe(before + 1));
    // in flight now: the preview stays, the download stays a link, and nothing says 更新中
    expect(container.querySelector(".rp-ctl [role=status]")).toBeNull();
    expect(dlKey(container)).not.toBeNull();
    await act(async () => { open(); });
  });

  it("上次下载 shows the week's newest download in Tokyo time; 还没下载过 when it has none", async () => {
    serve(["2026-W39", "2026-W40"], {}, { "2026-W40": [{ week: "2026-W40", template: "weekly", at: "2026-10-02T08:40:00Z" }] });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(ink(container.querySelector(".rp-ctl")!)).toContain("上次下载 10/02 17:40"));
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(ink(container.querySelector(".rp-ctl")!)).toContain("还没下载过"));
    expect(ink(container.querySelector(".rp-ctl")!)).not.toContain("上次下载");
  });

  it("after a click on 下载 the download list is re-read on the next window focus — once", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    await waitFor(() => expect(dlFetches("2026-W40")).toBe(1));
    clickDownload(await panelLink(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(dlFetches("2026-W40")).toBe(1);
    await act(async () => { fireEvent.focus(window); });
    await waitFor(() => expect(dlFetches("2026-W40")).toBe(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });   // the 4 s fallback was disarmed
    expect(dlFetches("2026-W40")).toBe(2);
  });

  it("after a click on 下载 without a focus change the list is re-read after 4 s — once", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    await waitFor(() => expect(dlFetches("2026-W40")).toBe(1));
    clickDownload(await panelLink(container));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(dlFetches("2026-W40")).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await waitFor(() => expect(dlFetches("2026-W40")).toBe(2));
    await act(async () => { fireEvent.focus(window); });                  // the focus listener was removed
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(dlFetches("2026-W40")).toBe(2);
  });
});

describe("ReportPage — range xlsx panel", () => {
  it("↓ xlsx opens the range panel: defaults first week with data … last week, the export language", async () => {
    serve(["2026-W40"], {}, {}, { first: "2026-W30", last: "2026-W40" });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    fireEvent.click(dlKey(container)!);
    const panel = await screen.findByRole("dialog", { name: "导出 xlsx" });
    expect(container.querySelector(".rp-ctl a.key.pri")).toBeNull();
    expect(await within(panel).findByLabelText("起始周")).toHaveValue("2026-W30");
    expect(within(panel).getByLabelText("结束周")).toHaveValue("2026-W40");
    expect(within(panel).getByRole("link", { name: "下载" })).toHaveAttribute("href", "/api/reports/range/xlsx?from=2026-W30&to=2026-W40&lang=ja");
  });

  it("the link follows the picks; from after to or over 52 weeks disables it with the reason", async () => {
    serve(["2026-W40"], {}, {}, { first: "2025-W01", last: "2026-W40" });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    fireEvent.click(dlKey(container)!);
    const panel = await screen.findByRole("dialog", { name: "导出 xlsx" });
    // default from = max(first, last − 51 weeks): 2025-W41 … 2026-W40 is exactly 52 weeks, downloadable
    expect(await within(panel).findByLabelText("起始周")).toHaveValue("2025-W41");
    expect(within(panel).getByRole("link", { name: "下载" })).toHaveAttribute("href", "/api/reports/range/xlsx?from=2025-W41&to=2026-W40&lang=ja");
    fireEvent.change(within(panel).getByLabelText("起始周"), { target: { value: "2025-W01" } });   // 92 weeks
    expect(within(panel).queryByRole("link", { name: "下载" })).toBeNull();
    expect(within(panel).getByText("最多 52 周")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("起始周"), { target: { value: "2026-W39" } });
    fireEvent.click(within(panel).getByRole("button", { name: "EN" }));
    expect(within(panel).getByRole("link", { name: "下载" })).toHaveAttribute("href", "/api/reports/range/xlsx?from=2026-W39&to=2026-W40&lang=en");
    fireEvent.change(within(panel).getByLabelText("结束周"), { target: { value: "2026-W38" } });
    expect(within(panel).getByText("起始周晚于结束周")).toBeInTheDocument();
  });

  it("Esc closes the panel and nothing else", async () => {
    serve(["2026-W40"], {}, {}, { first: "2026-W38", last: "2026-W40" });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    fireEvent.click(dlKey(container)!);
    const panel = await screen.findByRole("dialog", { name: "导出 xlsx" });
    const outer = vi.fn(); window.addEventListener("keydown", outer);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "导出 xlsx" })).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener("keydown", outer);
  });

  it("an outside click closes the panel; a click inside does not", async () => {
    serve(["2026-W40"], {}, {}, { first: "2026-W38", last: "2026-W40" });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    fireEvent.click(dlKey(container)!);
    const panel = await screen.findByRole("dialog", { name: "导出 xlsx" });
    fireEvent.pointerDown(await within(panel).findByLabelText("起始周"));
    expect(screen.getByRole("dialog", { name: "导出 xlsx" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "导出 xlsx" })).toBeNull();
  });
});

describe("ReportPage — range xlsx panel: focus, Esc, failures", () => {
  const boundsFetches = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u) === "/api/reports/range/bounds").length;
  const open = async (c: Element) => {
    await waitFor(() => expect(dlKey(c)).not.toBeNull());
    fireEvent.click(dlKey(c)!);
    return screen.findByRole("dialog", { name: "导出 xlsx" });
  };

  it("the key points at the panel (aria-controls); Esc in the panel or on the key closes it, focus back on the key", async () => {
    serve(["2026-W40"], {}, {}, { first: "2026-W38", last: "2026-W40" });
    const { container } = page("#/v2/report");
    const panel = await open(container);
    const key = dlKey(container)!;
    expect(key).toHaveAttribute("aria-expanded", "true");
    expect(key.getAttribute("aria-controls")).toBe(panel.id);
    fireEvent.keyDown(await within(panel).findByLabelText("起始周"), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "导出 xlsx" })).toBeNull();
    expect(document.activeElement).toBe(key);
    expect(key).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(key);
    await screen.findByRole("dialog", { name: "导出 xlsx" });
    const outer = vi.fn(); window.addEventListener("keydown", outer);
    key.focus();
    fireEvent.keyDown(key, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "导出 xlsx" })).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener("keydown", outer);
  });

  it("an Esc that ends an IME composition does not close the panel", async () => {
    serve(["2026-W40"], {}, {}, { first: "2026-W38", last: "2026-W40" });
    const { container } = page("#/v2/report");
    const panel = await open(container);
    fireEvent.keyDown(panel, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog", { name: "导出 xlsx" })).toBeInTheDocument();
  });

  it("a click on 下载 closes the panel and puts the focus back on the key", async () => {
    serve(["2026-W40"], {}, {}, { first: "2026-W38", last: "2026-W40" });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    clickDownload(await panelLink(container));
    expect(screen.queryByRole("dialog", { name: "导出 xlsx" })).toBeNull();
    expect(document.activeElement).toBe(dlKey(container));
  });

  it("a week switch closes the panel", async () => {
    serve(["2026-W39", "2026-W40"], {}, {}, { first: "2026-W38", last: "2026-W40" });
    const { container } = page("#/v2/report");
    await open(container);
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "导出 xlsx" })).toBeNull());
  });

  it("the panel opens at once with 读取中 while the weeks load; a failure says so after one request", async () => {
    const s = serve(["2026-W40"]);
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    s.failNext((m, u) => (m === "GET" && u === "/api/reports/range/bounds" ? held.then(() => fail(500)) : null));
    const { container } = page("#/v2/report");
    const panel = await open(container);
    expect(within(panel).getByRole("status").textContent).toBe("读取中…");
    await act(async () => { release(); });
    expect((await within(panel).findByRole("alert")).textContent).toBe("无法读取可导出的周");
    expect(boundsFetches()).toBe(1);
    expect(within(panel).queryByRole("link", { name: "下载" })).toBeNull();
  });

  it("the reason's live region is there before any reason", async () => {
    serve(["2026-W40"], {}, {}, { first: "2026-W38", last: "2026-W40" });
    const { container } = page("#/v2/report");
    const panel = await open(container);
    await within(panel).findByLabelText("起始周");
    const live = panel.querySelector(".why[role=status]")!;
    expect(live.textContent).toBe("");
    fireEvent.change(within(panel).getByLabelText("结束周"), { target: { value: "2026-W38" } });
    fireEvent.change(within(panel).getByLabelText("起始周"), { target: { value: "2026-W40" } });
    expect(panel.querySelector(".why[role=status]")).toBe(live);
    expect(live.textContent).toBe("起始周晚于结束周");
  });
});

describe("ReportPage — 未关联 warning", () => {
  it("unlinked sessions: a red lamp, the count and minutes, and a link to the week's timeline filtered to 未关联", async () => {
    serve(["2026-W39"], { unassigned_sessions: 3, unassigned_minutes: 95 });
    const { container } = page("#/v2/report/2026-W39");
    await waitFor(() => expect(container.querySelector(".rp-warn")).not.toBeNull());
    const w = container.querySelector(".rp-warn")!;
    expect(w.closest("[data-mod]")?.getAttribute("data-mod")).toBe("report.warn");
    expect(w.querySelector(".lamp.red")).not.toBeNull();
    expect(ink(w)).toContain("本周有 3 条会话未关联（95 分钟），不会计入任何案件");
    expect(screen.getByRole("link", { name: "查看时间线 →" }).getAttribute("href")).toBe("#/v2/timeline/2026-W39?unlinked=1");
  });

  it("none when every session is linked", async () => {
    serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    expect(container.querySelector(".rp-warn")).toBeNull();
  });

  it("in 表 the report.warn module can be hidden; 里 always shows it", async () => {
    serve(["2026-W40"], { unassigned_sessions: 1, unassigned_minutes: 10 });
    applyWorld("omote");
    const hide = { omote: { font: "plex" as const, hide: ["report.warn"] } };
    const { container, unmount } = page("#/v2/report", { prefs: hide });
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    expect(container.querySelector(".rp-warn")).toBeNull();
    unmount();
    applyWorld("ura");
    const r = page("#/v2/report", { prefs: hide });
    await waitFor(() => expect(r.container.querySelector(".rp-warn")).not.toBeNull());
  });
});

describe("ReportPage — sheet tabs", () => {
  it("one tab per preview sheet in the server's order, 日別作業 by default, ?sheet= honoured, a click replaces the address", async () => {
    serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(tabs(container)).toEqual(["サマリー", "案件一覧", "日別作業", "成果物", "稼働"]));
    expect(current(container)).toEqual(["日別作業"]);
    expect(view(container)).toEqual(["days"]);
    expect(screen.getByRole("navigation", { name: "工作表" })).toBeTruthy();
    const len = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "サマリー" }));
    expect(window.location.hash).toBe("#/v2/report?sheet=summary");
    expect(window.history.length).toBe(len);
    await waitFor(() => expect(current(container)).toEqual(["サマリー"]));
    expect(view(container)).toEqual(["summary"]);
  });

  it("a sheet the preview lacks falls back to 日別作業", async () => {
    const s = serve(["2026-W40"]);
    const p = s.db.previews["2026-W40/weekly"];
    s.db.previews["2026-W40/weekly"] = { ...p, sheets: p.sheets.filter((g) => g.key !== "hours") };
    const { container } = page("#/v2/report?sheet=hours");
    await waitFor(() => expect(tabs(container)).toEqual(["サマリー", "案件一覧", "日別作業", "成果物"]));
    expect(current(container)).toEqual(["日別作業"]);
    expect(view(container)).toEqual(["days"]);
  });

  it("tab names: the JP sheet names in zh and ja, English in en; the hybrid note in each language", async () => {
    serve(["2026-W40"]);
    for (const [lang, names, hyb] of [
      ["zh", ["サマリー", "案件一覧", "日別作業", "成果物", "稼働"], "混合式"],
      ["ja", ["サマリー", "案件一覧", "日別作業", "成果物", "稼働"], "ハイブリッド"],
      ["en", ["Summary", "Tasks", "By day", "Deliverables", "Hours"], "Hybrid"],
    ] as const) {
      const { container, unmount } = page("#/v2/report", { lang });
      await waitFor(() => expect(tabs(container)).toEqual(names));
      expect(container.querySelector(".rp-hyb b")!.textContent).toBe(hyb);
      unmount();
    }
  });

  it("group review D5: the hybrid note only in 里 on 日別作業", async () => {
    serve(["2026-W40"]);
    const { container, unmount } = page("#/v2/report");
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    expect(container.querySelector(".rp-hyb")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "案件一覧" }));
    await waitFor(() => expect(view(container)).toEqual(["tasks"]));
    expect(container.querySelector(".rp-hyb")).toBeNull();
    unmount();
    applyWorld("omote");
    const o = page("#/v2/report").container;
    await waitFor(() => expect(tabs(o)).toHaveLength(5));
    expect(view(o)).toEqual(["days"]);
    expect(o.querySelector(".rp-hyb")).toBeNull();
  });
});

describe("ReportPage — loading and failures", () => {
  it("the first load says 读取中 (role=status) and has no tabs", async () => {
    const s = serve(["2026-W40"]);
    gate(s, "/api/reports/2026-W40/weekly");
    const { container } = page("#/v2/report");
    await waitFor(() => expect(ink(screen.getByRole("status"))).toBe("读取中…"));
    expect(container.querySelector(".rp-tabs")).toBeNull();
    expect(screen.queryByText("更新中…")).toBeNull();
  });

  it("a week the server cannot build (404): 无法生成该周周报, no retry", async () => {
    rpServer();
    page("#/v2/report/2026-W39");
    const a = await screen.findByRole("alert");
    expect(ink(a)).toBe("无法生成该周周报");
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("a 400 is the same", async () => {
    const s = serve(["2026-W40"]);
    s.failNext((_m, u) => (u.startsWith("/api/reports/") ? fail(400) : null));
    page("#/v2/report");
    expect(ink(await screen.findByRole("alert"))).toBe("无法生成该周周报");
  });

  it("other failures: 加载周报失败 with 重试 (after the app's retries), which fetches again", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    serve(["2026-W40"]);
    const real = vi.mocked(fetch).getMockImplementation()!;
    let broken = true;
    vi.mocked(fetch).mockImplementation(async (u, i) => (broken && String(u).startsWith("/api/reports/") ? fail(500) : real(u, i)));
    const { container } = page("#/v2/report");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const a = await screen.findByRole("alert");
    expect(ink(a)).toBe(["加载周报失败", "重试"].join("|"));
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("group review A1: a refresh that fails with a preview on screen says so with 重试 above the tabs and keeps the page", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    serve(["2026-W40"]);
    const real = vi.mocked(fetch).getMockImplementation()!;
    let broken = false;
    vi.mocked(fetch).mockImplementation(async (u, i) => (broken && String(u).startsWith("/api/reports/") ? fail(500) : real(u, i)));
    const { container } = page("#/v2/report");
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    expect(screen.queryByRole("alert")).toBeNull();
    broken = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS + 10_000); });
    const a = await screen.findByRole("alert");
    expect(ink(a)).toBe(["加载周报失败", "重试"].join("|"));
    expect(a.classList.contains("rp-fail")).toBe(true);
    // above the tabs, with the page kept
    expect(a.compareDocumentPosition(container.querySelector(".rp-tabs")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabs(container)).toHaveLength(5);
    expect(view(container)).toEqual(["days"]);
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(tabs(container)).toHaveLength(5);
  });

  it("group review A4: a 200 that is not a preview (no sheets) is a failure with 重试, not an endless 读取中", async () => {
    const s = serve(["2026-W40"]);
    s.failNext((_m, u) => (u === "/api/reports/2026-W40/weekly" ? new Response("{\"ok\":true}", { status: 200, headers: { "Content-Type": "application/json" } }) : null));
    const { container } = page("#/v2/report");
    const a = await screen.findByRole("alert");
    expect(ink(a)).toBe(["加载周报失败", "重试"].join("|"));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(tabs(container)).toHaveLength(5));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a 401 is the global banner's: no alert here", async () => {
    const s = serve(["2026-W40"]);
    s.failNext((_m, u) => (u.startsWith("/api/reports/") ? new Response("{}", { status: 401 }) : null));
    const { container } = page("#/v2/report");
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector(".rp-wait")).toBeNull();
  });
});

describe("ReportPage — export language and PDF", () => {
  it("export language defaults to 日本語 under a zh UI; the panel's language starts from the toolbar's pick", async () => {
    serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    const group = screen.getByRole("group", { name: "导出语言" });
    expect(group.querySelector("[aria-pressed=true]")!.textContent).toContain("日本語");
    expect((await panelLink(container)).getAttribute("href")).toMatch(/lang=ja$/);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "导出 xlsx" }), { key: "Escape" });
    fireEvent.click(within(group).getByRole("button", { name: "EN" }));
    expect((await panelLink(container)).getAttribute("href")).toMatch(/lang=en$/);
  });

  it("↓ PDF: 生成中… while the server renders, then the busy message from Retry-After; nothing re-reads downloads", async () => {
    const s = serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    s.failNext((m, u) => (m === "GET" && u.startsWith("/api/reports/2026-W40/pdf?") ? held.then(() =>
      new Response(JSON.stringify({ error: "pdf busy", retry_after: 20 }), { status: 503, headers: { "Retry-After": "20", "Content-Type": "application/json" } })) : null));
    const btn = container.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.pdf")!;
    fireEvent.click(btn);
    await waitFor(() => expect(ink(btn)).toBe("生成中…"));
    expect(btn).toBeDisabled();
    expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === "/api/reports/2026-W40/pdf?lang=ja")).toBe(true);
    await act(async () => { release(); });
    await waitFor(() => expect(ink(container.querySelector(".rp-ctl [role=status]")!)).toBe("PDF 服务繁忙，请 20 秒后再试"));
    expect(ink(btn)).toBe("↓ PDF");
    expect(btn).not.toBeDisabled();
  });

  it("a PDF still rendering when the week is switched keeps the button busy and shows nothing on the new week", async () => {
    const s = serve(["2026-W39", "2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    s.failNext((m, u) => (m === "GET" && u.startsWith("/api/reports/2026-W40/pdf?") ? held.then(() =>
      new Response(JSON.stringify({ error: "pdf busy", retry_after: 20 }), { status: 503, headers: { "Retry-After": "20", "Content-Type": "application/json" } })) : null));
    const btn = container.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.pdf")!;
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "上一周" }));
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    expect(container.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.pdf")).toBeDisabled();
    await act(async () => { release(); });
    await waitFor(() => expect(container.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.pdf")).not.toBeDisabled());
    expect(container.querySelector(".rp-ctl [role=status]")).toBeNull();
  });

  it("a used-up daily quota (Retry-After 3600) says try again tomorrow, not 3600 seconds", async () => {
    const s = serve(["2026-W40"]);
    const { container } = page("#/v2/report");
    await waitFor(() => expect(dlKey(container)).not.toBeNull());
    s.failNext((m, u) => (m === "GET" && u.startsWith("/api/reports/2026-W40/pdf?")
      ? new Response(JSON.stringify({ error: "pdf busy", retry_after: 3600 }), { status: 503, headers: { "Retry-After": "3600", "Content-Type": "application/json" } }) : null));
    fireEvent.click(container.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.pdf")!);
    await waitFor(() => expect(ink(container.querySelector(".rp-ctl [role=status]")!)).toBe("今天的 PDF 额度已用完，请明天再试"));
  });

  describe("↓ PDF checks the composition first", () => {
    const view = (o: Partial<ComposeOut> = {}): ComposeOut => ({
      week: "2026-W40", inherited: false, updated_at: "t", items: [], text: { summary: ["■ x"], days: {} }, edited: false,
      generated_at: "2026-10-09T01:00:00Z", generating: false, translating: false, translate_failed: false,
      stale: { selection: false, inputs: false }, ...o });
    const pdfFetches = () => vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith("/api/reports/2026-W40/pdf?")).length;
    const served = (compose: Record<string, ComposeOut>) => {
      const s = serve(["2026-W40"]);
      Object.assign(s.db.compose, compose);
      return s;   // the PDF itself answers the stub's 404 (a failed download): only whether it was asked for matters here
    };
    const click = async (c: Element) => {
      await waitFor(() => expect(dlKey(c)).not.toBeNull());
      fireEvent.click(c.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.pdf")!);
    };

    it("stale text (selection or inputs) asks first: 先生成 opens the composer, 仍然下载 downloads", async () => {
      for (const stale of [{ selection: true, inputs: false }, { selection: false, inputs: true }]) {
        served({ "2026-W40/ja": view({ stale }) });
        const { container, unmount } = page("#/v2/report");
        await click(container);
        await waitFor(() => expect(container.querySelector(".cmp-ask")?.textContent).toContain("被隐藏的案件可能还在文字里"));
        expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === "/api/reports/2026-W40/pdf/compose?lang=ja")).toBe(true);
        expect(pdfFetches()).toBe(0);
        expect(container.querySelector<HTMLButtonElement>(".rp-ctl button.key.pri.pdf")).not.toBeDisabled();
        expect(container.querySelector(".cmp-ask a.key.pri")!.getAttribute("href")).toBe("#/v2/report/2026-W40/pdf");
        fireEvent.click([...container.querySelectorAll<HTMLButtonElement>(".cmp-ask button")].find((b) => b.textContent?.includes("仍然下载"))!);
        await waitFor(() => expect(pdfFetches()).toBe(1));
        expect(container.querySelector(".cmp-ask")).toBeNull();
        unmount(); vi.unstubAllGlobals();
      }
    });

    it("the check reads the export language's view", async () => {
      served({ "2026-W40/ja": view(), "2026-W40/en": view({ stale: { selection: true, inputs: false } }) });
      const { container } = page("#/v2/report");
      await waitFor(() => expect(dlKey(container)).not.toBeNull());
      fireEvent.click(screen.getByRole("button", { name: "EN" }));
      await click(container);
      await waitFor(() => expect(container.querySelector(".cmp-ask")).not.toBeNull());
      expect(vi.mocked(fetch).mock.calls.some(([u]) => String(u) === "/api/reports/2026-W40/pdf/compose?lang=en")).toBe(true);
    });

    it("never blocks: text up to date, no text, no composition (404), or a failed check → downloads at once", async () => {
      const cases: Array<Record<string, ComposeOut> | null> = [{ "2026-W40/ja": view() }, { "2026-W40/ja": view({ text: null, stale: { selection: true, inputs: true } }) }, {}, null];
      for (const compose of cases) {
        const s = served(compose ?? {});
        if (compose === null) {
          s.failNext((m, u) => (m === "GET" && u.includes("/pdf/compose") ? fail(500) : null));
        }
        const { container, unmount } = page("#/v2/report");
        await click(container);
        await waitFor(() => expect(pdfFetches()).toBe(1));
        expect(container.querySelector(".cmp-ask")).toBeNull();
        unmount(); vi.unstubAllGlobals();
      }
    });
  });

  it("上次下载 counts every download of the week — the xlsx, the PDF, and xlsx rows from before the templates merged", async () => {
    serve(["2026-W40"], {}, { "2026-W40": [
      { week: "2026-W40", template: "weekly", at: "2026-10-02T09:00:00Z" },
      { week: "2026-W40", template: "pdf", at: "2026-10-02T10:00:00Z" },
      { week: "2026-W40", template: "site", at: "2026-10-02T11:00:00Z" },
    ] });
    const { container } = page("#/v2/report");
    await waitFor(() => expect(ink(container.querySelector(".rp-ctl")!)).toContain("上次下载 10/02 20:00"));
  });
});
