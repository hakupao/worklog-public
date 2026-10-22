import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextRows } from "../src/pages/now/NextRows";
import { TipHost } from "../src/ui/TipHost";
import { planRows, shownPlanRows } from "../src/pages/now/plan";
import { PlanRows } from "../src/pages/now/PlanRows";
import { RunRows } from "../src/pages/now/RunRows";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { dayItem, dayPlan, J, machine, session, task, taskRef } from "../src/predict/fixtures";
import { predict } from "../src/predict/predict";
import { scenarioInput, type ScenarioId } from "../src/predict/scenarios";
import { buildSnapshot } from "../src/predict/snapshot";
import { V2TestProvider } from "./helpers";

const at = (id: ScenarioId) => { const snap = buildSnapshot(scenarioInput(id), 10); return { snap, pred: predict(snap, DEFAULT_PREFS.predict) }; };
/** The ink twins' text, slot by slot (the twin is written once the pixel font promise settles). */
const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");

describe("RunRows", () => {
  it("one row per running session: start, code, task, machine, elapsed to the collection", async () => {
    const { container } = render(<V2TestProvider><RunRows snap={at("day").snap} /></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("worklog 改修"));
    const rows = container.querySelectorAll<HTMLElement>(".row.run");
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.task).toBe("T20260918-02");
    expect(ink(rows[0])).toBe("13:40|worklog 改修|MAC|0:20");
    expect(await within(rows[0]).findByRole("img", { name: "0918-02" })).toBeTruthy();
    expect(ink(container)).toContain("运行中 2");
    expect(container.querySelector(".lamp.live")).not.toBeNull();
  });
  it("nothing running: a dim line, no green lamp", async () => {
    const { container } = render(<V2TestProvider><RunRows snap={at("morning").snap} /></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("没有运行中的会话"));
    expect(ink(container)).toContain("运行中 0");
    expect(container.querySelector(".lamp.live")).toBeNull();
  });
  it("an unlinked running session: a dim code at the same tier as a linked one (no Board rebuild when it gets linked)", async () => {
    const snap = buildSnapshot({
      now: Date.parse(J("2026-10-02 14:20")), machines: [machine("macmini", "2026-10-02 14:00")],
      sessions: [session("U", "2026-10-02 13:30", "2026-10-02 14:00")], tasks: [], planItems: [], dayPlan: null, downloads: [],
    }, 10);
    const { container } = render(<V2TestProvider><RunRows snap={snap} /></V2TestProvider>);
    await waitFor(() => expect(container.querySelector(".row.run .ink .i-dim")).not.toBeNull());
    expect(container.querySelectorAll(".row.run canvas")[1].getAttribute("data-tier")).toBe("1");
    expect(container.querySelector(".row.run .ink .i-dim")!.textContent).toBe("--");
    expect(container.querySelector(".row.run .tbadge")).toBeNull();
  });
});

