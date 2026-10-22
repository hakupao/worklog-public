import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dashboard, Hint } from "../src/api/types";
import type { Lang, Prefs } from "../src/prefs/types";
import { StatsPage } from "../src/pages/StatsPage";
import { J } from "../src/predict/fixtures";
import { UNLINKED_HREF } from "../src/predict/rules";
import { TipHost } from "../src/ui/TipHost";
import { applyWorld } from "../src/world/store";
import { EMPTY, FULL } from "./pages/dashboard-fixture";
import { V2TestProvider } from "./helpers";
import { stServer } from "./st-serve";
import { viewOf } from "./view-canvas";

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");
const page = (o: { lang?: Lang; prefs?: Partial<Prefs> } = {}) => {
  window.location.hash = "#/v2/stats";
  return render(<V2TestProvider lang={o.lang} prefs={o.prefs}><TipHost><StatsPage /></TipHost></V2TestProvider>);
};
const region = (name: string) => viewOf(name);
const rows = (el: Element, sel: string) => [...el.querySelectorAll(sel)];
const hint = (id: string, params: Hint["params"], links: Hint["links"] = []): Hint => ({ id, level: "info", text: `TEXT-${id}`, links, params });

// 2026-10-02 (Fri): the default 近 4 周 is 2026-09-05 〜 2026-10-02 (stServer answers FULL with that range)
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); applyWorld("ura"); window.location.hash = ""; });

