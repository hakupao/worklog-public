import { describe, expect, it } from "vitest";
import { agoLabel, dirName, hours, isStale, minutesToHoursInput, parseHoursInput } from "../../src/lib/format";

describe("format", () => {
  it("hours", () => {
    expect(hours(150)).toBe("2.5h");
    expect(hours(0)).toBe("0h");
    expect(hours(60)).toBe("1h");
    expect(hours(5)).toBe("0.1h");
  });
  it("dirName", () => {
    expect(dirName("/Volumes/Data/Projects/LEDGER")).toBe("LEDGER");
    expect(dirName("/Volumes/Data/Projects/LEDGER/")).toBe("LEDGER");
    expect(dirName("C:\\work\\order-system")).toBe("order-system");
    expect(dirName("")).toBe("(不明)");
  });
  it("agoLabel and isStale", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    expect(agoLabel("2026-09-22T11:48:00Z", now)).toBe("12 分前");
    expect(agoLabel("2026-09-22T09:00:00Z", now)).toBe("3 小时前");
    expect(agoLabel("2026-09-20T12:00:00Z", now)).toBe("2 天前");
    expect(isStale("2026-09-21T11:59:59Z", now)).toBe(true);
    expect(isStale("2026-09-21T12:00:01Z", now)).toBe(false);
  });

  // hours() rounds to the nearest 0.1h; see task-3-report.md for why this is fine for a
  // minute-granularity timesheet (the widest single-entry error is +/- 3 minutes).
  it("hours rounds sub-6-minute amounts to the nearest tenth of an hour", () => {
    expect(hours(1)).toBe("0h");
    expect(hours(2)).toBe("0h");
    expect(hours(3)).toBe("0.1h"); // exactly 0.05h, rounds up
    expect(hours(59)).toBe("1h"); // 0.9833h rounds to 1.0h
  });

  // Finding (c): a bad/missing server value must never render as "NaNh" or a negative hour count.
  it("hours guards against non-finite and negative input", () => {
    expect(hours(Number.NaN)).toBe("0h");
    expect(hours(-5)).toBe("0h");
    expect(hours(Number.POSITIVE_INFINITY)).toBe("0h");
  });

  // Finding 1: ordinary clock skew between the browser and the server can put a timestamp
  // slightly (or a full day) ahead of `now`. That must never show as a negative count.
  it("agoLabel and isStale are clock-skew-safe for a future timestamp", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    expect(agoLabel(new Date(now.getTime() + 30_000).toISOString(), now)).toBe("0 分前");
    expect(agoLabel(new Date(now.getTime() + 86_400_000).toISOString(), now)).toBe("0 分前");
    expect(isStale(new Date(now.getTime() + 86_400_000).toISOString(), now)).toBe(false);
  });

  describe("parseHoursInput", () => {
    it("accepts a plain decimal hours figure and rounds to the nearest minute", () => {
      expect(parseHoursInput("2.5")).toEqual({ ok: true, minutes: 150 });
    });
    it("accepts a comma as the decimal separator", () => {
      expect(parseHoursInput("2,5")).toEqual({ ok: true, minutes: 150 });
    });
    it("accepts 0 as a real value, not empty input", () => {
      expect(parseHoursInput("0")).toEqual({ ok: true, minutes: 0 });
    });
    it("rounds a sub-minute fraction (0.1h = 6 minutes exactly)", () => {
      expect(parseHoursInput("0.1")).toEqual({ ok: true, minutes: 6 });
    });
    it("trims surrounding whitespace", () => {
      expect(parseHoursInput(" 1 ")).toEqual({ ok: true, minutes: 60 });
    });
    it("rejects empty input", () => {
      expect(parseHoursInput("").ok).toBe(false);
      expect(parseHoursInput("   ").ok).toBe(false);
    });
    it("rejects non-numeric text", () => {
      expect(parseHoursInput("abc").ok).toBe(false);
    });
    it("rejects a negative value", () => {
      expect(parseHoursInput("-1").ok).toBe(false);
    });
    it("rejects scientific notation (a technically-parseable but never hand-typed form)", () => {
      expect(parseHoursInput("1e3").ok).toBe(false);
    });
    it("rejects more than 24 hours", () => {
      const result = parseHoursInput("25");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/24/);
    });
    it("accepts exactly 24 hours (the boundary is inclusive)", () => {
      expect(parseHoursInput("24")).toEqual({ ok: true, minutes: 1440 });
    });

    // F2 (task 9's fix round 1): a session/note's 24h default is wrong for a TASK's cumulative
    // hours_manual, which the server itself does not cap.
    describe("opts.maxHours (a caller-supplied cap, default 24)", () => {
      it("a figure within the default 24h cap is still accepted when no opts are given", () => {
        expect(parseHoursInput("23")).toEqual({ ok: true, minutes: 1380 });
      });
      it("rejects 30 by default, but accepts it with a raised maxHours", () => {
        expect(parseHoursInput("30").ok).toBe(false);
        expect(parseHoursInput("30", { maxHours: 10_000 })).toEqual({ ok: true, minutes: 1800 });
      });
      it("still rejects past the raised cap, naming the actual limit in effect", () => {
        const result = parseHoursInput("10001", { maxHours: 10_000 });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/10000/);
      });
      it("the default rejection message still names 24", () => {
        const result = parseHoursInput("25");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/24/);
      });
    });
  });

  describe("minutesToHoursInput", () => {
    it("round-trips through parseHoursInput for a value with no clean decimal", () => {
      expect(minutesToHoursInput(20)).toBe("0.33");
      expect(parseHoursInput(minutesToHoursInput(20))).toEqual({ ok: true, minutes: 20 });
    });
    it("drops a trailing .0 for whole hours", () => {
      expect(minutesToHoursInput(60)).toBe("1");
      expect(minutesToHoursInput(0)).toBe("0");
    });
    it("guards against non-finite and negative input", () => {
      expect(minutesToHoursInput(Number.NaN)).toBe("0");
      expect(minutesToHoursInput(-5)).toBe("0");
    });
  });
});
