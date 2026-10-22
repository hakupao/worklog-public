import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard, Hint } from "../src/api/types";
import type { Lang, Prefs } from "../src/prefs/types";
import { REFRESH_MS } from "../src/pages/now/useNowData";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { EMPTY, FULL } from "./pages/dashboard-fixture";
import { V2TestProvider } from "./helpers";
import { fail, json, stServer } from "./st-serve";

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (hash: string, o: { lang?: Lang; prefs?: Partial<Prefs> } = {}) => {
  window.location.hash = hash;
  return render(<V2TestProvider lang={o.lang} prefs={o.prefs}><StatsPage /></V2TestProvider>);
};
const figs = (c: Element) => [...c.querySelectorAll(".st-figs .st-fig")].map((f) => ink(f));
const dashCalls = (calls: string[], from: string) => calls.filter((u) => u.startsWith(`/api/dashboard?from=${from}`)).length;
const hint = (id: string, params: Hint["params"], links: Hint["links"] = [], level: Hint["level"] = "info"): Hint =>
  ({ id, level, text: `TEXT-${id}`, links, params });

// 2026-10-02 (Fri): the default 近 4 周 is 2026-09-05 〜 2026-10-02, one back is 2026-08-08 〜 2026-09-04
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("StatsPage — control line", () => {
  it("five preset keys (近 4 周 pressed by default); a preset is replaceHash and starts at its current range", async () => {
    const { calls } = stServer();
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    const g = screen.getByRole("group", { name: "统计区间" });
    const keys = within(g).getAllByRole("button");
    expect(keys.map((b) => ink(b))).toEqual(["今天", "本周", "本月", "近 4 周", "近 3 个月"]);
    expect(keys.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true", "false"]);
    expect(ink(container.querySelector(".st-ctl")!)).toContain("2026-09-05 〜 2026-10-02");
    const len = window.history.length;
    fireEvent.click(keys[1]);
    expect(window.location.hash).toBe("#/v2/stats?range=week");
    expect(window.history.length).toBe(len);
    await waitFor(() => expect(ink(container.querySelector(".st-ctl")!)).toContain("2026-09-28 〜 2026-10-02"));
    expect(calls).toContain("/api/dashboard?from=2026-09-28&to=2026-10-02");
    expect(screen.getByRole("button", { name: "本周" }).getAttribute("aria-pressed")).toBe("true");
    // 今天 is one day: the range text is the date alone
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    await waitFor(() => expect(ink(container.querySelector(".st-ctl")!)).toContain("|2026-10-02|"));
  });

  it("◀ goes one range back, ▶ forward; ▶ is disabled on the current range; neither adds history", async () => {
    stServer();
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    const next = screen.getByRole("button", { name: "下一段" }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    const len = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "上一段" }));
    expect(window.location.hash).toBe("#/v2/stats?back=1");
    expect(window.history.length).toBe(len);
    await waitFor(() => expect(ink(container.querySelector(".st-ctl")!)).toContain("2026-08-08 〜 2026-09-04"));
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(window.location.hash).toBe("#/v2/stats");
    await waitFor(() => expect(next.disabled).toBe(true));
  });

  it("another range keeps the figures on screen with 更新中… until it lands", async () => {
    const s = stServer();
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    let open!: () => void;
    const g = new Promise<void>((r) => { open = r; });
    s.failNext((u) => (u.startsWith("/api/dashboard?from=2026-08-08") ? g.then(() => json({ ...FULL, range: { from: "2026-08-08", to: "2026-09-04" }, overview: { ...FULL.overview, minutes: 1200 } })) : null));
    fireEvent.click(screen.getByRole("button", { name: "上一段" }));
    await waitFor(() => expect(ink(container.querySelector(".st-ctl")!)).toContain("更新中…"));
    expect(figs(container)[0]).toContain("10h");
    await act(async () => { open(); });
    await waitFor(() => expect(figs(container)[0]).toContain("20h"));
    expect(ink(container.querySelector(".st-ctl")!)).not.toContain("更新中…");
  });

  it("the dashboard re-reads every REFRESH_MS like the other v2 pages, without 更新中…", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    const s = stServer();
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    expect(dashCalls(s.calls, "2026-09-05")).toBe(1);
    let open!: () => void;
    const g = new Promise<void>((r) => { open = r; });
    s.failNext((u) => (u.startsWith("/api/dashboard") ? g.then(() => json(s.db.dash("2026-09-05", "2026-10-02"))) : null));
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    await waitFor(() => expect(dashCalls(s.calls, "2026-09-05")).toBe(2));
    expect(ink(container.querySelector(".st-ctl")!)).not.toContain("更新中…");
    await act(async () => { open(); });
  });
});