describe("StatsPage — 时间花在哪", () => {
  it("the task ledger: line code, title, hours, then cost and $/h in whole dollars (* = partly unpriced); rows link to the v2 task", async () => {
    stServer();
    page();
    const box = await region("时间花在哪");
    const led = box.querySelector(".st-led")!;
    expect(led.classList.contains("nocost")).toBe(false);
    expect(ink(led.querySelector(".st-r.head")!)).toBe("工时|费用|$/h");
    const r = rows(led, "a.st-r");
    // FULL: t1 300 min, $7.50 partial → $8* and $7.50 / 5h = $1.50 → $2*; t2 90 min and no cost row → — —
    expect(r.map((x) => ink(x))).toEqual([
      `看板开发|5h|$8|*|$2|*`,
      `报表修正|1.5h|—|—`,
    ]);
    expect(r[0].getAttribute("href")).toBe("#/v2/tasks/t1");
    expect(r[0].getAttribute("data-task")).toBe("t1");
    expect(r[0].querySelector(".st-pt")!.getAttribute("title")).toBe("部分会话未定价");
  });

  it("B3b: a ledger row shows the S badge, not the code Led", async () => {
    stServer();
    page();
    const box = await region("时间花在哪");
    const row = rows(box, ".st-led a.st-r").find((a) => a.getAttribute("data-task") === "t1")!;
    const badge = row.querySelector<HTMLElement>('.tbadge[data-task="t1"]')!;
    expect(badge).toBeTruthy();
    expect(badge.style.height).toBe("22px");
    expect(row.querySelector(".nm")).toBeTruthy();
    expect(row.firstElementChild).toBe(badge);
    expect(ink(row)).not.toContain("t1|");
    expect(ink(row).split("|")[0]).toBe("看板开发");     // no code Led: Led exposes its text as .ink
  });

  it("B3b: a ledger row hovers its task via the title Led", async () => {
    stServer();
    page();
    const box = await region("时间花在哪");
    const row = rows(box, ".st-led a.st-r").find((a) => a.getAttribute("data-task") === "t1")!;
    // the Shell lifts closest([data-task]) of the pointer target: the title Led carries it, as does the row and the badge box
    expect(row.querySelector(".nm canvas")!.getAttribute("data-task")).toBe("t1");
    expect(row.querySelector(".nm .ink")!.getAttribute("data-task")).toBe("t1");
    expect(row.querySelector(".nm canvas")!.closest("[data-task]")!.getAttribute("data-task")).toBe("t1");
    expect(row.querySelector(".tbadge")!.closest("[data-task]")!.getAttribute("data-task")).toBe("t1");
  });

  it("B3b: 产出 rows (done tasks, estimate gaps) lead with the S badge too", async () => {
    stServer();
    page();
    const box = await region("产出");
    for (const sel of [".st-done a.st-r", ".st-gap a.st-r"]) {
      const a = box.querySelector(sel)!;
      const b = a.querySelector<HTMLElement>('.tbadge[data-task="t1"]')!;
      expect(b.style.height).toBe("22px");
      expect(a.firstElementChild).toBe(b);
    }
  });

  it("$/h divides the cost by its own session minutes, not the ledger's time (notes and token-less sessions have no cost)", async () => {
    stServer({ dash: (from, to): Dashboard => ({
      ...FULL, range: { from, to },
      time: { ...FULL.time, by_task: [{ task_id: "t1", title: "看板开发", minutes: 600 }] },
      ai: { ...FULL.ai, by_task_cost: [{ task_id: "t1", title: "看板开发", cost_usd: 30, cost_partial: false, minutes: 300 }] },
    }) });
    page();
    const box = await region("时间花在哪");
    // $30 over the 5h of priced sessions = $6/h (over the ledger's 10h it would read $3); fully priced → no *
    expect(rows(box, ".st-led a.st-r").map((x) => ink(x))).toEqual(["看板开发|10h|$30|$6"]);
  });

  it("the ledger shows the first 10 tasks; an id is encoded in the link", async () => {
    const by_task = Array.from({ length: 12 }, (_, i) => ({ task_id: `T2026090${i % 10}-${i}`, title: `案件${i}`, minutes: 600 - i * 10 }));
    by_task[0].task_id = "a b";
    stServer({ dash: (from, to): Dashboard => ({ ...FULL, range: { from, to }, time: { ...FULL.time, by_task } }) });
    page();
    const box = await region("时间花在哪");
    const r = rows(box, ".st-led a.st-r");
    expect(r).toHaveLength(10);
    expect(r[0].getAttribute("href")).toBe("#/v2/tasks/a%20b");
  });

  it("表 with the default prefs (stats.cost hidden): the ledger has no cost or $/h cells at all", async () => {
    applyWorld("omote");
    stServer();
    page();
    const box = await region("时间花在哪");
    const led = box.querySelector(".st-led")!;
    expect(led.classList.contains("nocost")).toBe(true);
    expect(ink(led.querySelector(".st-r.head")!)).toBe("工时");
    expect(rows(led, "a.st-r").map((x) => ink(x))).toEqual(["看板开发|5h", "报表修正|1.5h"]);
    expect(box.querySelector("[data-mod]")).toBeNull();
    expect(box.textContent).not.toContain("$");
  });

  it("the unlinked note, worded by case as on the old page: sessions and notes, sessions only, notes only; its key opens the timeline's 未关联 filter (all weeks)", async () => {
    const s = stServer({ dash: (from, to): Dashboard => ({ ...FULL, range: { from, to }, time: { ...FULL.time, unlinked_minutes: 150, unlinked_note_minutes: 30 } }) });
    page();
    let box = await region("时间花在哪");
    const n = box.querySelector(".st-un")!;
    expect(ink(n)).toBe("未关联案件 2.5h（会话 2h · 补记 0.5h，在时间线的补记里选案件）|去关联");
    expect(n.querySelector("a")!.getAttribute("href")).toBe(UNLINKED_HREF);
    // only sessions: no word about notes
    s.db.dash = (from, to) => ({ ...FULL, range: { from, to }, time: { ...FULL.time, unlinked_minutes: 60, unlinked_note_minutes: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "近 3 个月" }));
    await waitFor(() => expect(ink(screen.getByRole("region", { name: "时间花在哪" }).querySelector(".st-un")!)).toBe("未关联案件 1h（会话 1h）|去关联"));
    // only notes: nothing for the key to open
    s.db.dash = (from, to) => ({ ...FULL, range: { from, to }, time: { ...FULL.time, unlinked_minutes: 30, unlinked_note_minutes: 30 } });
    fireEvent.click(screen.getByRole("button", { name: "本周" }));
    await waitFor(() => expect(ink(screen.getByRole("region", { name: "时间花在哪" }).querySelector(".st-un")!)).toBe("未关联案件 0.5h（补记 0.5h，在时间线的补记里选案件）"));
    // none at all: no note
    s.db.dash = (from, to) => ({ ...FULL, range: { from, to }, time: { ...FULL.time, unlinked_minutes: 0 } });
    fireEvent.click(screen.getByRole("button", { name: "本月" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "时间花在哪" }).querySelector(".st-un")).toBeNull());
    box = screen.getByRole("region", { name: "时间花在哪" });
    expect(rows(box, ".st-led a.st-r")).toHaveLength(2);
  });

  it("每周: one amber total bar per ISO week with its dates; the hover tip lists each project's time", async () => {
    stServer();
    page();
    const box = await region("时间花在哪");
    const w = rows(box, ".st-wk .st-r:not(.head)");
    expect(w.map((x) => ink(x))).toEqual(["W38|09-14–09-20|2h", "W39|09-21–09-27|4h"]);
    expect(w.every((x) => x.getAttribute("data-part") === null)).toBe(true);
    // the same words for screen readers (the tip is visual)
    expect(w[1].querySelector(".v2-sr")!.textContent).toBe("Alpha项目 3h · Beta项目 1h");
    fireEvent.pointerMove(w[1], { clientX: 10, clientY: 10 });
    const tip = screen.getByRole("tooltip");
    expect(tip.querySelector(".h")!.textContent).toBe("2026-W39 · 09-21–09-27");
    expect(tip.querySelector(".m")!.textContent).toBe("4h");
    expect(tip.querySelector(".s")!.textContent).toBe("Alpha项目 3h · Beta项目 1h");
    fireEvent.pointerLeave(w[1]);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a week cut by the range shows the cut dates and says 部分周; a bad week or project row is skipped, not a crash", async () => {
    stServer({
      dash: (): Dashboard => ({
        ...FULL,
        range: { from: "2026-09-16", to: "2026-09-24" },
        time: {
          ...FULL.time,
          weekly: [
            { week: "2026-W38", by_project: [{ key: "未关联", minutes: 90 }, { key: "x" } as never] },
            { week: "W39", by_project: [] },
            { week: "2026-W39", by_project: "x" as never },
            { week: "2026-W39", by_project: [{ key: "Alpha项目", minutes: 60 }] },
          ],
        },
      }),
    });
    page();
    const box = await region("时间花在哪");
    const w = rows(box, ".st-wk .st-r:not(.head)");
    expect(w.map((x) => ink(x))).toEqual(["W38|09-16–09-20|1.5h", "W39|09-21–09-24|1h"]);
    expect(w.map((x) => x.getAttribute("data-part"))).toEqual(["", ""]);
    // 未关联 is the page's word; other project keys are data
    expect(w[0].querySelector(".v2-sr")!.textContent).toBe("未关联 1.5h");
    fireEvent.pointerMove(w[0], { clientX: 10, clientY: 10 });
    expect(screen.getByRole("tooltip").querySelector(".h")!.textContent).toBe("2026-W38 · 09-16–09-20 · 部分周");
    expect(box.textContent).not.toContain("NaN");
  });
});

