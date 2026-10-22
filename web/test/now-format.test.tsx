import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { basisText, elapsed, plain, suggestionSegs, syncText, taskCode, whenText } from "../src/pages/now/format";
import { J, machine } from "../src/predict/fixtures";
import { buildSnapshot } from "../src/predict/snapshot";
import type { Hit } from "../src/predict/types";
import { seenText } from "../src/ui/machine";
import { Tip } from "../src/ui/Tip";

const T = (s: string) => Date.parse(J(s));
const snapAt = (now: string, ms: ReturnType<typeof machine>[]) =>
  buildSnapshot({ now: T(now), machines: ms, sessions: [], tasks: [], planItems: [], dayPlan: null, downloads: [] }, 10);

describe("now/format", () => {
  it("task code, elapsed, when", () => {
    expect([taskCode("T20260701-01"), taskCode(null), taskCode("odd-id")]).toEqual(["0701-01", "--", "odd-id"]);
    expect([elapsed(0), elapsed(65 * 60_000), elapsed(-5)]).toEqual(["0:00", "1:05", "0:00"]);
    expect(whenText("zh", { kind: "label", key: "yesterday" })).toBe("昨天");
    expect(whenText("en", { kind: "time", hm: "13:07" })).toBe("13:07");
    expect(whenText("ja", { kind: "date", md: "10/2" })).toBe("10/2");
  });
  it("a suggestion: the interface text, then the data in the display language's glyphs", () => {
    const h = { textKey: "rule.plan.unplaced.text", vars: {}, subject: "BEACON 帳票修正" } as unknown as Hit;
    expect(suggestionSegs("zh", h)).toEqual([{ t: "排进今日： " }, { t: "BEACON 帳票修正" }]);
    expect(plain(suggestionSegs("en", { ...h, subject: undefined }))).toBe("Plan today:");
  });
  it("basis line leaves out empty parts", () => {
    expect(basisText("zh", { hm: "14:20", running: 2, plan: { a: 1, b: 2 }, unlinked: 3 })).toBe("依据 14:20 · 2 个会话运行中 · 今日安排 1/2 · 未关联 3");
    expect(basisText("zh", { hm: "09:05", running: 0, plan: null, unlinked: 0 })).toBe("依据 09:05 · 今日安排未开始");
  });
  it("sync line: one time when both machines agree, each machine otherwise, dated when not today", () => {
    expect(seenText(T("2026-10-02 14:00"), "2026-10-02")).toBe("14:00");
    expect(seenText(T("2026-10-01 20:00"), "2026-10-02")).toBe("10/1 20:00");
    expect(syncText("zh", snapAt("2026-10-02 14:20", [machine("macmini", "2026-10-02 14:00"), machine("win11", "2026-10-02 14:00")]))).toBe("两台机器 14:00 已收集");
    expect(syncText("zh", snapAt("2026-10-02 14:20", [machine("macmini", "2026-10-02 14:00"), machine("win11", "2026-10-01 18:00")]))).toBe("MAC 14:00 已收集 · WIN 10/1 18:00 已收集");
    expect(syncText("zh", snapAt("2026-10-02 14:20", []))).toBe("还没有收集记录");
  });
});

describe("Tip", () => {
  it("one persistent tooltip in body; shown at the pointer, flipped near the right edge", () => {
    const { rerender } = render(<Tip tip={null} />);
    const el = document.body.querySelector(".tip.lg2") as HTMLElement;
    expect(el.getAttribute("role")).toBe("tooltip");
    expect(el.classList.contains("on")).toBe(false);
    act(() => rerender(<Tip tip={{ x: 100, y: 100, body: <b>why</b> }} />));
    expect(document.body.querySelectorAll(".tip.lg2")).toHaveLength(1);
    expect(el.classList.contains("on")).toBe(true);
    expect([el.style.left, el.style.top, el.textContent]).toEqual(["118px", "118px", "why"]);
    act(() => rerender(<Tip tip={{ x: window.innerWidth - 20, y: 100, body: "x" }} />));
    expect(el.style.left).toBe(`${window.innerWidth - 20 - 390}px`);
  });
  it("hiding keeps the last position and content so the fade-out does not jump", () => {
    const { rerender } = render(<Tip tip={{ x: 100, y: 100, body: <b>why</b> }} />);
    const el = document.body.querySelector(".tip.lg2") as HTMLElement;
    act(() => rerender(<Tip tip={null} />));
    expect(el.classList.contains("on")).toBe(false);
    expect([el.style.left, el.style.top, el.textContent]).toEqual(["118px", "118px", "why"]);
    expect(el.getAttribute("aria-hidden")).toBe("true");
  });
});
