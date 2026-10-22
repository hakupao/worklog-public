import { describe, expect, it } from "vitest";
import { readTk, statusQuery, tkHash } from "../src/pages/tasks/state";

describe("案件 state (#/v2/tasks[/<id>]?status=)", () => {
  it("defaults: 进行中 + 保留, nothing open", () => {
    expect(readTk("#/v2/tasks")).toEqual({ open: null, statuses: ["open", "hold"] });
  });
  it("reads the open task from the path and the filter with the old page's encoding", () => {
    expect(readTk("#/v2/tasks/T20261001-02?status=all&world=omote")).toEqual({ open: "T20261001-02", statuses: ["open", "hold", "done"] });
    expect(readTk("#/v2/tasks?status=done,open").statuses).toEqual(["open", "done"]);
    expect(readTk("#/v2/tasks?status=done,bogus").statuses).toEqual(["done"]);
    // nothing valid left: the default, never an empty filter
    expect(readTk("#/v2/tasks?status=bogus").statuses).toEqual(["open", "hold"]);
    expect(readTk("#/v2/tasks/%E0").open).toBeNull();
  });
  it("statusQuery: default omitted, all three = all, otherwise the canonical list", () => {
    expect(statusQuery(["hold", "open"])).toBeNull();
    expect(statusQuery(["done", "hold", "open"])).toBe("all");
    expect(statusQuery(["done", "open"])).toBe("open,done");
  });
  it("a patch changes only its part; ?world= / ?lang= stay", () => {
    const h = "#/v2/tasks?world=omote&status=all";
    expect(tkHash(h, { open: "T1" })).toBe("#/v2/tasks/T1?world=omote&status=all");
    expect(tkHash("#/v2/tasks/T1?status=all", { open: null })).toBe("#/v2/tasks?status=all");
    expect(tkHash("#/v2/tasks/T1?lang=ja", { statuses: ["done"] })).toBe("#/v2/tasks/T1?lang=ja&status=done");
    expect(tkHash("#/v2/tasks?status=done", { statuses: ["open", "hold"] })).toBe("#/v2/tasks");
    expect(tkHash("#/v2/tasks", { open: "T 1/2" })).toBe("#/v2/tasks/T%201%2F2");
  });
});