describe("StatsPage — 按依頼元", () => {
  it("one row per requester: name, a time bar with hours, share of 总工时, tokens, cost in whole dollars (* partly unpriced); then the even-split note", async () => {
    stServer();
    page();
    const box = await region("按依頼元");
    expect(ink(box.querySelector(".st-r.head")!)).toBe("依頼元|时间|占比|Token|费用");
    const r = rows(box, ".st-req .st-r:not(.head)");
    // shares of overview.minutes (600), as the old time donut's legend; $0.5 rounds to $1
    expect(r.map((x) => ink(x))).toEqual([
      "Alex Wang|5h|50%|3M|$12", "Team|2h|20%|500K|$2|*", "Kevin Liu|1h|10%|200K|$1", "未关联|1h|10%|1M|$4",
      "佐藤|0.5h|5%|100K|$1", "田中先生|0.3h|3%|100K|$1", "Mia Chen|0.2h|2%|100K|$1",
    ]);
    expect(ink(box.querySelector(".st-note")!)).toBe("多依頼元的案件按人数平分；未挂案件的算「未关联」。");
  });

  it("in English the 未关联 row and the headings follow the language; names stay", async () => {
    stServer();
    page({ lang: "en" });
    const box = await region("By requester");
    const r = rows(box, ".st-req .st-r:not(.head)");
    expect(ink(r[3])).toBe("Unlinked|1h|10%|1M|$4");
    expect(ink(r[0])).toBe("Alex Wang|5h|50%|3M|$12");
  });

  it("表 with the default prefs (stats.cost hidden): no cost column at all; the share stays", async () => {
    applyWorld("omote");
    stServer();
    page();
    const box = await region("按依頼元");
    expect(box.querySelector(".st-req")!.classList.contains("nocost")).toBe(true);
    expect(ink(box.querySelector(".st-r.head")!)).toBe("依頼元|时间|占比|Token");
    expect(ink(rows(box, ".st-req .st-r:not(.head)")[0])).toBe("Alex Wang|5h|50%|3M");
    expect(box.textContent).not.toContain("$");
  });
});

describe("StatsPage — 产出", () => {
  it("three figures, the done tasks and the estimate gaps, rows linking to the v2 task", async () => {
    stServer();
    page();
    const box = await region("产出");
    expect(rows(box, ".st-kv").map((x) => ink(x))).toEqual(["完了案件|1", "平均交付周期|3|天", "成果物|2"]);
    const done = rows(box, ".st-done a.st-r");
    expect(done.map((x) => ink(x))).toEqual(["看板开发|3 天|成果物 2"]);
    expect(done[0].getAttribute("href")).toBe("#/v2/tasks/t1");
    expect(done[0].getAttribute("title")).toBe("2026-09-01 → 2026-09-04");
    const gaps = rows(box, ".st-gap a.st-r");
    expect(gaps.map((x) => ink(x))).toEqual(["看板开发|3h / 3.5h"]);
  });

  it("empty: a dim line each", async () => {
    stServer({ dash: () => EMPTY });
    page();
    const box = await region("产出");
    expect(rows(box, ".st-kv").map((x) => ink(x))).toEqual(["完了案件|0", "平均交付周期|—", "成果物|0"]);
    expect(rows(box, ".st-none").map((x) => ink(x))).toEqual(["这段时间没有完了的案件", "区间内活跃的案件都没有填手动工时"]);
    expect(within(box).queryByRole("link")).toBeNull();
  });
});

