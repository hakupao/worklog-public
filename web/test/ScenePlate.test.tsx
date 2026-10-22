import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prefs } from "../src/prefs/types";
import type { SceneDef } from "../src/scene/registry";
import { ScenePlate } from "../src/pages/now/ScenePlate";
import { applyWorld } from "../src/world/store";
import { V2TestProvider } from "./helpers";

const H = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../src/scene/load", () => ({ loadScenes: H.load }));

const def = (id: string, fig: number, period: SceneDef["period"], zh: string, still?: number): SceneDef => ({
  id, fig, period, cap: { zh, ja: `${zh}(ja)`, en: `${id} (en)` },
  meta: { cols: 200, rows: 100, fps: 15, still }, make: () => () => "",
});
const DEFS = [
  def("alpineDawn", 1, "dawn", "阿尔卑斯 · 黎明"),
  def("kyotoDusk", 6, "dusk", "京都 · 黄昏"),
  def("auroraFjord", 10, "night", "峡湾 · 极光", 3),
  def("desertNight", 11, "night", "沙漠 · 夜"),
  def("lanternLake", 12, "night", "灯湖"),
  def("nightCoast", 13, "night", "夜岸 · 灯塔"),
];
let mod: { forPeriod: ReturnType<typeof vi.fn>; sampleFrame: ReturnType<typeof vi.fn>; drawScene: ReturnType<typeof vi.fn> };

// 2026-10-20 18:45 JST; Tokyo sunset that day rounds to 17:00 (cal/sun.ts), so it is night, 1:45 after sunset.
const NOW = Date.UTC(2026, 9, 20, 9, 45);
const step = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const capText = (c: HTMLElement) => c.querySelector(".cap > .ink")!.textContent ?? "";

let roCbs: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  mod = {
    forPeriod: vi.fn((p: string) => DEFS.filter((d) => d.period === p)),
    sampleFrame: vi.fn(() => ({ C: 200, R: 76, cells: [] })),
    drawScene: vi.fn(),
  };
  H.load.mockReset();
  H.load.mockResolvedValue(mod);
  vi.spyOn(Math, "random").mockReturnValue(0);   // the first candidate: each draw below is predictable
  const ctx = { setTransform() {}, drawImage() {}, clearRect() {} } as unknown as CanvasRenderingContext2D;
  // only the plate's canvases get a context; the LED boards stay on jsdom's null (test/setup.ts)
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return (this.classList.contains("scn") ? ctx : null) as never;
  });
  roCbs = [];
  vi.stubGlobal("ResizeObserver", class {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; roCbs.push(cb); }
    observe() { this.cb(); }
    disconnect() {}
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "hidden");
});

function mount(opts: { prefs?: Partial<Prefs>; setPrefs?: (u: (p: Prefs) => Prefs) => void; alert?: boolean } = {}) {
  return render(
    <V2TestProvider lang="zh" prefs={opts.prefs} setPrefs={opts.setPrefs}>
      <ScenePlate now={NOW} alert={opts.alert ?? false} />
    </V2TestProvider>,
  );
}

