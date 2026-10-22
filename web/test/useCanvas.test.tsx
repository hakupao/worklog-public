import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCanvas } from "../src/chart/useCanvas";
import { rec } from "./canvas-rec";

// useCanvas and its ResizeObserver (preflight R1: every hover redraw ran twice — the observer reports the box once
// on observe, and that report redrew the canvas just drawn).

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function Cv({ n, draw }: { n: number; draw: () => void }) {
  const ref = useCanvas(() => draw(), [n]);
  return <canvas ref={ref} />;
}

describe("useCanvas", () => {
  it("draws once per change: the observer's report of the same size does not redraw; a new size does", () => {
    let w = 300;
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: w, height: 100, left: 0, top: 0, right: w, bottom: 100, x: 0, y: 0 }) as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => rec().ctx as never);
    const obs: (() => void)[] = [];
    vi.stubGlobal("ResizeObserver", class {
      cb: () => void;
      constructor(cb: () => void) { this.cb = cb; obs.push(cb); }
      observe() { this.cb(); }                                         // as a browser does: one report on observe
      disconnect() {}
    });
    const draw = vi.fn();
    const v = render(<Cv n={1} draw={draw} />);
    expect(draw).toHaveBeenCalledTimes(1);
    v.rerender(<Cv n={2} draw={draw} />);
    expect(draw).toHaveBeenCalledTimes(2);
    obs.at(-1)!();                                                     // a report, same box
    expect(draw).toHaveBeenCalledTimes(2);
    w = 320;
    obs.at(-1)!();                                                     // resized
    expect(draw).toHaveBeenCalledTimes(3);
  });
});
