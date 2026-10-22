import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PITCH } from "../src/led/lattice";
import { NextRows } from "../src/pages/now/NextRows";
import { PlanRows } from "../src/pages/now/PlanRows";
import { RunChart } from "../src/pages/now/RunChart";
import { geometry, layoutChart } from "../src/pages/now/chart";
import { rec } from "./canvas-rec";
import { vi } from "vitest";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { predict } from "../src/predict/predict";
import { scenarioInput } from "../src/predict/scenarios";
import { buildSnapshot } from "../src/predict/snapshot";
import { TipHost, useTip } from "../src/ui/TipHost";
import { V2TestProvider } from "./helpers";

const tip = () => document.body.querySelector(".tip")!;
function Hot({ name }: { name: string }) {
  const set = useTip();
  return <div data-testid={name} onPointerMove={() => set({ x: 1, y: 1, body: name })} onPointerLeave={() => set(null)} />;
}

describe("TipHost", () => {
  it("a caller that unmounts while its tip is up takes the tip with it", () => {
    const { getByTestId, rerender } = render(<TipHost><Hot key="a" name="a" /></TipHost>);
    fireEvent.pointerMove(getByTestId("a"));
    expect(tip().classList.contains("on")).toBe(true);
    rerender(<TipHost><Hot key="b" name="b" /></TipHost>);   // a different row now sits under the still mouse
    expect(tip().classList.contains("on")).toBe(false);
  });
  it("clearing only clears what that caller put up", () => {
    const { getByTestId } = render(<TipHost><Hot name="a" /><Hot name="b" /></TipHost>);
    fireEvent.pointerMove(getByTestId("b"));
    fireEvent.pointerLeave(getByTestId("a"));             // a late leave from a neighbour
    expect(tip().classList.contains("on")).toBe(true);
    expect(tip().textContent).toBe("b");
  });
  it("此刻: a 下一步 row replaced by a refetch under a still mouse no longer leaves its tip behind", () => {
    const snap = buildSnapshot(scenarioInput("morning"), 10), pred = predict(snap, DEFAULT_PREFS.predict);
    const view = (p: typeof pred) => <V2TestProvider><TipHost><NextRows pred={p} /></TipHost></V2TestProvider>;
    const { container, rerender } = render(view(pred));
    fireEvent.pointerMove(container.querySelector('.row.next[data-rule="task.waiting"]')!, { clientX: 50, clientY: 50 });
    expect(tip().classList.contains("on")).toBe(true);
    rerender(view({ ...pred, suggestions: pred.suggestions.filter((s) => s.rule !== "task.waiting") }));
    expect(tip().classList.contains("on")).toBe(false);
  });
  it("此刻: the same 今日安排 row with new numbers after a refetch drops the tip that showed the old ones", () => {
    const snap = buildSnapshot(scenarioInput("day"), 10);
    const view = (sn: typeof snap) => <V2TestProvider><TipHost><PlanRows snap={sn} /></TipHost></V2TestProvider>;
    const { container, rerender } = render(view(snap));
    fireEvent.pointerMove(container.querySelector(".row.prow[data-status]")!, { clientX: 40, clientY: 40 });
    expect(tip().classList.contains("on")).toBe(true);
    rerender(view({ ...snap }));                                         // same data, a new object: the tip stays
    expect(tip().classList.contains("on")).toBe(true);
    const dp = snap.dayPlan!;
    rerender(view({ ...snap, dayPlan: { ...dp, items: [{ ...dp.items[0], ai_progress: "進捗あり" }, ...dp.items.slice(1)] } }));
    expect(tip().classList.contains("on")).toBe(false);
  });
  it("此刻: the run chart drops its tip when its data changes under a still mouse", () => {
    const { ctx } = rec();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      return this.classList.contains("dia-cv") ? ctx : null;
    } as never);
    const snap = buildSnapshot(scenarioInput("day"), 10), L = layoutChart(snap), g = geometry(L, 0, 0, PITCH);   // jsdom boxes are 0×0, as RunChart sees them
    const view = (sn: typeof snap) => <V2TestProvider><TipHost><RunChart snap={sn} /></TipHost></V2TestProvider>;
    const { container, rerender } = render(view(snap));
    fireEvent.pointerMove(container.querySelector("canvas.dia-cv")!, { clientX: g.dotX(60 / g.minPerDot), clientY: g.rowY(0, 0) });
    expect(tip().classList.contains("on")).toBe(true);
    const i = scenarioInput("day");
    rerender(view(buildSnapshot({ ...i, now: i.now + 60_000 }, 10)));     // the minute tick: same sessions
    expect(tip().classList.contains("on")).toBe(true);
    rerender(view(buildSnapshot(scenarioInput("weekly"), 10)));
    expect(tip().classList.contains("on")).toBe(false);
  });
  it("此刻: a 下一步 tip survives the minute tick (only its numbers changed) and leaves when the suggestion changes", () => {
    const snap = buildSnapshot(scenarioInput("day"), 10), pred = predict(snap, DEFAULT_PREFS.predict);
    const view = (p: typeof pred) => <V2TestProvider><TipHost><NextRows pred={p} /></TipHost></V2TestProvider>;
    const { container, rerender } = render(view(pred));
    const row = () => container.querySelector('.row.next[data-rule="unlinked.stale"]')!;
    fireEvent.pointerMove(row(), { clientX: 50, clientY: 50 });
    const bump = (f: (x: (typeof pred.suggestions)[number]) => (typeof pred.suggestions)[number]) =>
      ({ ...pred, suggestions: pred.suggestions.map((x) => (x.rule === "unlinked.stale" ? f(x) : x)) });
    rerender(view(bump((x) => ({ ...x, vars: { ...x.vars, m: 44 } }))));
    expect(tip().classList.contains("on")).toBe(true);
    rerender(view(bump((x) => ({ ...x, subject: "別の案件" }))));
    expect(tip().classList.contains("on")).toBe(false);
  });
});

