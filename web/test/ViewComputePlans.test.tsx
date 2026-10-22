import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang, Prefs } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { __resetHoverForTests, getHoverTask, setHoverTask } from "../src/ui/hover";
import { applyWorld } from "../src/world/store";
import type { Call } from "./canvas-rec";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { canvases, viewOf } from "./view-canvas";
import { VIZ, VIZ_TASKS } from "./viz-fixture";

// the ECharts views on the same page never load the real chunk in jsdom
vi.mock("../src/pages/stats/viz/echarts", () => ({
  init: () => ({ setOption() {}, dispose() {}, isDisposed: () => false, resize() {}, on() {}, off() {}, dispatchAction() {} }),
}));

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (o: { lang?: Lang; prefs?: Partial<Prefs> } = {}) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider lang={o.lang} prefs={o.prefs}><StatsPage /></V2TestProvider>);
};
/** The fixture under the page's default range (近 4 周 = 9/5–10/2 on 10/2): X (T3, Sunday 9/20 20:00–21:00) joins in. */
const serve = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to } }), tasks: VIZ_TASKS });
const empty = () => stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to }, sessions: [], plans: [] }), tasks: VIZ_TASKS });
const COST: Partial<Prefs> = { omote: { font: "plex", hide: ["now.cost"] } };
const tip = () => screen.getByRole("tooltip");
const texts = (calls: Call[]) => calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));
const region = (name: string) => viewOf(name);
/** A silhouette: a `fill` of a Path2D (the glyph chunk loads after the first draw, and its arrival redraws). */
const isGlyph = (c: Call) => c.op === "fill" && typeof c.args[0] === "object" && c.args[0] !== null;
const drawn = async (cv: ReturnType<typeof canvases>, sec: HTMLElement, cls: string) => {
  const el = await waitFor(() => sec.querySelector<HTMLCanvasElement>(`canvas.${cls}`)!);
  await waitFor(() => expect(cv.draws(el)).toBeGreaterThan(0));
  return el;
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); __resetHoverForTests(); window.location.hash = ""; });

