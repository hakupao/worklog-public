import { describe, expect, it } from "vitest";
import { datesOf, rangeDates, topTasks, weeksOf } from "../../src/m/pages/statsRange";

describe("stats ranges", () => {
  it("today, ISO week, calendar month (incl. December and a leap February)", () => {
    expect(rangeDates("today", "2026-10-13")).toEqual({ from: "2026-10-13", to: "2026-10-13" });
    expect(rangeDates("week", "2026-10-13")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(rangeDates("month", "2026-10-13")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeDates("month", "2026-12-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(rangeDates("month", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("dates and the ISO weeks that cover them", () => {
    expect(datesOf("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(weeksOf("2026-10-01", "2026-10-31")).toEqual(["2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44"]);
  });
  it("a month crossing ISO week years starts in the old year's last week", () => {
    expect(weeksOf("2027-01-01", "2027-01-31")).toEqual(["2026-W53", "2027-W01", "2027-W02", "2027-W03", "2027-W04"]);
  });
  it("top five, the rest folded into one row", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ title: `t${i}`, minutes: 100 - i }));
    const out = topTasks(rows, 5, "其他");
    expect(out.map((r) => r.title)).toEqual(["t0", "t1", "t2", "t3", "t4", "其他"]);
    expect(out[5].minutes).toBe(95 + 94 + 93);
    expect(topTasks(rows.slice(0, 3), 5, "其他")).toHaveLength(3);
  });
});
