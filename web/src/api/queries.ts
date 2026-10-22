/**
 * Data layer: TanStack Query key factory + hooks over ./client.ts.
 *
 * Write-hook contract (usePatchSession, useCreateTask, usePatchTask, useCreateNote,
 * usePatchNote, useDeleteNote) — identical for all of them:
 *   1. `onMutate` records, per affected item id, its PREVIOUS ROW in every cached copy it
 *      appears in (and, when the optimistic step removes it from a list — an optimistic
 *      hide, or a note delete — the list and index it was removed from too, so it can be put
 *      back in the right place). It never snapshots a whole query result: a failing mutation
 *      on item A must never touch item B.
 *   2. On success, the response row replaces the cached row everywhere it's currently found
 *      (sessions are re-run through `withEffective` even though the PATCH response already
 *      carries effective fields, so the invariant doesn't depend on the server).
 *   3. On a 409 (`ConflictError`), `error.current` (via `withEffective` for sessions) is
 *      written into every recorded location — REINSERTING it if the optimistic step had
 *      removed it (the hide / delete / link never actually happened) — then the mutation still
 *      rejects. One exception: a 未关联-list location is NOT refilled when `current` itself is
 *      linked or hidden (changed elsewhere), since that row is no longer 未关联.
 *   4. On any other error, every recorded location is put back to its previous row (again,
 *      reinserting if it had been removed), and the mutation still rejects.
 *   5. `onSettled` invalidates `["timeline"]`, `["tasks"]`, `["task"]`, `["task-totals"]`, `["unlinked"]`, AND
 *      `["dashboard"]` — every view that could be showing this data converges, however far
 *      removed from what the hook itself touched (task detail totals, tasks list, timeline
 *      totals/unassigned/hidden, which sessions are 未关联, and the dashboard's figures are all
 *      server-computed). `useCreateTask` additionally
 *      invalidates `["requesters"]`.
 *
 * The places a session can be cached — and so the places steps 1-4 record and restore — are every
 * timeline day, every cached TaskDetail, and the cross-week 未关联 list (`keys.unlinked`, kind
 * `unlinked-list`). That list is deliberately NOT under the `"timeline"` prefix: `liveEntries` walks
 * a prefix assuming one data shape, and the list is a bare `Session[]`. A write that makes a
 * session stop being 未关联 (it gets a task, or is hidden) REMOVES it from the list optimistically,
 * exactly like a hide removes it from a no-include-hidden timeline; a failure reinserts it at its
 * old index. Nothing is ever optimistically INSERTED into the list (unlinking a session elsewhere):
 * its position depends on server-side ordering, so the step-5 refetch adds it.
 *
 * `useDeleteTask` is deliberately OUTSIDE this contract — it has no optimistic step at all, so
 * steps 1/3/4 have nothing to record or put back; see its own comment for why a 案件 delete
 * doesn't want one.
 *
 * These hooks never swallow the error and never touch component state. A component that
 * needs to keep the user's in-progress text across a 409 must drive that itself:
 *
 *   const patchSession = usePatchSession();
 *   try {
 *     await patchSession.mutateAsync({ id, updatedAt, patch: { summary_edited: text } });
 *     // success: the cache already holds the server row; stop editing.
 *   } catch (err) {
 *     if (err instanceof ConflictError) {
 *       // the cache already holds the fresh row (see contract 3 above) — read it back
 *       // (e.g. from useTimeline's data) and let the user decide whether to keep `text`
 *       // or take the fresh value. Do NOT clear or remount the input yourself here.
 *     } else {
 *       toast.error("保存失败");
 *     }
 *   }
 *
 * `updatedAt` — the token every PATCH/DELETE must send — is NOT handled the same way by every
 * hook. `usePatchSession`, `usePatchTask`, `usePatchNote`, `useDeleteNote` AND `useDeleteTask`
 * all resolve their OWN token when the write actually starts (see "per-item write serialization" below): the
 * newest of whatever that id's in-progress chain or the cache currently knows, with the caller's
 * `updatedAt` only a FALLBACK for when the row isn't cached anywhere. `useCreateNote`/
 * `useCreateTask` send exactly the caller's value — a create has no prior token to resolve — and
 * `useHideSessions` (Task 7's batch hide) does too, deliberately: it sends each item's
 * caller-supplied `updatedAt` because it is not routed through the per-item queue (see that
 * hook's own comment). This does mean a 409 is now a slightly weaker signal for
 * sessions/tasks/notes specifically: a change that arrived via a background refetch the user
 * never looked at gets picked up silently instead of surfacing a conflict — the trade Task 6's
 * fix round 1 made deliberately for sessions (to stop two writes on one card racing for an
 * ordinary gesture — edit a summary, then click 隠す — from 409ing each other), generalized to
 * tasks/notes in Task 9's fix round 1 (editing two fields in a drawer back to back), and to
 * `useDeleteNote` in the final review's A-I1 fix (a delete racing a concurrent edit of the same
 * note).
 */
