import { describe, expect, it } from "vitest";
import { delta, presetRange, rangeAt } from "../../src/pages/stats/range";

describe("presetRange", () => {
  it("computes each preset ending today", () => {
    expect(presetRange("day", "2026-09-30")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(presetRange("week", "2026-09-30")).toEqual({ from: "2026-09-28", to: "2026-09-30" });  // Wed -> Mon
    expect(presetRange("month", "2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("4w", "2026-09-30")).toEqual({ from: "2026-09-03", to: "2026-09-30" });
    expect(presetRange("3m", "2026-09-30")).toEqual({ from: "2026-07-03", to: "2026-09-30" });
  });
});

describe("rangeAt", () => {
  const today = "2026-09-30"; // a Wednesday

  it("offset 0 is the preset itself", () => {
    for (const p of ["day", "week", "month", "4w", "3m"] as const) {
      expect(rangeAt(p, 0, today)).toEqual(presetRange(p, today));
    }
  });
  it("steps a day back one day at a time", () => {
    expect(rangeAt("day", 1, today)).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(rangeAt("day", 30, today)).toEqual({ from: "2026-08-31", to: "2026-08-31" });
  });
  it("an earlier week is a whole Monday-to-Sunday week", () => {
    expect(rangeAt("week", 1, today)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(rangeAt("week", 2, today)).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });
  it("an earlier month is the whole calendar month, February included", () => {
    expect(rangeAt("month", 1, today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(rangeAt("month", 7, today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(rangeAt("month", 1, "2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("rolling presets step by their own length, back to back", () => {
    expect(rangeAt("4w", 1, today)).toEqual({ from: "2026-08-06", to: "2026-09-02" });
    expect(rangeAt("3m", 1, today)).toEqual({ from: "2026-04-04", to: "2026-07-02" });
  });
});

describe("delta", () => {
  it("shows percentage change, new, and flat", () => {
    expect(delta(150, 100)).toEqual({ text: "+50%", dir: "up" });
    expect(delta(50, 100)).toEqual({ text: "-50%", dir: "down" });
    expect(delta(10, 0)).toEqual({ text: "新", dir: "new" });
    expect(delta(0, 0)).toEqual({ text: "—", dir: "flat" });
  });
});
