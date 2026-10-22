import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../src/led/board";
import { lattice } from "../src/led/lattice";
import { isLive, kick, unkick } from "../src/led/loop";
import { registerSlot, slots, unregisterSlot } from "../src/led/registry";

// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => vi.unstubAllGlobals());

describe("lattice", () => {
  it("snaps to the page-wide 3px grid from the document origin", () => {
    expect(lattice({ left: 10, top: 4, width: 60, height: 30 }, { x: 0, y: 0 }, 3, true))
      .toEqual({ offX: 2, offY: 2, nx: 19, ny: 9 });
  });
  it("ignores the page grid without snap", () => {
    expect(lattice({ left: 10, top: 4, width: 60, height: 30 }, { x: 0, y: 0 }, 3, false))
      .toEqual({ offX: 0, offY: 0, nx: 20, ny: 10 });
  });
  it("never goes negative or NaN for a zero-size (hidden / unlaid-out) canvas", () => {
    for (const r of [{ left: 0, top: 0, width: 0, height: 0 }, { left: 7, top: 7, width: 1, height: 1 }]) {
      const l = lattice(r, { x: 0, y: 0 }, 3, true);
      expect(l.nx).toBeGreaterThanOrEqual(0);
      expect(l.ny).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(l.offX + l.offY + l.nx + l.ny)).toBe(false);
    }
  });
});

describe("loop", () => {
  it("runs a kicked animation until it reports done, and unkick removes it", () => {
    const cbs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cbs.push(cb); return cbs.length; });
    let n = 0;
    const a = { frame: () => ++n < 3 };
    kick(a);
    expect(isLive(a)).toBe(true);
    while (cbs.length) cbs.shift()!(0);
    expect(n).toBe(3);
    expect(isLive(a)).toBe(false);
    const b = { frame: () => true };
    kick(b); unkick(b);
    expect(isLive(b)).toBe(false);
  });
});

describe("Board in jsdom (no canvas 2D)", () => {
  const cv = () => document.body.appendChild(document.createElement("canvas"));
  it("constructs, sets text, resizes and disposes without throwing", () => {
    const b = new Board(cv(), { size: 10, snap: true });
    expect(() => { b.set("運行中"); b.set([{ t: "A", color: "#f00" }], { fx: "morph" }); b.resize(); }).not.toThrow();
    expect(b.nx).toBeGreaterThanOrEqual(0);
    b.dispose();
    expect(isLive(b)).toBe(false);
    expect(() => b.set("after dispose")).not.toThrow();
  });
  it("with reduced motion a change lands at its final state at once", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const b = new Board(cv());
    b.set("一");
    b.set("二", { fx: "flicker" });
    expect(b.t).toBe(1);
    expect(isLive(b)).toBe(false);
  });
  it("an animated change starts at t=0 and is in the loop", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const b = new Board(cv());
    b.set("一");
    b.set("二", { fx: "roll" });
    expect(b.t).toBe(0);
    expect(isLive(b)).toBe(true);
    b.dispose();
  });
  it("an overflowing line scrolls only while hovered", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const b = new Board(cv(), { marquee: true });
    b.cur = { w: 999, h: 10, col: [], kc: new Int16Array(0), nk: 0 };
    expect(b.overflows()).toBe(false);
    b.hover(true);
    expect(b.overflows()).toBe(true);
    expect(isLive(b)).toBe(true);
    b.hover(false);
    expect(b.overflows()).toBe(false);
    b.dispose();
  });
  it("setting the same text again is a no-op", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const b = new Board(cv());
    b.set("一"); b.set("二", { fx: "roll" });
    b.frame(1e9);                       // finish
    b.set("二", { fx: "roll" });
    expect(b.t).toBe(1);
  });
});

describe("registry", () => {
  it("lists slots in document order and forgets unregistered ones", () => {
    const a = document.body.appendChild(document.createElement("canvas"));
    const b = document.body.insertBefore(document.createElement("canvas"), a);
    const sa = { board: new Board(a), ink: document.createElement("span") };
    const sb = { board: new Board(b), ink: document.createElement("span") };
    registerSlot(sa); registerSlot(sb);
    expect(slots()).toEqual([sb, sa]);
    unregisterSlot(sb);
    expect(slots()).toEqual([sa]);
  });
});
