import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "../src/api/types";
import type { Lang, Prefs } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { TipHost } from "../src/ui/TipHost";
import { applyWorld } from "../src/world/store";
import { FULL } from "./pages/dashboard-fixture";
import { V2TestProvider } from "./helpers";
import { rec, type Call } from "./canvas-rec";
import { stServer } from "./st-serve";
import { viewOf } from "./view-canvas";

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (o: { lang?: Lang; prefs?: Partial<Prefs> } = {}) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider lang={o.lang} prefs={o.prefs}><TipHost><StatsPage /></TipHost></V2TestProvider>);
};
/** A view's body (its frame's header — number, name, 累计, desc — left out), or a plain region. */
const region = async (name: string) => { const r = await viewOf(name); return r.querySelector(":scope > .sv-b") ?? r; };
const rows = (el: Element, sel: string) => [...el.querySelectorAll(sel)].map((r) => ink(r));
const withDash = (patch: (d: Dashboard) => Partial<Dashboard>) => stServer({ dash: (from, to) => ({ ...FULL, range: { from, to }, ...patch(FULL) }) });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("StatsPage — 工作节奏", () => {
  it("avg start / end / late night / weekend, the daily bars with the overlap note and the busiest day", async () => {
    withDash((f) => ({ rhythm: { ...f.rhythm, daily: [...f.rhythm.daily, { date: "2026-09-30", minutes: 0 }, { date: "2026-10-01", minutes: 1500 }] } }));
    page();
    const box = await region("工作节奏");
    expect(ink(box.querySelector(".st-kvl")!)).toBe("平均开始|09:30|平均结束|18:45|深夜（22–5 时）|12%|周末|5%");
    expect(box.querySelector("canvas.st-daily")!.getAttribute("aria-hidden")).toBe("true");
    // 09-28 2h, 09-29 1.5h, 09-30 nothing, 10-01 25h (parallel sessions)
    expect(ink(box.querySelector(".st-note")!)).toBe("单日超过 24h = 并行会话重叠计时|最多 10/1 25h");
    expect(box.querySelector("canvas.st-daily + .v2-sr")!.textContent).toBe("2026-09-28 2h; 2026-09-29 1.5h; 2026-10-01 25h");
  });

  it("the 7×24 matrix (its busy hours for screen readers) beside the session lengths", async () => {
    stServer();
    page();
    const box = await region("工作节奏");
    const heat = box.querySelector("canvas.st-heat")!;
    expect(heat.getAttribute("aria-hidden")).toBe("true");
    // FULL: Monday 22:00 40 min, Wednesday 10:00 80 min
    expect(heat.nextElementSibling!.textContent).toBe("周三 10 时 80 分; 周一 22 时 40 分".split("; ").reverse().join("; "));
    expect(rows(box, ".st-foc .st-r")).toEqual(["0-30 分|3 个", "30-60 分|5 个"]);
  });

  it("missing shares and times read —; a range with no days says so", async () => {
    withDash((f) => ({ rhythm: { ...f.rhythm, daily: [], avg_start: null, avg_end: null, late_night_share: null, weekend_share: null, focus_blocks: [] } }));
    page();
    const box = await region("工作节奏");
    expect(ink(box.querySelector(".st-kvl")!)).toBe("平均开始|—|平均结束|—|深夜（22–5 时）|—|周末|—");
    expect(box.querySelector("canvas.st-daily")).toBeNull();
    expect(box.querySelectorAll(".st-none")).toHaveLength(2);       // the days and the session lengths
  });

  it("a section that isn't the expected shape says 暂无数据; a bad matrix only blanks the matrix", async () => {
    const s = withDash(() => ({ rhythm: "oops" as unknown as Dashboard["rhythm"] }));
    let v = page();
    expect(ink(await region("工作节奏"))).toBe("暂无数据");
    v.unmount();
    const h = FULL.rhythm.heatmap;
    // six weekdays; a 23-hour day; a value that isn't a number
    for (const heatmap of [h.slice(0, 6), [...h.slice(0, 6), h[6].slice(1)], [...h.slice(0, 6), [...h[6].slice(1), "9"]]] as number[][][]) {
      s.db.dash = (from, to) => ({ ...FULL, range: { from, to }, rhythm: { ...FULL.rhythm, heatmap } });
      v = page();
      const box = await region("工作节奏");
      expect(box.querySelector("canvas.st-heat")).toBeNull();
      expect(box.querySelector("canvas.st-daily")).not.toBeNull();
      v.unmount();
    }
  });

  it("speaks the page's language: weekday names and units", async () => {
    stServer();
    page({ lang: "en" });
    const box = await region("Rhythm");
    expect(box.querySelector("canvas.st-heat")!.nextElementSibling!.textContent).toBe("MON 22:00 40 min; WED 10:00 80 min");
    expect(rows(box, ".st-foc .st-r")).toEqual(["0-30 min|3", "30-60 min|5"]);
  });
});

