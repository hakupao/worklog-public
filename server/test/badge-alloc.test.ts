import { describe, expect, it } from "vitest";
import { allocateBadge, countUsage, emptyUsage, fnv1a, isValidBadge, PALETTE_SIZE } from "../src/badge/alloc";
import { BADGE_OBJECT_NAMES } from "../src/badge/names.gen";

describe("allocateBadge", () => {
  it("is deterministic for the same id and usage", () => {
    expect(allocateBadge("T20261014-01", emptyUsage())).toEqual(allocateBadge("T20261014-01", emptyUsage()));
  });

  it("with nothing in use, picks by the id hash over the whole list", () => {
    const id = "T20261014-01", b = allocateBadge(id, emptyUsage());
    expect(b.obj).toBe(BADGE_OBJECT_NAMES[fnv1a(id + "|obj") % BADGE_OBJECT_NAMES.length]);
    expect(b.color).toBe(fnv1a(id + "|color") % PALETTE_SIZE);
  });

  it("never picks an object or colour in use while an unused one exists", () => {
    const u = emptyUsage();
    for (let i = 0; i < PALETTE_SIZE - 1; i++) {
      const b = allocateBadge(`T20261014-${i}`, u);
      expect(u.obj.get(b.obj) ?? 0).toBe(0);
      expect(u.color[b.color]).toBe(0);
      countUsage(u, b.obj, b.color);
    }
    const last = allocateBadge("T20261014-last", u);
    expect(u.color[last.color]).toBe(0);                 // the one colour left
  });

  it("when every colour is used, picks among the least used", () => {
    const u = emptyUsage();
    for (let c = 0; c < PALETTE_SIZE; c++) countUsage(u, BADGE_OBJECT_NAMES[c], c);
    countUsage(u, BADGE_OBJECT_NAMES[20], 3);            // colour 3 used twice
    for (const id of ["a", "b", "c", "d", "e"]) expect(allocateBadge(id, u).color).not.toBe(3);
  });

  it("when every object is used, picks among the least used", () => {
    const u = emptyUsage();
    for (const n of BADGE_OBJECT_NAMES) countUsage(u, n, 0);
    countUsage(u, BADGE_OBJECT_NAMES[0], 0);             // used twice
    const counts = new Set(["x", "y", "z"].map((id) => u.obj.get(allocateBadge(id, u).obj)));
    expect([...counts]).toEqual([1]);
  });

  it("ties among least-used candidates are broken by the id hash, over candidates in list order", () => {
    const u = emptyUsage();
    BADGE_OBJECT_NAMES.forEach((n, i) => { if (i % 3 === 0) u.obj.set(n, 1); });   // every third object once
    for (let c = 0; c < 6; c++) u.color[c] = 1;                                    // colours 0..5 once
    const objCands = BADGE_OBJECT_NAMES.filter((n) => !u.obj.get(n));
    const colorCands = [6, 7, 8, 9, 10, 11];
    for (const id of ["T20261014-01", "T20261014-02", "T20261014-03"]) {
      const b = allocateBadge(id, u);
      expect(b.obj).toBe(objCands[fnv1a(id + "|obj") % objCands.length]);
      expect(b.color).toBe(colorCands[fnv1a(id + "|color") % colorCands.length]);
    }
  });

  it("ignores invalid stored values when counting", () => {
    const u = emptyUsage();
    countUsage(u, "cat", 0);                             // old bare name: not listed
    countUsage(u, BADGE_OBJECT_NAMES[0], 12);            // colour out of range
    countUsage(u, BADGE_OBJECT_NAMES[0], 1.5);
    expect(u.obj.size).toBe(0);
    expect(u.color.every((n) => n === 0)).toBe(true);
    expect(isValidBadge(BADGE_OBJECT_NAMES[0], 0)).toBe(true);
    expect(isValidBadge(null, 0)).toBe(false);
  });
});
