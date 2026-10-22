import { describe, expect, it } from "vitest";
import {
  clockHour, cutDays, day5, DAY_MS, dayStartMs, daysOf, HOUR_MS, hourOf5, isoWeekKey, weekdayOf, weekMonday,
} from "../src/pages/stats/viz/day";
import { jst } from "./viz-fixture";

describe("7b day helpers (5:00 days, JST, epoch ms)", () => {
  it("constants", () => {
    expect(DAY_MS).toBe(86_400_000);
    expect(HOUR_MS).toBe(3_600_000);
  });

  it("dayStartMs is 05:00 JST of the date (20:00Z the day before)", () => {
    expect(dayStartMs("2026-09-21")).toBe(Date.parse("2026-09-20T20:00:00Z"));
    expect(dayStartMs("2026-09-22") - dayStartMs("2026-09-21")).toBe(DAY_MS);
  });

  it("day5: before 05:00 belongs to the previous day; 05:00 sharp starts the new one", () => {
    expect(day5(jst("2026-09-22T04:59"))).toBe("2026-09-21");
    expect(day5(jst("2026-09-22T05:00") - 1)).toBe("2026-09-21");
    expect(day5(jst("2026-09-22T05:00"))).toBe("2026-09-22");
    expect(day5(jst("2026-09-21T23:30"))).toBe("2026-09-21");
    expect(day5(jst("2026-09-22T00:30"))).toBe("2026-09-21");
    expect(day5(jst("2027-01-01T03:00"))).toBe("2026-12-31");
  });

  it("daysOf is inclusive, crosses month / year ends, empty when reversed", () => {
    expect(daysOf("2026-09-21", "2026-09-22")).toEqual(["2026-09-21", "2026-09-22"]);
    expect(daysOf("2026-09-21", "2026-09-21")).toEqual(["2026-09-21"]);
    expect(daysOf("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(daysOf("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(daysOf("2026-09-22", "2026-09-21")).toEqual([]);
  });

  it("hourOf5 counts from 05:00 in [0, 24)", () => {
    expect(hourOf5(jst("2026-09-21T05:00"))).toBe(0);
    expect(hourOf5(jst("2026-09-21T09:30"))).toBe(4.5);
    expect(hourOf5(jst("2026-09-22T00:00"))).toBe(19);
    expect(hourOf5(jst("2026-09-22T04:59"))).toBeCloseTo(23 + 59 / 60);
    expect(hourOf5(jst("2026-09-22T05:00") - 1)).toBeLessThan(24);
  });

  it("clockHour is the JST clock hour, an integer 0–23", () => {
    expect(clockHour(jst("2026-09-21T00:00"))).toBe(0);
    expect(clockHour(jst("2026-09-21T04:59"))).toBe(4);
    expect(clockHour(jst("2026-09-21T09:45"))).toBe(9);
    expect(clockHour(jst("2026-09-21T23:59"))).toBe(23);
  });

  it("weekdayOf: 0 = Monday … 6 = Sunday; weekMonday", () => {
    expect(weekdayOf("2026-09-21")).toBe(0);
    expect(weekdayOf("2026-09-26")).toBe(5);
    expect(weekdayOf("2026-09-27")).toBe(6);
    expect(weekMonday("2026-09-27")).toBe("2026-09-21");
    expect(weekMonday("2026-09-21")).toBe("2026-09-21");
    expect(weekMonday("2026-10-01")).toBe("2026-09-28");
    expect(weekMonday("2027-01-01")).toBe("2026-12-28");
  });

  it("isoWeekKey: the week belongs to its Thursday's year", () => {
    expect(isoWeekKey("2026-10-01")).toBe("2026-W40");
    expect(isoWeekKey("2026-09-21")).toBe("2026-W39");
    expect(isoWeekKey("2026-09-27")).toBe("2026-W39");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
  });

  it("cutDays splits [a, b) at every 05:00", () => {
    // E: 9/22 04:00–06:00 → 60 min on 9/21, 60 on 9/22
    expect(cutDays(jst("2026-09-22T04:00"), jst("2026-09-22T06:00"))).toEqual([
      { date: "2026-09-21", a: jst("2026-09-22T04:00"), b: jst("2026-09-22T05:00") },
      { date: "2026-09-22", a: jst("2026-09-22T05:00"), b: jst("2026-09-22T06:00") },
    ]);
    // crossing midnight stays whole
    expect(cutDays(jst("2026-09-21T23:30"), jst("2026-09-22T01:30"))).toEqual([
      { date: "2026-09-21", a: jst("2026-09-21T23:30"), b: jst("2026-09-22T01:30") },
    ]);
    // spanning two boundaries
    const parts = cutDays(jst("2026-09-21T04:00"), jst("2026-09-22T06:00"));
    expect(parts.map((p) => p.date)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(parts.map((p) => (p.b - p.a) / 60_000)).toEqual([60, 1440, 60]);
    // ending exactly at 05:00 makes no empty tail; empty / reversed input gives nothing
    expect(cutDays(jst("2026-09-22T04:00"), jst("2026-09-22T05:00")).map((p) => p.date)).toEqual(["2026-09-21"]);
    expect(cutDays(jst("2026-09-22T04:00"), jst("2026-09-22T04:00"))).toEqual([]);
    expect(cutDays(jst("2026-09-22T05:00"), jst("2026-09-22T04:00"))).toEqual([]);
  });
});
