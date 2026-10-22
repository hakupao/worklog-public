import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { TaskStatus } from "../../api/types";
import { subscribeHash } from "../../lib/hash";
import { parseV2Route, readQuery, replaceHash, withQuery } from "../../route";

/** The 案件 page's address (spec §3.1 `#/v2/tasks[/<id>]`): the open task in the path, the status filter in
 *  `?status=` with the old #/tasks page's encoding, so a filter link means the same thing on both pages. */
export interface TkState { open: string | null; statuses: TaskStatus[] }
export type TkPatch = Partial<TkState>;

export const ALL_STATUSES: TaskStatus[] = ["open", "hold", "done"];
export const DEFAULT_STATUSES: TaskStatus[] = ["open", "hold"];
const same = (a: TaskStatus[], b: TaskStatus[]) => a.length === b.length && a.every((s) => b.includes(s));

export function readTk(hash: string): TkState {
  const raw = readQuery(hash).get("status");
  const picked = raw === "all" ? ALL_STATUSES : ALL_STATUSES.filter((s) => (raw ?? "").split(",").includes(s));
  return { open: parseV2Route(hash).param, statuses: picked.length ? picked : DEFAULT_STATUSES };
}

/** The `status` value: null for the default (a plain #/v2/tasks is the common case), "all", or the list in
 *  进行中 / 保留 / 完了 order. */
export function statusQuery(statuses: TaskStatus[]): string | null {
  if (same(statuses, DEFAULT_STATUSES)) return null;
  if (same(statuses, ALL_STATUSES)) return "all";
  return ALL_STATUSES.filter((s) => statuses.includes(s)).join(",");
}

/** The hash for a change; other keys (?world= / ?lang=) stay. */
export function tkHash(hash: string, p: TkPatch): string {
  const cur = readTk(hash), open = "open" in p ? p.open ?? null : cur.open;
  const path = open ? `#/v2/tasks/${encodeURIComponent(open)}` : "#/v2/tasks";
  return withQuery(hash, p.statuses ? { status: statusQuery(p.statuses) } : {}, path);
}

export function useTk(): [TkState, (p: TkPatch) => void] {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const st = useMemo(() => readTk(hash), [hash]);
  const set = useCallback((p: TkPatch) => replaceHash(tkHash(window.location.hash, p)), []);
  return [st, set];
}