import {
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import { api, ApiError, ConflictError, UnauthorizedError, ValidationError } from "./client";
import type * as T from "./types";

export const keys = {
  machines: ["machines"] as const,
  machineRuns: ["machines", "runs"] as const,
  requesters: ["requesters"] as const,
  timeline: (week: string, includeHidden: boolean) => ["timeline", week, includeHidden] as const,
  tasks: (statuses?: T.TaskStatus[]) => ["tasks", statuses ?? null] as const,
  task: (id: string) => ["task", id] as const,
  // Not under "tasks": the write hooks walk that prefix as Task[] lists (liveEntries).
  taskTotals: ["task-totals"] as const,
  report: (week: string, template: T.TemplateKey) => ["report", week, template] as const,
  dashboard: (from: string, to: string) => ["dashboard", from, to] as const,
  // Its own top-level prefix: the write hooks walk "tasks" / "timeline" as Task[] / Timeline (see the header comment).
  statsSessions: (from: string, to: string) => ["stats-sessions", from, to] as const,
  reviews: ["reviews"] as const,
  // Not under "timeline" — see the header comment.
  unlinked: ["unlinked"] as const,
  planItems: (closed: boolean) => ["plan-items", closed] as const,
  dayPlan: (date: string) => ["day-plan", date] as const,
  reportDownloads: (week: string) => ["report-downloads", week] as const,
  rangeBounds: () => ["range-bounds"] as const,
};

/** A 409's `current` for a session is the raw row: no `*_effective` fields yet. */
export type RawSessionRow = Omit<T.Session, "summary_effective" | "minutes_effective">;

/** summary_effective = summary_edited ?? summary; minutes_effective = minutes_override ?? active_minutes. */
export function withEffective(row: RawSessionRow): T.Session {
  return {
    ...row,
    summary_effective: row.summary_edited ?? row.summary,
    minutes_effective: row.minutes_override ?? row.active_minutes,
  };
}

/** `false` for the error types a retry can never fix — auth, conflict, validation, and (task 9's
 *  data-layer fix, measured live: a stale `#/tasks/<id>` spun ~7s through 3 retries before
 *  reporting "案件不存在") any other 404 or 400 `ApiError`: a missing row or a malformed request
 *  is exactly as missing/malformed on the next attempt. Otherwise up to 3 attempts. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof UnauthorizedError || error instanceof ConflictError || error instanceof ValidationError) {
    return false;
  }
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return false;
  }
  return failureCount < 3;
}

/** Builds a QueryClient wired to the retry rule above; `onUnauthorized` fires for ANY query or mutation. */
export function createQueryClient(onUnauthorized?: () => void): QueryClient {
  const notifyUnauthorized = (error: unknown) => {
    if (error instanceof UnauthorizedError) onUnauthorized?.();
  };
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({ onError: notifyUnauthorized }),
    mutationCache: new MutationCache({ onError: notifyUnauthorized }),
  });
}

export function useMachines() {
  return useQuery({ queryKey: keys.machines, queryFn: api.machines });
}
export function useMachineRuns() {
  // 5 min, same cadence as REFRESH_MS in pages/now/useNowData.ts
  return useQuery({ queryKey: keys.machineRuns, queryFn: api.machineRuns, refetchInterval: 5 * 60_000 });
}
export function useRequesters() {
  return useQuery({ queryKey: keys.requesters, queryFn: api.requesters });
}
export function useTimeline(week: string, includeHidden: boolean) {
  return useQuery({
    queryKey: keys.timeline(week, includeHidden),
    queryFn: () => api.timeline(week, includeHidden),
    // Final review B-C1: without this, switching to a (week, includeHidden) key that has never
    // been fetched in this session (typically the first "显示已隐藏" toggle) makes `data`
    // momentarily undefined, unmounting — then remounting — every DayGroup/SessionCard/InlineEdit
    // on the page, silently discarding any draft the user had open anywhere, not just on a hidden
    // item. Keeping the previous key's data on screen (with `isFetching` true) while the new one
    // loads removes the unmount entirely; TimelinePage shows a small "更新中" indicator instead.
    placeholderData: keepPreviousData,
  });
}
export function useTasks(statuses?: T.TaskStatus[]) {
  return useQuery({ queryKey: keys.tasks(statuses), queryFn: () => api.tasks(statuses) });
}
export function useTask(id: string) {
  return useQuery({ queryKey: keys.task(id), queryFn: () => api.task(id), enabled: id.length > 0 });
}
export function useTaskTotals(o: { refetchInterval?: number } = {}) {
  return useQuery({ queryKey: keys.taskTotals, queryFn: api.taskTotals, ...o });
}
// ---- shared cache-editing helpers for the write hooks ----------------------------------
//
// Every helper below is scoped to ONE item id: it finds that id inside whatever caches
// currently hold it and edits only that slot, never a whole query result. This is what makes
// concurrent mutations on different items safe (see the "overlap" test) and what makes a 409
// on a delete able to put the item back exactly where it was, instead of silently doing
// nothing because a plain find-and-replace can't find a row that's no longer there.

type ListField = "sessions" | "notes";

/** Every cached entry under a key prefix, as [key, data] pairs (skips entries with no data yet). */
function liveEntries<D>(qc: QueryClient, prefix: string): [readonly unknown[], D][] {
  return qc.getQueriesData<D>({ queryKey: [prefix] }).filter((e): e is [readonly unknown[], D] => e[1] !== undefined);
}

/** One place a session/note currently lives, captured before an optimistic edit — enough to put it back exactly. */
interface Occurrence<Item> {
  queryKey: readonly unknown[];
  kind: "timeline" | "task-detail" | "unlinked-list";
  date?: string; // set when kind === "timeline"
  list: ListField;
  index: number;
  previous: Item;
}

function findOccurrences<Item extends { id: string }>(qc: QueryClient, list: ListField, id: string): Occurrence<Item>[] {
  const out: Occurrence<Item>[] = [];
  for (const [queryKey, data] of liveEntries<T.Timeline>(qc, "timeline")) {
    for (const day of data.days) {
      const arr = day[list] as unknown as Item[];
      const index = arr.findIndex((it) => it.id === id);
      if (index !== -1) out.push({ queryKey, kind: "timeline", date: day.date, list, index, previous: arr[index] });
    }
  }
  for (const [queryKey, data] of liveEntries<T.TaskDetail>(qc, "task")) {
    const arr = data[list] as unknown as Item[];
    const index = arr.findIndex((it) => it.id === id);
    if (index !== -1) out.push({ queryKey, kind: "task-detail", list, index, previous: arr[index] });
  }
  if (list === "sessions") {
    for (const [queryKey, arr] of liveEntries<Item[]>(qc, "unlinked")) {
      const index = arr.findIndex((it) => it.id === id);
      if (index !== -1) out.push({ queryKey, kind: "unlinked-list", list, index, previous: arr[index] });
    }
  }
  return out;
}

