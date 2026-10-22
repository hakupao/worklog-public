import { describe, expect, it } from "vitest";
import { RANGE_LABELS } from "../src/report/range/labels";
import { NONE, OTHER, UNLINKED, foldSeries, seriesLabel } from "../src/report/range/series";

const L = RANGE_LABELS.ja;
describe("foldSeries / seriesLabel", () => {
  it("keeps the 6 largest, folds the rest into OTHER, puts UNLINKED last", () => {
    const m = new Map<string, number>([["A", 9], ["B", 8], ["C", 7], ["D", 6], ["E", 5], ["F", 4], ["G", 3], ["H", 2], [UNLINKED, 10]]);
    const { keys, keyOf } = foldSeries(m);
    expect(keys).toEqual(["A", "B", "C", "D", "E", "F", OTHER, UNLINKED]);
    expect([keyOf("G"), keyOf("A"), keyOf(UNLINKED)]).toEqual([OTHER, "A", UNLINKED]);
  });
  it("no OTHER with 6 or fewer; no UNLINKED without its hours; zero-hour keys dropped; ties by key", () => {
    expect(foldSeries(new Map([["A", 1], ["B", 0], [UNLINKED, 0]])).keys).toEqual(["A"]);
    expect(foldSeries(new Map([["b", 1], ["a", 1]])).keys).toEqual(["a", "b"]);
  });
  it("labels: folded and unlinked differ; a real 依頼元 named like a reserved label stays separate, with a suffix", () => {
    expect([OTHER, UNLINKED, NONE].map((k) => seriesLabel(k, L))).toEqual(["その他の依頼元", "未紐付", "（依頼元なし）"]);
    const { keys } = foldSeries(new Map([["その他の依頼元", 2], [UNLINKED, 1]]));
    expect(keys.map((k) => seriesLabel(k, L))).toEqual(["その他の依頼元（依頼元）", "未紐付"]);
  });
});