describe("StatsPage — AI 使用效率", () => {
  it("the three ratios, the uncollected note, tokens by model", async () => {
    stServer();
    page();
    const box = await region("AI 使用效率");
    expect(ink(box.querySelector(".st-kvl")!)).toBe("子 agent 占比|35%|缓存命中率|90%|每小时费用|≈$3.00/h");
    expect(ink(box.querySelector(".st-note")!)).toBe("2 个会话未采集 token");
    expect(rows(box, ".st-mdl .st-r")).toEqual(["claude-opus|2M", "gpt-5|500K"]);
  });

  it("the agents (named, unknown ids as they are; an unpriced agent says so) and the costliest sessions, linked to the timeline drawer", async () => {
    withDash((f) => ({ ai: { ...f.ai, by_agent: [{ agent: "claude-code", sessions: 8, minutes: 400, cost_usd: 9, cost_partial: true }, ...f.ai.by_agent] } }));
    page();
    const box = await region("AI 使用效率");
    expect(rows(box, ".st-agt .st-r")).toEqual(["Claude Code|8 个 · 6.7h|$9|*", "claude|8 个 · 6.7h|$9", "Codex|4 个 · 3.3h|费用未定价"]);
    const a = box.querySelector<HTMLAnchorElement>(".st-tops a.st-r")!;
    // started 2026-09-28T15:30Z = 09-29 00:30 JST → 2026-W40
    expect(ink(a)).toBe("9/29|重构统计模块|900K|$4");
    expect(a.getAttribute("href")).toBe("#/v2/timeline/2026-W40?day=2026-09-29&s=s1");
  });

  it("按案件费用: the first 5 tasks by cost (not by time), line code, title, whole dollars, * when partly unpriced; linked to the v2 task", async () => {
    const cost = (i: number, usd: number, partial = false) => ({ task_id: `T2026090${i}-01`, title: `案件${i}`, cost_usd: usd, cost_partial: partial, minutes: 10 });
    withDash((f) => ({ ai: { ...f.ai, by_task_cost: [cost(1, 3), cost(2, 40, true), cost(3, 7), cost(4, 0.2), cost(5, 12), cost(6, 1), null, { task_id: "x" }] as unknown as Dashboard["ai"]["by_task_cost"] } }));
    page();
    const box = await region("AI 使用效率");
    expect(rows(box, ".st-tc a.st-r")).toEqual(["案件2|$40|*", "案件5|$12", "案件3|$7", "案件1|$3", "案件6|$1"]);
    const a = box.querySelector(".st-tc a.st-r")!;
    expect(a.getAttribute("href")).toBe("#/v2/tasks/T20260902-01");
    expect(a.getAttribute("data-task")).toBe("T20260902-01");
    // B3b: the S badge (22 px) sits where the code Led was
    const b = a.querySelector<HTMLElement>(`.tbadge[data-task="T20260902-01"]`)!;
    expect(b.style.height).toBe("22px");
    expect(a.firstElementChild).toBe(b);
    expect(b.title).toBe("0902-01");
    expect(ink(a)).not.toContain("0902-01");
  });

  it("the model tip speaks the page's language", async () => {
    stServer();
    page({ lang: "en" });
    const box = await region("AI efficiency");
    expect(box.querySelector(".st-mdl .st-r .v2-sr")!.textContent).toBe("input 1 · output 1 · cache read 1 · cache write 1");
    const v = page({ lang: "ja" });
    const ja = [await viewOf("AI 利用効率")];
    expect(ja[0].querySelector(".st-mdl .st-r .v2-sr")!.textContent).toBe("入力 1 · 出力 1 · キャッシュ読込 1 · キャッシュ書込 1");
    v.unmount();
  });

  it("bad rows are skipped; a section that isn't the expected shape says 暂无数据", async () => {
    const s = withDash((f) => ({ ai: { ...f.ai, by_model: [null, { model: 3 }, ...f.ai.by_model] as unknown as Dashboard["ai"]["by_model"], top_sessions: [{ id: "x", cost_usd: 1, started_at: "nope" }] as unknown as Dashboard["ai"]["top_sessions"] } }));
    const v = page();
    let box = await region("AI 使用效率");
    expect(rows(box, ".st-mdl .st-r")).toEqual(["claude-opus|2M", "gpt-5|500K"]);
    expect(box.querySelector(".st-tops")).toBeNull();
    v.unmount();
    s.db.dash = (from, to) => ({ ...FULL, range: { from, to }, ai: null as unknown as Dashboard["ai"] });
    page();
    box = await region("AI 使用效率");
    expect(ink(box)).toBe("暂无数据");
  });
});