/**
 * Writes `item` into `occ`'s cache entry: replaces it in place if still present there, or
 * reinserts it near its remembered index if an optimistic hide/delete had removed it. Touches
 * only the one id `occ` was captured for — every sibling item is left exactly as it was.
 */
function writeOccurrence<Item extends { id: string }>(qc: QueryClient, occ: Occurrence<Item>, item: Item): void {
  const splice = (arr: Item[]): Item[] => {
    const next = arr.slice();
    const idx = next.findIndex((it) => it.id === item.id);
    if (idx !== -1) next[idx] = item;
    else next.splice(Math.min(occ.index, next.length), 0, item);
    return next;
  };
  if (occ.kind === "timeline") {
    const data = qc.getQueryData<T.Timeline>(occ.queryKey);
    if (!data) return; // that timeline isn't cached any more; the invalidation below will refetch it
    const days = data.days.map((day) =>
      day.date === occ.date ? ({ ...day, [occ.list]: splice(day[occ.list] as unknown as Item[]) } as T.TimelineDay) : day,
    );
    qc.setQueryData(occ.queryKey, { ...data, days });
  } else if (occ.kind === "unlinked-list") {
    const arr = qc.getQueryData<Item[]>(occ.queryKey);
    if (!arr) return;
    qc.setQueryData(occ.queryKey, splice(arr));
  } else {
    const data = qc.getQueryData<T.TaskDetail>(occ.queryKey);
    if (!data) return;
    qc.setQueryData(occ.queryKey, { ...data, [occ.list]: splice(data[occ.list] as unknown as Item[]) });
  }
}

/** Removes item `id` from `occ`'s cache entry (used for an optimistic hide or an optimistic delete). */
function removeOccurrence<Item extends { id: string }>(qc: QueryClient, occ: Occurrence<Item>): void {
  const id = occ.previous.id;
  if (occ.kind === "timeline") {
    const data = qc.getQueryData<T.Timeline>(occ.queryKey);
    if (!data) return;
    const days = data.days.map((day) =>
      day.date === occ.date
        ? ({ ...day, [occ.list]: (day[occ.list] as unknown as Item[]).filter((it) => it.id !== id) } as T.TimelineDay)
        : day,
    );
    qc.setQueryData(occ.queryKey, { ...data, days });
  } else if (occ.kind === "unlinked-list") {
    const arr = qc.getQueryData<Item[]>(occ.queryKey);
    if (!arr) return;
    qc.setQueryData(occ.queryKey, arr.filter((it) => it.id !== id));
  } else {
    const data = qc.getQueryData<T.TaskDetail>(occ.queryKey);
    if (!data) return;
    qc.setQueryData(occ.queryKey, { ...data, [occ.list]: (data[occ.list] as unknown as Item[]).filter((it) => it.id !== id) });
  }
}

/** `keys.timeline(week, includeHidden)`'s third element is `includeHidden`. */
function isIncludeHiddenKey(queryKey: readonly unknown[]): boolean {
  return queryKey[2] === true;
}

/** Whether `occ` should no longer list a session that now looks like `row`: a hidden one leaves a
 *  timeline fetched without include_hidden, and a hidden or newly linked one leaves the 未关联
 *  list. "Newly": the list also holds sessions whose task_id points at a 案件 that no longer
 *  exists, and editing one of those (its summary, say) must not drop it. */
function dropsOut(occ: Occurrence<T.Session>, row: Pick<T.Session, "hidden" | "task_id">): boolean {
  if (occ.kind === "unlinked-list") {
    return row.hidden === 1 || (row.task_id !== null && row.task_id !== occ.previous.task_id);
  }
  return occ.kind === "timeline" && row.hidden === 1 && !isIncludeHiddenKey(occ.queryKey);
}

function applySessionPatch(s: T.Session, patch: T.SessionPatch): T.Session {
  const next: T.Session = {
    ...s,
    summary_edited: "summary_edited" in patch ? (patch.summary_edited ?? null) : s.summary_edited,
    minutes_override: "minutes_override" in patch ? (patch.minutes_override ?? null) : s.minutes_override,
    hidden: patch.hidden === undefined ? s.hidden : patch.hidden ? 1 : 0,
    task_id: "task_id" in patch ? (patch.task_id ?? null) : s.task_id,
  };
  return withEffective(next);
}

// Tasks are never removed from a list by any mutation here, so no index tracking is needed —
// just the previous row, per cache entry it's found in.
interface TaskOccurrence {
  queryKey: readonly unknown[];
  kind: "tasks-list" | "task-detail-task";
  previous: T.Task;
}
function findTaskOccurrences(qc: QueryClient, id: string): TaskOccurrence[] {
  const out: TaskOccurrence[] = [];
  for (const [queryKey, list] of liveEntries<T.Task[]>(qc, "tasks")) {
    const found = list.find((t) => t.id === id);
    if (found) out.push({ queryKey, kind: "tasks-list", previous: found });
  }
  for (const [queryKey, data] of liveEntries<T.TaskDetail>(qc, "task")) {
    if (data.task.id === id) out.push({ queryKey, kind: "task-detail-task", previous: data.task });
  }
  return out;
}
/**
 * Final review A-C1: a task's 409 `current` comes straight from the DB row (server/src/
 * concurrency.ts's `conflictOrNotFound`), which — on a server predating that fix — ships
 * `deliverables` as the raw JSON-ENCODED STRING it's stored as, not the array every success
 * response decodes it into. Trusting that blindly crashes TaskDrawer's `task.deliverables.map`.
 * Defensive here (belt-and-suspenders alongside the server fix) so a browser mid-deploy-window,
 * talking to an old Worker, never renders a broken shape.
 */
