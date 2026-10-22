import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "../src/prefs/types";
import { REFRESH_MS } from "../src/pages/now/useNowData";
import { Markdown } from "../src/lib/markdown";
import { lit } from "../src/pages/stats/ReviewSec";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";
import { fail, review, stServer } from "./st-serve";
import { viewOf } from "./view-canvas";

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (o: { lang?: Lang } = {}) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider lang={o.lang}><StatsPage /></V2TestProvider>);
};
const region = () => viewOf("周复盘");
const nums = (el: Element) => [...el.querySelectorAll(".n")].map((e) => e.textContent);
const reviewCalls = (calls: string[]) => calls.filter((u) => u.startsWith("/api/reviews")).length;

const W40 = "## 本周概览\n\n总工时 **52.5h**，比上周多 12%。\n\n- 等价费用 $1,234.50\n- 会话 37 个，`wl 2` 照旧\n\n1. 第一条";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("lit — figures lit inside rendered prose", () => {
  it("wraps amounts, hours, percents and counts in .n; words, W40-style codes and inline code stay as they are", () => {
    const { container } = render(<div>{lit(<p>周 W40：<strong>10.5h</strong>，$1,234.50 与 35%，共 3 个；<code>wl 2</code>。</p>)}</div>);
    expect(nums(container)).toEqual(["10.5h", "$1,234.50", "35%", "3 个"]);
    expect(container.querySelector("strong .n")?.textContent).toBe("10.5h");
    expect(container.querySelector("code")?.textContent).toBe("wl 2");
    expect(container.querySelector("code .n")).toBeNull();
    expect(container.textContent).toBe("周 W40：10.5h，$1,234.50 与 35%，共 3 个；wl 2。");
  });

  it("a table and line breaks in the review keep React's key rules (no warning), the cells' figures lit", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<div>{lit(Markdown({ text: "| 案件 | 工时 |\n|---|---|\n| 看板 | 20.5h |\n\n第一行\n第二行 3 个" }))}</div>);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
    expect(nums(container.querySelector("table")!)).toEqual(["20.5h"]);
    expect(container.querySelector("p br")).not.toBeNull();
  });

  it("a sentence-ending point is not part of the figure", () => {
    const { container } = render(<p>{lit("一共 8.")}</p>);
    expect(nums(container)).toEqual(["8"]);
    expect(container.textContent).toBe("一共 8.");
  });

  it("an ISO date or week is a date, not figures: none of its parts is lit", () => {
    const { container } = render(<p>{lit("2026-W40 起，2026-10-05 与 2026-10 共 3 天")}</p>);
    expect(nums(container)).toEqual(["3 天"]);
    expect(container.textContent).toBe("2026-W40 起，2026-10-05 与 2026-10 共 3 天");
  });

  it("a model name's version, a clock time and a short date stay unlit; K / M / B are units", () => {
    const text = "claude-opus-4 与 sonnet-4.5 用了 2M token 和 300K，09:30 开始，10/5 结束，3-4 个案件";
    const { container } = render(<p>{lit(text)}</p>);
    expect(nums(container)).toEqual(["2M", "300K", "3", "4 个"]);
    expect(container.textContent).toBe(text);
  });
});