describe("StatsPage — stats.cost and the lower views", () => {
  // the sub-project 7 two-column pairs are gone (7b brief assumption 5): each block is a full-width view
  const view = async (name: string) => (await screen.findByRole("region", { name })).closest("section.sv")!;

  it("里: 工作节奏 then AI 使用效率, each its own full-width view", async () => {
    stServer();
    const { container } = page();
    const rh = await view("工作节奏");
    expect(rh.nextElementSibling).toBe(screen.getByRole("region", { name: "AI 使用效率" }));
    expect(container.querySelector(".st-cols")).toBeNull();
  });

  it("表 with the default prefs: the AI view is not rendered; no amount in 工作节奏", async () => {
    applyWorld("omote");
    stServer();
    page();
    const rh = await view("工作节奏");
    expect(rh.nextElementSibling).toBeNull();
    expect(screen.queryByRole("region", { name: "AI 使用效率" })).toBeNull();
    expect(rh.textContent).not.toContain("$");
  });

  it("表 with stats.cost shown in the settings: the AI view again", async () => {
    applyWorld("omote");
    stServer();
    page({ prefs: { omote: { font: "plex", hide: ["now.cost"] } } });
    await view("工作节奏");
    expect(screen.getByRole("region", { name: "AI 使用效率" })).toBeTruthy();
  });
});

