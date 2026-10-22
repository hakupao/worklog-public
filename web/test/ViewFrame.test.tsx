import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ViewFrame, Thin } from "../src/pages/stats/ViewFrame";
import { useReveal } from "../src/pages/stats/useReveal";
import { __resetMotionForTests, motion } from "../src/led/motion";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";

const enter = vi.hoisted(() => vi.fn());
vi.mock("../src/ink/fx", async (orig) => ({ ...(await orig<typeof import("../src/ink/fx")>()), enter }));

const ink = (el: Element) => [...el.querySelectorAll(".ink")].map((e) => e.textContent).join("|");

/** An IntersectionObserver whose callback the test fires. */
function stubIo() {
  const made: { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; els: Element[]; off: boolean }[] = [];
  class IO {
    rec: (typeof made)[number];
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { this.rec = { cb, opts, els: [], off: false }; made.push(this.rec); }
    observe(el: Element) { this.rec.els.push(el); }
    unobserve() {}
    disconnect() { this.rec.off = true; }
    takeRecords() { return []; }
  }
  vi.stubGlobal("IntersectionObserver", IO);
  const fire = (hit: boolean) => act(() => {
    for (const r of made) if (!r.off) r.cb(r.els.map((target) => ({ target, isIntersecting: hit }) as IntersectionObserverEntry), {} as IntersectionObserver);
  });
  return { made, fire };
}
const reduce = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));

function P() { return <span data-testid="p">{useReveal().toFixed(2)}</span>; }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); applyWorld("ura"); enter.mockClear(); __resetMotionForTests(); });

describe("ViewFrame — header", () => {
  it("a region named after the view: number, name, 累计 for a cumulative block, the line on what it reveals, the key figure; the summary for screen readers", async () => {
    render(<V2TestProvider><ViewFrame id="time" num="03" meta="12.5h" summary="合计 12.5h"><i>body</i></ViewFrame></V2TestProvider>);
    const sec = screen.getByRole("region", { name: "时间花在哪" });
    expect(sec.getAttribute("data-view")).toBe("time");
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toBe("03|时间花在哪|累计|案件账本、未关联的时间和每周合计|12.5h"));
    expect(sec.querySelector(".v2-sr")!.textContent).toBe("合计 12.5h");
    expect(sec.querySelector(".sv-b i")!.textContent).toBe("body");
  });

  it("a new view has no 累计; no meta, no summary = neither rendered", async () => {
    render(<V2TestProvider lang="en"><ViewFrame id="river" num="01"><i /></ViewFrame></V2TestProvider>);
    const sec = screen.getByRole("region", { name: "Parallel formation" });
    await waitFor(() => expect(ink(sec.querySelector(".sv-h")!)).toBe("01|Parallel formation|Time each day spent at ≥1 … ≥6 in parallel; click a day to open its session lanes"));
    expect(sec.querySelector(".v2-sr")).toBeNull();
  });

  it("Thin: one dim line in the page's language", async () => {
    const { container } = render(<V2TestProvider lang="ja"><Thin /></V2TestProvider>);
    await waitFor(() => expect(ink(container)).toBe("この期間ではデータが足りません"));
  });
});

describe("ViewFrame — lazy draw", () => {
  it("no IntersectionObserver (jsdom): the body is drawn at once", () => {
    render(<V2TestProvider><ViewFrame id="river" num="01"><i data-testid="b" /></ViewFrame></V2TestProvider>);
    expect(screen.getByTestId("b")).toBeTruthy();
  });

  it("the header at once, the body only once the view comes within 600px; kept after it scrolls away", () => {
    const io = stubIo();
    render(<V2TestProvider><ViewFrame id="river" num="01"><i data-testid="b" /></ViewFrame></V2TestProvider>);
    const sec = screen.getByRole("region", { name: "并行编队" });
    expect(sec.querySelector(".sv-h")).not.toBeNull();
    expect(screen.queryByTestId("b")).toBeNull();
    expect(io.made[0].opts?.rootMargin).toBe("600px 0px");
    expect(io.made[0].els).toEqual([sec]);
    io.fire(false);
    expect(screen.queryByTestId("b")).toBeNull();
    io.fire(true);
    expect(screen.getByTestId("b")).toBeTruthy();
    expect(io.made.every((r) => r.off)).toBe(true);
    io.fire(false);
    expect(screen.getByTestId("b")).toBeTruthy();
  });
});