describe("StatsPage — malformed sections", () => {
  it("a section in an unexpected shape shows 暂无数据 there; the figures and the other sections still draw", async () => {
    stServer({ dash: (from, to) => ({ ...FULL, range: { from, to }, time: null, requesters: "x", output: {}, ai: null } as unknown as Dashboard) });
    const { container } = page();
    for (const name of ["时间花在哪", "按依頼元", "产出"]) {
      const box = await region(name);
      expect(ink(box)).toContain("暂无数据");
    }
    expect(container.querySelectorAll(".st-figs .st-fig")).toHaveLength(6);
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("undefined");
  });

  it("时间花在哪's parts stand alone: a broken 每周 keeps the ledger, a broken ledger keeps 每周", async () => {
    const s = stServer({ dash: (from, to) => ({ ...FULL, range: { from, to }, time: { ...FULL.time, weekly: "x" } } as unknown as Dashboard) });
    page();
    let box = await region("时间花在哪");
    expect(rows(box, ".st-led a.st-r")).toHaveLength(2);
    expect(rows(box, ".st-wk")).toHaveLength(0);
    expect(rows(box, ".st-none").map((x) => ink(x))).toEqual(["暂无数据"]);
    s.db.dash = (from, to) => ({ ...FULL, range: { from, to }, time: { ...FULL.time, by_task: null } } as unknown as Dashboard);
    fireEvent.click(screen.getByRole("button", { name: "本周" }));
    await waitFor(() => expect(rows(screen.getByRole("region", { name: "时间花在哪" }), ".st-led")).toHaveLength(0));
    box = screen.getByRole("region", { name: "时间花在哪" });
    expect(rows(box, ".st-wk .st-r")).toHaveLength(2);
    expect(rows(box, ".st-none").map((x) => ink(x))).toEqual(["暂无数据"]);
  });

  it("bad rows inside a good section are skipped; a ledger without the AI section has no cost to show", async () => {
    stServer({
      dash: (from, to) => ({
        ...FULL, range: { from, to }, ai: { ...FULL.ai, by_task_cost: "x" },
        time: { ...FULL.time, by_task: [null, { task_id: 3, minutes: 1 }, ...FULL.time.by_task] },
        requesters: [{ requester: null, minutes: 1 }, ...FULL.requesters.slice(0, 1)],
        output: { ...FULL.output, done_tasks: [{ title: "x" }], estimate_gaps: [{ task_id: "t1", title: "看板开发", manual_hours: "3" }] },
      } as unknown as Dashboard),
    });
    page();
    const t = await region("时间花在哪");
    expect(rows(t, ".st-led a.st-r").map((x) => ink(x))).toEqual(["看板开发|5h|—|—", "报表修正|1.5h|—|—"]);
    expect(rows(await region("按依頼元"), ".st-req .st-r:not(.head)").map((x) => ink(x))).toEqual(["Alex Wang|5h|50%|3M|$12"]);
    const o = await region("产出");
    expect(rows(o, ".st-done a.st-r")).toHaveLength(0);
    expect(rows(o, ".st-gap a.st-r")).toHaveLength(0);
  });
});

describe("StatsPage — hint links keep their own task", () => {
  it("a malformed link before a task link does not hand the task's id to another key", async () => {
    stServer({
      dash: (from, to) => ({
        ...FULL, range: { from, to },
        hints: [hint("stale-open", { n: 1, days: 14 }, [{ label: "坏的", href: 7 as never }, { label: "2026-W40", href: "#/timeline/2026-W40" }, { label: "看板开发", href: "#/tasks/T20260901-01" }])],
      }),
    });
    page();
    const box = await region("提示");
    const keys = rows(box, ".lk a");
    expect(keys.map((a) => [a.getAttribute("href"), a.getAttribute("data-task")])).toEqual([
      ["#/v2/timeline/2026-W40", null],
      ["#/v2/tasks/T20260901-01", "T20260901-01"],
    ]);
    expect(keys[1].getAttribute("title")).toBe("看板开发");
  });
});