function normalizeTaskDeliverables(task: T.Task): T.Task {
  if (Array.isArray(task.deliverables)) return task;
  let parsed: unknown;
  try {
    parsed = JSON.parse(task.deliverables as unknown as string);
  } catch {
    parsed = [];
  }
  return { ...task, deliverables: Array.isArray(parsed) ? parsed : [] };
}

function writeTaskOccurrence(qc: QueryClient, occ: TaskOccurrence, task: T.Task): void {
  if (occ.kind === "tasks-list") {
    const list = qc.getQueryData<T.Task[]>(occ.queryKey);
    if (!list) return;
    const idx = list.findIndex((t) => t.id === task.id);
    if (idx === -1) return;
    const next = list.slice();
    next[idx] = task;
    qc.setQueryData(occ.queryKey, next);
  } else {
    const data = qc.getQueryData<T.TaskDetail>(occ.queryKey);
    if (!data || data.task.id !== task.id) return;
    qc.setQueryData(occ.queryKey, { ...data, task });
  }
}

/** Every write hook's convergence step: totals, unassigned/hidden counts, and detail lists are all server-computed. */
function invalidateAll(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["timeline"] });
  qc.invalidateQueries({ queryKey: ["tasks"] });
  qc.invalidateQueries({ queryKey: ["task"] });
  qc.invalidateQueries({ queryKey: keys.taskTotals });
  qc.invalidateQueries({ queryKey: keys.unlinked });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
  qc.invalidateQueries({ queryKey: ["stats-sessions"] });
  // every 週報 preview (old and v2 page): its rows, minutes and 未割当 come from sessions, notes and 案件
  qc.invalidateQueries({ queryKey: ["report"] });
}

// ---- per-item write serialization (Task 6's F4, generalized to tasks/notes in Task 9's fix
// round 1) --------------------------------------------------------------------------------
//
// The server bumps `updated_at` with ms resolution and a strict `>` guarantee on every write
// (server/src/concurrency.ts), so two writes on the SAME item issued a few ms apart — editing a
// session's summary then clicking 隠す in one gesture; editing a task's 案件名 then immediately
// clicking 保留 in its drawer — both carry whatever `updated_at` was in the cache when each was
// CALLED, and if the first hasn't resolved yet, that is the same stale value for both: the second
// always 409s for a perfectly ordinary action. Fix: writes for the SAME (kind, id) run strictly
// one after another (writes for a different id, or a different kind, stay fully concurrent — a
// task and a note never share a queue slot even if their ids happened to collide), and each write
// resolves its OWN `updated_at` — the NEWEST of every source it knows about (see
// `currentUpdatedAt`) — at the moment it actually starts, not when the caller called mutate,
// falling back to the caller's `updatedAt` only if the row isn't cached anywhere (e.g.
// undo-after-hide, where a session was optimistically removed from the only timeline that had it,
// and the caller passes the hide response's own updated_at instead).
type WriteKind = "session" | "task" | "note";

function writeQueueKey(kind: WriteKind, id: string): string {
  return `${kind}:${id}`;
}

const writeChains = new Map<string, Promise<unknown>>();
// The outcome of the most recent write in a (kind, id)'s chain, updated the instant that write
// settles. This is deliberately NOT read from the query cache: each hook's own onSuccess/onError
// also update the cache, via their own `.then()`/`.catch()` attached to the very same mutationFn
// result — and those are attached AFTER `enqueueWrite` returns it, so they fire in a LATER
// microtask than anything chained inside this function. A queued write released by (and reading
// from) the cache at that point would see the cache exactly one microtask before onSuccess/onError
// caught up to it. Tracking the outcome here, synchronously alongside releasing the next write,
// closes that gap.
const lastKnownUpdatedAt = new Map<string, string>();

/** A server-issued `updated_at`: a fixed-width UTC ISO instant with milliseconds, exactly what
 *  `nextUpdatedAt` (server/src/concurrency.ts) emits via `toISOString()`. Two tokens of this
 *  shape order correctly by plain string comparison. */
function isServerUpdatedAt(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s);
}

/** The chronologically later of two `updated_at` tokens. A string max is safe when both are the
 *  server's fixed-width shape; otherwise this falls back to `Date.parse`, and if EITHER still
 *  doesn't parse (a test fixture's placeholder, an empty fallback), it keeps `a` rather than
 *  guessing from a comparison that isn't measuring time at all — `a` being whichever token was
 *  already ahead in `currentSessionUpdatedAt`'s reduce, which orders its candidates
 *  most-authoritative-first so ties among non-tokens still resolve sensibly. */
function newerUpdatedAt(a: string, b: string): string {
  if (isServerUpdatedAt(a) && isServerUpdatedAt(b)) return a > b ? a : b;
  const at = Date.parse(a);
  const bt = Date.parse(b);
  if (Number.isNaN(at) || Number.isNaN(bt)) return a;
  return at >= bt ? a : b;
}

/** Every cached copy's `updated_at` for a (kind, id), via the SAME occurrence-finder each write
 *  hook already uses to read/write the cache — a session/note's own `findOccurrences` under its
 *  list field, or a task's `findTaskOccurrences`. */
