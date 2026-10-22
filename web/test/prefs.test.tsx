import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../src/api/queries";
import { readCachedPrefs, writeCachedPrefs } from "../src/prefs/cache";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { normalizePrefs } from "../src/prefs/normalize";
import { readOverrides, withoutOverride } from "../src/prefs/overrides";
import { usePrefs } from "../src/prefs/usePrefs";

const wrap = () => {
  const qc = createQueryClient();
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("defaults", () => {
  it("match the server's defaults.json exactly", () => {
    const server = JSON.parse(readFileSync(path.resolve(__dirname, "../../server/src/prefs/defaults.json"), "utf8"));
    expect(DEFAULT_PREFS).toEqual(server);
  });
});

describe("normalizePrefs", () => {
  it("predict: keeps valid fields, replaces invalid ones field by field, drops unknown rules and params", () => {
    const D = DEFAULT_PREFS.predict;
    const p = normalizePrefs({ predict: {
      runningMin: 999,
      modes: { morning: { from: "07:00", to: "25:00", days: [1, 9] }, focus: { days: [1, 3] } },
      rules: { "plan.stale": { on: false, weight: 55, mode: "nope", params: { minutes: 3 } },
        "task.waiting": { params: { keywords: [" 待ち ", 5], days: 7 } }, "x.y": { on: true } },
    } }).predict;
    expect(p.runningMin).toBe(D.runningMin);
    expect(p.modes.morning).toEqual({ from: "07:00", to: D.modes.morning.to, days: D.modes.morning.days });
    expect(p.modes.focus).toEqual({ ...D.modes.focus, days: [1, 3] });
    expect(p.rules["plan.stale"]).toEqual({ on: false, weight: 55, mode: D.rules["plan.stale"].mode, params: {} });
    expect(p.rules["task.waiting"].params).toEqual({ keywords: D.rules["task.waiting"].params.keywords, days: 7 });
    expect(p.rules).not.toHaveProperty("x.y");
  });
  it("unlinked.stale.minMinutes (Task 15b): a cached copy without it gets the default; out of range falls back", () => {
    const D = DEFAULT_PREFS.predict;
    expect(D.rules["unlinked.stale"].params).toEqual({ minutes: 30, minMinutes: 5 });
    const old = (params: unknown) => normalizePrefs({ predict: { rules: { "unlinked.stale": { params } } } }).predict.rules["unlinked.stale"].params;
    expect(old({ minutes: 45 })).toEqual({ minutes: 45, minMinutes: 5 });
    expect(old({ minutes: 45, minMinutes: 0 })).toEqual({ minutes: 45, minMinutes: 0 });
    expect(old({ minutes: 45, minMinutes: 601 })).toEqual({ minutes: 45, minMinutes: 5 });
    expect(old({ minutes: 45, minMinutes: -1 })).toEqual({ minutes: 45, minMinutes: 5 });
  });
  it("week.unlinked.minMinutes (final review): a cached copy without it gets the default; out of range falls back", () => {
    expect(DEFAULT_PREFS.predict.rules["week.unlinked"].params).toEqual({ minMinutes: 5 });
    const old = (params: unknown) => normalizePrefs({ predict: { rules: { "week.unlinked": { params } } } }).predict.rules["week.unlinked"].params;
    expect(old({})).toEqual({ minMinutes: 5 });
    expect(old({ minMinutes: 0 })).toEqual({ minMinutes: 0 });
    expect(old({ minMinutes: 600 })).toEqual({ minMinutes: 600 });
    expect(old({ minMinutes: 601 })).toEqual({ minMinutes: 5 });
    expect(old({ minMinutes: -1 })).toEqual({ minMinutes: 5 });
  });
  it("predict: a cached copy from before sub-project 2 (no predict) reads as the defaults", () => {
    const { predict: _drop, ...old } = DEFAULT_PREFS;
    expect(normalizePrefs(old).predict).toEqual(DEFAULT_PREFS.predict);
  });
  it("stats (sub-project 7b): a cached copy without it reads as the defaults; non-strings are dropped, unknown ids kept", () => {
    const { stats: _drop, ...old } = DEFAULT_PREFS;
    expect(normalizePrefs(old).stats).toEqual(DEFAULT_PREFS.stats);
    expect(normalizePrefs({ stats: { order: ["dial", 3, null, "gone"], off: ["terrain", {}] } }).stats)
      .toEqual({ order: ["dial", "gone"], off: ["terrain"] });
    expect(normalizePrefs({ stats: { order: "dial", off: null } }).stats).toEqual(DEFAULT_PREFS.stats);
    expect(normalizePrefs({ stats: [] }).stats).toEqual(DEFAULT_PREFS.stats);
  });
  it("stats ids take the server's shape (A3: one bad id made every later save a 400): a–z0–9, 1–24 long, at most 64", () => {
    const long = "a".repeat(25), many = Array.from({ length: 70 }, (_, i) => `v${i}`);
    expect(normalizePrefs({ stats: { order: ["dial", "Bad-ID!", long, "a".repeat(24), "", "ok2"], off: ["Terrain", "terrain"] } }).stats)
      .toEqual({ order: ["dial", "a".repeat(24), "ok2"], off: ["terrain"] });
    const n = normalizePrefs({ stats: { order: many, off: many } }).stats;
    expect(n.order).toEqual(many.slice(0, 64));
    expect(n.off).toEqual(many.slice(0, 64));
  });
  it("keeps valid fields and replaces invalid ones with defaults", () => {
    const p = normalizePrefs({ lang: "ja", world: "mars", fx: { load: "scan", lang: 3 }, speed: 9, omote: { hide: ["now.run", 5] }, junk: 1 });
    expect(p).toEqual({ ...DEFAULT_PREFS, lang: "ja", fx: { ...DEFAULT_PREFS.fx, load: "scan" }, omote: { ...DEFAULT_PREFS.omote, hide: ["now.run"] } });
  });
  it("never throws", () => {
    for (const x of [null, undefined, 1, "x", [], { fx: null }]) expect(normalizePrefs(x)).toEqual(DEFAULT_PREFS);
  });
});

describe("cache", () => {
  it("round-trips through localStorage", () => {
    writeCachedPrefs({ ...DEFAULT_PREFS, lang: "en" });
    expect(readCachedPrefs()?.lang).toBe("en");
  });
  it("swallows storage errors", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(readCachedPrefs()).toBeNull();
    expect(() => writeCachedPrefs(DEFAULT_PREFS)).not.toThrow();
  });
});

