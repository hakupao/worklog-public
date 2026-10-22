import { describe, expect, it } from "vitest";
import { readTl, tlHash, weekHash } from "../src/pages/timeline/state";
import { readQuery, withQuery } from "../src/route";

const NOW = new Date("2026-10-06T03:00:00Z");     // Tue 10/6 12:00 JST, week 2026-W41

describe("hash query helpers", () => {
  it("sets and removes keys, keeps the others, can swap the path", () => {
    expect(withQuery("#/v2/now?world=omote", { lang: "ja" })).toBe("#/v2/now?world=omote&lang=ja");
    expect(withQuery("#/v2/now?world=omote", { world: null })).toBe("#/v2/now");
    expect(withQuery("#/v2/timeline?x=1", { y: "2" }, "#/v2/timeline/2026-W40")).toBe("#/v2/timeline/2026-W40?x=1&y=2");
    expect(readQuery("#/v2/timeline/2026-W40?dir=%2Fw%2Fa%20b").get("dir")).toBe("/w/a b");
  });
});

describe("timeline state", () => {
  it("defaults: this week, no day, no filters, nothing open", () => {
    expect(readTl("#/v2/timeline", NOW)).toEqual({ week: "2026-W41", day: null, unlinked: false, hidden: false, dir: null, open: null });
  });
  it("reads the week from the path and every filter from the query", () => {
    expect(readTl("#/v2/timeline/2026-W40?day=2026-10-01&unlinked=1&hidden=1&dir=%2Fw&s=S1&world=omote", NOW)).toEqual({
      week: "2026-W40", day: "2026-10-01", unlinked: true, hidden: true, dir: "/w", open: { kind: "s", id: "S1" },
    });
    expect(readTl("#/v2/timeline/2026-W40?n=7", NOW).open).toEqual({ kind: "n", id: "7" });
  });
  it("an invalid week falls back to this week; a day outside the week is ignored", () => {
    expect(readTl("#/v2/timeline/2025-W53", NOW).week).toBe("2026-W41");
    expect(readTl("#/v2/timeline/bogus?day=2026-10-06", NOW)).toMatchObject({ week: "2026-W41", day: "2026-10-06" });
    expect(readTl("#/v2/timeline/2026-W40?day=2026-10-06", NOW).day).toBeNull();
    expect(readTl("#/v2/timeline/2026-W40?day=10-01", NOW).day).toBeNull();
    expect(readTl("#/v2/timeline/%E0", NOW).week).toBe("2026-W41");     // a broken escape falls back, never throws
  });
  it("a patch touches only its keys; the override keys survive", () => {
    const h = "#/v2/timeline/2026-W40?world=omote&unlinked=1";
    expect(tlHash(h, { day: "2026-10-01" })).toBe("#/v2/timeline/2026-W40?world=omote&unlinked=1&day=2026-10-01");
    expect(tlHash(h, { unlinked: false, open: { kind: "s", id: "S9" } })).toBe("#/v2/timeline/2026-W40?world=omote&s=S9");
    expect(tlHash("#/v2/timeline?s=S9", { open: { kind: "n", id: "4" } })).toBe("#/v2/timeline?n=4");
    expect(tlHash("#/v2/timeline?dir=%2Fw", { dir: null })).toBe("#/v2/timeline");
  });
  it("another week keeps the filters and drops the day and the drawer", () => {
    expect(weekHash("#/v2/timeline/2026-W40?unlinked=1&day=2026-10-01&s=S1&lang=ja", "2026-W39"))
      .toBe("#/v2/timeline/2026-W39?unlinked=1&lang=ja");
  });
});
