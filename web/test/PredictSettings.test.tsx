import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { move, PredictSettings, reweigh, rulesByWeight } from "../src/pages/settings/PredictSettings";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { RULE_IDS, type Prefs } from "../src/prefs/types";
import { V2Context } from "../src/ui/context";

function renderIt(prefs: Prefs = DEFAULT_PREFS) {
  let cur = prefs;
  const setPrefs = vi.fn((u: (p: Prefs) => Prefs) => { cur = u(cur); });
  render(<V2Context.Provider value={{ prefs, lang: "zh", setPrefs, resetPrefs: () => {}, setLang: () => {} }}><PredictSettings /></V2Context.Provider>);
  return { setPrefs, get: () => cur.predict };
}
const row = (id: string) => document.querySelector<HTMLElement>(`li.prule[data-rule="${id}"]`)!;
const mode = (id: string) => document.querySelector<HTMLElement>(`.pmode[data-mode="${id}"]`)!;

describe("helpers", () => {
  it("rulesByWeight / move / reweigh", () => {
    expect(rulesByWeight(DEFAULT_PREFS.predict.rules)).toEqual(RULE_IDS);
    expect(move(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    const w = reweigh(DEFAULT_PREFS.predict.rules, move(RULE_IDS, 0, 1));
    expect([w["unlinked.stale"].weight, w["unlinked.yesterday"].weight, w["nextweek.empty"].weight]).toEqual([100, 90, 10]);
  });
});

describe("PredictSettings", () => {
  it("lists the rules by weight and writes the running threshold", () => {
    const s = renderIt();
    expect([...document.querySelectorAll<HTMLElement>("li.prule")].map((r) => r.dataset.rule)).toEqual(RULE_IDS);
    fireEvent.click(screen.getByRole("button", { name: "15 分钟" }));
    expect(s.get().runningMin).toBe(15);
  });
  it("a rule can be turned off and moved to another mode", () => {
    const s = renderIt();
    fireEvent.click(within(row("plan.stale")).getByRole("checkbox"));
    expect(s.get().rules["plan.stale"].on).toBe(false);
    fireEvent.change(within(row("task.waiting")).getByRole("combobox", { name: "模式" }), { target: { value: "all" } });
    expect(s.get().rules["task.waiting"].mode).toBe("all");
  });
  it("↓ moves a rule down and the weights follow the new order; the first row cannot go up", () => {
    const s = renderIt();
    expect(within(row("unlinked.yesterday")).getByRole("button", { name: "上移" })).toBeDisabled();
    fireEvent.click(within(row("unlinked.yesterday")).getByRole("button", { name: "下移" }));
    expect(rulesByWeight(s.get().rules).slice(0, 2)).toEqual(["unlinked.stale", "unlinked.yesterday"]);
    expect([s.get().rules["unlinked.stale"].weight, s.get().rules["unlinked.yesterday"].weight]).toEqual([100, 90]);
  });
  it("dragging a row onto another moves it there", () => {
    const s = renderIt();
    fireEvent.dragStart(row("unlinked.yesterday"), { dataTransfer: { setData: () => {} } });
    fireEvent.dragOver(row("week.unlinked"));
    fireEvent.drop(row("week.unlinked"));
    expect(rulesByWeight(s.get().rules).slice(0, 3)).toEqual(["unlinked.stale", "week.unlinked", "unlinked.yesterday"]);
  });
  it("numeric params commit on blur and roll back when out of range", () => {
    const s = renderIt();
    const input = within(row("unlinked.yesterday")).getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);
    expect(s.get().rules["unlinked.yesterday"].params.minMinutes).toBe(15);
    s.setPrefs.mockClear();
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.blur(input);
    expect(s.setPrefs).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("5");
  });
  it("unlinked.stale shows both params with their labels (Task 15b) and commits minMinutes", () => {
    const s = renderIt();
    const [least, ended] = within(row("unlinked.stale")).getAllByRole("spinbutton") as HTMLInputElement[];
    expect([least.value, ended.value]).toEqual(["5", "30"]);
    expect(within(row("unlinked.stale")).getByLabelText("至少（分钟）")).toBe(least);
    expect(within(row("unlinked.stale")).getByLabelText("结束超过（分钟）")).toBe(ended);
    fireEvent.change(least, { target: { value: "10" } });
    fireEvent.blur(least);
    expect(s.get().rules["unlinked.stale"].params).toEqual({ minutes: 30, minMinutes: 10 });
  });
  it("week.unlinked shows its minMinutes with the shared label (final review) and commits it", () => {
    const s = renderIt();
    const input = within(row("week.unlinked")).getByLabelText("至少（分钟）") as HTMLInputElement;
    expect(input.value).toBe("5");
    fireEvent.change(input, { target: { value: "15" } });
    fireEvent.blur(input);
    expect(s.get().rules["week.unlinked"].params).toEqual({ minMinutes: 15 });
  });
  it("keywords split on 、 or commas; an empty list rolls back", () => {
    const s = renderIt();
    const input = within(row("task.waiting")).getByRole("textbox");
    fireEvent.change(input, { target: { value: "待ち、 pending ,確認" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(s.get().rules["task.waiting"].params.keywords).toEqual(["待ち", "pending", "確認"]);
    s.setPrefs.mockClear();
    fireEvent.change(input, { target: { value: " 、 " } });
    fireEvent.blur(input);
    expect(s.setPrefs).not.toHaveBeenCalled();
  });
  it("mode windows and weekdays", () => {
    const s = renderIt();
    fireEvent.change(within(mode("morning")).getByLabelText("早上 开始"), { target: { value: "07:00" } });
    expect(s.get().modes.morning.from).toBe("07:00");
    fireEvent.click(within(mode("focus")).getByRole("button", { name: "六" }));
    expect(s.get().modes.focus.days).toEqual([1, 2, 3, 4, 5, 6]);
    s.setPrefs.mockClear();
    fireEvent.change(within(mode("wrap")).getByLabelText("收工 结束"), { target: { value: "" } });
    expect(s.setPrefs).not.toHaveBeenCalled();
  });
  it("restore defaults resets only the prediction rules", () => {
    const changed: Prefs = { ...DEFAULT_PREFS, lang: "ja", predict: { ...DEFAULT_PREFS.predict, runningMin: 30 } };
    let cur = changed;
    const setPrefs = vi.fn((u: (p: Prefs) => Prefs) => { cur = u(cur); });
    render(<V2Context.Provider value={{ prefs: changed, lang: "zh", setPrefs, resetPrefs: () => {}, setLang: () => {} }}><PredictSettings /></V2Context.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认预判规则" }));
    expect(cur.predict).toEqual(DEFAULT_PREFS.predict);
    expect(cur.lang).toBe("ja");
  });
});
