import { readFileSync } from "node:fs";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { glyphFor } from "../src/badge/glyph";
import { resolveBadge } from "../src/badge/cache";
import { objectPath } from "../src/badge/objects";
import { dotsOf, drawGlyph, glyphDataUrl, loadTaskGlyph, useTaskGlyph } from "../src/ui/taskGlyph";
import { mix } from "../src/ui/palette";
import { rec } from "./canvas-rec";

describe("tier-2 glyph", () => {
  it("uses the same object and colour as the badge", () => {
    const spec = { id: "T20261001-01" };
    const g = glyphFor(spec), r = resolveBadge(spec);
    expect(g.color).toBe(r.color);
    expect(g.d).toBe(objectPath(r.obj));
    expect(g.box).toBe(256);
  });
  it("unknown stored object falls back like resolveBadge", () => {
    const spec = { id: "T20261001-02", obj: "phosphor:not-a-real-object" };
    const g = glyphFor(spec);
    expect(g.d).toBe(objectPath(resolveBadge(spec).obj));
    expect(g.d.length).toBeGreaterThan(10);
  });
  it("loadTaskGlyph resolves to a function keyed by task id", async () => {
    const f = await loadTaskGlyph();
    expect(f("T20261001-01").d).toBe(glyphFor({ id: "T20261001-01" }).d);
    expect(await loadTaskGlyph()).toBe(f);            // memoised
  });
  it("glyphDataUrl is an svg data url filled with the colour", () => {
    const url = glyphDataUrl({ d: "M0 0L256 0L256 256Z", rule: "evenodd", color: "#ff0000", box: 256 }, 16);
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(url.slice("data:image/svg+xml,".length));
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('width="16"');
  });
  it("taskGlyph.ts has no static runtime import of badge/ (only import type + dynamic import)", () => {
    const src = readFileSync("src/ui/taskGlyph.ts", "utf8");
    expect(src).not.toMatch(/^(import|export)\b(?!\s+type\b)(?:[^;"']*?\bfrom\s*|\s*)["']\.\.\/badge\//m);
    expect(src).toContain('import("../badge/glyph")');
  });
});

describe("B3b glyph helpers", () => {
  it("mix moves toward the target", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#102030", "#102030", 0.7)).toBe("#102030");
  });
  it("dotsOf: a cell is on when its mean alpha is over half", () => {
    const side = 8, a = new Uint8ClampedArray(side * side);           // 2×2 grid of 4×4 cells
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) a[y * side + x] = 255;          // top-left full
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) a[y * side + x] = (x + y) % 2 ? 255 : 0;  // bottom-right half
    expect(dotsOf(a, side, 2)).toEqual([true, false, false, false]);
  });
  it("drawGlyph reuses one Path2D per path", () => {
    const g = { d: "M0 0L256 0L256 256Z", rule: "evenodd" as const, color: "#ff0000", box: 256 as const };
    const r = rec();
    drawGlyph(r.ctx, g, 0, 0, 24); drawGlyph(r.ctx, g, 30, 0, 24);
    const fills = r.calls.filter((c) => c.op === "fill");
    expect(fills).toHaveLength(2);
    expect(fills[0].args[0]).toBe(fills[1].args[0]);
    expect(fills[0].args[1]).toBe("evenodd");
  });
  it("useTaskGlyph: null first, then a TaskSil whose of() matches glyphFor", async () => {
    const { result } = renderHook(() => useTaskGlyph());
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.of("T20261001-01").d).toBe(glyphFor({ id: "T20261001-01" }).d);
    expect(result.current!.dots("T20261001-01", 9)).toBeNull();          // jsdom: no 2D context → null, callers draw the code
  });
});

describe("B3b glyph load failure", () => {
  it("useTaskGlyph stays null and retries on the next mount after a failed load", async () => {
    vi.resetModules();
    let calls = 0;
    vi.doMock("../src/badge/glyph", () => { calls++; throw new Error("chunk"); });
    const { useTaskGlyph: hook } = await import("../src/ui/taskGlyph");
    const a = renderHook(() => hook());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(a.result.current).toBeNull();
    a.unmount();
    const b = renderHook(() => hook());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(b.result.current).toBeNull();
    expect(calls).toBe(2);                                                 // one attempt per mount, no loop
    vi.doUnmock("../src/badge/glyph");
  });
});
