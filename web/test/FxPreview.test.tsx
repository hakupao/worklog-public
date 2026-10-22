import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../src/led/board";
import { FxPreview } from "../src/pages/settings/FxPreview";
import { V2TestProvider } from "./helpers";

let release = () => {};
vi.mock("../src/led/fonts", async (orig) => ({
  ...(await orig<typeof import("../src/led/fonts")>()),
  loadPixelFont: () => new Promise<void>((r) => { const prev = release; release = () => { prev(); r(); }; }),
}));

// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); release = () => {}; });

describe("<FxPreview>", () => {
  it("a pixel font that arrives after unmount draws nothing on the disposed board", async () => {
    const { unmount } = render(<V2TestProvider><FxPreview trigger="data" fx="roll" /></V2TestProvider>);
    const set = vi.spyOn(Board.prototype, "set"); set.mockClear();
    unmount();
    release(); await new Promise((r) => setTimeout(r, 0));
    expect(set).not.toHaveBeenCalled();
  });
  it("draws its first sample once the font is in", async () => {
    render(<V2TestProvider><FxPreview trigger="data" fx="roll" /></V2TestProvider>);
    const set = vi.spyOn(Board.prototype, "set"); set.mockClear();
    release(); await new Promise((r) => setTimeout(r, 0));
    expect(set).toHaveBeenCalledWith([{ t: "作業記録・週報システム開発", glyph: "ja" }], { animate: false });
  });
});
