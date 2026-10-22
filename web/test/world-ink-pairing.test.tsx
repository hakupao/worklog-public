import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fx from "../src/led/fx";
import type { Slot } from "../src/led/registry";

// test/setup.ts already loaded transitions.ts with the real fx module, so the switch test below
// re-imports the v2 graph after resetModules to get one wired to this spy.
vi.mock("../src/led/fx", async (orig) => {
  const m = await orig<typeof import("../src/led/fx")>();
  return { ...m, pairSlots: vi.fn(m.pairSlots) };
});

type D = { x: number; y: number };
const d = (x: number, y = 0): D => ({ x, y });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { delete (document as unknown as { fonts?: unknown }).fonts; });

describe("pairSlots", () => {
  it("pairs by slot identity, and a slot on one side only goes one-sided", () => {
    const a = {}, hidden = {}, c = {};
    const led = new Map<object, D[]>([[a, [d(0)]], [hidden, [d(10), d(11)]], [c, [d(20)]]]);
    const ink = new Map<object, D[]>([[a, [d(1)]], [c, [d(21)]]]);
    expect(fx.pairSlots(led, ink)).toEqual([[d(0), d(1)], [d(10), null], [d(11), null], [d(20), d(21)]]);
    expect(fx.pairSlots(ink, led)).toEqual([[d(1), d(0)], [d(21), d(20)], [null, d(10)], [null, d(11)]]);
  });
});

describe("ink world switch", () => {
  it("ura→omote: a board inside a <Mod> hidden in 表 is paired with nothing, the rest with themselves", async () => {
    vi.resetModules();
    const fresh = await import("../src/led/fx");
    const { slots } = await import("../src/led/registry");
    const { Led } = await import("../src/ui/Led");
    const { Mod } = await import("../src/ui/Mod");
    const { applyWorld, getWorld } = await import("../src/world/store");
    const { setWorldFxSource, toggleWorld } = await import("../src/world/transitions");
    const { V2TestProvider } = await import("./helpers");
    (await import("../src/led/motion")).motion.speed = 50;   // the 1.9 s overlay in ~40 ms
    applyWorld("ura");
    render(<V2TestProvider prefs={{ omote: { font: "plex", hide: ["now.cost"] } }}>
      <Led text="運行中" /><Mod id="now.cost"><Led text="39.29 USD" /></Mod><Led text="次" />
    </V2TestProvider>);
    await flush();
    const [first, hidden, last] = slots() as Slot[];
    expect(slots()).toHaveLength(3);

    // a 2D context that draws nothing, so the ink switch runs end to end in jsdom
    const ctx = new Proxy({}, { get: () => () => ({ data: new Uint8ClampedArray(4), fontBoundingBoxAscent: 0 }), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    Object.defineProperty(document, "fonts", { configurable: true, value: { load: () => Promise.resolve([]), ready: Promise.resolve() } });
    setWorldFxSource(() => "ink");
    const spy = vi.mocked(fresh.pairSlots); spy.mockClear();
    await act(() => toggleWorld());

    expect(getWorld()).toBe("omote");
    const after = slots();                                   // the same Slot objects survive the switch
    expect(after).toHaveLength(2); expect(after[0]).toBe(first); expect(after[1]).toBe(last);
    expect(spy).toHaveBeenCalledTimes(1);
    const [led, ink] = spy.mock.calls[0] as [Map<Slot, unknown>, Map<Slot, unknown>];
    const same = (got: Slot[], want: Slot[]) => { expect(got).toHaveLength(want.length); got.forEach((s, i) => expect(s).toBe(want[i])); };
    same([...led.keys()], [first, hidden, last]);
    same([...ink.keys()], [first, last]);                   // the hidden board exists on the LED side only
  });
});
