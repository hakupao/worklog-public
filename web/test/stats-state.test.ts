import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSt, stHash, useSt } from "../src/pages/stats/state";
import { J } from "../src/predict/fixtures";

const NOW = new Date(J("2026-10-07 14:20"));   // Wednesday

describe("统计 state (#/v2/stats?range=&back=)", () => {
  it("the defaults (近 4 周, back 0) are not in the address; the range is the old page's rangeAt", () => {
    expect(readSt("#/v2/stats", NOW)).toEqual({ preset: "4w", back: 0, from: "2026-09-10", to: "2026-10-07" });
    expect(readSt("#/v2/stats?range=week&back=1&world=omote", NOW)).toEqual({ preset: "week", back: 1, from: "2026-09-28", to: "2026-10-04" });
    expect(readSt("#/v2/stats?range=month", NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-07" });
    expect(readSt("#/v2/stats?range=day&back=2", NOW)).toMatchObject({ from: "2026-10-05", to: "2026-10-05" });
    expect(readSt("#/v2/stats?range=3m&back=1", NOW)).toMatchObject({ from: "2026-04-11", to: "2026-07-09" });
  });
  it("bad values fall back silently: range → 4w, a bad / negative / absurd back → 0", () => {
    expect(readSt("#/v2/stats?range=year", NOW).preset).toBe("4w");
    expect(readSt("#/v2/stats?range=4W", NOW).preset).toBe("4w");
    for (const b of ["-1", "1.5", "x", "", "01", "1e3", "99999999999999999999"]) expect(readSt(`#/v2/stats?back=${b}`, NOW).back).toBe(0);
    // far enough back that the year leaves four digits: not a date the server takes, so back to 0
    expect(readSt("#/v2/stats?range=3m&back=99999", NOW)).toMatchObject({ back: 0, to: "2026-10-07" });
    expect(readSt("#/v2/stats?back=12", NOW).back).toBe(12);
  });
  it("on a Monday the current week is that day alone; on the 1st the current month is", () => {
    const mon = new Date(J("2026-10-05 09:00")), first = new Date(J("2026-10-01 09:00"));
    expect(readSt("#/v2/stats?range=week", mon)).toMatchObject({ from: "2026-10-05", to: "2026-10-05" });
    expect(readSt("#/v2/stats?range=week&back=1", mon)).toMatchObject({ from: "2026-09-28", to: "2026-10-04" });
    expect(readSt("#/v2/stats?range=month", first)).toMatchObject({ from: "2026-10-01", to: "2026-10-01" });
    expect(readSt("#/v2/stats?range=month&back=1", first)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("today is Tokyo's: Tuesday 15:30 UTC is already Wednesday", () => {
    expect(readSt("#/v2/stats?range=day", new Date("2026-10-06T15:30:00Z")).to).toBe("2026-10-07");
  });
  it("a preset change clears back; the defaults are not written; other keys stay", () => {
    expect(stHash("#/v2/stats?range=week&back=3&lang=ja", { preset: "month" })).toBe("#/v2/stats?range=month&lang=ja");
    expect(stHash("#/v2/stats?range=week&back=3", { preset: "4w" })).toBe("#/v2/stats");
    expect(stHash("#/v2/stats?range=day", { back: 2 })).toBe("#/v2/stats?range=day&back=2");
    expect(stHash("#/v2/stats?range=day&back=2", { back: 0 })).toBe("#/v2/stats?range=day");
    expect(stHash("#/v2/stats?range=bogus&back=-4&world=omote", { back: 1 })).toBe("#/v2/stats?back=1&world=omote");   // bad values cleaned on write
    expect(stHash("#/v2/stats?back=2", { back: -1 })).toBe("#/v2/stats");
  });
});

describe("useSt", () => {
  afterEach(() => { vi.useRealTimers(); window.location.hash = ""; });

  it("presets and ‹ › replace the entry (no history), and the state follows", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.location.hash = "#/v2/stats";
    const before = window.history.length;
    const { result } = renderHook(() => useSt());
    expect(result.current.st).toMatchObject({ preset: "4w", back: 0 });
    act(() => result.current.setBack(1));
    expect(window.location.hash).toBe("#/v2/stats?back=1");
    expect(result.current.st).toMatchObject({ back: 1, from: "2026-08-13", to: "2026-09-09" });
    act(() => result.current.setPreset("week"));
    expect(window.location.hash).toBe("#/v2/stats?range=week");
    expect(result.current.st).toMatchObject({ preset: "week", back: 0, from: "2026-10-05", to: "2026-10-07" });
    expect(window.history.length).toBe(before);
  });

  it("crossing 00:00 Tokyo moves the range on with no address change", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(J("2026-10-07 23:59")));
    window.location.hash = "#/v2/stats?range=day";
    const { result } = renderHook(() => useSt());
    expect(result.current.st).toMatchObject({ from: "2026-10-07", to: "2026-10-07" });
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(result.current.st).toMatchObject({ from: "2026-10-08", to: "2026-10-08" });
    expect(window.location.hash).toBe("#/v2/stats?range=day");
  });
});
