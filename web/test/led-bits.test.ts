import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearBitsCache, bits } from "../src/led/bits";

// A fake rasterizer for the pixel fonts. Each character is the same 5 × 7 design-pixel "E" on the baseline, advance
// 6. Like a real one, it antialiases: the outline does not sit exactly on the device grid, so one device-pixel row
// above every lit design pixel gets partial coverage. `fringe` is that coverage after the platform's gamma: Chrome on
// macOS leaves it near 57 / 255, Chrome on Windows lifts it past the 127 threshold.
const E = ["#####", "#....", "#....", "####.", "#....", "#....", "#####"];
function fakeCtx(fringe: number) {
  let W = 0, H = 0, buf = new Uint8ClampedArray(0), px = 12, design = 12;
  const canvas = {
    get width() { return W; }, set width(v: number) { W = v; buf = new Uint8ClampedArray(W * H); },
    get height() { return H; }, set height(v: number) { H = v; buf = new Uint8ClampedArray(W * H); },
  };
  const k = () => px / design;
  const put = (x: number, y: number, a: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = Math.max(buf[y * W + x], a);
  };
  return {
    canvas,
    textBaseline: "alphabetic",
    fillStyle: "#fff",
    set font(f: string) { px = Number(/(\d+(?:\.\d+)?)px/.exec(f)![1]); design = Number(/"fp(\d+)-/.exec(f)![1]); },
    get font() { return `${px}px "fp${design}-sc"`; },
    measureText: (t: string) => ({ width: Array.from(t).length * 6 * k() }),
    clearRect: () => { buf.fill(0); },
    fillText(t: string, x0: number, bl: number) {
      const s = k(), n = Array.from(t).length;
      for (let c = 0; c < n; c++) for (let r = 0; r < 7; r++) for (let i = 0; i < 5; i++) {
        if (E[r][i] !== "#") continue;
        const left = Math.round(x0 + (c * 6 + i) * s), top = Math.round(bl - (7 - r) * s);
        for (let y = top; y < top + s; y++) for (let x = left; x < left + s; x++) put(x, y, 255);
        for (let x = left; x < left + s; x++) put(x, top - 1, fringe);   // the antialiased edge above
      }
    },
    getImageData(x: number, y: number, w: number, h: number) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const sx = x + i, sy = y + j;
        data[(j * w + i) * 4 + 3] = sx < W && sy < H && sx >= 0 && sy >= 0 ? buf[sy * W + sx] : 0;
      }
      return { data };
    },
  };
}

/** The bitmap as rows of '#' / '.', trailing blank columns kept. */
const rows = (b: { w: number; h: number; on: Uint8Array }) =>
  Array.from({ length: b.h }, (_, y) => Array.from({ length: b.w }, (_, x) => (b.on[y * b.w + x] ? "#" : ".")).join(""));

function useFake(fringe: number) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeCtx(fringe) as unknown as CanvasRenderingContext2D);
}

beforeEach(() => __clearBitsCache());
afterEach(() => { __clearBitsCache(); vi.restoreAllMocks(); });

describe("bits — one lit LED per design pixel, whatever the platform's antialiasing", () => {
  // ASC 12 → 10: the 7-row glyph fills rows 3..9 of the 12-row em box
  const want12 = ["......", "......", "......", "#####.", "#.....", "#.....", "####..", "#.....", "#.....", "#####.", "......", "......"];

  it("a faint edge (macOS-like) is ignored", () => {
    useFake(57);
    expect(rows(bits("E", 12, "zh"))).toEqual(want12);
  });

  it("a strong edge (Windows-like) does not double the rows", () => {
    useFake(160);
    expect(rows(bits("E", 12, "zh"))).toEqual(want12);
  });

  it("every size keeps its native grid: 8 and 10 px, two characters", () => {
    useFake(160);
    const b10 = bits("EE", 10, "zh");
    expect([b10.w, b10.h]).toEqual([12, 10]);
    expect(rows(b10)[1]).toBe("#####.#####.");   // ASC 10 → 8: top stroke on row 1
    expect(rows(b10)[0]).toBe("............");
    const b8 = bits("E", 8, "ja");
    expect([b8.w, b8.h]).toEqual([6, 8]);
    // ASC 8 → 6: the fake 7-row glyph loses its top row to the em box's crop (the same crop as before); the rest, one
    // row per stroke
    expect(rows(b8)).toEqual(["#.....", "#.....", "####..", "#.....", "#.....", "#####.", "......", "......"]);
  });
});

describe("bits — a fallback-face bitmap is never cached (glyph cache race, final review C1)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("draws but does not cache before the cut loads; caches once it has", async () => {
    let resolve!: () => void;
    const face = { load: () => new Promise<typeof face>((r) => { resolve = () => r(face); }) };
    vi.stubGlobal("FontFace", vi.fn(function FakeFace() { return face; }));
    const added: unknown[] = [];
    Object.defineProperty(document, "fonts", { configurable: true, value: { add: (f: unknown) => added.push(f) } });
    try {
      vi.resetModules();
      const { bits: b, __clearBitsCache: clear } = await import("../src/led/bits");
      const { loadPixelFont, pixelFontReady } = await import("../src/led/fonts");
      clear();
      const ctx = fakeCtx(57), fill = vi.spyOn(ctx, "fillText");
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);

      const p = loadPixelFont(12, "zh");
      expect(pixelFontReady(12, "zh")).toBe(false);
      expect(rows(b("E", 12, "zh"))).toEqual(rows(b("E", 12, "zh")));   // still drawn every time …
      expect(fill).toHaveBeenCalledTimes(2);                              // … and rasterised again, not cached

      resolve();
      await p;
      expect(added).toEqual([face]);
      expect(pixelFontReady(12, "zh")).toBe(true);
      expect(pixelFontReady(12, "ja")).toBe(false);                       // per cut, not per family set
      b("E", 12, "zh"); b("E", 12, "zh");
      expect(fill).toHaveBeenCalledTimes(3);                              // cached after the first real-cut draw
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it("without a FontFace API (jsdom) the cache works as before", () => {
    const ctx = fakeCtx(57), fill = vi.spyOn(ctx, "fillText");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    bits("E", 12, "zh"); bits("E", 12, "zh");
    expect(fill).toHaveBeenCalledTimes(1);
  });
});
