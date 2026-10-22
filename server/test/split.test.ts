import { describe, expect, it } from "vitest";
import { apportion, cellKey, hourPieces, splitMinutes } from "../src/split";

const obj = (m: Map<string, number>) => Object.fromEntries(m);
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("hourPieces", () => {
  it("cuts at Tokyo whole hours, including midnight", () => {
    // 23:30 -> 00:30 JST on Tue 9/29 -> Wed 9/30
    const p = hourPieces([["2026-09-29T14:30:00Z", "2026-09-29T15:30:00Z"]]);
    expect(p).toEqual([
      { date: "2026-09-29", weekday: 1, hour: 23, seconds: 1800 },
      { date: "2026-09-30", weekday: 2, hour: 0, seconds: 1800 },
    ]);
  });

  it("merges pieces of the same hour and drops empty or inverted intervals", () => {
    const p = hourPieces([
      ["2026-09-29T01:00:00Z", "2026-09-29T01:10:00Z"],
      ["2026-09-29T01:20:00Z", "2026-09-29T01:30:00Z"],
      ["2026-09-29T02:00:00Z", "2026-09-29T02:00:00Z"],
      ["2026-09-29T03:00:00Z", "2026-09-29T02:00:00Z"],
    ]);
    expect(p).toEqual([{ date: "2026-09-29", weekday: 1, hour: 10, seconds: 1200 }]);
  });

  it("accepts an explicit offset", () => {
    const p = hourPieces([["2026-09-22T08:00:00+09:00", "2026-09-22T08:30:00+09:00"]]);
    expect(p).toEqual([{ date: "2026-09-22", weekday: 1, hour: 8, seconds: 1800 }]);
  });
});

describe("apportion", () => {
  it("sums to the total exactly, extra going to the largest remainders then earlier index", () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(200, [3, 1])).toEqual([150, 50]);
    expect(apportion(0, [5, 5])).toEqual([0, 0]);
    expect(apportion(7, [0, 0])).toEqual([0, 0]);
    expect(apportion(7, [])).toEqual([]);
  });
});

describe("splitMinutes", () => {
  it("halves a cluster that crosses midnight", () => {
    const s = splitMinutes({ started_at: "2026-09-29T14:30:00Z", minutes: 60,
      active_intervals: [["2026-09-29T14:30:00Z", "2026-09-29T15:30:00Z"]] });
    expect(obj(s.byDay)).toEqual({ "2026-09-29": 30, "2026-09-30": 30 });
    expect(obj(s.byCell)).toEqual({ [cellKey(1, 23)]: 30, [cellKey(2, 0)]: 30 });
    expect(s.fallback).toBe(false);
  });

  it("gives an idle gap across midnight nothing", () => {
    // 23:00-23:45 JST, 31-minute gap, 00:16-00:31 JST: 60 minutes over 45 + 15 seconds
    const s = splitMinutes({ started_at: "2026-09-29T14:00:00Z", minutes: 60, active_intervals: [
      ["2026-09-29T14:00:00Z", "2026-09-29T14:45:00Z"],
      ["2026-09-29T15:16:00Z", "2026-09-29T15:31:00Z"],
    ] });
    expect(obj(s.byDay)).toEqual({ "2026-09-29": 45, "2026-09-30": 15 });
  });

  it("scales an override by the same proportions", () => {
    const s = splitMinutes({ started_at: "2026-09-29T01:00:00Z", minutes: 200, active_intervals: [
      ["2026-09-29T01:00:00Z", "2026-09-29T04:00:00Z"],   // 3h on 9/29
      ["2026-09-30T01:00:00Z", "2026-09-30T02:00:00Z"],   // 1h on 9/30
    ] });
    expect(obj(s.byDay)).toEqual({ "2026-09-29": 150, "2026-09-30": 50 });
    expect(sum(s.byCell)).toBe(200);
  });

  it("keeps whole minutes summing to the total", () => {
    const s = splitMinutes({ started_at: "2026-09-29T01:00:00Z", minutes: 10, active_intervals: [
      ["2026-09-29T01:00:00Z", "2026-09-29T01:20:00Z"],
      ["2026-09-29T02:00:00Z", "2026-09-29T02:20:00Z"],
      ["2026-09-29T03:00:00Z", "2026-09-29T03:20:00Z"],
    ] });
    expect([...s.byCell.values()]).toEqual([4, 3, 3]);
    expect(sum(s.byDay)).toBe(10);
  });

  it("falls back to the start day and hour without usable intervals", () => {
    for (const active_intervals of [null, [], [["2026-09-29T14:30:00Z", "2026-09-29T14:30:00Z"]]] as const) {
      const s = splitMinutes({ started_at: "2026-09-29T14:30:00Z", minutes: 42,
        active_intervals: active_intervals as [string, string][] | null });
      expect(obj(s.byDay)).toEqual({ "2026-09-29": 42 });
      expect(obj(s.byCell)).toEqual({ [cellKey(1, 23)]: 42 });
      expect(s.fallback).toBe(true);
    }
  });

  it("drops a day whose share rounds to zero, and keeps a zero-minute session on its start day only", () => {
    // 30 seconds before midnight, then two hours: the first day gets 0 of 120 minutes and is not a day
    // the session was worked on, so it must not appear at all (no 0-minute timeline card).
    const s = splitMinutes({
      started_at: "2026-09-20T14:59:30Z", minutes: 120,
      active_intervals: [["2026-09-20T14:59:30Z", "2026-09-20T17:00:00Z"]],
    });
    expect([...s.byDay]).toEqual([["2026-09-21", 120]]);
    expect(s.fallback).toBe(false);
    // Under a minute of activity across midnight: nothing to split, listed once on the start day.
    const z = splitMinutes({
      started_at: "2026-09-20T14:59:40Z", minutes: 0,
      active_intervals: [["2026-09-20T14:59:40Z", "2026-09-20T15:00:20Z"]],
    });
    expect([...z.byDay]).toEqual([["2026-09-20", 0]]);
    expect(z.fallback).toBe(true);
  });

  it("spreads a 70-hour interval over four Tokyo dates", () => {
    const s = splitMinutes({ started_at: "2026-09-25T03:00:00Z", minutes: 53,
      active_intervals: [["2026-09-25T03:00:00Z", "2026-09-28T01:00:00Z"]] });
    // 12h / 24h / 24h / 10h of 70h: the days are settled first, so the last day is not starved by
    // remainder ties among 70 equal hour pieces.
    expect([...s.byDay]).toEqual([["2026-09-25", 9], ["2026-09-26", 18], ["2026-09-27", 18], ["2026-09-28", 8]]);
    expect(sum(s.byDay)).toBe(53);
    expect(sum(s.byCell)).toBe(53);
  });
});
