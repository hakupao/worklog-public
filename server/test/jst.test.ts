import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isoWeekOf, jstClock, jstDate, weekRange } from "../src/jst";

describe("jst", () => {
  it("2026-W39 is Mon 9/21 .. Sun 9/27, starting at Monday 00:00 JST", () => {
    const r = weekRange("2026-W39")!;
    expect(r.days).toEqual(["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(new Date(r.startUnix * 1000).toISOString()).toBe("2026-09-20T15:00:00.000Z");
    expect(r.endUnix - r.startUnix).toBe(7 * 86400);
  });

  it("week 1 can start in the previous year", () => {
    expect(weekRange("2026-W01")!.days[0]).toBe("2025-12-29");
  });

  it("accepts week 53 only in years that have one", () => {
    expect(weekRange("2026-W53")!.days[0]).toBe("2026-12-28");
    expect(weekRange("2025-W53")).toBeNull();
  });

  it("rejects malformed input", () => {
    for (const w of ["2026-39", "2026-W00", "2026-W54", "abcd-W01", ""]) expect(weekRange(w)).toBeNull();
  });

  it("jstDate crosses the day boundary at 15:00Z", () => {
    expect(jstDate("2026-09-20T14:59:59Z")).toBe("2026-09-20");
    expect(jstDate("2026-09-20T15:00:00Z")).toBe("2026-09-21");
    expect(jstDate("2026-09-21T23:30:00+09:00")).toBe("2026-09-21");
  });
});

describe("dashboard date helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });
  it("counts days between two dates", () => {
    expect(daysBetween("2026-09-01", "2026-09-29")).toBe(28);
    expect(daysBetween("2026-09-29", "2026-09-29")).toBe(0);
  });
  it("gives the ISO week of a date, including year boundaries", () => {
    expect(isoWeekOf("2026-09-21")).toBe("2026-W39");
    expect(isoWeekOf("2026-09-27")).toBe("2026-W39");
    expect(isoWeekOf("2026-12-31")).toBe("2026-W53");
    expect(isoWeekOf("2027-01-03")).toBe("2026-W53");
    expect(isoWeekOf("2027-01-04")).toBe("2027-W01");
  });
  it("reads the Tokyo clock of an instant", () => {
    expect(jstClock("2026-09-20T15:30:00Z")).toEqual({ date: "2026-09-21", weekday: 0, minuteOfDay: 30 });
    expect(jstClock("2026-09-27T13:00:00Z")).toEqual({ date: "2026-09-27", weekday: 6, minuteOfDay: 22 * 60 });
  });
});
