import { describe, expect, it } from "vitest";
import { isV2Hash, parseV2Route } from "../src/route";

describe("v2 routes", () => {
  it("recognises the v2 entrance", () => {
    expect(["#/v2", "#/v2/", "#/v2/now", "#/v2/settings?world=omote"].map(isV2Hash)).toEqual([true, true, true, true]);
    expect(["", "#/", "#/timeline/2026-W40", "#/v20", "#/v2x"].map(isV2Hash)).toEqual([false, false, false, false, false]);
  });
  it("parses page and param, ignoring the query", () => {
    expect(parseV2Route("#/v2/tasks/T1?world=omote")).toEqual({ page: "tasks", param: "T1" });
    expect(parseV2Route("#/v2/settings")).toEqual({ page: "settings", param: null });
  });
  it("falls back to now", () => {
    expect(parseV2Route("#/v2")).toEqual({ page: "now", param: null });
    expect(parseV2Route("#/v2/bogus")).toEqual({ page: "now", param: null });
  });
});
