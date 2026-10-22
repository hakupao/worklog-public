import { useCallback, useMemo, useSyncExternalStore } from "react";
import { subscribeHash } from "../../lib/hash";
import { currentWeek, isValidWeek, weekOfDate } from "../../lib/jst";
import { parseV2Route, readQuery, replaceHash, withQuery } from "../../route";

/** Everything the timeline shows is addressable (the prototype's ?day / ?unlinked / ?s), so a link from
 *  此刻 or a reload lands on the same view. `day` and `open` are only meaningful inside `week`. */
export interface TlState {
  week: string;
  /** The day whose rows are listed; null = the page's default (today in this week, else Monday). */
  day: string | null;
  unlinked: boolean;
  hidden: boolean;
  /** 只看此目录: the exact cwd. */
  dir: string | null;
  /** The drawer: a session ("s:<id>") or a note ("n:<id>"). */
  open: { kind: "s" | "n"; id: string } | null;
}
export type TlPatch = Partial<Omit<TlState, "week">>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readTl(hash: string, now: Date = new Date()): TlState {
  const param = parseV2Route(hash).param, q = readQuery(hash);
  const week = param && isValidWeek(param) ? param : currentWeek(now);
  const d = q.get("day"), s = q.get("s"), n = q.get("n");
  return {
    week,
    day: d && DATE.test(d) && weekOfDate(d) === week ? d : null,
    unlinked: q.get("unlinked") === "1",
    hidden: q.get("hidden") === "1",
    dir: q.get("dir") || null,
    open: s ? { kind: "s", id: s } : n ? { kind: "n", id: n } : null,
  };
}

/** The hash for a state change. Keys not in the patch (and ?world= / ?lang=) stay as they are. */
export function tlHash(hash: string, p: TlPatch): string {
  const q: Record<string, string | null> = {};
  if ("day" in p) q.day = p.day ?? null;
  if ("unlinked" in p) q.unlinked = p.unlinked ? "1" : null;
  if ("hidden" in p) q.hidden = p.hidden ? "1" : null;
  if ("dir" in p) q.dir = p.dir ?? null;
  if ("open" in p) { q.s = p.open?.kind === "s" ? p.open.id : null; q.n = p.open?.kind === "n" ? p.open.id : null; }
  return withQuery(hash, q);
}
/** Another week: the filters stay (paging through weeks while cleaning up is the point), the day and the drawer go. */
export const weekHash = (hash: string, week: string) => withQuery(hash, { day: null, s: null, n: null }, `#/v2/timeline/${week}`);

export function useTl(): [TlState, (p: TlPatch) => void, (week: string) => void] {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const st = useMemo(() => readTl(hash), [hash]);
  const set = useCallback((p: TlPatch) => replaceHash(tlHash(window.location.hash, p)), []);
  // a new week is a new place: a history entry, so Back returns to the previous week
  const go = useCallback((week: string) => { window.location.hash = weekHash(window.location.hash, week); }, []);
  return [st, set, go];
}
