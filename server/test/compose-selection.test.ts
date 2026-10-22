import { describe, expect, it } from "vitest";
import { MAX_SHOWN_ALONE, MAX_SHOWN_WITH_OTHER, UNASSIGNED, capShown, defaultItems, fitItems, selectionHash, validateItems, withinCap, workedOf, type ComposeItem, type Worked } from "../src/report/compose/selection";
import type { WeekData } from "../src/report/types";

const w = (id: string, minutes: number, title = id): Worked => ({ id, minutes, title, requester: "" });

function week(tasks: Array<[string, number]>, total: number): WeekData {
  return {
    tasks: tasks.map(([id, m]) => ({ task: { id, title: `t-${id}`, requester: "田中" } as any, hours: m / 60, week_minutes: m, sessions: [] })),
    days: [], summary: {} as any, dates: [], day_minutes: [["2026-09-28", total]], day_sum_minutes: [], day_buckets: {}, unassigned_sessions: 0, unassigned_minutes: 0,
  };
}

describe("workedOf", () => {
  it("keeps worked tasks, adds the 未関連 rest when ≥ 0.5 min", () => {
    expect(workedOf(week([["A", 120], ["B", 0]], 150), "その他・調査")).toEqual([
      { id: "A", minutes: 120, title: "t-A", requester: "田中" },
      { id: UNASSIGNED, minutes: 30, title: "その他・調査", requester: "" },
    ]);
    expect(workedOf(week([["A", 120]], 120.2), "x").map((x) => x.id)).toEqual(["A"]);
  });
});

describe("defaultItems", () => {
  it("is today's PDF: all show, minutes desc, then title", () => {
    expect(defaultItems([w("B", 30, "b"), w("A", 90, "a"), w("C", 30, "a")])).toEqual([
      { id: "A", mode: "show" }, { id: "C", mode: "show" }, { id: "B", mode: "show" },
    ]);
  });
});

describe("fitItems", () => {
  it("keeps modes and show order, drops vanished ids, appends new ones as show (minutes desc)", () => {
    const base = [{ id: "B", mode: "show" as const }, { id: "A", mode: "show" as const }, { id: "X", mode: "other" as const }, { id: "C", mode: "hide" as const }];
    expect(fitItems(base, [w("A", 10), w("B", 5), w("C", 50), w("N1", 3), w("N2", 30)])).toEqual([
      { id: "B", mode: "show" }, { id: "A", mode: "show" }, { id: "N2", mode: "show" }, { id: "N1", mode: "show" }, { id: "C", mode: "hide" },
    ]);
  });
  it("an empty base is the default", () => {
    expect(fitItems([], [w("A", 1), w("B", 2)])).toEqual(defaultItems([w("A", 1), w("B", 2)]));
  });
});

describe("validateItems", () => {
  const worked = [w("A", 1), w(UNASSIGNED, 2)];
  it("accepts a permutation of worked ids with valid modes", () => {
    expect(validateItems([{ id: UNASSIGNED, mode: "other" }, { id: "A", mode: "show" }], worked))
      .toEqual({ ok: true, items: [{ id: UNASSIGNED, mode: "other" }, { id: "A", mode: "show" }] });
  });
  it("rejects unknown ids, duplicates, bad modes, missing ids, non-arrays", () => {
    expect(validateItems([{ id: "Z", mode: "show" }, { id: "A", mode: "show" }, { id: UNASSIGNED, mode: "show" }], worked)).toEqual({ ok: false, error: "unknown id Z" });
    expect(validateItems([{ id: "A", mode: "show" }, { id: "A", mode: "hide" }], worked)).toEqual({ ok: false, error: "duplicate id A" });
    expect(validateItems([{ id: "A", mode: "big" }, { id: UNASSIGNED, mode: "show" }], worked)).toEqual({ ok: false, error: "bad mode for A" });
    expect(validateItems([{ id: "A", mode: "show" }], worked)).toEqual({ ok: false, error: `missing id ${UNASSIGNED}` });
    expect(validateItems("x", worked)).toEqual({ ok: false, error: "items must be an array" });
  });
});

