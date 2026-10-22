import { describe, expect, it } from "vitest";
import { makeCalendar } from "../src/cal/calendar";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import type { ModeCfg } from "../src/prefs/types";
import {
  addDays, currentMode, daysBetween, daysOf, dayStart, hmOf, inWindow, jstDate, jstMinute, jstWeekday, mdOf, prevWorkday, windowAge,
} from "../src/predict/time";

/** Tokyo wall clock → instant. */
const J = (s: string) => Date.parse(`${s.replace(" ", "T")}:00+09:00`);
const M = DEFAULT_PREFS.predict.modes;

describe("Tokyo calendar", () => {
  it("date, minute and weekday flip at Tokyo midnight, whatever the host zone", () => {
    expect([jstDate(J("2026-10-02 23:59")), jstMinute(J("2026-10-02 23:59")), jstWeekday(J("2026-10-02 23:59"))]).toEqual(["2026-10-02", 1439, 5]);
    expect([jstDate(J("2026-10-03 00:00")), jstMinute(J("2026-10-03 00:00")), jstWeekday(J("2026-10-03 00:00"))]).toEqual(["2026-10-03", 0, 6]);
    expect(dayStart("2026-10-03")).toBe(J("2026-10-03 00:00"));
    expect(hmOf(J("2026-10-02 09:05"))).toBe("09:05");
    expect(mdOf("2026-10-02")).toBe("10/2");
  });
  it("day arithmetic and the previous workday", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-02", "2026-10-09")).toBe(7);
    expect(prevWorkday("2026-10-02")).toBe("2026-10-01");   // Fri → Thu
    expect(prevWorkday("2026-10-05")).toBe("2026-10-02");   // Mon → Fri
    expect(prevWorkday("2026-10-04")).toBe("2026-10-02");   // Sun → Fri
    expect(prevWorkday("2026-10-20")).toBe("2026-10-19");   // plain Tue → Mon
    expect(prevWorkday("2026-11-04")).toBe("2026-11-03");   // default: weekends only (the leaf does not know 祝日)
    const cal = makeCalendar(DEFAULT_PREFS.cal).isOff;
    expect(prevWorkday("2026-11-04", cal)).toBe("2026-11-02");   // skips 文化の日 11/03
    expect(prevWorkday("2027-01-04", cal)).toBe("2026-12-28");   // skips the year-end break and the weekend
    const allOff = makeCalendar({ ...DEFAULT_PREFS.cal, breaks: [{ name: "x", from: "01-01", to: "12-31" }] }).isOff;
    expect(prevWorkday("2026-10-06", allOff)).toBe("2026-10-05");   // every day off: bounded, falls back to the day before
    expect(prevWorkday("2026-10-06", (d) => d === "2026-10-05" || d === "2026-10-04" || d === "2026-10-03")).toBe("2026-10-02");   // injected isOff
  });
  it("daysOf: a span across midnight belongs to both days; ending exactly at midnight does not", () => {
    expect(daysOf(J("2026-10-01 23:30"), J("2026-10-02 00:20"))).toEqual(["2026-10-01", "2026-10-02"]);
    expect(daysOf(J("2026-10-01 23:30"), J("2026-10-02 00:00"))).toEqual(["2026-10-01"]);
    expect(daysOf(J("2026-10-01 10:00"), J("2026-10-01 10:00"))).toEqual(["2026-10-01"]);
  });
});

describe("windows", () => {
  it("a same-day window includes its start and excludes its end", () => {
    expect(windowAge(J("2026-10-02 10:59"), M.focus)).toBeNull();
    expect(windowAge(J("2026-10-02 11:00"), M.focus)).toBe(0);
    expect(windowAge(J("2026-10-02 17:59"), M.focus)).toBe(419);
    expect(windowAge(J("2026-10-02 18:00"), M.focus)).toBeNull();
    expect(inWindow(J("2026-10-03 12:00"), M.focus)).toBe(false);          // Saturday
  });
  it("a window across midnight: the part after midnight counts for the day it opened", () => {
    const late: ModeCfg = { from: "22:00", to: "02:00", days: [5] };
    expect(windowAge(J("2026-10-02 23:00"), late)).toBe(60);              // Fri
    expect(windowAge(J("2026-10-03 01:00"), late)).toBe(180);             // Sat 01:00, opened Fri
    expect(windowAge(J("2026-10-03 02:00"), late)).toBeNull();
    expect(windowAge(J("2026-10-02 01:00"), late)).toBeNull();            // opened Thu, not a listed day
  });
  it("'to 00:00' runs to midnight and stops there", () => {
    expect(windowAge(J("2026-10-02 23:59"), M.wrap)).toBe(359);
    expect(windowAge(J("2026-10-03 00:01"), M.wrap)).toBeNull();
  });
  it("from === to is the whole day", () => {
    expect(windowAge(J("2026-10-03 03:00"), { from: "09:00", to: "09:00", days: [6] })).toBe(180);
  });
});

describe("currentMode (defaults)", () => {
  it("names the mode whose window opened last", () => {
    expect(currentMode(J("2026-10-02 09:05"), M)).toBe("morning");
    expect(currentMode(J("2026-10-02 14:20"), M)).toBe("focus");
    expect(currentMode(J("2026-10-02 16:30"), M)).toBe("weekly");      // focus and weekly overlap: weekly opened later
    expect(currentMode(J("2026-10-02 18:45"), M)).toBe("wrap");        // weekly and wrap overlap: wrap opened later
    expect(currentMode(J("2026-10-01 16:30"), M)).toBe("focus");       // Thursday: no weekly
    expect(currentMode(J("2026-10-05 23:59"), M)).toBe("wrap");
  });
  it("no mode outside every window", () => {
    expect(currentMode(J("2026-10-05 05:59"), M)).toBeNull();
    expect(currentMode(J("2026-10-03 10:00"), M)).toBeNull();          // Saturday
  });
});
