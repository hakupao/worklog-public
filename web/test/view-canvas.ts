import { act, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import { rec, type Call } from "./canvas-rec";

// Canvas / visibility stubs the hand-drawn 统计 view tests share (jsdom has no 2D context, no boxes, no
// IntersectionObserver).

/** jsdom boxes are 0×0 and there is no 2D context: canvases with one of the given classes get a box at (100, 50) and
 *  a recording context; `draws(cv)` counts their full draws (each one sizes the canvas and fetches the context),
 *  `calls(cv)` is the latest draw's record. */
export function canvases(size: Record<string, [number, number]>) {
  const all = new Map<HTMLCanvasElement, Call[][]>();
  const cls = (el: HTMLCanvasElement) => Object.keys(size).find((k) => el.classList.contains(k));
  const box = HTMLCanvasElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLCanvasElement) {
    const k = cls(this);
    if (!k) return box.call(this);
    const [w, h] = size[k];
    return { width: w, height: h, left: 100, top: 50, right: 100 + w, bottom: 50 + h, x: 100, y: 50 } as DOMRect;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    if (!cls(this)) return null;
    const r = rec();
    all.set(this, [...(all.get(this) ?? []), r.calls]);
    return r.ctx;
  } as never);
  return {
    draws: (cv: Element) => all.get(cv as HTMLCanvasElement)?.length ?? 0,
    calls: (cv: Element) => all.get(cv as HTMLCanvasElement)?.at(-1) ?? [],
    every: (cv: Element) => (all.get(cv as HTMLCanvasElement) ?? []).flat(),
  };
}
/** An IntersectionObserver that reports every element visible as soon as it is observed. */
export function seeAll() {
  class IO {
    cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
    observe(el: Element) { this.cb([{ target: el, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", IO);
}

/** A view's band once its data is in: the region by name, waited for until its wait line (R4: every view holds its
 *  place from the start, 读取中 until its data arrives) is gone. */
export async function viewOf(name: string): Promise<HTMLElement> {
  const found = () => {
    const sec = screen.getByRole("region", { name });             // found again each time: a new view's band is replaced
    expect(sec.querySelector(".sv-b .sv-pend")).toBeNull();
    return sec;
  };
  await waitFor(found);
  // The band can show up before its passive effects run (the data arrived outside act), and an LED writes its text
  // twin (.ink) only in an effect, a microtask after mount: let those run, so the caller reads the band's text (F6).
  await act(async () => {});
  return waitFor(found);
}
