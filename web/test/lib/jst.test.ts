import { describe, expect, it } from "vitest";
import { currentWeek, dayLabel, isValidWeek, jstDateOf, reportWeekDates, reportWeekLabel, reportWeekOf, shiftWeek, timeRange, todayJst, weekLabel, weekOfDate } from "../../src/lib/jst";
import jstSource from "../../src/lib/jst.ts?raw";

describe("jst", () => {
  it("currentWeek follows Tokyo, not UTC and not the browser", () => {
    expect(currentWeek(new Date("2026-09-20T14:59:59Z"))).toBe("2026-W38"); // Sun 23:59 JST
    expect(currentWeek(new Date("2026-09-20T15:00:00Z"))).toBe("2026-W39"); // Mon 00:00 JST
  });
  it("todayJst crosses the day at 15:00Z", () => {
    expect(todayJst(new Date("2026-09-21T14:59:59Z"))).toBe("2026-09-21");
    expect(todayJst(new Date("2026-09-21T15:00:00Z"))).toBe("2026-09-22");
  });
  it("ISO year boundaries", () => {
    expect(currentWeek(new Date("2025-12-29T03:00:00Z"))).toBe("2026-W01");
    expect(currentWeek(new Date("2027-01-01T03:00:00Z"))).toBe("2026-W53");
  });
  it("shiftWeek crosses years in both directions, including a 53-week year", () => {
    expect(shiftWeek("2026-W39", 1)).toBe("2026-W40");
    expect(shiftWeek("2026-W01", -1)).toBe("2025-W52");
    expect(shiftWeek("2026-W53", 1)).toBe("2027-W01");
    expect(shiftWeek("2027-W01", -1)).toBe("2026-W53");
  });
  it("labels", () => {
    expect(weekLabel("2026-W39")).toBe("2026-W39 (9/21〜9/27)");
    expect(dayLabel("2026-09-21")).toBe("9/21 (月)");
    expect(dayLabel("2026-09-27")).toBe("9/27 (日)");
  });
  it("timeRange renders Tokyo wall-clock time for any input offset", () => {
    expect(timeRange("2026-09-21T00:10:00Z", "2026-09-21T02:40:00Z")).toBe("09:10-11:40");
    expect(timeRange("2026-09-21T23:30:00+09:00", "2026-09-22T00:15:00+09:00")).toBe("23:30-00:15");
  });

  // |delta| > 1 and delta = 0, computed by hand (see task-3-report.md for the arithmetic).
  it("shiftWeek handles a zero delta and a delta spanning more than a year", () => {
    expect(shiftWeek("2026-W39", 0)).toBe("2026-W39");
    expect(shiftWeek("2026-W39", -52)).toBe("2025-W39");
  });
});

// scripts/test-tz.mjs re-runs this file's suite in a fresh child process per zone (env.TZ set
// before that process starts). If a future change to that runner ever silently dropped the TZ
// override (e.g. a broken spawn option), every jst test would still pass vacuously under the
// host's own zone — this fails loudly instead by confirming the process actually adopted it.
describe("TZ propagation guard", () => {
  it("confirms the process actually adopted TZ when the runner set one", () => {
    if (!process.env.TZ) return; // running under the default/host zone; nothing to confirm
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(process.env.TZ);
  });
});

describe("weekOfDate (task 8: back-dated notes)", () => {
  it("returns the ISO week label of a plain calendar-day string, no time-zone conversion", () => {
    expect(weekOfDate("2026-09-21")).toBe("2026-W39"); // Monday of W39
    expect(weekOfDate("2026-09-27")).toBe("2026-W39"); // Sunday of the same week
    expect(weekOfDate("2026-09-28")).toBe("2026-W40");
  });
  it("crosses an ISO year boundary the same way currentWeek does", () => {
    expect(weekOfDate("2025-12-29")).toBe("2026-W01");
    expect(weekOfDate("2027-01-03")).toBe("2026-W53");
  });
  it("throws a clear error on malformed input, mirroring dayLabel/weekLabel", () => {
    expect(() => weekOfDate("2026/09/21")).toThrow(/invalid date: 2026\/09\/21/);
    expect(() => weekOfDate("")).toThrow(/invalid date: /);
  });
});

describe("jstDateOf (task 9: linking a session row back to its week)", () => {
  it("crosses the day at 15:00Z, matching the server's jstDate boundary", () => {
    expect(jstDateOf("2026-09-21T14:59:59Z")).toBe("2026-09-21");
    expect(jstDateOf("2026-09-21T15:00:00Z")).toBe("2026-09-22");
  });
  it("agrees regardless of the instant's own written format (fractional seconds, explicit offset)", () => {
    expect(jstDateOf("2026-09-21T01:00:00.123456Z")).toBe("2026-09-21"); // Mon 10:00 JST
    expect(jstDateOf("2026-09-22T08:00:00+09:00")).toBe("2026-09-22"); // explicit offset, already JST
  });
});

describe("isValidWeek", () => {
  it("accepts real ISO weeks, including a 53-week year", () => {
    expect(isValidWeek("2026-W39")).toBe(true);
    expect(isValidWeek("2026-W53")).toBe(true); // 2026 has 53 weeks
  });
  it("rejects a week number that doesn't exist that year, out-of-range weeks, and malformed input", () => {
    expect(isValidWeek("2025-W53")).toBe(false); // 2025 has only 52 weeks
    expect(isValidWeek("2026-W00")).toBe(false);
    expect(isValidWeek("2026-W54")).toBe(false);
    expect(isValidWeek("2026-39")).toBe(false);
    expect(isValidWeek("")).toBe(false);
    expect(isValidWeek("abcd-W01")).toBe(false);
  });
});

