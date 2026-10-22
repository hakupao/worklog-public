import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isDate, plHash, readPl, usePl } from "../src/pages/plan/state";
import { J } from "../src/predict/fixtures";

const NOW = new Date(J("2026-10-02 14:20"));

describe("计划 state (#/v2/plan[/<date>]?day=|item=)", () => {
  it("no date in the path is today; a drawer from ?day= or ?item=", () => {
    expect(readPl("#/v2/plan", NOW)).toEqual({ date: "2026-10-02", isToday: true, open: null });
    expect(readPl("#/v2/plan/2026-09-30?day=D1&world=omote", NOW)).toEqual({ date: "2026-09-30", isToday: false, open: { kind: "day", id: "D1" } });
    expect(readPl("#/v2/plan?item=P7", NOW).open).toEqual({ kind: "item", id: "P7" });
  });
  it("a bad date falls back to today (not a crash, not a blank page)", () => {
    expect(readPl("#/v2/plan/2026-02-30", NOW).date).toBe("2026-10-02");
    expect(readPl("#/v2/plan/yesterday", NOW).date).toBe("2026-10-02");
    expect(readPl("#/v2/plan/%E0", NOW).date).toBe("2026-10-02");
    expect(isDate("2026-10-05")).toBe(true);
    expect(isDate("2026-1-5")).toBe(false);
  });
  it("today's date: the path is just #/v2/plan, after 00:00 Tokyo as well", () => {
    // 15:30 UTC = 00:30 the next day in Tokyo
    expect(readPl("#/v2/plan", new Date("2026-10-02T15:30:00Z")).date).toBe("2026-10-03");
    expect(plHash("#/v2/plan/2026-09-30", { date: "2026-10-02" }, NOW)).toBe("#/v2/plan");
  });
  it("a patch keeps ?world= / ?lang=; opening one drawer replaces the other; another day closes it", () => {
    expect(plHash("#/v2/plan?lang=ja", { open: { kind: "day", id: "D1" } }, NOW)).toBe("#/v2/plan?lang=ja&day=D1");
    expect(plHash("#/v2/plan?day=D1", { open: { kind: "item", id: "P 2" } }, NOW)).toBe("#/v2/plan?item=P+2");
    expect(plHash("#/v2/plan?day=D1&world=omote", { open: null }, NOW)).toBe("#/v2/plan?world=omote");
    expect(plHash("#/v2/plan?day=D1", { date: "2026-10-01" }, NOW)).toBe("#/v2/plan/2026-10-01");
    expect(plHash("#/v2/plan/2026-10-01?item=P1", { date: "2026-10-01" }, NOW)).toBe("#/v2/plan/2026-10-01?item=P1");
  });
});

describe("usePl over time", () => {
  it("a bare #/v2/plan moves to the new day at 00:00 Tokyo, without touching the address", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(J("2026-10-02 23:59")));
    window.location.hash = "#/v2/plan";
    const { result } = renderHook(() => usePl());
    expect(result.current[0].date).toBe("2026-10-02");
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(result.current[0]).toMatchObject({ date: "2026-10-03", isToday: true });
    vi.useRealTimers();
    window.location.hash = "";
  });
});