describe("ViewFrame — entrance", () => {
  it("表: the view's own canvases enter on the first draw (not the LED twins), once; useReveal is 1", () => {
    applyWorld("omote");
    const io = stubIo();
    const { rerender } = render(<V2TestProvider><ViewFrame id="river" num="01"><canvas className="c1" /><canvas data-tier="1" /><P /></ViewFrame></V2TestProvider>);
    expect(enter).not.toHaveBeenCalled();
    io.fire(true);
    expect(enter).toHaveBeenCalledTimes(1);
    expect((enter.mock.calls[0][0] as Element[]).map((e) => e.className)).toEqual(["c1"]);
    expect(screen.getByTestId("p").textContent).toBe("1.00");
    rerender(<V2TestProvider><ViewFrame id="river" num="01" meta="x"><canvas className="c1" /><P /></ViewFrame></V2TestProvider>);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it("里: no enter(); useReveal goes 0 → 1 over 900ms / speed, eased out", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    motion.speed = 2;
    render(<V2TestProvider><ViewFrame id="river" num="01"><P /></ViewFrame></V2TestProvider>);
    expect(enter).not.toHaveBeenCalled();
    const p = () => Number(screen.getByTestId("p").textContent);
    expect(p()).toBe(0);
    act(() => { vi.advanceTimersByTime(75); });           // 75 of 900 / 2 = 450ms: 1 − (5/6)³ ≈ .42
    expect(p()).toBeGreaterThan(0.36);
    expect(p()).toBeLessThan(0.48);
    act(() => { vi.advanceTimersByTime(400); });
    expect(p()).toBe(1);
  });

  it("a body that arrives after the frame opened (R4: a wait line first, ready later) gets its entrance then: 表 enter(), 里 a fresh reveal", () => {
    applyWorld("omote");
    const io = stubIo();
    const wait = <i data-testid="w" />, body = <><canvas className="c1" /><P /></>;
    const { rerender } = render(<V2TestProvider><ViewFrame id="time" num="01" ready={false}>{wait}</ViewFrame></V2TestProvider>);
    io.fire(true);
    expect(enter).not.toHaveBeenCalled();                    // nothing of its own to bring in yet
    rerender(<V2TestProvider><ViewFrame id="time" num="01">{body}</ViewFrame></V2TestProvider>);
    expect(enter).toHaveBeenCalledTimes(1);
    expect((enter.mock.calls[0][0] as Element[]).map((e) => e.className)).toEqual(["c1"]);
    applyWorld("ura");
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const r = render(<V2TestProvider><ViewFrame id="share" num="02" ready={false}>{wait}</ViewFrame></V2TestProvider>);
    io.fire(true);
    act(() => { vi.advanceTimersByTime(2000); });            // the wait line's reveal long over
    r.rerender(<V2TestProvider><ViewFrame id="share" num="02"><P /></ViewFrame></V2TestProvider>);
    expect(Number(r.container.querySelector("[data-testid=p]")!.textContent)).toBe(0);  // the body's reveal starts now
    act(() => { vi.advanceTimersByTime(1000); });
    expect(Number(r.container.querySelector("[data-testid=p]")!.textContent)).toBe(1);
  });

  it("reduced motion: p = 1 at once and no enter() in either world", () => {
    reduce(true);
    render(<V2TestProvider><ViewFrame id="river" num="01"><P /></ViewFrame></V2TestProvider>);
    expect(screen.getByTestId("p").textContent).toBe("1.00");
    applyWorld("omote");
    render(<V2TestProvider><ViewFrame id="dial" num="02"><canvas /></ViewFrame></V2TestProvider>);
    expect(enter).not.toHaveBeenCalled();
  });

  it("useReveal outside a frame is 1", () => {
    render(<P />);
    expect(screen.getByTestId("p").textContent).toBe("1.00");
  });
});
