import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../src/led/board";
import { slots } from "../src/led/registry";
import { Led } from "../src/ui/Led";
import { LINE_PALETTE, lineColor } from "../src/ui/palette";
import { V2TestProvider } from "./helpers";

const flush = () => new Promise((r) => setTimeout(r, 0));
// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("<Led> in jsdom", () => {
  it("re-measures the canvas before its first text (sub5: a parent that never resizes after mount kept the creation width)", async () => {
    vi.stubGlobal("ResizeObserver", undefined);                      // no relayout path: only the first-text resize can measure
    const sizes = vi.spyOn(Board.prototype, "resize");
    render(<V2TestProvider><Led text="上次对账" ui clip className="fill" /></V2TestProvider>);
    expect(sizes).toHaveBeenCalledTimes(1);                         // the constructor
    await flush();
    expect(sizes).toHaveBeenCalledTimes(2);                         // once more, before the first text
  });

  it("renders an aria-hidden canvas and an ink twin with the text and its language", async () => {
    const { container } = render(<V2TestProvider><Led text="作業記録" tier={1} /></V2TestProvider>);
    await flush();
    const cv = container.querySelector("canvas")!;
    expect(cv.getAttribute("aria-hidden")).toBe("true");
    expect(cv.dataset.tier).toBe("1");
    const ink = cv.nextElementSibling as HTMLElement;
    expect(ink.className).toContain("ink t1 s10");
    expect(ink.textContent).toBe("作業記録");
    expect(ink.querySelector("span")!.getAttribute("lang")).toBe("zh-CN");  // data text follows the display language (S1)
  });

  it("data text redraws in the new language's glyphs even when the text itself does not change", async () => {
    const { container, rerender } = render(<V2TestProvider lang="ja"><Led text="0:08" /></V2TestProvider>);
    await flush();
    expect(container.querySelector(".ink span")!.getAttribute("lang")).toBe("ja");
    const set = vi.spyOn(slots()[0].board, "set");
    rerender(<V2TestProvider lang="en"><Led text="0:08" /></V2TestProvider>);
    await flush();
    expect(container.querySelector(".ink span")!.getAttribute("lang")).toBe("en");
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject({ glyph: "zh" });
  });

  it("ui text takes the interface language", async () => {
    const { container } = render(<V2TestProvider lang="zh"><Led text="此刻" ui size={12} tier={2} /></V2TestProvider>);
    await flush();
    expect(container.querySelector(".ink span")!.getAttribute("lang")).toBe("zh-CN");
    expect(container.querySelector(".ink")!.className).toContain("t2 s12");
  });

  it("maps segment kinds to ink classes", async () => {
    const { container } = render(<V2TestProvider><Led text={[
      { t: "運行中 " }, { t: "0:08", kind: "live" }, { t: " 未関連", kind: "alert" }, { t: " ·", kind: "dim" }, { t: "WL", kind: "code", color: "#9be05a" },
    ]} /></V2TestProvider>);
    await flush();
    const spans = [...container.querySelectorAll(".ink > span")];
    expect(spans.map((s) => s.className)).toEqual(["", "i-g", "i-r", "i-dim", "i-code"]);
    expect((spans[4] as HTMLElement).style.getPropertyValue("--lc")).toBe("#9be05a");
  });

  it("escapes markup in the text", async () => {
    const { container } = render(<V2TestProvider><Led text="<b>x</b>" /></V2TestProvider>);
    await flush();
    expect(container.querySelector(".ink b")).toBeNull();
    expect(container.querySelector(".ink")!.textContent).toBe("<b>x</b>");
  });

  it("a colour-only change redraws the board in the new colour without animating", async () => {
    const { rerender } = render(<V2TestProvider><Led text="色" color="#ffad3a" /></V2TestProvider>);
    await flush();
    const set = vi.spyOn(slots()[0].board, "set");
    rerender(<V2TestProvider><Led text="色" color="#7dff9e" /></V2TestProvider>);
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject({ animate: false, color: "#7dff9e" });
  });

  it("drops a code colour that is not a hex literal", async () => {
    const { container } = render(<V2TestProvider><Led text={[{ t: "a", kind: "code", color: 'red;"x:y' }, { t: "b", kind: "code", color: "#abc" }]} /></V2TestProvider>);
    await flush();
    const [a, b] = [...container.querySelectorAll(".ink > span")] as HTMLElement[];
    expect(a.getAttribute("style")).toBeNull();
    expect(b.style.getPropertyValue("--lc")).toBe("#abc");
  });

  it("marks the canvas and twin with the task for linked focus", async () => {
    const { container } = render(<V2TestProvider><Led text="WL" task="T20260918-02" /></V2TestProvider>);
    await flush();
    expect(container.querySelector("canvas")!.dataset.task).toBe("T20260918-02");
    expect((container.querySelector(".ink") as HTMLElement).dataset.task).toBe("T20260918-02");
  });

  it("registers while mounted and unregisters on unmount", async () => {
    const { unmount } = render(<V2TestProvider><Led text="一" /><Led text="二" /></V2TestProvider>);
    await flush();
    expect(slots()).toHaveLength(2);
    unmount();
    expect(slots()).toHaveLength(0);
  });

  it("unmount unregisters the slot and disposes the board", async () => {
    const dispose = vi.spyOn(Board.prototype, "dispose");
    const { unmount } = render(<V2TestProvider><Led text="一" /></V2TestProvider>);
    await flush();
    expect(slots()).toHaveLength(1);
    unmount();
    expect(slots()).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("still: a later text change redraws without animating", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const { rerender } = render(<V2TestProvider><Led text="09:41:08" still /></V2TestProvider>);
    await flush();
    rerender(<V2TestProvider><Led text="09:41:09" still /></V2TestProvider>);
    await flush();
    expect(slots()[0].board.t).toBe(1);
    expect(document.querySelector(".ink")!.textContent).toBe("09:41:09");
  });

  it("rebuilding the board for a new tier draws on the new board", async () => {
    const { container, rerender } = render(<V2TestProvider><Led text="甲" tier={1} /></V2TestProvider>);
    await flush();
    rerender(<V2TestProvider><Led text="甲" tier={2} /></V2TestProvider>);
    await flush();
    expect(slots()).toHaveLength(1);
    expect(slots()[0].board.cur).not.toBeNull();
    expect(container.querySelector("canvas")!.dataset.tier).toBe("2");
  });

  it("mounts at zero size without errors", async () => {
    const { container } = render(<V2TestProvider><div style={{ display: "none" }}><Led text="隠" clip /></div></V2TestProvider>);
    await flush();
    expect(container.querySelector(".ink")!.textContent).toBe("隠");
  });
});

describe("lineColor", () => {
  it("is deterministic, from the palette, grey for no task", () => {
    expect(lineColor("T20260918-02")).toBe(lineColor("T20260918-02"));
    expect(LINE_PALETTE).toContain(lineColor("T20261001-01"));
    expect(lineColor(null)).toBe("#9aa0a8");
  });
});
