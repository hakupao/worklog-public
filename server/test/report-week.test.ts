import { describe, expect, it } from "vitest";
import { day5Of, dayStart5, reportWeekOf, reportWeekRange } from "../src/report/week";

const jst = (s: string) => Date.parse(`${s}+09:00`);

describe("report week (Sat→Fri, 05:00 JST day)", () => {
  it("day5Of: before 05:00 JST is the previous day", () => {
    expect(day5Of(jst("2026-10-03T04:59:59"))).toBe("2026-10-02");
    expect(day5Of(jst("2026-10-03T05:00:00"))).toBe("2026-10-03");
    expect(dayStart5("2026-10-03")).toBe(jst("2026-10-03T05:00:00"));
  });

  it("W40 is Sat 9/26 → Fri 10/2, [9/26 05:00, 10/3 05:00)", () => {
    const r = reportWeekRange("2026-W40")!;
    expect(r.days).toEqual(["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(r.startMs).toBe(jst("2026-09-26T05:00:00"));
    expect(r.endMs).toBe(jst("2026-10-03T05:00:00"));
    expect(r.startUnix).toBe(r.startMs / 1000);
  });

  it("reportWeekOf follows the Friday", () => {
    expect(reportWeekOf(jst("2026-10-02T23:59:00"))).toBe("2026-W40");
    expect(reportWeekOf(jst("2026-10-03T04:59:00"))).toBe("2026-W40"); // still Friday's day
    expect(reportWeekOf(jst("2026-10-03T05:00:00"))).toBe("2026-W41"); // Saturday opens the next report
    expect(reportWeekOf(jst("2026-10-04T12:00:00"))).toBe("2026-W41");
    expect(reportWeekOf(jst("2026-10-05T09:00:00"))).toBe("2026-W41");
  });

  it("year ends: the Saturday before ISO week 1 belongs to W01", () => {
    expect(reportWeekRange("2027-W01")!.days[0]).toBe("2027-01-02");
    expect(reportWeekOf(jst("2027-01-02T10:00:00"))).toBe("2027-W01");
    expect(reportWeekRange("2026-W53")!.days).toEqual(["2026-12-26", "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("rejects malformed keys", () => {
    expect(reportWeekRange("2026-40")).toBeNull();
    expect(reportWeekRange("2025-W53")).toBeNull(); // 2025 has no W53
  });
});
