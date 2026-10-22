import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatsViewsSettings } from "../src/pages/settings/StatsViewsSettings";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { STATS_VIEWS, type Prefs } from "../src/prefs/types";
import { V2Context } from "../src/ui/context";

function renderIt(prefs: Prefs = DEFAULT_PREFS, lang: Prefs["lang"] = "zh") {
  let cur = prefs;
  const setPrefs = vi.fn((u: (p: Prefs) => Prefs) => { cur = u(cur); });
  render(<V2Context.Provider value={{ prefs, lang, setPrefs, resetPrefs: () => {}, setLang: () => {} }}><StatsViewsSettings /></V2Context.Provider>);
  return { setPrefs, get: () => cur };
}
const rows = () => [...document.querySelectorAll<HTMLElement>("li.sview")];
const row = (id: string) => document.querySelector<HTMLElement>(`li.sview[data-view="${id}"]`)!;

describe("StatsViewsSettings", () => {
  it("lists every view in the default order with its name and description, all checked", () => {
    renderIt();
    expect(screen.getByRole("heading", { name: "统计页视图" })).toBeInTheDocument();
    expect(rows().map((r) => r.dataset.view)).toEqual(STATS_VIEWS);
    expect(within(row("headlines")).getByText("洞察头条")).toBeInTheDocument();
    expect(within(row("waterfall")).getByRole("checkbox")).toBeChecked();
  });
  it("follows the stored order (missing ids appended) and shows off views unchecked", () => {
    renderIt({ ...DEFAULT_PREFS, stats: { order: ["dial", "gone", "headlines"], off: ["headlines"] } });
    expect(rows().map((r) => r.dataset.view).slice(0, 3)).toEqual(["dial", "headlines", "waterfall"]);
    expect(rows()).toHaveLength(24);
    expect(within(row("headlines")).getByRole("checkbox")).not.toBeChecked();
    expect(row("headlines").classList.contains("off")).toBe(true);
  });
  it("unchecking writes off, rechecking removes it; order is untouched", () => {
    const s = renderIt();
    fireEvent.click(within(row("terrain")).getByRole("checkbox"));
    expect(s.get().stats).toEqual({ order: DEFAULT_PREFS.stats.order, off: ["terrain"] });
    const s2 = renderIt({ ...DEFAULT_PREFS, stats: { order: [...STATS_VIEWS], off: ["terrain", "dial"] } });
    fireEvent.click(within(document.querySelectorAll<HTMLElement>('li.sview[data-view="terrain"]')[1]).getByRole("checkbox"));
    expect(s2.get().stats.off).toEqual(["dial"]);
  });
  it("↑ ↓ move a view and write the whole resolved order; first / last rows are disabled at the ends", () => {
    const s = renderIt({ ...DEFAULT_PREFS, stats: { order: ["dial"], off: [] } });
    expect(within(row("dial")).getByRole("button", { name: "上移" })).toBeDisabled();
    expect(within(row("review")).getByRole("button", { name: "下移" })).toBeDisabled();
    fireEvent.click(within(row("dial")).getByRole("button", { name: "下移" }));
    expect(s.get().stats.order).toEqual(["headlines", "dial", ...STATS_VIEWS.filter((id) => id !== "headlines" && id !== "dial")]);
  });
  it("dragging a row onto another moves it there", () => {
    const s = renderIt();
    fireEvent.dragStart(row("headlines"), { dataTransfer: { setData: () => {} } });
    fireEvent.dragOver(row("dial"));
    fireEvent.drop(row("dial"));
    expect(s.get().stats.order.slice(0, 4)).toEqual(["waterfall", "river", "dial", "headlines"]);
  });
  it("views a front-world module hides carry a note naming that module", () => {
    renderIt();
    expect(within(row("compute")).getByText("表世界随「统计 · AI 费用」隐藏")).toBeInTheDocument();
    expect(within(row("ai")).getByText("表世界随「统计 · AI 费用」隐藏")).toBeInTheDocument();
    expect(within(row("review")).getByText("表世界随「统计 · 周复盘」隐藏")).toBeInTheDocument();
    expect(row("dial").querySelector(".need")).toBeNull();
  });
  it("restore defaults resets only stats", () => {
    const s = renderIt({ ...DEFAULT_PREFS, lang: "ja", stats: { order: ["dial"], off: ["river"] } }, "ja");
    fireEvent.click(screen.getByRole("button", { name: "統計ページのビューを初期設定に戻す" }));
    expect(s.get().stats).toEqual(DEFAULT_PREFS.stats);
    expect(s.get().lang).toBe("ja");
  });
});