describe("<ScenePlate>", () => {
  it("captions the plate on one LED row: Fig. n — zh cap · 日没 17:00 · 夜 +1:45", async () => {
    const { container } = mount();
    await step(50);
    expect(container.querySelectorAll(".cap > canvas")).toHaveLength(1);
    expect(capText(container)).toBe("Fig. 10 — 峡湾 · 极光 · 日没 17:00 · 夜 +1:45");
  });

  it("at 18:45 picks from the night scenes", async () => {
    mount();
    await step(50);
    expect(mod.forPeriod).toHaveBeenCalledWith("night");
    expect(mod.sampleFrame.mock.calls[0][0].id).toBe("auroraFjord");
  });

  it("turns to another night scene after 25 000 ms, never the same one twice in a row", async () => {
    const { container } = mount();
    await step(50);
    await step(24_000);
    expect(capText(container)).toContain("Fig. 10 — ");
    await step(1_000);
    expect(capText(container)).toContain("Fig. 11 — 沙漠 · 夜");
    expect(mod.sampleFrame.mock.lastCall![0].id).toBe("desertNight");
    await step(25_000);
    expect(capText(container)).toContain("Fig. 10 — ");
  });

  it("draws the opening plate and each turn at random among the period's scenes", async () => {
    vi.mocked(Math.random).mockReturnValueOnce(0.99).mockReturnValueOnce(0.7);
    const { container } = mount();
    await step(50);
    expect(capText(container)).toContain("Fig. 13 — 夜岸");          // the last of four
    await step(25_000);
    expect(capText(container)).toContain("Fig. 12 — 灯湖");          // .7 of the three others, not the next in line
  });

  it("a period change shows a scene of the new period at once", async () => {
    const plate = (now: number) => (
      <V2TestProvider lang="zh"><ScenePlate now={now} alert={false} /></V2TestProvider>
    );
    const { container, rerender } = render(plate(NOW));
    await step(50);
    await step(25_000);                                               // a turn: a night scene is now the picked one
    rerender(plate(NOW - 135 * 60_000));                              // 16:30, sunset 17:00: dusk
    await step(50);
    expect(capText(container)).toContain("Fig. 6 — 京都 · 黄昏");
    expect(mod.sampleFrame.mock.lastCall![0].id).toBe("kyotoDusk");
  });

  it("the progress line fills over the 25 s cycle (scaleX through --p)", async () => {
    const { container } = mount();
    await step(50);
    const cyc = container.querySelector<HTMLElement>(".cap > .cyc")!;
    await step(10_000);
    expect(Number(cyc.style.getPropertyValue("--p"))).toBeCloseTo(0.4, 1);
  });

  it("draws the world it is in with the scene's period, dims on alert, and has no colour keys", async () => {
    const { container, unmount } = mount({ alert: true });
    await step(50);
    expect(mod.drawScene.mock.lastCall!.slice(2).map(String)).toEqual(["ura", "0", "true", "night"]);
    expect(container.querySelector("button")).toBeNull();
    unmount();
    act(() => applyWorld("omote"));
    const r = mount();
    await step(50);
    expect([mod.drawScene.mock.lastCall![2], mod.drawScene.mock.lastCall![5]]).toEqual(["omote", "night"]);
    expect(r.container.querySelector("button")).toBeNull();
  });

  it("does not draw on a tick while the page is hidden", async () => {
    mount();
    await step(200);
    expect(mod.drawScene).toHaveBeenCalled();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    mod.drawScene.mockClear();
    await step(1_000);
    expect(mod.drawScene).not.toHaveBeenCalled();
  });

  it("reduced motion draws exactly one still frame (meta.still) and never turns the plate", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    const { container } = mount();
    await step(5_000);
    expect(mod.drawScene).toHaveBeenCalledTimes(1);
    expect(mod.sampleFrame.mock.calls[0][2]).toBe(3);
    await step(60_000);
    expect(capText(container)).toContain("Fig. 10 — ");
    expect(mod.drawScene).toHaveBeenCalledTimes(1);   // no rotation, so no crossfade and no second frame
    expect(container.querySelector<HTMLElement>(".cap > .cyc")!.style.getPropertyValue("--p")).toBe("");
  });

  it("reduced motion: a failed chunk still retries on its own timer", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    H.load.mockReset();
    H.load.mockRejectedValueOnce(new Error("chunk 404")).mockResolvedValue(mod);
    const { container } = mount();
    await step(50);
    expect(H.load).toHaveBeenCalledTimes(1);
    await step(25_000);
    expect(H.load).toHaveBeenCalledTimes(2);
    expect(capText(container)).toContain("Fig. 10 — ");
  });

  it("a hidden tab does not use up the cycle: the time away is added back on return", async () => {
    const { container } = mount();
    await step(10_000);
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await step(120_000);
    hidden = false;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await step(1_000);
    expect(capText(container)).toContain("Fig. 10 — ");   // 11 s of the cycle seen, not 131
    await step(14_500);
    expect(capText(container)).toContain("Fig. 11 — ");
  });

  it("hides the period segment when the caption row overflows", async () => {
    const { container } = mount();
    await step(50);
    const cap = container.querySelector<HTMLElement>(".cap")!;
    Object.defineProperty(cap, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(cap, "scrollWidth", { configurable: true, value: 420 });
    act(() => roCbs.forEach((f) => f()));
    await step(50);
    expect(capText(container)).toBe("Fig. 10 — 峡湾 · 极光 · 日没 17:00");
  });

  it("Review Focus 5: a failed chunk keeps the caption, logs nothing, and retries on the next cycle", async () => {
    const err = vi.spyOn(console, "error");
    H.load.mockReset();
    H.load.mockRejectedValueOnce(new Error("chunk 404")).mockResolvedValue(mod);
    const { container } = mount();
    await step(50);
    expect(H.load).toHaveBeenCalledTimes(1);
    expect(capText(container)).toBe("日没 17:00 · 夜 +1:45");
    expect(mod.drawScene).not.toHaveBeenCalled();
    await step(25_000);
    expect(H.load).toHaveBeenCalledTimes(2);
    expect(capText(container)).toContain("Fig. ");
    expect(mod.drawScene).toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
