import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { costOf } from "../src/pages/now/cost";
import { CostPanel } from "../src/pages/now/CostPanel";
import { InfoPanel } from "../src/pages/now/InfoPanel";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { TipHost } from "../src/ui/TipHost";
import { applyWorld, resetWorldStore } from "../src/world/store";
import { J, machine } from "../src/predict/fixtures";
import { predict } from "../src/predict/predict";
import { scenarioInput, type ScenarioId } from "../src/predict/scenarios";
import { buildSnapshot } from "../src/predict/snapshot";
import { V2TestProvider } from "./helpers";

const at = (id: ScenarioId) => { const snap = buildSnapshot(scenarioInput(id), 10); return { snap, pred: predict(snap, DEFAULT_PREFS.predict) }; };
const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");

describe("InfoPanel", () => {
  afterEach(() => resetWorldStore());
  it("an alert in 表 folds onto the heading row: title, how many, the first alert, its action; the why is the row's tip", async () => {
    act(() => applyWorld("omote"));
    const { snap, pred } = at("morning");
    const { container } = render(<V2TestProvider><TipHost><InfoPanel pred={pred} snap={snap} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("需要你处理 1 件 · 【延误】关联 10/1 的 2 个会话（47 分钟）"));
    const sec = container.querySelector(".info > .sec")!;
    expect(container.querySelector(".info")!.children).toHaveLength(1);   // one row: nothing below the heading
    expect(ink(sec)).toContain("运行情报");
    expect(sec.querySelectorAll(".lamp.red")).toHaveLength(1);
    expect(sec.querySelector("a.key.pri")!.getAttribute("href")).toBe("#/v2/timeline?unlinked=1");
    expect(sec.querySelector(".ink .i-r")).not.toBeNull();
    expect(ink(container)).not.toContain("週報会少记");   // the why is not on the board
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("上一个工作日（10/1）还有 2 个会话没归到案件，週報会少记 47 分钟");
    expect(sec.querySelector("a.key.pri")!.getAttribute("aria-label")).toBe("关联 · 需要你处理 1 件 · 【延误】关联 10/1 的 2 个会话（47 分钟）");
    fireEvent.pointerMove(sec, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(document.body.querySelector(".tip.on")!.textContent).toContain("上一个工作日（10/1）还有 2 个会话没归到案件，週報会少记 47 分钟"));
    fireEvent.pointerLeave(sec);
    await waitFor(() => expect(document.body.querySelector(".tip.on")).toBeNull());
    fireEvent.focus(sec.querySelector("a.key.pri")!);   // keyboard: focusing the key opens the same tip
    await waitFor(() => expect(document.body.querySelector(".tip.on")!.textContent).toContain("週報会少记 47 分钟"));
    fireEvent.blur(sec.querySelector("a.key.pri")!);
    await waitFor(() => expect(document.body.querySelector(".tip.on")).toBeNull());
  });
  it("an alert in 里: the first alert leads the row (no title, no count), both move to the tip", async () => {
    act(() => applyWorld("ura"));
    const { snap, pred } = at("morning");
    const { container } = render(<V2TestProvider><TipHost><InfoPanel pred={pred} snap={snap} /></TipHost></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("【延误】关联 10/1 的 2 个会话（47 分钟）"));
    const sec = container.querySelector(".info > .sec")!;
    expect(ink(sec)).not.toContain("运行情报");
    expect(ink(sec)).not.toContain("需要你处理");
    expect(sec.querySelectorAll(".lamp.red")).toHaveLength(1);
    expect(sec.querySelector("a.key.pri")).not.toBeNull();
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("运行情报 · 需要你处理 1 件 · 上一个工作日（10/1）还有 2 个会话没归到案件，週報会少记 47 分钟");
    fireEvent.pointerMove(sec, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      const tip = document.body.querySelector(".tip.on")!;
      expect(tip.textContent).toContain("运行情报 · 需要你处理 1 件");
      expect(tip.textContent).toContain("週報会少记 47 分钟");
    });
    act(() => applyWorld("omote"));   // a world switch under a still mouse drops the old tip
    await waitFor(() => expect(document.body.querySelector(".tip.on")).toBeNull());
  });
  it("no alert: the normal line with the collection time on the heading row, no red, no action", async () => {
    const { snap, pred } = at("day");
    const { container } = render(<V2TestProvider><InfoPanel pred={{ ...pred, alerts: [] }} snap={snap} /></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("两台机器 14:00 已收集"));
    expect(container.querySelector(".info")!.children).toHaveLength(1);   // folded into the heading row (decision 9b)
    expect(container.querySelector(".lamp.red")).toBeNull();
    expect(container.querySelector("a.key")).toBeNull();
  });
  it("one machine stopped collecting: each machine shows its own time, the stale one dated", async () => {
    const snap = buildSnapshot({ ...scenarioInput("day"), machines: [machine("macmini", "2026-10-02 14:00"), machine("win11", "2026-10-01 18:00")] }, 10);
    const { container } = render(<V2TestProvider><InfoPanel pred={{ ...predict(snap, DEFAULT_PREFS.predict), alerts: [] }} snap={snap} /></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("MAC 14:00 已收集 · WIN 10/1 18:00 已收集"));
  });
});

describe("CostPanel", () => {
  it("costOf: today's sessions in full, per machine, the week, as of the last collection", () => {
    const c = costOf(at("day").snap);
    expect(c.n).toBe(5);
    expect(c.today).toBeCloseTo(102.3);
    expect(c.byMachine.map((m) => [m.name, Math.round(m.usd * 100) / 100])).toEqual([["macmini", 62.1], ["win11", 40.2]]);
    expect(c.week).toBeCloseTo(140.1);
    expect([c.partial, c.asOf]).toEqual([false, Date.parse(J("2026-10-02 14:00"))]);
  });
  it("renders the total on the heading row, then each machine, the session count and the week on one line", async () => {
    const { container } = render(<V2TestProvider><CostPanel snap={at("day").snap} /></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("102.30"));
    expect(container.querySelector(".cost-big")!.textContent).toBe("$102.30");
    expect(container.querySelector(".cost-foot")!.textContent).toBe("MAC $62.10 · WIN $40.20 · 5 个会话 · 14:00 时点 · 本周累计 $140.10 · 跨日会话按整段计入");
  });
  it("an empty day: zero, no bars, no crash", async () => {
    const snap = buildSnapshot({ now: Date.parse(J("2026-10-05 09:00")), machines: [], sessions: [], tasks: [], planItems: [], dayPlan: null, downloads: [] }, 10);
    const { container } = render(<V2TestProvider><CostPanel snap={snap} /></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toContain("0 个会话 · 09:00 时点"));
    expect(ink(container)).toContain("0.00");
    expect(container.querySelector(".cost-foot")!.textContent).not.toContain("MAC");
  });
});
