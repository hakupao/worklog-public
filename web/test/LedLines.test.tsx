import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../src/led/board";
import { segsWidth, type Seg } from "../src/led/compose";
import { PITCH } from "../src/led/lattice";
import { LedLines } from "../src/ui/LedLines";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";

// jsdom cannot rasterize the pixel font: every character is 2 columns wide (as led-compose.test.ts's fake).
vi.mock("../src/led/bits", () => ({
  bits: (text: string, size: number) => ({ w: Array.from(text).length * 2, h: size, on: new Uint8Array(Array.from(text).length * 2 * size) }),
  __clearBitsCache: () => {},
}));

const W = 21 * PITCH;                                          // canvas px → (W − PITCH) / PITCH = 20 LED columns, as Led's clip reads it
const AVAIL = Math.floor((W - PITCH) / PITCH);
const NAME = "受注管理サービスの帳票改修と移行準備";              // 18 characters = 36 font columns: wider than one line at any scale
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: W, height: 33, left: 0, top: 0, right: W, bottom: 33, x: 0, y: 0, toJSON() {} }) as DOMRect);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); applyWorld("ura"); });

describe("<LedLines>", () => {
  it("里: one board per line, cut at the cell's width; the lines' ink together is the whole text", async () => {
    const { container } = render(<V2TestProvider><LedLines tier={1} text={NAME} className="fill" /></V2TestProvider>);
    await waitFor(() => expect(container.querySelectorAll("canvas[data-tier]").length).toBeGreaterThan(1));
    expect(container.querySelector(".ledlines.fill")).not.toBeNull();
    const inks = [...container.querySelectorAll(".ink")].map((e) => e.textContent);
    expect(inks.join("")).toBe(NAME);
  });

  it("里 at scale 2: every line measures within what a clipped Led shows, so no line is cut with …", async () => {
    const set = vi.spyOn(Board.prototype, "set");
    const { container } = render(<V2TestProvider><LedLines tier={1} scale={2} text={NAME} /></V2TestProvider>);
    await waitFor(() => expect(container.querySelectorAll("canvas[data-tier]").length).toBeGreaterThan(1));
    await flush();
    const lines = [...container.querySelectorAll(".ink")].map((e) => e.textContent ?? "");
    expect(lines.join("")).toBe(NAME);
    // the same conversion as Led's clip: canvas px → (px − PITCH) / PITCH columns, text → segsWidth × scale
    for (const l of lines) expect(segsWidth([{ t: l }], 10, "zh") * 2).toBeLessThanOrEqual(AVAIL);
    // 2 columns per character at scale 2 = 4 LED columns: 5 characters a line
    expect(lines.map((l) => Array.from(l).length)).toEqual([5, 5, 5, 3]);
    // each board's latest draw (the whole text drawn before the first cut is clipped, by design)
    const last = new Map<unknown, string>();
    set.mock.calls.forEach((c, i) => last.set(set.mock.contexts[i], (c[0] as Seg[]).map((s) => s.t).join("")));
    const shown = [...last.entries()].filter(([b]) => !(b as unknown as { disposed: boolean }).disposed).map(([, t]) => t);
    expect(shown.filter((t) => lines.includes(t))).toEqual(lines);
    expect(shown.some((t) => t.includes("…"))).toBe(false);
  });

  it("表: a single Led whose type wraps (iwrap, never the one-line iblk)", async () => {
    applyWorld("omote");
    const { container } = render(<V2TestProvider><LedLines tier={1} text={NAME} className="fill" /></V2TestProvider>);
    await waitFor(() => expect(container.querySelector(".ink")!.textContent).toBe(NAME));
    expect(container.querySelectorAll("canvas[data-tier]")).toHaveLength(1);
    const ink = container.querySelector(".ink")!;
    expect(ink.classList.contains("iwrap")).toBe(true);
    expect(ink.classList.contains("iblk")).toBe(false);
  });
});