describe("shown cap (6 summary lines on the PDF)", () => {
  const S = (id: string): ComposeItem => ({ id, mode: "show" }), O = (id: string): ComposeItem => ({ id, mode: "other" }), H = (id: string): ComposeItem => ({ id, mode: "hide" });
  const ws = (n: number) => Array.from({ length: n }, (_, i) => w(`T${i + 1}`, 100 - i));   // T1 most minutes
  it("constants: 5 with something folded, 6 alone", () => {
    expect([MAX_SHOWN_WITH_OTHER, MAX_SHOWN_ALONE]).toEqual([5, 6]);
  });
  it("withinCap: ≤ 6 shown with nothing folded, ≤ 5 when any 案件 is other; 未関連 and hidden never count", () => {
    expect(withinCap(["1", "2", "3", "4", "5", "6"].map(S))).toBe(true);
    expect(withinCap([..."1234567"].map(S))).toBe(false);
    expect(withinCap([..."123456"].map(S).concat(O("x")))).toBe(false);
    expect(withinCap([..."12345"].map(S).concat(O("x")))).toBe(true);
    expect(withinCap([..."123456"].map(S).concat(S(UNASSIGNED), O(UNASSIGNED), H("h1"), H("h2")))).toBe(true);
  });
  it("capShown keeps the user's order and folds the LAST shown first; folding the 7th makes the cap 5", () => {
    const worked = ws(7);
    expect(capShown(["T7", "T1", "T2", "T3", "T4", "T5", "T6"].map(S), worked)).toEqual([
      S("T7"), S("T1"), S("T2"), S("T3"), S("T4"), O("T5"), O("T6"),
    ]);
  });
  it("capShown: an existing other caps at 5; 未関連 shown stays where it is and does not count", () => {
    const worked = [...ws(7), w(UNASSIGNED, 1)];
    expect(capShown([S("T1"), S(UNASSIGNED), S("T2"), S("T3"), S("T4"), S("T5"), S("T6"), O("T7")], worked)).toEqual([
      S("T1"), S(UNASSIGNED), S("T2"), S("T3"), S("T4"), S("T5"), O("T6"), O("T7"),
    ]);
  });
  it("capShown leaves a selection within the cap as it is", () => {
    const items = [..."123456"].map((n) => S(`T${n}`)).concat(H("T7"));
    expect(capShown(items, ws(7))).toBe(items);
  });
  it("a brand-new week (no selection) folds the smallest 案件 beyond 5", () => {
    expect(fitItems([], ws(8))).toEqual([S("T1"), S("T2"), S("T3"), S("T4"), S("T5"), O("T6"), O("T7"), O("T8")]);
    expect(defaultItems(ws(6))).toEqual(ws(6).map((x) => S(x.id)));
  });
  it("an inherited / saved selection: newly worked 案件 are appended last, so they fold first", () => {
    const base = [S("T3"), S("T1"), S("T2"), S("T4"), O("T5")];
    expect(fitItems(base, [...ws(5), w("N1", 500), w("N2", 1)])).toEqual([S("T3"), S("T1"), S("T2"), S("T4"), S("N1"), O("T5"), O("N2")]);   // other rows by minutes
  });
  it("validateItems rejects a selection over the cap", () => {
    const worked = ws(7);
    expect(validateItems(worked.map((x) => S(x.id)), worked)).toEqual({ ok: false, error: expect.stringMatching(/too many shown/) });
    expect(validateItems([..."123456"].map((n) => S(`T${n}`)).concat(O("T7")), worked)).toEqual({ ok: false, error: expect.stringMatching(/too many shown/) });
    expect(validateItems([..."12345"].map((n) => S(`T${n}`)).concat(O("T6"), H("T7")), worked).ok).toBe(true);
  });
});

describe("selectionHash", () => {
  it("changes with order and mode, not with object identity", async () => {
    const a = [{ id: "A", mode: "show" as const }, { id: "B", mode: "show" as const }];
    expect(await selectionHash(a)).toBe(await selectionHash(a.map((x) => ({ ...x }))));
    expect(await selectionHash(a)).not.toBe(await selectionHash([a[1], a[0]]));
    expect(await selectionHash(a)).not.toBe(await selectionHash([a[0], { id: "B", mode: "other" }]));
  });
});
