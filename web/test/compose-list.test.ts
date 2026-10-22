import { describe, expect, it } from "vitest";
import type { ComposeRowOut } from "../src/api/types";
import { MAX_SHOWN_ALONE, MAX_SHOWN_WITH_OTHER, canSet, groups, moveShown, setMode, toItems, withinCap } from "../src/pages/report/compose/list";

const r = (id: string, mode: ComposeRowOut["mode"], minutes: number): ComposeRowOut => ({ id, mode, minutes, title: id, requester: "" });
const rows = [r("A", "show", 10), r("B", "show", 50), r("C", "other", 5), r("D", "other", 40), r("E", "hide", 1)];

describe("compose list", () => {
  it("groups: show in order; other / hide by minutes desc", () => {
    const g = groups(rows);
    expect(g.show.map((x) => x.id)).toEqual(["A", "B"]);
    expect(g.other.map((x) => x.id)).toEqual(["D", "C"]);
    expect(g.hide.map((x) => x.id)).toEqual(["E"]);
  });
  it("setMode to show appends at the end of the shown rows; away from show removes it", () => {
    expect(toItems(setMode(rows, "C", "show")).filter((i) => i.mode === "show").map((i) => i.id)).toEqual(["A", "B", "C"]);
    expect(toItems(setMode(rows, "A", "hide")).filter((i) => i.mode === "show").map((i) => i.id)).toEqual(["B"]);
    expect(setMode(rows, "A", "show")).toBe(rows);   // no change → same array
  });
  it("moveShown reorders within the shown rows and clamps the target", () => {
    expect(groups(moveShown(rows, "B", 0)).show.map((x) => x.id)).toEqual(["B", "A"]);
    expect(groups(moveShown(rows, "A", 99)).show.map((x) => x.id)).toEqual(["B", "A"]);
    expect(moveShown(rows, "C", 0)).toBe(rows);   // not a shown row
  });
  it("toItems: shown first in order, then the rest", () => {
    expect(toItems(rows)).toEqual([{ id: "A", mode: "show" }, { id: "B", mode: "show" }, { id: "D", mode: "other" }, { id: "C", mode: "other" }, { id: "E", mode: "hide" }]);
  });
  describe("shown cap (mirrors server compose/selection.ts)", () => {
    const shown = (n: number) => Array.from({ length: n }, (_, i) => r(`S${i}`, "show", 100 - i));
    it("5 with something folded, 6 alone; 未関連 and hidden never count", () => {
      expect([MAX_SHOWN_WITH_OTHER, MAX_SHOWN_ALONE]).toEqual([5, 6]);
      expect(withinCap(toItems(shown(6)))).toBe(true);
      expect(withinCap(toItems([...shown(6), r("X", "other", 1)]))).toBe(false);
      expect(withinCap(toItems([...shown(5), r("X", "other", 1), r("__unassigned", "show", 1), r("H", "hide", 1)]))).toBe(true);
      expect(withinCap(toItems([...shown(6), r("__unassigned", "other", 1)]))).toBe(true);
    });
    it("canSet: no 6th own row while something is folded; no 7th ever", () => {
      const five = [...shown(5), r("X", "other", 3), r("Y", "hide", 2)];
      expect(canSet(five, "Y", "show")).toBe(false);
      expect(canSet(five, "Y", "other")).toBe(true);
      expect(canSet(five, "X", "show")).toBe(true);    // folding the last other back: nothing folded → 6 allowed
      expect(canSet([...five, r("Z", "other", 1)], "X", "show")).toBe(false);   // Z stays folded → still 5
      expect(canSet([...shown(6), r("Y", "hide", 2)], "Y", "show")).toBe(false);
    });
    it("canSet: with 6 own rows and nothing folded, folding another 案件 in is blocked too (6 rows + その他)", () => {
      const six = [...shown(6), r("Y", "hide", 2), r("__unassigned", "hide", 1)];
      expect(canSet(six, "Y", "other")).toBe(false);
      expect(canSet(six, "__unassigned", "other")).toBe(true);   // 未関連 has no summary line
      expect(canSet(six, "S5", "other")).toBe(true);              // one of the six itself: 5 + その他
    });
  });
});

