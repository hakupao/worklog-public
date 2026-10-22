import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import type { Prefs } from "../src/prefs/types";
import { toggleWorld } from "../src/world/transitions";
import { V2Context } from "../src/ui/context";

function renderPage(prefs: Prefs = DEFAULT_PREFS) {
  let cur = prefs;
  const setPrefs = vi.fn((u: (p: Prefs) => Prefs) => { cur = u(cur); });
  const resetPrefs = vi.fn(), setLang = vi.fn();
  render(<V2Context.Provider value={{ prefs, lang: prefs.lang, setPrefs, resetPrefs, setLang }}><SettingsPage /></V2Context.Provider>);
  return { setPrefs, resetPrefs, setLang, get: () => cur };
}
// The back- and front-world groups share item names (打开 / 切换页面 …): i picks the occurrence.
const item = (name: string, i = 0) => screen.getAllByText(name)[i].closest(".it") as HTMLElement;

vi.mock("../src/world/transitions", async (orig) => ({ ...(await orig<object>()), toggleWorld: vi.fn(async () => {}) }));
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { window.location.hash = ""; });

describe("SettingsPage", () => {
  it("shows the current choice pressed for each trigger", () => {
    renderPage();
    expect(within(item("打开 / 切换页面")).getByRole("button", { name: "全暗启辉" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(item("速度")).getByRole("button", { name: "1×" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("picking a back-world effect writes fx.<trigger>", () => {
    const s = renderPage();
    fireEvent.click(within(item("切换语言")).getAllByRole("button", { name: "逐字滚动" })[0]);
    expect(s.get().fx.lang).toBe("flap");
    expect(s.get().fx.load).toBe(DEFAULT_PREFS.fx.load);
  });

  it("front-world effects write ofx.<trigger> and offer only that trigger's list", () => {
    const s = renderPage();
    const load = item("打开 / 切换页面", 1);
    expect(within(load).queryByRole("button", { name: "上推替换" })).toBeNull();
    fireEvent.click(within(load).getByRole("button", { name: "打字机" }));
    expect(s.get().ofx.load).toBe("type");
  });

  it("speed, world switch and font", () => {
    const s = renderPage();
    fireEvent.click(within(item("速度")).getByRole("button", { name: "0.5×" }));
    fireEvent.click(within(item("表 ⇄ 里 切换")).getByRole("button", { name: "翻面" }));
    fireEvent.click(within(item("表世界字体")).getByRole("button", { name: /Geist/ }));
    expect([s.get().speed, s.get().worldFx, s.get().omote.font]).toEqual([0.5, "flip", "geist"]);
  });

  it("module checkboxes: checked = shown; unchecking adds the id to hide", () => {
    const s = renderPage();
    const box = within(item("表世界显示的模块"));
    expect((box.getByRole("checkbox", { name: "AI 费用" }) as HTMLInputElement).checked).toBe(false);
    expect((box.getByRole("checkbox", { name: "统计 · AI 费用" }) as HTMLInputElement).checked).toBe(false);
    expect((box.getByRole("checkbox", { name: "统计 · 周复盘" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box.getByRole("checkbox", { name: "运行图" }));
    expect(s.get().omote.hide).toEqual(["now.cost", "stats.cost", "stats.review", "now.dia"]);
  });

  it("language buttons go through setLang", () => {
    const s = renderPage();
    fireEvent.click(within(item("界面语言")).getByRole("button", { name: "日本語" }));
    expect(s.setLang).toHaveBeenCalledWith("ja", expect.any(HTMLButtonElement));
  });

  it("restore defaults", () => {
    const s = renderPage({ ...DEFAULT_PREFS, speed: 0.25 });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));   // the page-level reset; 日历's is 恢复默认日历
    expect(s.resetPrefs).toHaveBeenCalledOnce();
  });

  it("has the 统计页视图 group after the prediction rules (sub-project 7b)", () => {
    renderPage();
    const hs = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(hs.indexOf("统计页视图")).toBe(hs.indexOf("预判规则") + 1);
    expect(document.querySelectorAll("li.sview")).toHaveLength(24);
  });

  it("renders in Japanese", () => {
    renderPage({ ...DEFAULT_PREFS, lang: "ja" });
    expect(screen.getAllByText("言語の切り替え")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "初期設定に戻す" })).toBeTruthy();
  });

  it("picking a language drops ?lang= from the hash before setLang, and never writes the override into prefs", () => {
    window.location.hash = "#/v2/settings?lang=en&world=omote";
    const s = renderPage();
    s.setLang.mockImplementation(() => { expect(window.location.hash).not.toContain("lang="); });
    fireEvent.click(within(item("界面语言")).getByRole("button", { name: "日本語" }));
    expect(s.setLang).toHaveBeenCalledOnce();
    expect(window.location.hash).toContain("world=omote");
    expect(s.setPrefs).not.toHaveBeenCalled();
  });

  it("the try-it button drops ?world= from the hash before toggling", () => {
    window.location.hash = "#/v2/settings?world=omote";
    vi.mocked(toggleWorld).mockImplementationOnce(async () => { expect(window.location.hash).not.toContain("world="); });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "在这一页试一下" }));
    expect(toggleWorld).toHaveBeenCalledOnce();
    expect(window.location.hash).not.toContain("world=");
  });

  it("氏名 saves on blur, trimmed; an empty value puts the saved name back and saves nothing", () => {
    const s = renderPage();
    const input = screen.getByRole("textbox", { name: "姓名" }) as HTMLInputElement;
    expect(input.value).toBe("Taro Yamada");
    fireEvent.change(input, { target: { value: "  山田 太郎 " } });
    fireEvent.blur(input);
    expect(s.get().report).toEqual({ name: "山田 太郎" });
    expect(input.value).toBe("山田 太郎");
    s.setPrefs.mockClear();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(input.value).toBe("Taro Yamada");   // renderPage's prefs prop is static: the "saved" value is the default
    expect(s.setPrefs).not.toHaveBeenCalled();
  });

  it("氏名: Enter commits, but not while an IME is composing (isComposing, or Safari's keyCode 229)", () => {
    const s = renderPage();
    const input = screen.getByRole("textbox", { name: "姓名" }) as HTMLInputElement;
    const enter = (init: object) => {
      input.focus();
      fireEvent.change(input, { target: { value: " 山田 " } });
      fireEvent.keyDown(input, { key: "Enter", ...init });
    };
    enter({ isComposing: true });
    expect(s.setPrefs).not.toHaveBeenCalled();
    input.blur();   // the field is still dirty; clear it so each case starts clean
    s.setPrefs.mockClear();
    enter({ keyCode: 229 });
    expect(s.setPrefs).not.toHaveBeenCalled();
    enter({});
    expect(s.setPrefs).toHaveBeenCalledTimes(1);
    expect(s.get().report).toEqual({ name: "山田" });
  });
});