describe("StatsPage — figures", () => {
  it("总工时 leads (L0); each figure has its delta; 等价费用 carries * for unpriced sessions; one 对比上一段 line", async () => {
    stServer();
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    const f = figs(container);
    // FULL: 600 vs 300 min, 5 vs 5 days, 12 vs 0 sessions, 3 vs 0 done, 5M vs 0 tokens, $12.50 (partial) vs 0
    expect(f[0]).toBe("总工时|10h|+100%");
    expect(f[1]).toBe("活跃天数|5|天|0%");
    expect(f[2]).toBe("会话|12|新");
    expect(f[3]).toBe("完了案件|3|新");
    expect(f[4]).toBe("Token|5M|新");
    expect(f[5]).toBe("等价费用|≈$12.50|*|新");
    expect(container.querySelector(".st-fig.hero .v canvas")?.getAttribute("data-tier")).toBe("0");
    const mark = container.querySelector(".st-fig .st-pt")!;
    expect(mark.getAttribute("title")).toBe("部分会话未定价");
    expect(mark.textContent).toContain("部分会话未定价");
    expect(ink(container.querySelector(".st-vs")!)).toBe("对比上一段 2026-08-06 〜 2026-09-02");
  });

  it("no * when every session is priced; a flat delta with nothing before is —", async () => {
    stServer({ dash: () => ({ ...FULL, overview: { ...FULL.overview, cost_partial: false, sessions: 0 }, overview_prev: { ...FULL.overview_prev, sessions: 0 } }) });
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    expect(container.querySelector(".st-figs .st-pt")).toBeNull();
    expect(figs(container)[2]).toBe("会话|0|—");
  });

  it("cost_partial that isn't true (an odd 0) is no *, never a stray 0 on screen", async () => {
    stServer({ dash: () => ({ ...FULL, overview: { ...FULL.overview, cost_partial: 0 as unknown as boolean } }) });
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    expect(figs(container)[5]).toBe("等价费用|≈$12.50|新");
    expect(container.querySelector(".st-figs .st-fig:last-child .v")!.textContent).toBe("≈$12.50");
  });

  it("in Japanese and English: preset, figure and delta words follow the language; numbers stay", async () => {
    stServer();
    const ja = page("#/v2/stats", { lang: "ja" });
    await waitFor(() => expect(figs(ja.container)).toHaveLength(6));
    expect(ink(screen.getByRole("group", { name: "集計期間" }))).toContain("直近 4 週");
    expect(figs(ja.container)[1]).toBe("稼働日数|5|日|0%");
    ja.unmount();
    const en = page("#/v2/stats", { lang: "en" });
    await waitFor(() => expect(figs(en.container)).toHaveLength(6));
    expect(ink(screen.getByRole("group", { name: "Range" }))).toContain("Last 4 weeks");
    expect(figs(en.container)[2]).toBe("Sessions|12|new");
    expect(figs(en.container)[5]).toContain("≈$12.50");
    expect(ink(en.container.querySelector(".st-vs")!)).toBe("vs previous 2026-08-06 〜 2026-09-02");
    expect(en.container.querySelector(".st-pt")!.getAttribute("title")).toBe("Some sessions are unpriced");
  });

  it("表 with the default prefs hides 等价费用 (module stats.cost): five figures, not rendered at all", async () => {
    applyWorld("omote");
    stServer();
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(5));
    expect(container.querySelector("[data-mod='stats.cost']")).toBeNull();
    expect(ink(container.querySelector(".st-figs")!)).not.toContain("≈");
  });

  it("an empty range says 暂无数据 under the figures", async () => {
    stServer({ dash: () => EMPTY });
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    expect(ink(container.querySelector(".st-empty")!)).toBe("暂无数据");
  });
});

