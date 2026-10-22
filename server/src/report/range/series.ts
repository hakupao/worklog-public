// The requester series of the charts (spec §3 ①-3): the 6 largest 依頼元 by range hours, the rest folded into
// その他の依頼元, 未紐付 last and never folded. Keys are 依頼元 names plus three sentinels, so a real 依頼元 that happens
// to be called like a reserved label stays its own series. Ties by key (code-point order) so the order is stable.
import type { RangeLabels } from "./labels";

export const TOP_SERIES = 6;
/** Never a real 依頼元: a NUL cannot be typed into one. */
export const OTHER = "\u0000other", UNLINKED = "\u0000unlinked", NONE = "\u0000none";

export function foldSeries(byKey: Map<string, number>): { keys: string[]; keyOf: (key: string) => string } {
  const named = [...byKey].filter(([k, v]) => k !== UNLINKED && v > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k]) => k);
  const top = named.slice(0, TOP_SERIES), kept = new Set(top);
  const keys = [...top, ...(named.length > TOP_SERIES ? [OTHER] : []), ...((byKey.get(UNLINKED) ?? 0) > 0 ? [UNLINKED] : [])];
  return { keys, keyOf: (k) => (k === UNLINKED || kept.has(k) ? k : OTHER) };
}

/** A series as shown in the export language; a real 依頼元 that reads like a reserved label gets the 依頼元 suffix. */
export function seriesLabel(key: string, L: RangeLabels): string {
  if (key === OTHER) return L.other;
  if (key === UNLINKED) return L.unassigned;
  if (key === NONE) return L.noRequester;
  return [L.other, L.unassigned, L.noRequester].includes(key) ? `${key}${L.requesterSuffix}` : key;
}
