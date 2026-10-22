import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SheetKey } from "../../api/types";
import { subscribeHash } from "../../lib/hash";
import { isValidWeek, reportWeekOf } from "../../lib/jst";
import { parseV2Route, readQuery, replaceHash, withQuery } from "../../route";
import { useMinute } from "../now/useNowData";
import { isDate } from "../plan/state";

/** The 週報 page's address: `#/v2/report[/<week>]?sheet=<key>&cell=<taskId or ->|<YYYY-MM-DD>`.
 *  The week is the report week (Sat→Fri, lib/jst.ts reportWeekOf). This week has no week in the path (a bookmark
 *  of #/v2/report always means this week); the default sheet (日別作業) is not written. Bad values fall back
 *  silently, without touching the address bar; a `?tpl=` from before the templates merged is ignored. */
export interface RpCell { taskId: string | null; date: string }
export interface RpState { week: string; isThisWeek: boolean; sheet: SheetKey; cell: RpCell | null }
export interface RpPatch { week?: string; sheet?: SheetKey; cell?: RpCell | null }

/** The report's sheets (server/src/report/templates.ts). The tabs follow the server's `preview.sheets` order; this
 *  list only decides which `?sheet=` the address accepts. */
export const SHEETS: readonly SheetKey[] = ["summary", "tasks", "days", "deliverables", "hours"];
const sheetIn = (s: string | null): SheetKey => (s && (SHEETS as readonly string[]).includes(s) ? (s as SheetKey) : "days");

/** The report week (Sat→Fri) a "YYYY-MM-DD" day belongs to: its 12:00 JST, well inside its 05:00 day. */
const reportWeekOfDate = (date: string) => reportWeekOf(Date.parse(`${date}T12:00:00+09:00`));

/** `?cell=` → the 日別作業 cell; "-" is the 未割当 row. Anything else, or a day outside the week, is no cell. */
function readCell(raw: string | null, week: string): RpCell | null {
  if (!raw) return null;
  const i = raw.lastIndexOf("|");
  if (i <= 0) return null;
  const id = raw.slice(0, i), date = raw.slice(i + 1);
  if (!isDate(date) || reportWeekOfDate(date) !== week) return null;
  return { taskId: id === "-" ? null : id, date };
}
export const cellParam = (c: RpCell) => `${c.taskId ?? "-"}|${c.date}`;

export function readRp(hash: string, now: Date = new Date()): RpState {
  const param = parseV2Route(hash).param, q = readQuery(hash), here = reportWeekOf(now);
  const week = param && isValidWeek(param) ? param : here;
  const sheet = sheetIn(q.get("sheet"));
  // the drawer belongs to the 日別作業 matrix: on another sheet there is nothing for it to point at
  const cell = sheet === "days" ? readCell(q.get("cell"), week) : null;
  return { week, isThisWeek: week === here, sheet, cell };
}

/** The hash for a change; other keys (?world= / ?lang=) stay, an old `?tpl=` goes. Another week keeps the sheet
 *  and closes the drawer; another sheet closes it too. */
export function rpHash(hash: string, p: RpPatch, now: Date = new Date()): string {
  const cur = readRp(hash, now);
  const week = p.week !== undefined && isValidWeek(p.week) ? p.week : cur.week;
  const sheet = sheetIn(p.sheet ?? cur.sheet);
  const moved = week !== cur.week || sheet !== cur.sheet;
  const cell = sheet !== "days" ? null : "cell" in p ? p.cell ?? null : moved ? null : cur.cell;
  const path = week === reportWeekOf(now) ? "#/v2/report" : `#/v2/report/${week}`;
  return withQuery(hash, {
    tpl: null,
    sheet: sheet === "days" ? null : sheet,
    cell: cell ? cellParam(cell) : null,
  }, path);
}

export interface Rp {
  st: RpState;
  /** Another week: a history entry (Back returns to the previous week), like the timeline's weeks. */
  go: (week: string) => void;
  setSheet: (sheet: SheetKey) => void;
  /** Open (a cell) or close (null) the 日別作業 drawer; no history entry. */
  setCell: (cell: RpCell | null) => void;
}

export function useRp(): Rp {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  // a bare #/v2/report is this (report) week: re-read when it turns over too (Saturday 05:00), not only when the address changes
  const here = reportWeekOf(useMinute());
  const st = useMemo(() => readRp(hash), [hash, here]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = useCallback((week: string) => {
    // the entry being left loses ?cell= first (preflight R8): Back returns to that week with the drawer closed
    if (readRp(window.location.hash).cell) replaceHash(rpHash(window.location.hash, { cell: null }));
    window.location.hash = rpHash(window.location.hash, { week });
  }, []);
  const setSheet = useCallback((sheet: SheetKey) => replaceHash(rpHash(window.location.hash, { sheet })), []);
  const setCell = useCallback((cell: RpCell | null) => replaceHash(rpHash(window.location.hash, { cell })), []);
  return useMemo(() => ({ st, go, setSheet, setCell }), [st, go, setSheet, setCell]);
}

/** The PDF composer's address: always with its week (spec 2026-10-09 §3.1). composeHref takes any week, for ◀ ▶ paging. */
export const isComposeHash = (hash: string) => /^#\/v2\/report\/[^/?]+\/pdf(\?|$)/.test(hash);
export const composeHref = (week: string) => `#/v2/report/${week}/pdf`;
