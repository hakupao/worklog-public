// The composer's left column as data (spec 2026-10-09 §3.2): show rows in the user's order, other / hide rows by minutes.
import type { ComposeItem, ComposeMode, ComposeRowOut } from "../../../api/types";

/** The PDF shows at most 6 summary lines: one per shown 案件, plus the その他 line when any 案件 is folded. 未関連 and
 *  hidden 案件 have none. Mirrors server/src/report/compose/selection.ts (the server rejects a selection past it). */
export const MAX_SHOWN_WITH_OTHER = 5;
export const MAX_SHOWN_ALONE = 6;
const UNASSIGNED = "__unassigned";
const counts = (items: ComposeItem[]) => ({
  shown: items.filter((i) => i.mode === "show" && i.id !== UNASSIGNED).length,
  folded: items.some((i) => i.mode === "other" && i.id !== UNASSIGNED),
});
export function withinCap(items: ComposeItem[]): boolean {
  const { shown, folded } = counts(items);
  return shown <= (folded ? MAX_SHOWN_WITH_OTHER : MAX_SHOWN_ALONE);
}
/** No further 案件 can get its own row as things stand (the page then says why). */
export function atCap(rows: ComposeRowOut[]): boolean {
  const { shown, folded } = counts(rows);
  return shown >= (folded ? MAX_SHOWN_WITH_OTHER : MAX_SHOWN_ALONE);
}
export interface Groups { show: ComposeRowOut[]; other: ComposeRowOut[]; hide: ComposeRowOut[] }
const byMinutes = (a: ComposeRowOut, b: ComposeRowOut) => b.minutes - a.minutes || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);

export function groups(rows: ComposeRowOut[]): Groups {
  return {
    show: rows.filter((r) => r.mode === "show"),
    other: rows.filter((r) => r.mode === "other").sort(byMinutes),
    hide: rows.filter((r) => r.mode === "hide").sort(byMinutes),
  };
}
const flat = (g: Groups) => [...g.show, ...g.other, ...g.hide];

/** A row's new mode; one turned to show goes to the end of the shown rows. The same array when nothing changes. */
export function setMode(rows: ComposeRowOut[], id: string, mode: ComposeMode): ComposeRowOut[] {
  const row = rows.find((r) => r.id === id);
  if (!row || row.mode === mode) return rows;
  const rest = rows.filter((r) => r.id !== id), g = groups(rest);
  g[mode] = [...g[mode], { ...row, mode }];
  return flat(groups(flat(g)));
}

/** A shown row moved to index `to` among the shown rows (clamped). The same array for a row that is not shown. */
export function moveShown(rows: ComposeRowOut[], id: string, to: number): ComposeRowOut[] {
  const g = groups(rows), from = g.show.findIndex((r) => r.id === id);
  if (from < 0) return rows;
  const show = [...g.show], [row] = show.splice(from, 1);
  show.splice(Math.max(0, Math.min(to, show.length)), 0, row);
  return flat({ ...g, show });
}

export const toItems = (rows: ComposeRowOut[]): ComposeItem[] => flat(groups(rows)).map((r) => ({ id: r.id, mode: r.mode }));

/** Switching `id` to `mode` keeps the selection within the cap. */
export const canSet = (rows: ComposeRowOut[], id: string, mode: ComposeMode): boolean => withinCap(toItems(setMode(rows, id, mode)));