describe("shiftWeek/weekLabel reject invalid weeks instead of returning garbage", () => {
  it("throws a clear error", () => {
    expect(() => shiftWeek("2025-W53", 1)).toThrow(/invalid week: 2025-W53/);
    expect(() => weekLabel("2025-W53")).toThrow(/invalid week: 2025-W53/);
    expect(() => shiftWeek("garbage", 0)).toThrow(/invalid week: garbage/);
    expect(() => weekLabel("")).toThrow(/invalid week: /);
  });
});

/** True if `source` calls the local-time `new Date(year, month, day, ...)` constructor — the
 *  exact bug class this module exists to prevent. Must not be fooled by a nested call that
 *  itself contains commas, e.g. `new Date(Date.UTC(2026, 8, 21))` (a single, timezone-safe
 *  argument): nested parens are stripped before checking for a top-level comma. */
function usesLocalDateConstructor(source: string): boolean {
  const calls = source.matchAll(/new Date\(\s*((?:[^()]|\([^()]*\))*)\)/g);
  for (const [, args] of calls) {
    if (args.replace(/\([^()]*\)/g, "").includes(",")) return true;
  }
  return false;
}

describe("usesLocalDateConstructor (test helper)", () => {
  it("flags a multi-argument local constructor, not a single argument or a nested Date.UTC", () => {
    expect(usesLocalDateConstructor("new Date(2026, 8, 21)")).toBe(true);
    expect(usesLocalDateConstructor("new Date(ms)")).toBe(false);
    expect(usesLocalDateConstructor("new Date(Date.UTC(2026, 8, 21))")).toBe(false);
  });
});

// The same five cases as server/test/report-week.test.ts (server/src/report/week.ts), on the web's calls.
describe("report week (Sat→Fri, 05:00 JST day)", () => {
  const jst = (s: string) => Date.parse(`${s}+09:00`);
  it("the day turns at 05:00 JST: Saturday before 05:00 is still Friday's", () => {
    expect(reportWeekOf(jst("2026-10-03T04:59:59"))).toBe("2026-W40");
    expect(reportWeekOf(jst("2026-10-03T05:00:00"))).toBe("2026-W41");
    expect(reportWeekOf(new Date(jst("2026-10-03T05:00:00")))).toBe("2026-W41");
  });
  it("W40 is Sat 9/26 → Fri 10/2", () => {
    expect(reportWeekDates("2026-W40")).toEqual(["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(reportWeekLabel("2026-W40")).toBe("2026-W40 (9/26(土)〜10/2(金))");
    expect(reportWeekLabel("2026-W40", { from: "2026-09-26", to: "2026-10-02" })).toBe("2026-W40 (9/26(土)〜10/2(金))");
  });
  it("reportWeekOf follows the Friday", () => {
    expect(reportWeekOf(jst("2026-10-02T23:59:00"))).toBe("2026-W40");
    expect(reportWeekOf(jst("2026-10-03T04:59:00"))).toBe("2026-W40"); // still Friday's day
    expect(reportWeekOf(jst("2026-10-03T05:00:00"))).toBe("2026-W41"); // Saturday opens the next report
    expect(reportWeekOf(jst("2026-10-04T12:00:00"))).toBe("2026-W41");
    expect(reportWeekOf(jst("2026-10-05T09:00:00"))).toBe("2026-W41");
  });
  it("year ends: the Saturday before ISO week 1 belongs to W01", () => {
    expect(reportWeekDates("2027-W01")[0]).toBe("2027-01-02");
    expect(reportWeekOf(jst("2027-01-02T10:00:00"))).toBe("2027-W01");
    expect(reportWeekDates("2026-W53")).toEqual(["2026-12-26", "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01"]);
  });
  it("rejects malformed keys", () => {
    expect(() => reportWeekDates("2026-40")).toThrow();
    expect(() => reportWeekDates("2025-W53")).toThrow(); // 2025 has no W53
    expect(() => reportWeekLabel("2025-W53")).toThrow();
  });
});

describe("jst forbidden APIs", () => {
  it("never uses Date's local-time getters, the local-time constructor, or an unzoned formatter", () => {
    const forbidden = [
      "getDay(",
      "getDate(",
      "getMonth(",
      "getFullYear(",
      "getHours(",
      "getMinutes(",
      "getTimezoneOffset(",
      "toLocaleDateString(",
      "toLocaleTimeString(",
    ];
    for (const pattern of forbidden) {
      expect(jstSource.includes(pattern), `jst.ts must not call ${pattern}`).toBe(false);
    }
    expect(usesLocalDateConstructor(jstSource), "jst.ts must not call new Date(y, m, d, ...)").toBe(false);
    // Intl.DateTimeFormat is only allowed with an explicit timeZone option; jst.ts doesn't use
    // it at all today, but guard against a future unzoned call creeping in.
    const dtfCalls = jstSource.match(/Intl\.DateTimeFormat\([^)]*\)/g) ?? [];
    for (const call of dtfCalls) {
      expect(call, `${call} must pass an explicit timeZone`).toMatch(/timeZone/);
    }
  });
});