describe("StatsPage — hints", () => {
  it("each hint on one line in the page's language, its links as keys on v2 addresses (tasks by code, with the title)", async () => {
    stServer({
      dash: () => ({
        ...FULL,
        hints: [
          hint("unlinked", { n: 3, hours: 2.5 }, [{ label: "去关联（全部）", href: "#/unlinked" }], "warn"),
          hint("stale-open", { n: 1, days: 14 }, [{ label: "看板开发", href: "#/tasks/T20260901-01" }]),
          hint("costly-session", { n: 2, usd: 100, max: 180 }, [{ label: "2026-W40", href: "#/timeline/2026-W40" }]),
          hint("from-a-newer-server", {}),
        ],
      }),
    });
    const { container } = page("#/v2/stats");
    const box = await screen.findByRole("region", { name: "提示" });
    const rows = [...box.querySelectorAll(".st-hint")];
    expect(rows.map((r) => r.getAttribute("data-level"))).toEqual(["warn", "info", "info", "info"]);
    expect(ink(rows[0].querySelector(".nm")!)).toBe("3 个会话未关联案件（2.5h），不会进入周报的案件工时");
    expect(ink(rows[3].querySelector(".nm")!)).toBe("TEXT-from-a-newer-server");
    const links = (r: Element) => [...r.querySelectorAll(".lk a")].map((a) => [a.getAttribute("href"), ink(a)]);
    expect(links(rows[0])).toEqual([["#/v2/timeline?unlinked=1", "去关联"]]);
    expect(links(rows[1])).toEqual([["#/v2/tasks/T20260901-01", ""]]);       // B3b: the key holds the S badge, no code Led
    const task = rows[1].querySelector(".lk a")!;
    expect(task.getAttribute("title")).toBe("看板开发");
    expect(task.getAttribute("aria-label")).toBe("看板开发");
    expect(task.getAttribute("data-task")).toBe("T20260901-01");
    const kb = task.querySelector<HTMLElement>('.tbadge[data-task="T20260901-01"]')!;
    expect(kb.style.height).toBe("16px");
    expect(kb.hasAttribute("title")).toBe(false);       // the key's own title (the label) is not shadowed
    expect(links(rows[2])).toEqual([["#/v2/timeline/2026-W40", "2026-W40"]]);
    expect(rows[3].querySelector(".lk a")).toBeNull();
    expect(ink(box.querySelector(".st-sh")!)).toBe("提示|4");
    expect(container.querySelector(".stp")!.textContent).not.toContain("NaN");
  });

  it("a hint that isn't an object is skipped, not a crash of the whole page", async () => {
    stServer({ dash: () => ({ ...FULL, hints: [null, 7, hint("weekend", { pct: 25 })] as unknown as Hint[] }) });
    page("#/v2/stats");
    const box = await screen.findByRole("region", { name: "提示" });
    expect([...box.querySelectorAll(".st-hint")].map((r) => ink(r.querySelector(".nm")!))).toEqual(["周末工作占 25%"]);
    expect(ink(box.querySelector(".st-sh")!)).toBe("提示|1");
  });

  it("a hint without a string id or text (no wording to fall back on) is skipped, not a crash", async () => {
    const odd = [{ id: "x" }, { id: 3, text: "数字 id" }, { ...hint("weekend", { pct: 25 }), text: undefined }] as unknown as Hint[];
    stServer({ dash: () => ({ ...FULL, hints: [...odd, hint("late-night", { pct: 30 })] }) });
    page("#/v2/stats");
    const box = await screen.findByRole("region", { name: "提示" });
    expect([...box.querySelectorAll(".st-hint")].map((r) => ink(r.querySelector(".nm")!))).toEqual(["深夜（22–5 时）的工作占 30%"]);
    expect(ink(box.querySelector(".st-sh")!)).toBe("提示|1");
  });

  it("表 with stats.cost hidden drops costly-session (an amount) and counts one fewer; shown in 设置, it is back", async () => {
    const hints = [hint("costly-session", { n: 2, usd: 100, max: 412 }), hint("weekend", { pct: 25 })];
    stServer({ dash: () => ({ ...FULL, hints }) });
    applyWorld("omote");
    const v = page("#/v2/stats");
    let box = await screen.findByRole("region", { name: "提示" });
    expect([...box.querySelectorAll(".st-hint")].map((r) => ink(r.querySelector(".nm")!))).toEqual(["周末工作占 25%"]);
    expect(ink(box.querySelector(".st-sh")!)).toBe("提示|1");
    expect(box.textContent).not.toContain("$");
    v.unmount();
    page("#/v2/stats", { prefs: { omote: { font: "plex", hide: [] } } });
    box = await screen.findByRole("region", { name: "提示" });
    expect(ink(box.querySelector(".st-sh")!)).toBe("提示|2");
  });

  it("no hints: one dim line says so", async () => {
    stServer({ dash: () => EMPTY });
    page("#/v2/stats");
    await screen.findByRole("region", { name: "提示" });
    expect(ink(screen.getByRole("region", { name: "提示" }))).toBe("提示|0|没有需要处理的事项");
  });
});