describe("compute — 算力构成", () => {
  it("里: the range's cost (* = some unpriced) and cost per wall-clock hour (8.5h) as the key figure; the unit stated; shares beside", async () => {
    serve();
    page();
    const sec = await region("算力构成");
    await waitFor(() => expect(sec.querySelector("canvas.sv-cmpc")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|$11.60* · $1.36/h");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe(
      "5 周，token 416K（1 点 = 2K）；费用 $11.60*，每墙钟小时 $1.36；最贵的一周 W39：$11.50*。"
      + "macmini 墙钟 8h · 费用 $11.10；win11 墙钟 0.5h · 费用 $0.50；claude-code 墙钟 7.3h · 费用 $11.60；codex 墙钟 1.3h · 费用 $0.00");
    await waitFor(() => expect(ink(sec.querySelector(".sv-cmp .main")!)).toContain("1 点 = 2K token"));
    const side = ink(sec.querySelector(".sv-cmp .side")!);
    expect(side).toContain("机器|墙钟|费用|macmini|94%|96%|win11|6%|4%");
    expect(side).toContain("Opus|378K|91%|GPT|26K|6%|Sonnet|12K|3%");          // X (9/20) adds 1.2K Opus
    expect(side).toContain("子 agent 占 token 0.2%");
  });

  it("表 with amounts shown: a week's tip — dates (cut or not), tokens, cost, $/h over that week's wall clock, the kinds", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-cmpc": [600, 141] });
    serve();
    page({ prefs: COST });
    const el = await drawn(cv, await region("算力构成"), "sv-cmpc");
    expect(texts(cv.calls(el))).toEqual(["W36", "W37", "$0", "W38", "$0/h", "$12", "W39", "$2/h", "W40"]);
    // 表: columns 39 dots (117px) from 6px; W39 = index 3
    fireEvent.pointerMove(el, { clientX: 100 + 6 + 117 * 3.5, clientY: 50 + 60 });
    expect(tip().querySelector(".h")!.textContent).toBe("W39 · 9/21–9/27");
    expect(tip().querySelector(".m")!.textContent).toBe("415K token · $11.50* · $1.53/h（墙钟 7.5h）");
    // the kinds, then the week's tokens by model family (F3)
    expect([...tip().querySelectorAll(".s")].map((e) => e.textContent)).toEqual(["缓存读取 380K · 缓存写入 18K · 输入 9.5K · 输出 7.5K", "Opus 377K · GPT 26K · Sonnet 12K"]);
    fireEvent.pointerMove(el, { clientX: 100 + 6 + 117 * 0.5, clientY: 50 + 60 });
    expect(tip().querySelector(".h")!.textContent).toBe("W36 · 8/31–9/6（区间截断）");
    expect(tip().querySelector(".m")!.textContent).toBe("0 token · $0.00 · —/h（墙钟 0h）");
    expect(tip().querySelectorAll(".s")).toHaveLength(1);                         // no tokens: no family line
    fireEvent.pointerLeave(el);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("表 with stats.cost hidden (default): not rendered; no amount in any view of the area", async () => {
    applyWorld("omote");
    serve();
    const { container } = page();
    await region("依頼元旭日");
    expect(screen.queryByRole("region", { name: "算力构成" })).toBeNull();
    for (const s of container.querySelectorAll("section.sv")) expect(s.textContent).not.toContain("$");
  });

  it("nothing in the range: one dim line", async () => {
    empty();
    page();
    const sec = await region("算力构成");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});

describe("density — 产出密度", () => {
  it("里: the fastest task's median as the key figure; the summary", async () => {
    serve();
    page();
    const sec = await region("产出密度");
    await waitFor(() => expect(sec.querySelector("canvas.sv-den")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|最快 T1 4/h");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("1 个案件；最快 T1（中位 4 轮/h），最慢 T1（4 轮/h）");
  });

  it("表: a row under the pointer lights its task and tips its medians and totals; page hover redraws; leave clears", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-den": [600, 75] });
    serve();
    page();
    const el = await drawn(cv, await region("产出密度"), "sv-den");
    await waitFor(() => expect(cv.calls(el).filter(isGlyph)).toHaveLength(1));      // B3b: the T1 silhouette replaces its code once the glyph chunk is in
    expect(texts(cv.calls(el))).not.toContain("T1");
    const n = cv.draws(el);
    fireEvent.pointerMove(el, { clientX: 100 + 300, clientY: 50 + 6 + 16 });
    expect(getHoverTask()).toBe("T1");
    expect(tip().querySelector(".h")!.textContent).toBe("T1案件 一");
    expect(tip().querySelector(".h .tbadge[data-task=\"T1\"]")!.getAttribute("style")).toContain("height: 16px");
    expect(tip().querySelector(".h .tcode")!.textContent).toBe("T1");
    expect(tip().querySelector(".h .code")).toBeNull();
    expect(tip().querySelector(".m")!.textContent).toBe("中位 4 轮/h · 0 文件/h");
    expect(tip().querySelector(".s")!.textContent).toBe("3 个会话 · 墙钟 3.5h · 16 轮 · 2 个文件");
    expect(cv.draws(el)).toBe(n + 1);
    fireEvent.pointerMove(el, { clientX: 100 + 300, clientY: 50 + 70 });
    expect(getHoverTask()).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { setHoverTask("T2"); });
    expect(cv.calls(el).filter((c) => c.op === "fill" && !isGlyph(c)).map((c) => c.alpha)).toEqual([0.55 * 0.3, 0.55 * 0.3, 0.55 * 0.3]);
    expect(cv.calls(el).filter(isGlyph).map((c) => c.alpha)).toEqual([0.3]);
    fireEvent.pointerLeave(el);
    expect(getHoverTask()).toBeNull();
  });

  it("no task with enough sessions: one dim line", async () => {
    stServer({ sessions: () => ({ ...VIZ }), tasks: VIZ_TASKS });              // 9/21–9/22: T1 still qualifies
    const { unmount } = page();
    await waitFor(async () => expect((await region("产出密度")).querySelector("canvas.sv-den")).not.toBeNull());
    unmount();
    stServer({ sessions: () => ({ ...VIZ, sessions: VIZ.sessions.filter((s) => s.id !== "F") }), tasks: VIZ_TASKS });
    page();
    const sec = await region("产出密度");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});

describe("plans — 计划兑现", () => {
  it("里: items, AI done / judged, manual done, agreement as the key figure; the summary; the legend", async () => {
    serve();
    page();
    const sec = await region("计划兑现");
    await waitFor(() => expect(sec.querySelector("canvas.sv-pl")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|条目 4 · AI 完成 1/3 · 手动完成 2 · 一致 1/2");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("2 天的今日安排，4 个条目，3 个案件；AI 判完成 1/3，手动完成 2，两者都判的 2 条中一致 1 条");
    await waitFor(() => expect(ink(sec)).toContain("每格：每个条目一对灯"));
  });

  it("表: a cell's tip — the day's wall clock of the task, each item with both verdicts; a two-task item shows its tasks' total; rows light their task", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-pl": [600, 141] });
    serve();
    page();
    const el = await drawn(cv, await region("计划兑现"), "sv-pl");
    await waitFor(() => expect(cv.calls(el).filter(isGlyph)).toHaveLength(3));      // B3b: silhouettes replace the codes once the glyph chunk is in
    expect(texts(cv.calls(el))).toEqual(["9/21", "9/22"]);
    // 表: columns 36 dots (108px) from 78px, rows 33px from 36px
    const cell = (r: number, c: number) => ({ clientX: 100 + 78 + 108 * (c + 0.5), clientY: 50 + 36 + 33 * (r + 0.5) });
    fireEvent.pointerMove(el, cell(0, 1));
    expect(getHoverTask()).toBe("T1");
    expect(tip().querySelector(".h")!.textContent).toBe("T1案件 一");
    expect(tip().querySelector(".h .tbadge[data-task=\"T1\"]")!.getAttribute("style")).toContain("height: 16px");
    expect(tip().querySelector(".h .tcode")!.textContent).toBe("T1");
    expect(tip().querySelector(".h .code")).toBeNull();
    expect(tip().querySelector(".m")!.textContent).toBe("9/22 二 · 当天墙钟 0.5h");
    expect([...tip().querySelectorAll(".s")].map((e) => e.textContent)).toEqual(["T1 の確認 · AI 未判 · 手动 完成", "T1 の追加 · AI 未完成 · 手动 未判"]);
    fireEvent.pointerMove(el, cell(1, 0));
    expect(getHoverTask()).toBe("T2");
    expect(tip().querySelector(".m")!.textContent).toBe("9/21 一 · 当天墙钟 2.3h");
    expect(tip().querySelector(".s")!.textContent).toBe("T2 と T3 を調べる · AI 部分 · 手动 未完成（条目各案件合计 2.3h）");
    fireEvent.pointerMove(el, cell(2, 0));
    expect(tip().querySelector(".m")!.textContent).toBe("9/21 一 · 当天墙钟 0h");
    fireEvent.pointerMove(el, cell(1, 1));
    expect(tip().querySelector(".s")!.textContent).toBe("这天没有该案件的条目");
    fireEvent.pointerMove(el, { clientX: 100 + 10, clientY: 50 + 10 });
    expect(getHoverTask()).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("表, 30 plan dates on a 600px canvas (C2): one lamp per item, only the latest 26 dates with a dim line saying so; the tip names the drawn date", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-pl": [600, 141] });
    const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 3 + i)).toISOString().slice(0, 10));   // 9/3–10/2
    const plans = dates.map((date) => ({ date, text: `p ${date}`, task_ids: ["T1"], ai_status: "done" as const, manual_status: null }));
    stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to }, plans }), tasks: VIZ_TASKS });
    page();
    const sec = await region("计划兑现");
    const el = await drawn(cv, sec, "sv-pl");
    await waitFor(() => expect(ink(sec)).toContain("只显示最近 26 天"));
    expect(ink(sec)).toContain("每格：每个条目一盏灯");
    expect(ink(sec)).not.toContain("一对灯");
    expect(texts(cv.calls(el))[0]).toBe("9/7");
    // 表: columns 6 dots (18px) from 126px; the first drawn column is 9/7
    fireEvent.pointerMove(el, { clientX: 100 + 126 + 9, clientY: 50 + 36 + 16 });
    expect(tip().querySelector(".s")!.textContent).toBe("p 2026-09-07 · AI 完成 · 手动 未判");
  });

  it("items but none linked to a task (F4): one dim line saying so, no lamp legend", async () => {
    const plans = VIZ.plans.map((p) => ({ ...p, task_ids: [] }));
    stServer({ sessions: (from, to) => ({ ...VIZ, range: { from, to }, plans }), tasks: VIZ_TASKS });
    page();
    const sec = await region("计划兑现");
    await waitFor(() => expect(ink(sec)).toContain("没有条目关联案件"));
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|条目 4 ·");
    expect(ink(sec)).not.toContain("每格");
    expect(sec.querySelector("canvas.sv-pl")).toBeNull();
  });

  it("no plan in the range: one dim line", async () => {
    empty();
    page();
    const sec = await region("计划兑现");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});

describe("sunburst — 依頼元旭日", () => {
  it("里: the largest requester's share as the key figure; requesters beside; the summary adds up to the wall clock", async () => {
    serve();
    page();
    const sec = await region("依頼元旭日");
    await waitFor(() => expect(sec.querySelector("canvas.sv-sun")).not.toBeNull());
    expect(ink(sec.querySelector(".sv-h")!)).toContain("|最大 田中 38%");
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("墙钟 8.5h：田中 3.3h（38%）、未关联 2h（24%）、佐藤 1.6h（19%）、鈴木 1.6h（19%）");
    await waitFor(() => expect(ink(sec.querySelector(".st-list")!)).toBe("田中|3.3h|38%|未关联|2h|24%|佐藤|1.6h|19%|鈴木|1.6h|19%"));
  });

  it("表: a task arc lights its task and tips its share; a requester arc tips without a task; the centre is nothing", async () => {
    applyWorld("omote");
    const cv = canvases({ "sv-sun": [600, 570] });
    serve();
    page();
    const el = await drawn(cv, await region("依頼元旭日"), "sv-sun");
    expect(texts(cv.calls(el))).toEqual(["8.5h"]);
    // 表: centre (300, 285), R = 285 − 12 = 273; the first arcs start at the top, clockwise
    const at = (frac: number, a: number) => ({ clientX: 100 + 300 + Math.sin(a) * frac * 273, clientY: 50 + 285 - Math.cos(a) * frac * 273 });
    fireEvent.pointerMove(el, at(0.7, 0.2));                                  // 田中 → T1 (T1 135 + T3 60 → T1 first)
    expect(getHoverTask()).toBe("T1");
    expect(tip().querySelector(".h")!.textContent).toBe("T1案件 一");
    expect(tip().querySelector(".h .tbadge[data-task=\"T1\"]")!.getAttribute("style")).toContain("height: 16px");
    expect(tip().querySelector(".h .tcode")!.textContent).toBe("T1");
    expect(tip().querySelector(".h .code")).toBeNull();
    expect(tip().querySelector(".m")!.textContent).toBe("墙钟 2.3h · 26.5%");
    expect(tip().querySelector(".s")!.textContent).toBe("田中");
    fireEvent.pointerMove(el, at(0.95, 0.05));                                // T1 on macmini
    expect(tip().querySelector(".m")!.textContent).toBe("macmini · 墙钟 1.7h · 19.9%");
    fireEvent.pointerMove(el, at(0.4, 0.2));
    expect(getHoverTask()).toBeNull();
    expect(tip().querySelector(".h")!.textContent).toBe("田中");
    expect(tip().querySelector(".m")!.textContent).toBe("墙钟 3.3h · 38.2%");
    fireEvent.pointerMove(el, at(0.1, 0.2));
    expect(screen.queryByRole("tooltip")).toBeNull();
    const n = cv.draws(el);
    act(() => { setHoverTask("T2"); });
    expect(cv.draws(el)).toBe(n + 1);
  });

  it("nothing in the range: one dim line", async () => {
    empty();
    page();
    const sec = await region("依頼元旭日");
    await waitFor(() => expect(ink(sec.querySelector(".sv-thin")!)).toBe("这个区间的数据不够"));
  });
});
