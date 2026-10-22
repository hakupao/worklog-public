import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clipSegs, compose, segsWidth, wrapSegs, type BitsFn, type Seg } from "../src/led/compose";
import { motion, reducedMotion, setMotion, __resetMotionForTests } from "../src/led/motion";
import { bits } from "../src/led/bits";
import { loadPixelFont, pixelFamily } from "../src/led/fonts";

// A fake rasterizer: every character is 2 columns wide; column 0 lit on every row, column 1 dark.
const fake: BitsFn = (text, size) => {
  const w = Array.from(text).length * 2, on = new Uint8Array(w * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < w; x += 2) on[y * w + x] = 1;
  return { w, h: size, on };
};

// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { __resetMotionForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("compose", () => {
  it("lays segments side by side with their own colours and records which character each column is", () => {
    const c = compose([{ t: "ab" }, { t: "c", color: "#ff0000" }], 8, "zh", "#ffad3a", fake);
    expect(c.w).toBe(6);
    expect(c.h).toBe(8);
    expect(c.col[0]).toBe("#ffad3a");
    expect(c.col[1]).toBeNull();
    expect(c.col[4]).toBe("#ff0000");
    expect(Array.from(c.kc)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(c.nk).toBe(3);
  });
  it("is empty for no text", () => {
    const c = compose([], 10, "ja", "#fff", fake);
    expect([c.w, c.nk, c.col.length]).toEqual([0, 0, 0]);
  });
});

describe("clipSegs", () => {
  const widthOf = (s: Seg[]) => segsWidth(s, 8, "zh", fake);
  it("returns the segments untouched when they fit", () => {
    const s = [{ t: "abc" }];
    expect(clipSegs(s, 6, widthOf, "#9c6f33")).toEqual(s);
  });
  it("drops characters from the end and appends a dim ellipsis", () => {
    expect(clipSegs([{ t: "ab" }, { t: "cdef", color: "#f00" }], 8, widthOf, "#9c6f33"))
      .toEqual([{ t: "ab" }, { t: "c", color: "#f00" }, { t: "…", color: "#9c6f33", glyph: undefined }]);
  });
  it("drops a whole segment that empties out", () => {
    expect(clipSegs([{ t: "abc" }, { t: "de" }], 6, widthOf, "#999").map((s) => s.t)).toEqual(["ab", "…"]);
  });
  it("copes with no room at all", () => {
    expect(clipSegs([{ t: "abc" }], 0, widthOf, "#999").map((s) => s.t)).toEqual(["…"]);
  });
});

describe("motion", () => {
  it("setMotion copies the prefs' effects and speed", () => {
    setMotion({ fx: { load: "scan", lang: "flap", data: "none" }, ofx: { load: "fade", lang: "roll", data: "slide" }, speed: 0.5 });
    expect(motion.fx.load).toBe("scan");
    expect(motion.ofx.data).toBe("slide");
    expect(motion.speed).toBe(0.5);
  });
  it("reducedMotion is read live and is false without matchMedia", () => {
    expect(reducedMotion()).toBe(false);
    let reduce = true;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce") }));
    expect(reducedMotion()).toBe(true);
    reduce = false;
    expect(reducedMotion()).toBe(false);
  });
});

describe("fonts and bits without a canvas (jsdom)", () => {
  it("names families and resolves loading without FontFace", async () => {
    expect(pixelFamily(10, "ja")).toBe("fp10-jp");
    expect(pixelFamily(12, "zh")).toBe("fp12-sc");
    await expect(loadPixelFont(10, "ja")).resolves.toBeUndefined();
  });
  it("bits degrades to an empty bitmap", () => {
    expect(bits("漢字", 10, "ja")).toEqual({ w: 0, h: 10, on: new Uint8Array(0) });
  });
});

describe("wrapSegs", () => {
  const w = (segs: { t: string }[]) => segs.reduce((n, s) => n + Array.from(s.t).length, 0);   // 1 column per char
  const lines = (segs: { t: string }[][]) => segs.map((l) => l.map((s) => s.t).join(""));

  it("breaks CJK anywhere and keeps Latin words whole", () => {
    expect(lines(wrapSegs([{ t: "受注管理サービス" }], 4, w))).toEqual(["受注管理", "サービス"]);
    expect(lines(wrapSegs([{ t: "ATLAS data conversion" }], 11, w))).toEqual(["ATLAS data", "conversion"]);
  });
  it("a word's trailing space does not count against the line it ends", () => {
    expect(lines(wrapSegs([{ t: "ATLAS data conv" }], 10, w))).toEqual(["ATLAS data", "conv"]);
  });
  it("hard-breaks a word longer than the line (review focus 4: a long word / a path without spaces)", () => {
    expect(lines(wrapSegs([{ t: "abcdefghij" }], 4, w))).toEqual(["abcd", "efgh", "ij"]);
    const path = "projects/2026/基幹/帳票/report-layout-v3.xlsx";
    const out = lines(wrapSegs([{ t: path }], 7, w));
    expect(out.every((l) => Array.from(l).length <= 7)).toBe(true);
    expect(out.join("")).toBe(path);
  });
  it("honours \\n, keeps segment boundaries and their props, drops leading spaces", () => {
    const out = wrapSegs([{ t: "田中先生、", color: "#fff" }, { t: "Alex Wang\n社内" }], 6, w);
    expect(lines(out)).toEqual(["田中先生、", "Alex", "Wang", "社内"]);
    expect(out[0][0]).toMatchObject({ color: "#fff" });
    expect(out[0][0]).not.toHaveProperty("_src");
  });
  it("fits in one line when it fits; empty input is one empty line", () => {
    expect(lines(wrapSegs([{ t: "短い" }], 10, w))).toEqual(["短い"]);
    expect(lines(wrapSegs([{ t: "受注管理" }], 4, w))).toEqual(["受注管理"]);            // exactly one line wide
    expect(lines(wrapSegs([{ t: "" }], 10, w))).toEqual([""]);
  });
});
