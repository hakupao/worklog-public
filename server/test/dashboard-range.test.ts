import { describe, expect, it } from "vitest";
import { datesIn, parseRange } from "../src/dashboard/range";

describe("parseRange", () => {
  it("defaults to the 28 days ending today", () => {
    expect(parseRange(undefined, undefined, "2026-09-29")).toEqual({
      range: { from: "2026-09-02", to: "2026-09-29" },
      prev: { from: "2026-08-05", to: "2026-09-01" },
    });
  });
  it("takes an explicit range and a previous period of the same length", () => {
    expect(parseRange("2026-09-21", "2026-09-27", "2026-09-29")).toEqual({
      range: { from: "2026-09-21", to: "2026-09-27" },
      prev: { from: "2026-09-14", to: "2026-09-20" },
    });
  });
  it.each([
    ["2026-9-1", "2026-09-29"],
    ["2026-02-30", "2026-03-01"],
    ["2026-09-29", "2026-09-01"],
    ["2025-01-01", "2026-09-29"],
    ["2026-09-01", undefined],
    ["2026-13-01", "2026-13-02"],
    ["2026-00-10", "2026-09-01"],
    ["2026-09-32", "2026-10-01"],
  ])("rejects from=%s to=%s", (from, to) => {
    expect(parseRange(from, to, "2026-09-29")).toHaveProperty("error");
  });
  it("lists every date of a range", () => {
    expect(datesIn({ from: "2026-09-29", to: "2026-10-01" })).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  });
});