function cachedUpdatedAtsFor(qc: QueryClient, kind: WriteKind, id: string): string[] {
  if (kind === "task") return findTaskOccurrences(qc, id).map((occ) => occ.previous.updated_at);
  const list: ListField = kind === "session" ? "sessions" : "notes";
  return findOccurrences<{ id: string; updated_at: string }>(qc, list, id).map((occ) => occ.previous.updated_at);
}

/** The freshest `updated_at` this (kind, id) has anywhere: the newest of its in-progress chain's
 *  last recorded outcome (if any), EVERY cached copy of the row (there can be more than one —
 *  e.g. a no-hidden and an include-hidden timeline both cached for the same week, or a task
 *  cached in both the list and its own detail — and they are not always in sync: a background
 *  refetch only touches whichever is active), and `fallback` if the row isn't cached anywhere at
 *  all right now. Picking just the first cached copy (as opposed to the newest) let a stale
 *  INACTIVE copy's token win and 409 an otherwise ordinary edit — exactly the failure this whole
 *  scheme exists to remove. */
function currentUpdatedAt(qc: QueryClient, kind: WriteKind, id: string, fallback: string): string {
  const candidates: string[] = [];
  const tracked = lastKnownUpdatedAt.get(writeQueueKey(kind, id));
  if (tracked !== undefined) candidates.push(tracked);
  candidates.push(...cachedUpdatedAtsFor(qc, kind, id));
  candidates.push(fallback);
  return candidates.reduce(newerUpdatedAt);
}

/** Chains `run` onto whatever is still pending for this (kind, id) (writes for a different id, or
 *  a different kind of the same id, are untouched — `previous` is looked up per queue key). The
 *  map always holds a promise that never rejects, so a failed/conflicted write can never block
 *  (or be skipped by) the next one for the same item; the REAL result (which can reject) is what's
 *  returned to the caller. */
function enqueueWrite<R extends { updated_at: string }>(kind: WriteKind, id: string, run: () => Promise<R>): Promise<R> {
  const key = writeQueueKey(kind, id);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const result = previous.then(run);
  const settled = result.then(
    (row) => {
      lastKnownUpdatedAt.set(key, row.updated_at);
    },
    (err) => {
      if (err instanceof ConflictError) lastKnownUpdatedAt.set(key, (err.current as { updated_at: string }).updated_at);
    },
  );
  writeChains.set(key, settled);
  void settled.finally(() => {
    if (writeChains.get(key) === settled) {
      writeChains.delete(key);
      // Once the chain is idle the cache (kept current by onSuccess/onError) is the source of
      // truth again; holding onto this would let a much-later, unrelated write read a stale value.
      lastKnownUpdatedAt.delete(key);
    }
  });
  return result;
}

/** Test-only: clears both write-queue maps, for every kind. They are module-level (shared across
 *  every `QueryClient`, deliberately — the guarantee is "one (kind, id) writes in order",
 *  regardless of which component or hook instance issued the write), so a chain a test leaves
 *  pending (e.g. an unresolved fetch mock) would otherwise silently couple it to the next test
 *  that writes the same item. Called from `test/setup.ts`'s `afterEach`; not used by application
 *  code. */
export function __resetWriteQueuesForTests(): void {
  writeChains.clear();
  lastKnownUpdatedAt.clear();
}

// ---- write hooks -------------------------------------------------------------------------

export function usePatchSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; updatedAt: string; patch: T.SessionPatch }) =>
      enqueueWrite("session", vars.id, () =>
        api.patchSession(vars.id, currentUpdatedAt(qc, "session", vars.id, vars.updatedAt), vars.patch),
      ),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["timeline"] });
      await qc.cancelQueries({ queryKey: ["task"] });
      await qc.cancelQueries({ queryKey: keys.unlinked });
      const occurrences = findOccurrences<T.Session>(qc, "sessions", id);
      for (const occ of occurrences) {
        // Hiding removes the session from timelines fetched WITHOUT include_hidden, but only
        // marks it hidden (stays visible) where fetched WITH it; hiding or linking it removes it
        // from the 未关联 list. Un-hiding / unlinking is a plain patch: it only ever touches
        // occurrences where the session is already present.
        const next = applySessionPatch(occ.previous, patch);
        if (dropsOut(occ, next)) {
          removeOccurrence(qc, occ);
        } else {
          writeOccurrence(qc, occ, next);
        }
      }
      return { occurrences };
    },
    onSuccess: (row) => {
      const effective = withEffective(row);
      for (const occ of findOccurrences<T.Session>(qc, "sessions", effective.id)) {
        if (dropsOut(occ, effective)) {
          removeOccurrence(qc, occ);
          continue;
        }
        // The PATCH response is the bare row: keep the timeline's day share until the refetch
        // brings the recomputed one, or the card would flash the whole session's hours.
        writeOccurrence(qc, occ, { ...effective, minutes_on_day: occ.previous.minutes_on_day });
      }
    },
    onError: (err, _vars, ctx) => {
      if (!ctx) return;
      if (err instanceof ConflictError) {
        const current = withEffective(err.current as RawSessionRow);
        for (const occ of ctx.occurrences) {
          // Linked or hidden elsewhere: the row is no longer 未关联, so it does not go back there.
          if (occ.kind === "unlinked-list" && dropsOut(occ, current)) removeOccurrence(qc, occ);
          else writeOccurrence(qc, occ, current);
        }
      } else {
        for (const occ of ctx.occurrences) writeOccurrence(qc, occ, occ.previous);
      }
    },
    onSettled: () => invalidateAll(qc),
  });
}

