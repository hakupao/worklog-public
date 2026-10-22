import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyWorld, getWorld } from "../src/world/store";
import { isModuleHidden, MODULES } from "../src/world/modules";
import { isWorldBusy, leave, setWorldFxSource, setWorldPersist, toggleWorld } from "../src/world/transitions";
import { Mod } from "../src/ui/Mod";
import { V2TestProvider } from "./helpers";

// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => vi.unstubAllGlobals());

describe("store", () => {
  it("applies the world to <html> and notifies once per change", () => {
    const seen: string[] = [];
    document.addEventListener("worldchange", (e) => seen.push((e as CustomEvent).detail));
    applyWorld("omote"); applyWorld("omote"); applyWorld("ura");
    expect(document.documentElement.dataset.world).toBe("ura");
    expect(seen).toEqual(["omote", "ura"]);
  });
});

describe("modules", () => {
  it("registers the 此刻, 时间线, 案件, 计划, 週報 and 统计 modules with page-prefixed ids", () => {
    expect(MODULES.map((m) => m.id)).toEqual(["now.run", "now.next", "now.plan", "now.info", "now.cost", "now.dia", "now.scene", "now.time", "timeline.legend", "timeline.cost", "tasks.cost", "plan.judge", "report.warn", "stats.cost", "stats.review"]);
  });
  it("hides only in 表", () => {
    expect(isModuleHidden("now.cost", ["now.cost"], "omote")).toBe(true);
    expect(isModuleHidden("now.cost", ["now.cost"], "ura")).toBe(false);
    expect(isModuleHidden("now.run", ["now.cost"], "omote")).toBe(false);
  });
  it("<Mod> renders nothing for a hidden module in 表", () => {
    applyWorld("omote");
    render(<V2TestProvider prefs={{ omote: { font: "plex", hide: ["now.cost"] } }}>
      <Mod id="now.cost"><p>cost</p></Mod><Mod id="now.run"><p>run</p></Mod>
    </V2TestProvider>);
    expect(screen.queryByText("cost")).toBeNull();
    expect(screen.getByText("run").closest("[data-mod]")?.getAttribute("data-mod")).toBe("now.run");
  });
});

describe("toggleWorld", () => {
  it("without View Transitions switches directly and persists", async () => {
    const persist = vi.fn();
    setWorldPersist(persist); setWorldFxSource(() => "scan");
    applyWorld("ura");
    await toggleWorld();
    expect(getWorld()).toBe("omote");
    expect(persist).toHaveBeenCalledWith("omote");
    expect(isWorldBusy()).toBe(false);
  });
  it("with reduced motion switches directly even if View Transitions exist", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const start = vi.fn();
    (document as unknown as { startViewTransition: unknown }).startViewTransition = start;
    try {
      setWorldFxSource(() => "flip"); applyWorld("ura");
      await toggleWorld();
      expect(getWorld()).toBe("omote");
      expect(start).not.toHaveBeenCalled();
    } finally { delete (document as unknown as { startViewTransition?: unknown }).startViewTransition; }
  });
  it("a second toggle while busy is ignored, and busy resets after a failure", async () => {
    let finish!: () => void;
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
      cb();
      return { ready: Promise.reject(new Error("aborted")), finished: new Promise<void>((r) => { finish = r; }) };
    };
    try {
      setWorldFxSource(() => "scan"); applyWorld("ura");
      const first = toggleWorld();
      expect(isWorldBusy()).toBe(true);
      await toggleWorld();                     // ignored
      await first;
      finish?.();
      expect(getWorld()).toBe("omote");
      expect(isWorldBusy()).toBe(false);
    } finally { delete (document as unknown as { startViewTransition?: unknown }).startViewTransition; }
  });
});

describe("busy lock", () => {
  it("resets busy when the transition throws midway", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (document as unknown as { startViewTransition: unknown }).startViewTransition = () => { throw new Error("boom"); };
    try {
      setWorldFxSource(() => "flip"); applyWorld("ura");
      await toggleWorld();
      expect(isWorldBusy()).toBe(false);
      expect(getWorld()).toBe("ura");          // threw before flipping
      (document as unknown as { startViewTransition?: unknown }).startViewTransition = undefined;
      await toggleWorld();                     // not stuck: a later toggle works
      expect(getWorld()).toBe("omote");
    } finally { delete (document as unknown as { startViewTransition?: unknown }).startViewTransition; }
  });
  it("ignores a second toggle while the first is still running", async () => {
    let finish!: () => void;
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => void) => {
      cb();
      return { ready: Promise.resolve(), finished: new Promise<void>((r) => { finish = r; }) };
    };
    (document.documentElement as unknown as { animate: unknown }).animate = () => ({});
    try {
      setWorldFxSource(() => "scan"); applyWorld("ura");
      const first = toggleWorld();
      await Promise.resolve();
      await toggleWorld();                     // ignored: still busy
      expect(getWorld()).toBe("omote");
      expect(isWorldBusy()).toBe(true);
      finish(); await first;
      expect(isWorldBusy()).toBe(false);
    } finally {
      delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
      delete (document.documentElement as unknown as { animate?: unknown }).animate;
    }
  });
});

describe("ink switch cleanup", () => {
  const fakeCtx = (clearRect: () => void) => new Proxy({ clearRect }, { get: (o, k) => (k in o ? (o as never)[k] : () => ({ data: new Uint8ClampedArray(4) })), set: () => true });
  const stubInk = (ctx: unknown, fonts: boolean) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    if (fonts) Object.defineProperty(document, "fonts", { configurable: true, value: { load: () => Promise.resolve([]), ready: Promise.resolve() } });
    setWorldFxSource(() => "ink"); applyWorld("ura");
  };
  const clean = () => {
    expect(isWorldBusy()).toBe(false);
    expect(document.getElementById("wov")).toBeNull();
    expect(document.documentElement.classList.contains("inking")).toBe(false);
  };
  afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; });

  it("a throw inside the animation tick removes the overlay, the class and busy", async () => {
    stubInk(fakeCtx(() => { throw new Error("draw failed"); }), true);
    await toggleWorld();
    clean();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await toggleWorld();                       // not stuck
    expect(isWorldBusy()).toBe(false);
  });
  it("a throw while sampling (after the overlay is added) is cleaned up too", async () => {
    stubInk(fakeCtx(() => {}), false);         // no document.fonts: sampleInk throws
    await toggleWorld();
    clean();
  });
});

describe("leave", () => {
  it("navigates at once without Element.animate", () => {
    const go = vi.fn();
    leave(go);
    expect(go).toHaveBeenCalledOnce();
  });
});
