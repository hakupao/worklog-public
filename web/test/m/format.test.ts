import { describe, expect, it } from "vitest";
import { dayTitle, hmClock, hours1, isSyncStale, relWord, splitAt, stepDay, swipeOf } from "../../src/m/format";

describe("m format", () => {
  it("hmClock rounds before splitting", () => {
    expect([0, 5, 59.6, 312, 6000].map(hmClock)).toEqual(["0:00", "0:05", "1:00", "5:12", "100:00"]);
    expect(hmClock(-3)).toBe("0:00");
  });
  it("splitAt: the words before the placeholder", () => {
    expect(splitAt("zh", "m.now.syncAt")).toBe("同步 ");
    expect(splitAt("ja", "m.now.syncAt")).toBe("同期 ");
    expect(splitAt("en", "m.now.syncAt")).toBe("Synced ");
    expect(splitAt("zh", "m.now.week")).toBe("本周 ");
  });
  it("hours1", () => { expect([0, 90, 2287].map(hours1)).toEqual(["0.0", "1.5", "38.1"]); });
  it("names today / tomorrow / yesterday in three languages", () => {
    expect(relWord("2026-10-13", "2026-10-13", "zh")).toBe("今天");
    expect(relWord("2026-10-14", "2026-10-13", "ja")).toBe("明日");
    expect(relWord("2026-10-12", "2026-10-13", "en")).toBe("Yesterday");
    expect(relWord("2026-10-20", "2026-10-13", "zh")).toBe("");
    expect(dayTitle("2026-10-13", "2026-10-13", "zh")).toBe("10/13 周二 · 今天");
    expect(dayTitle("2026-10-13", "2026-10-13", "ja")).toBe("10/13 火 · 今日");
    expect(dayTitle("2026-10-20", "2026-10-13", "en")).toBe("10/20 Tue");
  });
  it("collection is stale after two hours or when never seen", () => {
    const now = Date.parse("2026-10-13T07:00:00Z");
    expect(isSyncStale(now - 119 * 60_000, now)).toBe(false);
    expect(isSyncStale(now - 121 * 60_000, now)).toBe(true);
    expect(isSyncStale(null, now)).toBe(true);
  });
  it("stepDay stops at the bounds", () => {
    expect(stepDay("2026-10-13", 1, undefined, "2026-10-13")).toBeNull();
    expect(stepDay("2026-10-13", -1, undefined, "2026-10-13")).toBe("2026-10-12");
    expect(stepDay("2026-10-01", -1, "2026-10-01")).toBeNull();
    expect(stepDay("2026-10-31", 1)).toBe("2026-11-01");
  });
  it("swipeOf needs 60px and a mostly horizontal move", () => {
    expect(swipeOf(-80, 10)).toBe(1);
    expect(swipeOf(80, 10)).toBe(-1);
    expect(swipeOf(-50, 0)).toBe(0);
    expect(swipeOf(-80, 60)).toBe(0);
  });
});