export interface HideSessionsItem {
  id: string;
  updatedAt: string;
}
export interface HideSessionsResult {
  hidden: string[];
  /** 409s — someone/something else changed the row (most likely the collector re-reporting it). */
  conflicted: string[];
  /** Any other per-item failure (network error, 5xx, ...) — NOT auth: see the UnauthorizedError note below. */
  errored: string[];
}
/** Thrown by the batch on session expiry — see the UnauthorizedError branch below. */
export interface HideSessionsAuthError extends UnauthorizedError {
  hiddenBeforeExpiry: number;
}

/**
 * Task 7's "hide all sessions of a directory for the week" — sequential, one PATCH per session.
 * Deliberately NOT built on `usePatchSession`: that hook's contract (per-item optimistic update +
 * an invalidation on every settle) is right for a single edit but wrong here twice over —
 * invalidating after every one of N PATCHes would refetch the timeline N times, and there is
 * nothing to gain from writing the cache optimistically before each response when the caller
 * already renders its own progress via `onProgress`. So this mutationFn drives the loop itself:
 * one PATCH at a time, in order, each with the caller-supplied `updatedAt` for THAT item; a
 * response applies the identical cache write `usePatchSession` uses for a hide/409 — reusing
 * `findOccurrences`/`removeOccurrence`/`writeOccurrence`/`withEffective` rather than copying
 * them.
 *
 * A 409 does NOT stop the batch (someone/something changed one row; the rest are unaffected) and
 * is counted separately from any other failure so the caller can report the truth instead of
 * blaming every failure on "modified elsewhere". An `UnauthorizedError`, however, DOES stop the
 * batch immediately and is RE-THROWN rather than swallowed into the result: every remaining item
 * is doomed to the same 401 (retrying them would just hammer an already-expired session), and
 * letting the mutation actually reject is what lets `createQueryClient`'s
 * `mutationCache.onError` — the thing that shows the app-wide "登录已过期，请刷新页面" banner —
 * fire for this path exactly like it does for every other mutation. Items never reached by the
 * loop were never written to the cache (there is no optimistic step here), so stopping early
 * needs no rollback for them.
 *
 * `onSettled` invalidates once for the whole batch, on success OR rejection.
 */
export function useHideSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      items,
      onProgress,
    }: {
      items: HideSessionsItem[];
      onProgress?: (done: number, total: number) => void;
    }): Promise<HideSessionsResult> => {
      const hidden: string[] = [];
      const conflicted: string[] = [];
      const errored: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const row = await api.patchSession(item.id, item.updatedAt, { hidden: true });
          const effective = withEffective(row);
          for (const occ of findOccurrences<T.Session>(qc, "sessions", item.id)) {
            // The hide succeeded, so the row IS hidden whatever the response body says.
            if (dropsOut(occ, { ...effective, hidden: 1 })) {
              removeOccurrence(qc, occ);
            } else {
              writeOccurrence(qc, occ, effective);
            }
          }
          hidden.push(item.id);
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            throw Object.assign(err, { hiddenBeforeExpiry: hidden.length } satisfies Pick<HideSessionsAuthError, "hiddenBeforeExpiry">);
          }
          if (err instanceof ConflictError) {
            const current = withEffective(err.current as RawSessionRow);
            for (const occ of findOccurrences<T.Session>(qc, "sessions", item.id)) {
              if (occ.kind === "unlinked-list" && dropsOut(occ, current)) removeOccurrence(qc, occ);
              else writeOccurrence(qc, occ, current);
            }
            conflicted.push(item.id);
          } else {
            errored.push(item.id);
          }
        }
        // Counts requests that have COMPLETED (succeeded, conflicted, or errored) — not merely
        // started — so the readout never shows "N/N" before the last one has actually finished.
        onProgress?.(i + 1, items.length);
      }
      return { hidden, conflicted, errored };
    },
    onSettled: () => invalidateAll(qc),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T.TaskCreate) => api.createTask(body),
    onSettled: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ["requesters"] });
    },
  });
}

export function usePatchTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; updatedAt: string; patch: T.TaskPatch }) =>
      enqueueWrite("task", vars.id, () => api.patchTask(vars.id, currentUpdatedAt(qc, "task", vars.id, vars.updatedAt), vars.patch)),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["tasks"] });
      await qc.cancelQueries({ queryKey: ["task"] });
      const occurrences = findTaskOccurrences(qc, id);
      for (const occ of occurrences) writeTaskOccurrence(qc, occ, { ...occ.previous, ...patch });
      return { occurrences };
    },
    onSuccess: (row) => {
      for (const occ of findTaskOccurrences(qc, row.id)) writeTaskOccurrence(qc, occ, row);
    },
    onError: (err, _vars, ctx) => {
      if (!ctx) return;
      if (err instanceof ConflictError) {
        const current = normalizeTaskDeliverables(err.current as T.Task);
        for (const occ of ctx.occurrences) writeTaskOccurrence(qc, occ, current);
      } else {
        for (const occ of ctx.occurrences) writeTaskOccurrence(qc, occ, occ.previous);
      }
    },
    onSettled: (_data, _error, vars) => {
      invalidateAll(qc);
      // Final review A-I3: a 依頼元 rename leaves the create-task autocomplete stale otherwise —
      // useCreateTask already invalidates this; a rename via the drawer must too.
      if (vars.patch.requester !== undefined) qc.invalidateQueries({ queryKey: ["requesters"] });
    },
  });
}