describe("StatsPage — 周复盘", () => {
  it("week keys newest first (the newest pressed), the body set as Chinese type with its figures lit, the meta line", async () => {
    stServer({ reviews: [{ ...review("2026-W40", W40), model: "claude-opus", machine: "mbp", generated_at: "2026-10-05T09:07:30Z" }, review("2026-W39")] });
    const { container } = page();
    const sec = await region();
    const keys = within(within(sec).getByRole("group", { name: "选择周" })).getAllByRole("button");
    await waitFor(() => expect(keys.map((k) => ink(k))).toEqual(["W40", "W39"]));     // the LED text lands a tick after mount
    expect(keys.map((k) => k.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    const body = sec.querySelector(".st-rv")!;
    expect(body.getAttribute("lang")).toBeNull();   // the review text arrives in the display language (S1)
    expect(body.classList.contains("two")).toBe(true);
    expect(within(body as HTMLElement).getByRole("heading", { name: "本周概览" }).tagName).toBe("H3");
    expect(body.querySelectorAll("ul li")).toHaveLength(2);
    expect(body.querySelectorAll("ol li")).toHaveLength(1);
    expect(nums(body)).toEqual(["52.5h", "12%", "$1,234.50", "37 个"]);
    expect(body.querySelector("code")?.textContent).toBe("wl 2");
    expect(ink(sec.querySelector(".st-sh")!)).toContain("claude-opus · mbp · 2026-10-05 09:07 UTC");
    // the last view by default, after AI 使用效率; the frame's header is its title (sv.review.name)
    expect(sec.previousElementSibling?.getAttribute("data-view")).toBe("ai");
    expect(container.querySelector(".stp > section.sv:last-child > .sv-b > .st-rvs")).not.toBeNull();
  });

  it("another week key switches body and meta without adding history", async () => {
    stServer({ reviews: [review("2026-W40", "本周 52h"), { ...review("2026-W39", "上周 40h"), model: "old-model" }] });
    page();
    const sec = await region();
    const len = window.history.length;
    fireEvent.click(within(sec).getByRole("button", { name: "W39" }));
    expect(sec.querySelector(".st-rv")!.textContent).toBe("上周 40h");
    await waitFor(() => expect(ink(sec.querySelector(".st-sh")!)).toContain("old-model · macmini"));
    expect(within(sec).getByRole("button", { name: "W39" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(sec).getByRole("button", { name: "W40" }).getAttribute("aria-pressed")).toBe("false");
    expect(window.history.length).toBe(len);
  });

  it("re-reads every REFRESH_MS; a selected week that is gone falls back to the newest", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(J("2026-10-02 14:20")));
    const s = stServer({ reviews: [review("2026-W40", "本周 52h"), review("2026-W39", "上周 40h")] });
    page();
    const sec = await region();
    fireEvent.click(within(sec).getByRole("button", { name: "W39" }));
    expect(reviewCalls(s.calls)).toBe(1);
    s.db.reviews = [review("2026-W41", "新的一周 3h"), review("2026-W40", "本周 52h")];
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    await waitFor(() => expect(reviewCalls(s.calls)).toBe(2));
    await waitFor(() => expect(sec.querySelector(".st-rv")!.textContent).toBe("新的一周 3h"));
    expect(within(sec).getByRole("button", { name: "W41" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("no reviews yet: the old page's sentence with the command as literal code, in each language", async () => {
    for (const [lang, words] of [["zh", "尚未生成"], ["ja", "まだ生成されていません"], ["en", "Not generated yet"]] as const) {
      stServer({ reviews: [] });
      const { unmount } = page({ lang });
      const sec = await viewOf({ zh: "周复盘", ja: "週次振り返り", en: "Weekly review" }[lang]);
      const empty = await waitFor(() => { const e = sec.querySelector(".st-rv-none"); expect(e).not.toBeNull(); return e!; });
      expect(empty.textContent).toContain(words);
      expect(empty.querySelector("code")?.textContent).toBe("uv run wl review");
      expect(within(sec).queryByRole("group")).toBeNull();
      unmount();
    }
  });

  it("a row missing model / machine / time shows the parts it has, never undefined", async () => {
    stServer({ reviews: [{ ...review("2026-W40", W40), model: undefined, generated_at: null } as never] });
    page();
    const sec = await region();
    expect(ink(sec.querySelector(".st-sh")!)).toBe("W40|macmini");   // the title is the frame's now
    expect(sec.querySelector(".st-sh")!.textContent).not.toMatch(/undefined|null/);
  });

  it("odd rows (no week or text) are skipped", async () => {
    stServer({ reviews: [{ week: 7, text: null } as never, review("2026-W39", "上周 40h")] });
    page();
    const sec = await region();
    expect(within(sec).getAllByRole("button").map((k) => ink(k))).toEqual(["W39"]);
    expect(sec.querySelector(".st-rv")!.textContent).toBe("上周 40h");
  });

  it("the reviews failing alone: role=alert in the review section with 重试, the figures stay; 重试 recovers", async () => {
    const s = stServer();
    s.failNext((u) => (u.startsWith("/api/reviews") ? fail(400) : null));
    const { container } = page();
    const sec = await region();
    const alert = await within(sec).findByRole("alert");
    expect(ink(alert)).toContain("复盘加载失败");
    expect(container.querySelectorAll(".st-figs .st-fig")).toHaveLength(6);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    fireEvent.click(within(alert).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(within(sec).getAllByRole("button").map((k) => ink(k))).toEqual(["W40", "W39"]));
    expect(within(sec).queryByRole("alert")).toBeNull();
  });

  it("表 with the default prefs (module stats.review hidden): no review section at all; shown in 设置, it is back", async () => {
    applyWorld("omote");
    stServer();
    const { container, unmount } = page();
    await waitFor(() => expect(container.querySelectorAll(".st-figs .st-fig")).toHaveLength(5));
    expect(screen.queryByRole("region", { name: "周复盘" })).toBeNull();
    expect(container.querySelector(".st-rv")).toBeNull();
    unmount();
    window.location.hash = "#/v2/stats";
    render(<V2TestProvider prefs={{ omote: { font: "plex", hide: ["now.cost", "stats.cost"] } }}><StatsPage /></V2TestProvider>);
    expect(await region()).toBeTruthy();
  });

  it("comes with the dashboard, as on the old page: a failed dashboard shows only its own failure (the block keeps its place with one dim line, R4)", async () => {
    const s = stServer();
    s.failNext((u) => (u.startsWith("/api/dashboard") ? fail(400) : null));
    page();
    expect(await screen.findByRole("alert")).toBeTruthy();
    const rv = screen.getByRole("region", { name: "周复盘" });
    await waitFor(() => expect(ink(rv.querySelector(".sv-b")!)).toBe("统计加载失败"));
    expect(within(rv).queryByRole("alert")).toBeNull();
    expect(rv.querySelector(".sv-b button")).toBeNull();
  });
});