describe("StatsPage — hover tips on the charts and the model rows", () => {
  // jsdom boxes are 0×0: give the two chart canvases a box 100px in from the left and 50 down, and a recording
  // context (so they draw and keep their geometry); every other canvas keeps none
  const boxes = (w: Record<string, [number, number]>) => {
    const drawn = new Map<HTMLCanvasElement, Call[]>();
    const box = HTMLCanvasElement.prototype.getBoundingClientRect;
    const size = (el: HTMLCanvasElement) => Object.entries(w).find(([c]) => el.classList.contains(c))?.[1];
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLCanvasElement) {
      const s = size(this);
      return s ? ({ width: s[0], height: s[1], left: 100, top: 50, right: 100 + s[0], bottom: 50 + s[1], x: 100, y: 50 } as DOMRect) : box.call(this);
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      if (!size(this)) return null;
      const r = rec(); drawn.set(this, r.calls); return r.ctx;
    } as never);
    return drawn;
  };
  const tip = () => screen.getByRole("tooltip");
  afterEach(() => { vi.restoreAllMocks(); });

  it("每日工时 (表): the day under the pointer, from clientX − the canvas's left; past a held-in bar, nothing", async () => {
    applyWorld("omote");
    const drawn = boxes({ "st-daily": [300, 138] });
    withDash((f) => ({ rhythm: { ...f.rhythm, daily: [...f.rhythm.daily, { date: "2026-09-30", minutes: 0 }, { date: "2026-10-01", minutes: 1500 }] } }));
    page({ lang: "en" });
    const cv = (await region("Rhythm")).querySelector<HTMLCanvasElement>("canvas.st-daily")!;
    await waitFor(() => expect(drawn.get(cv)?.length).toBeGreaterThan(0));
    // 4 days over 272px: a 68px pitch, each bar held to a week-day's 272 / 7 px; day 3 starts at 204
    fireEvent.pointerMove(cv, { clientX: 100 + 204 + 10, clientY: 120 });
    expect(tip().querySelector(".h")!.textContent).toBe("2026-10-01 (THU)");
    expect(tip().querySelector(".m")!.textContent).toBe("25h");
    expect(tip().querySelector(".s")!.textContent).toBe("Over 24h a day = parallel sessions counted twice");
    fireEvent.pointerMove(cv, { clientX: 100 + 10, clientY: 120 });
    expect(tip().querySelector(".h")!.textContent).toBe("2026-09-28 (MON)");
    expect(tip().querySelector(".s")).toBeNull();
    fireEvent.pointerMove(cv, { clientX: 100 + 68 + 50, clientY: 120 });     // the gap after day 1's bar
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("时段分布 (表): the hour under the pointer, from clientX / clientY − the canvas's box", async () => {
    applyWorld("omote");
    const drawn = boxes({ "st-heat": [270, 86] });
    stServer();
    page();
    const cv = (await region("工作节奏")).querySelector<HTMLCanvasElement>("canvas.st-heat")!;
    await waitFor(() => expect(drawn.get(cv)?.length).toBeGreaterThan(0));
    // 30px of labels, then 24 cells of 10px; 7 rows of 10px: Wednesday 10:00 is x 130–140, y 20–30
    fireEvent.pointerMove(cv, { clientX: 100 + 135, clientY: 50 + 25 });
    expect(tip().querySelector(".h")!.textContent).toBe("周三 10 时");
    expect(tip().querySelector(".m")!.textContent).toBe("80 分");
    fireEvent.pointerMove(cv, { clientX: 100 + 10, clientY: 50 + 25 });     // on the weekday labels
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("按模型: a row's tip splits its tokens", async () => {
    stServer();
    page();
    const row = (await region("AI 使用效率")).querySelector(".st-mdl .st-r")!;
    fireEvent.pointerMove(row, { clientX: 10, clientY: 10 });
    expect(tip().querySelector(".h")!.textContent).toBe("claude-opus");
    expect(tip().querySelector(".m")!.textContent).toBe("2M token");
    expect(tip().querySelector(".s")!.textContent).toBe(row.querySelector(".v2-sr")!.textContent);
    expect(tip().querySelector(".s")!.textContent).toMatch(/^输入 .+ · 输出 .+ · 缓存读 .+ · 缓存写 .+$/);
    fireEvent.pointerLeave(row);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("StatsPage — the tooltip", () => {
  it("the page brings its own TipHost: the one persistent tooltip is mounted without a wrapper", async () => {
    stServer();
    window.location.hash = "#/v2/stats";
    render(<V2TestProvider><StatsPage /></V2TestProvider>);
    await region("工作节奏");
    expect(document.querySelectorAll("[role=tooltip]")).toHaveLength(1);
  });
});