/**
 * Deletes a 案件. Routed through the same per-(kind,id) queue as `usePatchTask`/`useDeleteNote`,
 * for the same reason: a delete issued right after an edit of the SAME task must carry the token
 * that edit produced, not the one the cache held when the user clicked.
 *
 * Deliberately NOT optimistic, unlike `useDeleteNote`. A note is deleted from a row the user can
 * see go away; a 案件 is deleted from behind a confirmation dialog that closes the drawer, and the
 * server refuses outright (409 `linked`) whenever anything still points at it — so there is no
 * moment where removing it early is what makes the UI feel right, and every rollback path that
 * would need (contract 3/4's reinsertion) is dead weight. On success the task is dropped from
 * every cached list and its detail query is REMOVED rather than invalidated: invalidating a query
 * whose row the server no longer has just schedules a guaranteed 404 (TaskDrawer stops observing
 * it at the same moment — see its own `deletedRef`).
 */
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; updatedAt: string }) =>
      enqueueWrite("task", vars.id, async () => {
        const updatedAt = currentUpdatedAt(qc, "task", vars.id, vars.updatedAt);
        await api.deleteTask(vars.id, updatedAt);
        return { updated_at: updatedAt };
      }),
    onSuccess: (_data, { id }) => {
      for (const [queryKey, list] of liveEntries<T.Task[]>(qc, "tasks")) {
        if (list.some((t) => t.id === id)) qc.setQueryData(queryKey, list.filter((t) => t.id !== id));
      }
      qc.removeQueries({ queryKey: keys.task(id) });
    },
    onSettled: () => invalidateAll(qc),
  });
}

/** × (out) or ＋ (in) on an automatic 成果物. Not optimistic: the 案件 detail and the 週報 re-derive it. */
export function useDeliverableVerdict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { key: string; kind: T.AutoDeliverable["kind"]; verdict: "in" | "out" }) => api.putDeliverableVerdict(body),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["task"] });
      qc.invalidateQueries({ queryKey: ["report"] });
      // the dashboard and the stats page count automatic 成果物 too
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["stats-sessions"] });
    },
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T.NoteCreate) => api.createNote(body),
    onSettled: () => invalidateAll(qc),
  });
}

export function usePatchNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; updatedAt: string; patch: T.NotePatch }) =>
      enqueueWrite("note", vars.id, () => api.patchNote(vars.id, currentUpdatedAt(qc, "note", vars.id, vars.updatedAt), vars.patch)),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["timeline"] });
      await qc.cancelQueries({ queryKey: ["task"] });
      const occurrences = findOccurrences<T.Note>(qc, "notes", id);
      for (const occ of occurrences) writeOccurrence(qc, occ, { ...occ.previous, ...patch });
      return { occurrences };
    },
    onSuccess: (row) => {
      for (const occ of findOccurrences<T.Note>(qc, "notes", row.id)) writeOccurrence(qc, occ, row);
    },
    onError: (err, _vars, ctx) => {
      if (!ctx) return;
      if (err instanceof ConflictError) {
        const current = err.current as T.Note;
        for (const occ of ctx.occurrences) writeOccurrence(qc, occ, current);
      } else {
        for (const occ of ctx.occurrences) writeOccurrence(qc, occ, occ.previous);
      }
    },
    onSettled: () => invalidateAll(qc),
  });
}

// ---- report cell overrides (Task 7) ----------------------------------------------------
//
// A report's cache entry (`keys.report(week, template)`) is a single `ReportPreview`, not a list
// keyed by id like sessions/notes/tasks — a cell is addressed by (sheet, row_key, column) instead
// of an id, and it only ever lives in the one query for its own (week, template). So there is no
// "occurrences" search here: `updateReportCell` rewrites exactly the one cell inside that one
// cached preview, exactly like `writeOccurrence` touches exactly one item's slot elsewhere in this
// file. No 409 handling (report overrides carry no `updated_at`; the server is last-writer-wins by
// design — see server/src/report/overrides.ts), so no per-item write queue either.

export interface ReportCellTarget {
  sheet: T.SheetKey;
  row_key: string;
  column: string;
  /** Only the row whose `date` cell (its computed value) is this day. The days sheet keys a session's row by
   *  the session alone, so a session over midnight is two rows with one row_key (v2 週報, preflight R1); without
   *  a date every row with the row_key matches, as before. Never sent to the server. */
  date?: string;
}

/** Whether `row` is the target's row: the row_key, and the day when the target names one. */
function isTargetRow(row: T.GridRow, target: ReportCellTarget): boolean {
  if (row.row_key !== target.row_key) return false;
  if (target.date === undefined) return true;
  const d = row.cells.find((c) => c.column === "date");
  return d !== undefined && String(d.auto ?? d.value) === target.date;
}

/**
 * What `onMutate` hands to `onError`/`onSettled` for a report write — including the query key the
 * write was STARTED against.
 *
 * Phase A review, W1: a cell stays mounted across a week switch, so a save on week 38 followed by
 * a ▶ click used to finish against week 39's key: the wrong week was invalidated, and a rollback
 * wrote week 38's cell straight into week 39's preview (a tasks-sheet row_key is a task id, so it
 * names a real cell in both weeks). The key therefore travels with the write (pages/report/write.ts)
 * instead of being read from the current week when it settles.
 */
export interface ReportWriteContext {
  queryKey: readonly unknown[];
  previousCell: T.GridCell | undefined;
}

/** Rewrites exactly one cell of a cached `ReportPreview`; every other sheet/row/cell object keeps
 *  its old identity. A target the cached grid doesn't have (report regenerated without it, or
 *  nothing cached yet) is a no-op — there is nothing to optimistically update. */