describe("NextRows", () => {
  it("heading with mode and count, the basis, three rows in rank order, the first one primary", async () => {
    const { container } = render(<V2TestProvider><TipHost><NextRows pred={at("morning").pred} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("下一步 · 早上排今日 3"));
    expect(ink(container)).toContain("依据 09:05 · 今日安排未开始 · 未关联 2");
    const rows = [...container.querySelectorAll<HTMLElement>(".row.next")];
    expect(rows.map((r) => r.dataset.rule)).toEqual(["unlinked.yesterday", "plan.unplaced", "task.waiting"]);
    const keys = rows.map((r) => r.querySelector("a.key")!);
    expect(keys.map((k) => k.getAttribute("href"))).toEqual(["#/v2/timeline?unlinked=1", "#/v2/plan", "#/v2/tasks/T20261001-01"]);
    expect(keys.map((k) => k.classList.contains("pri"))).toEqual([true, false, false]);
    expect(keys[0].getAttribute("aria-label")).toBe("关联 · 关联 10/1 的 2 个会话（47 分钟）");
    expect(ink(rows[1])).toContain("BEACON 每天推进一点");
    expect(rows[2].dataset.task).toBe("T20261001-01");
  });
  it("hovering a row shows why and which rule fired; leaving hides it", () => {
    const { container } = render(<V2TestProvider><TipHost><NextRows pred={at("morning").pred} /></TipHost></V2TestProvider>);
    const row = container.querySelector<HTMLElement>('.row.next[data-rule="task.waiting"]')!;
    fireEvent.pointerMove(row, { clientX: 50, clientY: 50 });
    const tip = document.body.querySelector(".tip")!;
    expect(tip.classList.contains("on")).toBe(true);
    expect(tip.textContent).toContain("最近一个会话（10/1）的摘要里有「確認待ち」");
    expect(tip.textContent).toContain("规则 task.waiting");
    fireEvent.pointerLeave(row);
    expect(tip.classList.contains("on")).toBe(false);
  });
  it("keyboard focus on an action shows the same tip; the why is also in the page for screen readers", () => {
    const { container } = render(<V2TestProvider><TipHost><NextRows pred={at("day").pred} /></TipHost></V2TestProvider>);
    const row = container.querySelector<HTMLElement>('.row.next[data-rule="unlinked.stale"]')!;
    expect(row.querySelector(".v2-sr")!.textContent).toBe("会话结束 43 分钟了，仍未关联");   // S5 ended 13:37, board at 14:20
    fireEvent.focus(row.querySelector("a.key")!);
    expect(document.body.querySelector(".tip")!.textContent).toContain("规则 unlinked.stale");
    fireEvent.blur(row.querySelector("a.key")!);
    expect(document.body.querySelector(".tip")!.classList.contains("on")).toBe(false);
  });
  it("the code slot keeps tier 1 when a target's task flips null ↔ set; no task reads as a dim placeholder (no Board rebuild)", async () => {
    const { pred } = at("morning");
    const s0 = pred.suggestions[0];
    const withTask = (taskId: string | null) => ({ ...pred, suggestions: [{ ...s0, taskId }] });
    const code = (c: Element) => c.querySelectorAll(".row.next canvas")[1];
    const { container, rerender } = render(<V2TestProvider><TipHost><NextRows pred={withTask(null)} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(container.querySelector(".row.next .ink .i-dim")).not.toBeNull());
    expect(code(container).getAttribute("data-tier")).toBe("1");
    rerender(<V2TestProvider><TipHost><NextRows pred={withTask("T20261001-01")} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(container.querySelector(".row.next .ink .i-dim")).toBeNull());
    expect(code(container).getAttribute("data-tier")).toBe("1");
    rerender(<V2TestProvider><TipHost><NextRows pred={withTask(null)} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(container.querySelector(".row.next .ink .i-dim")).not.toBeNull());
    expect(code(container).getAttribute("data-tier")).toBe("1");
  });
  it("no suggestions: says so, no rows", async () => {
    const { pred } = at("morning");
    const { container } = render(<V2TestProvider><TipHost><NextRows pred={{ ...pred, suggestions: [] }} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("没有建议"));
    expect(container.querySelectorAll(".row.next[data-rule]")).toHaveLength(0);
    expect(ink(container)).toContain("下一步 · 早上排今日 0");
  });
});

