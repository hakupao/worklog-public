import { useCallback, useMemo, useSyncExternalStore } from "react";
import { subscribeHash } from "../../lib/hash";
import { todayJst } from "../../lib/jst";
import { jstDate } from "../../predict/time";
import { parseV2Route, readQuery, replaceHash, withQuery } from "../../route";
import { useMinute } from "../now/useNowData";

/** The 计划 page's address (spec §3.1 `#/v2/plan[/<date>]`): the day in the path — none for today, so a bookmark
 *  of #/v2/plan always means today — and the open drawer in `?day=<day-plan item id>` or `?item=<plan item id>`. */
export type PlOpen = { kind: "day" | "item"; id: string } | null;
export interface PlState { date: string; isToday: boolean; open: PlOpen }
export interface PlPatch { date?: string; open?: PlOpen }

/** A real calendar date (2026-02-30 is not): the old page's pattern plus a round trip. */
export const isDate = (s: string | null): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function readPl(hash: string, now: Date = new Date()): PlState {
  const param = parseV2Route(hash).param, today = todayJst(now), q = readQuery(hash);
  const date = isDate(param) ? param : today;
  const day = q.get("day"), item = q.get("item");
  return { date, isToday: date === today, open: day ? { kind: "day", id: day } : item ? { kind: "item", id: item } : null };
}

/** The hash for a change; other keys (?world= / ?lang=) stay. Another day closes the drawer (its item is that day's). */
export function plHash(hash: string, p: PlPatch, now: Date = new Date()): string {
  const cur = readPl(hash, now);
  const date = p.date ?? cur.date;
  const open = p.date !== undefined && p.date !== cur.date ? null : "open" in p ? p.open ?? null : cur.open;
  const path = date === todayJst(now) ? "#/v2/plan" : `#/v2/plan/${date}`;
  return withQuery(hash, { day: open?.kind === "day" ? open.id : null, item: open?.kind === "item" ? open.id : null }, path);
}

/** [state, open / close a drawer (no history entry), go to another day (a history entry, like the timeline's weeks)]. */
export function usePl(): [PlState, (open: PlOpen) => void, (date: string) => void] {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  // a bare #/v2/plan is today: re-read at 00:00 Tokyo too, not only when the address changes
  const today = jstDate(useMinute().getTime());
  const st = useMemo(() => readPl(hash), [hash, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const setOpen = useCallback((open: PlOpen) => replaceHash(plHash(window.location.hash, { open })), []);
  const go = useCallback((date: string) => { window.location.hash = plHash(window.location.hash, { date }); }, []);
  return [st, setOpen, go];
}
