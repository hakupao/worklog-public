// The PDF composer's selection (spec 2026-10-09 §4.2): which worked 案件 the PDF lists on their own ("show", in
// order), folds into その他 ("other") or leaves out of the text ("hide" — its minutes still count). Pure.
import { hashOf } from "../digests";
import type { WeekData } from "../types";

export type Mode = "show" | "other" | "hide";
export interface ComposeItem { id: string; mode: Mode }
/** The 未関連 bucket's id in a selection (what no 案件 holds; the PDF's 「その他・調査」 row). */
export const UNASSIGNED = "__unassigned";
export interface Worked { id: string; minutes: number; title: string; requester: string }

const MODES: readonly string[] = ["show", "other", "hide"];
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byMinutes = (a: Worked, b: Worked) => b.minutes - a.minutes || cmp(a.title, b.title);

/** The week's worked 案件 and, when ≥ 0.5 min is left over, the 未関連 bucket — the rows the PDF can show today. */
export function workedOf(data: WeekData, unassignedTitle: string): Worked[] {
  const total = data.day_minutes.reduce((a, [, m]) => a + m, 0);
  const real = data.tasks.filter((r) => r.week_minutes > 0)
    .map((r) => ({ id: r.task.id, minutes: r.week_minutes, title: r.task.title, requester: r.task.requester }));
  const rest = total - real.reduce((a, t) => a + t.minutes, 0);
  return rest >= 0.5 ? [...real, { id: UNASSIGNED, minutes: rest, title: unassignedTitle, requester: "" }] : real;
}

/** The PDF shows at most 6 summary lines (pdf/html.ts clamps the 7th on): one per shown 案件 plus the その他 line
 *  when any 案件 is folded. So at most 5 shown 案件 with something folded, 6 with nothing folded. 未関連 has no
 *  summary line and hidden 案件 none either: neither counts. (Mirrored in web compose/list.ts.) */
export const MAX_SHOWN_WITH_OTHER = 5;
export const MAX_SHOWN_ALONE = 6;
/** Summary lines the PDF shows whole: a generated reply may not write more (checkReply). */
export const MAX_SUMMARY_LINES = MAX_SHOWN_ALONE;
const counts = (items: ComposeItem[]) => ({
  shown: items.filter((i) => i.mode === "show" && i.id !== UNASSIGNED).length,
  folded: items.some((i) => i.mode === "other" && i.id !== UNASSIGNED),
});
/** The selection fits the PDF's summary lines. */
export function withinCap(items: ComposeItem[]): boolean {
  const { shown, folded } = counts(items);
  return shown <= (folded ? MAX_SHOWN_WITH_OTHER : MAX_SHOWN_ALONE);
}

/** The selection brought within the cap: the first shown 案件 (in order) stay, the last ones fold into その他 (which
 *  itself makes the cap 5). Unchanged (the same array) when it already fits; other / hide rows then by minutes. */
export function capShown(items: ComposeItem[], worked: Worked[]): ComposeItem[] {
  if (withinCap(items)) return items;
  let left = MAX_SHOWN_WITH_OTHER;
  const fold = new Set(items.filter((i) => i.mode === "show" && i.id !== UNASSIGNED && left-- <= 0).map((i) => i.id));
  const here = new Map(worked.map((x) => [x.id, x]));
  const out = items.map((i): ComposeItem => (fold.has(i.id) ? { id: i.id, mode: "other" } : i));
  const rest = out.filter((i) => i.mode !== "show")
    .sort((a, b) => (here.has(a.id) && here.has(b.id) ? byMinutes(here.get(a.id)!, here.get(b.id)!) : 0));
  return [...out.filter((i) => i.mode === "show"), ...rest];
}

/** No selection ever: today's PDF — every row shown, most minutes first — within the cap (the smallest fold). */
export const defaultItems = (worked: Worked[]): ComposeItem[] =>
  capShown([...worked].sort(byMinutes).map((x) => ({ id: x.id, mode: "show" })), worked);

/** A saved (or last week's) selection fitted to this week: modes and the show order kept, ids no longer worked
 *  dropped, newly worked ids appended as show (most minutes first), then capped (capShown — the appended ones fold
 *  first). other / hide rows follow the show rows. */
export function fitItems(base: ComposeItem[], worked: Worked[]): ComposeItem[] {
  if (base.length === 0) return defaultItems(worked);
  const here = new Map(worked.map((x) => [x.id, x]));
  const kept = base.filter((i) => here.has(i.id));
  const known = new Set(kept.map((i) => i.id));
  const fresh = worked.filter((x) => !known.has(x.id)).sort(byMinutes).map((x): ComposeItem => ({ id: x.id, mode: "show" }));
  const shown = kept.filter((i) => i.mode === "show");
  const rest = kept.filter((i) => i.mode !== "show").sort((a, b) => byMinutes(here.get(a.id)!, here.get(b.id)!));
  return capShown([...shown, ...fresh, ...rest], worked);
}

/** A PUT body's items: exactly the worked ids, once each, with a known mode, within the shown cap. */
export function validateItems(raw: unknown, worked: Worked[]): { ok: true; items: ComposeItem[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "items must be an array" };
  const ids = new Set(worked.map((x) => x.id)), seen = new Set<string>(), items: ComposeItem[] = [];
  for (const r of raw) {
    const id = typeof r?.id === "string" ? r.id : "";
    if (!ids.has(id)) return { ok: false, error: `unknown id ${id}` };
    if (seen.has(id)) return { ok: false, error: `duplicate id ${id}` };
    if (!MODES.includes(r.mode)) return { ok: false, error: `bad mode for ${id}` };
    seen.add(id); items.push({ id, mode: r.mode as Mode });
  }
  for (const id of ids) if (!seen.has(id)) return { ok: false, error: `missing id ${id}` };
  if (!withinCap(items)) {
    return { ok: false, error: `too many shown: at most ${MAX_SHOWN_WITH_OTHER} when any 案件 is other, ${MAX_SHOWN_ALONE} otherwise` };
  }
  return { ok: true, items };
}

export const selectionHash = (items: ComposeItem[]) => hashOf(JSON.stringify(items.map((i) => [i.id, i.mode])));