describe("PlanRows", () => {
  it("before the day starts: how many plan items could come in", async () => {
    const { container } = render(<V2TestProvider><TipHost><PlanRows snap={at("morning").snap} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("还没开始 · 计划里有 1 条可以带入"));
    expect(container.querySelectorAll(".row.prow[data-status]")).toHaveLength(0);
  });
  it("started: one row per item — mark, code, item, today's time on its tasks, the AI's progress or what is missing", async () => {
    const { container } = render(<V2TestProvider><TipHost><PlanRows snap={at("day").snap} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("今日安排 1/2 完成"));
    const rows = [...container.querySelectorAll<HTMLElement>(".row.prow[data-status]")];
    expect(rows.map((r) => [r.dataset.task, r.dataset.status])).toEqual([["T20260701-01", "none"], ["T20260918-02", "done"]]);
    expect(ink(rows[0])).toBe("HARBOR2 Mapping 仕様書作成|--|今天还没有会话");
    expect(ink(rows[1])).toBe("worklog 改修|2:30|AI 判定：完成");
    expect(await within(rows[0]).findByRole("img", { name: "0701-01" })).toBeTruthy();
    expect(await within(rows[1]).findByRole("img", { name: "0918-02" })).toBeTruthy();        // judged done, no progress words
    expect(rows.map((r) => r.querySelector(".lamp")!.className)).toEqual(["lamp", "lamp live"]);
    expect(rows[1].querySelector(".v2-sr")!.textContent).toBe("完成");
  });
  it("the AI's progress is shown after its label; hovering a row shows the item, its status and time", async () => {
    const base = at("day").snap, dp = base.dayPlan!;
    const snap = { ...base, dayPlan: { ...dp, items: [{ ...dp.items[1], ai_progress: "Step 3 完了", ai_note: "残りはレビュー" }] } };
    const { container } = render(<V2TestProvider><TipHost><PlanRows snap={snap} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("|AI：Step 3 完了"));
    fireEvent.pointerMove(container.querySelector(".row.prow[data-status]")!, { clientX: 40, clientY: 40 });
    const tip = document.body.querySelector(".tip")!;
    expect(tip.textContent).toContain("worklog 改修");
    expect(tip.textContent).toContain("完成 · 今天 2:30");
    expect(tip.textContent).toContain("残りはレビュー");
  });
  it("more than four items: four rows and a count of the rest", async () => {
    const base = at("day").snap, it0 = base.dayPlan!.items[0];
    const items = ["A", "B", "C", "D", "E", "F"].map((id) => ({ ...it0, id, text: `item ${id}` }));
    const { container } = render(<V2TestProvider><TipHost><PlanRows snap={{ ...base, dayPlan: { ...base.dayPlan!, items } }} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("还有 2 条"));
    expect(container.querySelectorAll(".row.prow[data-status]")).toHaveLength(4);
    expect(ink(container)).toContain("今日安排 0/6 完成");
  });
  it("the rows that fit whole: 还有 N 条 counts every row not shown (T10 F2)", async () => {
    // jsdom has no layout: the box is 64px (the 里 heavy day's column), each row 30px, as measured in Chrome
    const box = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains("plan-rows") ? 64 : this.classList.contains("prow") ? 30 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
    });
    const base = at("day").snap, it0 = base.dayPlan!.items[0];
    const items = ["A", "B", "C", "D", "E"].map((id) => ({ ...it0, id, text: `item ${id}` }));
    const { container } = render(<V2TestProvider><TipHost><PlanRows snap={{ ...base, dayPlan: { ...base.dayPlan!, items } }} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("还有 3 条"));
    const rows = [...container.querySelectorAll<HTMLElement>(".row.prow[data-status]")];
    // the rest stay in the layout (so the box keeps its size and the count cannot feed back) but unseen and unheard
    expect(rows.filter((r) => r.getAttribute("aria-hidden") !== "true")).toHaveLength(2);
    expect(rows.filter((r) => r.classList.contains("unseen"))).toHaveLength(2);
    box.mockRestore();
  });
  it("started but empty", async () => {
    const snap = { ...at("day").snap, dayPlan: dayPlan("2026-10-02", []) };
    const { container } = render(<V2TestProvider><TipHost><PlanRows snap={snap} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("今日安排是空的"));
  });
});

describe("shownPlanRows", () => {
  it("whole rows that fit, capped at four; unmeasured shows the cap", () => {
    expect(shownPlanRows(5, 64, 30)).toBe(2);
    expect(shownPlanRows(5, 120, 30)).toBe(4);
    expect(shownPlanRows(5, 119.6, 30)).toBe(4);     // sub-pixel boxes still hold a whole row
    expect(shownPlanRows(5, 400, 30)).toBe(4);
    expect(shownPlanRows(3, 400, 30)).toBe(3);
    expect(shownPlanRows(5, 20, 30)).toBe(0);
    expect(shownPlanRows(5, 0, 30)).toBe(4);
    expect(shownPlanRows(2, 64, 0)).toBe(2);
  });
});

describe("planRows", () => {
  it("minutes count only today's share of the item's tasks; no task / no session / not judged are told apart", () => {
    const now = Date.parse(J("2026-10-02 14:20"));
    const snap = buildSnapshot({
      now, machines: [machine("macmini", "2026-10-02 14:00")],
      sessions: [
        session("X", "2026-10-01 23:30", "2026-10-02 00:30", { task_id: "T1", active_intervals: [[J("2026-10-01 23:30"), J("2026-10-02 00:30")]] }),
        session("Y", "2026-10-02 10:00", "2026-10-02 10:15", { task_id: "T1" }),
      ],
      tasks: [task("T1", "one"), task("T2", "two")], planItems: [], downloads: [],
      dayPlan: dayPlan("2026-10-02", [
        dayItem({ id: "a", text: "a", tasks: [taskRef("T1", "one")] }),
        dayItem({ id: "b", text: "b", tasks: [taskRef("T2", "two")] }),
        dayItem({ id: "c", text: "c" }),
        dayItem({ id: "d", text: "d", tasks: [taskRef("T2", "two")], ai_progress: "  ", ai_status: "partial" }),
        dayItem({ id: "e", text: "e", ai_status: "none", manual_status: "done" }),
      ]),
    }, 10);
    expect(planRows(snap).map((r) => [r.id, r.minutes, r.progress.kind, r.status])).toEqual([
      ["a", 45, "unjudged", "none"], ["b", 0, "noSession", "none"], ["c", 0, "noTask", "none"], ["d", 0, "judged", "partial"], ["e", 0, "manual", "done"],
    ]);
  });
  it("no day plan: no rows", () => {
    expect(planRows(at("morning").snap)).toEqual([]);
  });
});
