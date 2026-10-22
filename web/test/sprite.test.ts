import { afterEach, describe, expect, it, vi } from "vitest";
import { sprite } from "../src/led/sprite";

// The lit-LED sprite cache (preflight P1: the relief's glow follows its smoothed height, a fresh number for nearly
// every dot, so each redraw of a turned relief made thousands of new sprite canvases).

afterEach(() => { vi.restoreAllMocks(); });

describe("sprite", () => {
  it("the glow is kept to steps of .05: nearby glows share one sprite, a step apart do not", () => {
    const made = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      made();
      return { scale() {}, createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} } as never;
    });
    const a = sprite("#123456", 1.2, 0.5123), b = sprite("#123456", 1.2, 0.5071), c = sprite("#123456", 1.2, 0.55);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(made).toHaveBeenCalledTimes(2);
    expect(sprite("#123456", 1.2, 0.6)).toBe(sprite("#123456", 1.2, 0.6000000001));
  });
});