describe("StatsPage — loading and failure", () => {
  it("读取中 until the first answer", async () => {
    const s = stServer();
    let open!: () => void;
    const g = new Promise<void>((r) => { open = r; });
    s.failNext((u) => (u.startsWith("/api/dashboard") ? g.then(() => json(FULL)) : null));
    const { container } = page("#/v2/stats");
    const top = () => container.querySelector(".st-top")!;
    await waitFor(() => expect(ink(within(top() as HTMLElement).getByRole("status"))).toBe("读取中…"));
    expect(figs(container)).toHaveLength(0);
    await act(async () => { open(); });
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    expect(screen.queryByRole("status")).toBeNull();                               // the blocks' wait lines too (R4)
  });

  // 400: not retried by the app's shouldRetry, so the one failure lands at once
  it("a failed first load is role=alert with 重试, which recovers", async () => {
    const s = stServer();
    s.failNext((u) => (u.startsWith("/api/dashboard") ? fail(400) : null));
    const { container } = page("#/v2/stats");
    const a = await screen.findByRole("alert");
    expect(ink(a)).toContain("统计加载失败");
    fireEvent.click(within(a).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("figures that aren't numbers, or a previous range without dates, are a failure to retry — never NaN or undefined on screen", async () => {
    for (const odd of [{ overview: {} }, { overview_prev: { ...FULL.overview_prev, cost_usd: "1" } }, { prev_range: {} }]) {
      const s = stServer({ dash: () => ({ ...FULL, ...odd } as unknown as Dashboard) });
      const { container, unmount } = page("#/v2/stats");
      await screen.findByRole("alert");
      expect(figs(container)).toHaveLength(0);
      expect(container.textContent).not.toMatch(/NaN|undefined/);
      unmount();
      void s;
    }
  });

  it("an odd answer (not a dashboard) is a failure to retry, not an endless 读取中 or a crash", async () => {
    const s = stServer();
    s.failNext((u) => (u.startsWith("/api/dashboard") ? json([]) : null));
    const { container } = page("#/v2/stats");
    const a = await screen.findByRole("alert");
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(within(a).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(figs(container)).toHaveLength(6));
  });

  it("another range that fails is role=alert with 重试 (the control line stays), which loads that range", async () => {
    const s = stServer({ dash: (from, to): Dashboard => ({ ...FULL, range: { from, to }, overview: { ...FULL.overview, minutes: from === "2026-08-08" ? 1200 : 600 } }) });
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    s.failNext((u) => (u.startsWith("/api/dashboard?from=2026-08-08") ? fail(400) : null));
    fireEvent.click(screen.getByRole("button", { name: "上一段" }));
    const a = await screen.findByRole("alert");
    expect(ink(a)).toContain("统计加载失败");
    expect(figs(container)).toHaveLength(0);                     // the previous range's figures are gone, not passed off as this one's
    expect(screen.getByRole("group", { name: "统计区间" })).toBeTruthy();
    fireEvent.click(within(a).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(figs(container)[0]).toContain("20h"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a 5-minute refresh that fails with figures on screen says so with 重试 and keeps them", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    stServer();
    const real = vi.mocked(fetch).getMockImplementation()!;
    let broken = false;
    vi.mocked(fetch).mockImplementation(async (u, i) => (broken && String(u).startsWith("/api/dashboard") ? fail(500) : real(u, i)));
    const { container } = page("#/v2/stats");
    await waitFor(() => expect(figs(container)).toHaveLength(6));
    broken = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS + 10_000); });
    const a = await screen.findByRole("alert");
    expect(ink(a)).toContain("统计加载失败");
    expect(figs(container)).toHaveLength(6);
    broken = false;
    fireEvent.click(within(a).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