export function updateReportCell(preview: T.ReportPreview, target: ReportCellTarget, update: (cell: T.GridCell) => T.GridCell): T.ReportPreview {
  return {
    ...preview,
    sheets: preview.sheets.map((grid) => {
      if (grid.key !== target.sheet) return grid;
      return {
        ...grid,
        rows: grid.rows.map((row) => {
          if (!isTargetRow(row, target)) return row;
          return { ...row, cells: row.cells.map((c) => (c.column === target.column ? update(c) : c)) };
        }),
      };
    }),
  };
}

/** Finds one cell inside a cached `ReportPreview`, or `undefined` if that (sheet, row_key, column)
 *  isn't in it. */
export function findReportCell(preview: T.ReportPreview | undefined, target: ReportCellTarget): T.GridCell | undefined {
  const grid = preview?.sheets.find((g) => g.key === target.sheet);
  const row = grid?.rows.find((r) => isTargetRow(r, target));
  return row?.cells.find((c) => c.column === target.column);
}

/** Fix round 1, Critical 1: the shared rollback for the report cell writes. Snapshotting
 *  and restoring the WHOLE `ReportPreview` — the original shape — violates
 *  this file's own rule at the top ("a failing mutation on item A must never touch item B"):
 *  editing cell A, then cell B before A settles, then A failing would reset the ENTIRE cache to
 *  what it held before A's edit even started, silently wiping B's — by then possibly already
 *  server-confirmed — change. The fix is the same shape every other hook here uses for a single
 *  item: remember only the ONE cell's previous value, and on error rewrite only that one cell
 *  inside whatever the cache CURRENTLY holds (not the stale onMutate-time snapshot) via
 *  `updateReportCell` — exactly like `writeOccurrence` never touches a sibling item. */
export function rollbackReportCell(qc: QueryClient, ctx: ReportWriteContext | undefined, target: ReportCellTarget): void {
  const previousCell = ctx?.previousCell;
  if (!ctx || !previousCell) return;
  const current = qc.getQueryData<T.ReportPreview>(ctx.queryKey);
  if (!current) return;
  qc.setQueryData(ctx.queryKey, updateReportCell(current, target, () => previousCell));
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    // Final review A-I1: this used to send the caller's captured `updatedAt` directly, bypassing
    // the per-(kind,id) queue every other note/task/session write goes through — so a delete and
    // a concurrent edit of the SAME note could race (the in-flight edit's own token going stale
    // out from under it). Routed through `enqueueWrite`/`currentUpdatedAt` like `usePatchNote`; a
    // delete has no row left afterward to carry a fresher token forward, but resolving the
    // freshest one AT THE MOMENT IT STARTS (same as every other queued write) is what actually
    // closes the race.
    mutationFn: (vars: { id: string; updatedAt: string }) =>
      enqueueWrite("note", vars.id, async () => {
        const updatedAt = currentUpdatedAt(qc, "note", vars.id, vars.updatedAt);
        await api.deleteNote(vars.id, updatedAt);
        return { updated_at: updatedAt };
      }),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ["timeline"] });
      await qc.cancelQueries({ queryKey: ["task"] });
      const occurrences = findOccurrences<T.Note>(qc, "notes", id);
      for (const occ of occurrences) removeOccurrence(qc, occ);
      return { occurrences };
    },
    onError: (err, _vars, ctx) => {
      if (!ctx) return;
      // Either way the delete did NOT happen server-side, so every occurrence — the optimistic
      // step removed all of them — must be reinserted, not merely "updated" (nothing to find).
      if (err instanceof ConflictError) {
        const current = err.current as T.Note;
        for (const occ of ctx.occurrences) writeOccurrence(qc, occ, current);
      } else {
        for (const occ of ctx.occurrences) writeOccurrence(qc, occ, occ.previous);
      }
    },
    onSettled: () => invalidateAll(qc),
  });
}

export function useDashboard(from: string, to: string) {
  return useQuery({ queryKey: keys.dashboard(from, to), queryFn: () => api.dashboard(from, to), placeholderData: keepPreviousData });
}

export function useDayPlan(date: string) {
  return useQuery({ queryKey: keys.dayPlan(date), queryFn: () => api.dayPlan(date) });
}

/** Plan writes are NOT optimistic (outside the header contract): each one waits for the server, then
 *  every plan view refetches. A 409 refetches too, so the next edit starts from the current row. */
function usePlanWriteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    // Write-through: later writes must carry this row's new updated_at without waiting for the refetch.
    onSuccess: (result) => {
      if (!result || typeof result !== "object") return;
      if ("horizon" in result && "id" in result) {
        const row = result as T.PlanItem;
        qc.setQueriesData<T.PlanItem[]>({ queryKey: ["plan-items"] }, (list) => list?.map((p) => (p.id === row.id ? row : p)));
      } else if ("final_status" in result && "date" in result) {
        const row = result as T.DayPlanItem;
        qc.setQueryData<T.DayPlan | null>(keys.dayPlan(row.date), (plan) =>
          plan ? { ...plan, items: plan.items.map((i) => (i.id === row.id ? { ...i, ...row } : i)) } : plan);
      }
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: ["plan-items"] }),
      qc.invalidateQueries({ queryKey: ["day-plan"] }),
      // the 统计 page's plans view reads the day plans through /api/stats/sessions
      qc.invalidateQueries({ queryKey: ["stats-sessions"] }),
    ]),
  });
}

/** The 计划 page's plan write: waits for the server, writes the row through, refetches; it resolves to the
 *  server's answer and throws — the caller reports the failure in the interface language. */
export function usePlanWrite(): <R>(fn: () => Promise<R>) => Promise<R> {
  const { mutateAsync } = usePlanWriteMutation();
  return useCallback(<R,>(fn: () => Promise<R>) => mutateAsync(fn) as Promise<R>, [mutateAsync]);
}
