import { describe, expect, it } from "vitest";
import { hourSlots } from "../src/runs";

const T = (s: string) => Date.parse(s);
describe("hourSlots", () => {
  const now = T("2026-10-14T05:20:00Z");             // 14:20 JST
  it("puts a run in its hour; the last slot is the current hour", () => {
    const h = hourSlots(["2026-10-14T05:01:00Z", "2026-10-14T04:59:59Z"], now);
    expect(h).toHaveLength(24);
    expect(h[23]).toBe(true);
    expect(h[22]).toBe(true);
    expect(h.filter(Boolean)).toHaveLength(2);
  });
  it("drops runs older than 24 slots and runs in the future", () => {
    expect(hourSlots(["2026-10-13T05:59:59Z", "2026-10-14T06:00:00Z"], now).some(Boolean)).toBe(false);
    expect(hourSlots(["2026-10-13T06:00:00Z"], now)[0]).toBe(true);
  });
  it("crosses the JST midnight like any other hour", () => {
    // 2026-10-13T15:30Z is 00:30 JST on 10/14; now 14:20 JST → slot 23 - 14 = 9
    expect(hourSlots(["2026-10-13T15:30:00Z"], now).indexOf(true)).toBe(9);
  });
  it("ignores unparseable stamps", () => {
    expect(hourSlots(["nope"], now).some(Boolean)).toBe(false);
  });
});