describe("overrides", () => {
  it("reads ?world= and ?lang= from the hash query and ignores junk", () => {
    expect(readOverrides("#/v2/settings?world=omote&lang=ja")).toEqual({ world: "omote", lang: "ja" });
    expect(readOverrides("#/v2/now?world=sideways&lang=fr")).toEqual({});
    expect(readOverrides("#/v2/now")).toEqual({});
  });
  it("removes one override and keeps the rest", () => {
    expect(withoutOverride("#/v2/now?world=omote&lang=ja", "world")).toBe("#/v2/now?lang=ja");
    expect(withoutOverride("#/v2/now?world=omote", "world")).toBe("#/v2/now");
  });
});

describe("usePrefs", () => {
  it("first paint uses the cached prefs, then the server's", async () => {
    writeCachedPrefs({ ...DEFAULT_PREFS, lang: "en" });
    let release!: () => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { release = () => r(json({ ...DEFAULT_PREFS, lang: "ja" })); })));
    const { result } = renderHook(() => usePrefs(), { wrapper: wrap() });
    expect(result.current.prefs.lang).toBe("en");
    act(() => release());
    await waitFor(() => expect(result.current.prefs.lang).toBe("ja"));
    expect(readCachedPrefs()?.lang).toBe("ja");
  });

  it("first paint works when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.stubGlobal("fetch", vi.fn(async () => json(DEFAULT_PREFS)));
    const { result } = renderHook(() => usePrefs(), { wrapper: wrap() });
    expect(result.current.prefs).toEqual(DEFAULT_PREFS);
  });

  it("writes optimistically and sends PUTs one after another in call order", async () => {
    const bodies: string[] = [];
    let inFlight = 0, maxInFlight = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method !== "PUT") return json(DEFAULT_PREFS);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      bodies.push(String(init.body)); inFlight--;
      return json(JSON.parse(String(init.body)));
    }));
    const { result } = renderHook(() => usePrefs(), { wrapper: wrap() });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => {
      result.current.setPrefs((p) => ({ ...p, speed: 0.5 }));
      result.current.setPrefs((p) => ({ ...p, speed: 1.5 }));
    });
    // TanStack notifies observers on a setTimeout(0) batch, so the optimistic value shows up a tick later.
    await waitFor(() => expect(result.current.prefs.speed).toBe(1.5));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies.map((b) => JSON.parse(b).speed)).toEqual([0.5, 1.5]);
    expect(maxInFlight).toBe(1);
    expect(result.current.prefs.speed).toBe(1.5);
  });

  it("a write made while the first GET is still in flight wins over that GET's answer", async () => {
    let releaseGet!: () => void;
    vi.stubGlobal("fetch", vi.fn((_u: string, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(json(JSON.parse(String(init.body))));
      return new Promise<Response>((r) => { releaseGet = () => r(json({ ...DEFAULT_PREFS, speed: 1 })); });
    }));
    const { result } = renderHook(() => usePrefs(), { wrapper: wrap() });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => result.current.setPrefs((p) => ({ ...p, speed: 1.5 })));
    act(() => releaseGet());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.prefs.speed).toBe(1.5);
    expect(readCachedPrefs()?.speed).toBe(1.5);
  });

  it("resetPrefs writes the defaults", async () => {
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === "PUT") { puts.push(JSON.parse(String(init.body))); return json(JSON.parse(String(init.body))); }
      return json({ ...DEFAULT_PREFS, lang: "ja" });
    }));
    const { result } = renderHook(() => usePrefs(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.prefs.lang).toBe("ja"));
    act(() => result.current.resetPrefs());
    await waitFor(() => expect(puts).toEqual([DEFAULT_PREFS]));
  });

  it("normalize keeps a valid report.name and falls back on anything else", () => {
    expect(normalizePrefs({ report: { name: " 山田 " } }).report).toEqual({ name: "山田" });
    for (const bad of [undefined, null, "", "   ", 3, "x".repeat(61)]) {
      expect(normalizePrefs({ report: { name: bad } }).report).toEqual({ name: "Taro Yamada" });
    }
  });
  it("normalize cal: payday falls back, invalid breaks are dropped, names trimmed; a stored scene key is dropped", () => {
    const cal = normalizePrefs({
      cal: { payday: "x", breaks: [{ name: "", from: "1-1" }, { name: " GW ", from: "04-29", to: "05-05" }, { name: "b", from: "13-01", to: "01-02" }] },
    }).cal;
    expect(cal.payday).toBe(25);
    expect(cal.breaks).toEqual([{ name: "GW", from: "04-29", to: "05-05" }]);
    expect(normalizePrefs({ cal: { payday: 31, breaks: [] } }).cal).toEqual({ payday: 31, breaks: [] });
    expect(normalizePrefs({ cal: { payday: 0 } }).cal.breaks).toEqual(DEFAULT_PREFS.cal.breaks);
    expect(normalizePrefs({ scene: { mode: "mono" } })).not.toHaveProperty("scene");   // a cached copy from before the keys went
  });
});
