import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "../api/client";
import { toast } from "../components/Toast";
import { t } from "../i18n/t";
import { readCachedPrefs, writeCachedPrefs } from "./cache";
import { DEFAULT_PREFS } from "./defaults";
import type { Prefs } from "./types";

export const PREFS_KEY = ["prefs"] as const;

// One chain for every PUT this tab sends: in call order, never two in flight, so the server ends on
// the last click. Module-level like the write queues in api/queries.ts.
let chain: Promise<unknown> = Promise.resolve();
// Bumped by every write. A GET that started before the latest write is stale: it must not touch the
// cache, and the server's PUT answer is only adopted if no newer write exists.
let seq = 0;
export function __resetPrefsQueueForTests() { chain = Promise.resolve(); seq = 0; }

export function usePrefs() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: PREFS_KEY,
    queryFn: async () => {
      const s = seq, p = await api.prefs();
      if (s !== seq) return qc.getQueryData<Prefs>(PREFS_KEY) ?? p;
      writeCachedPrefs(p);
      return p;
    },
    initialData: () => readCachedPrefs() ?? DEFAULT_PREFS,
    initialDataUpdatedAt: 0,           // always refetch on mount: the cache is only for the first paint
    staleTime: 60_000,
  });
  const prefs = q.data ?? DEFAULT_PREFS;

  const write = useCallback((next: Prefs) => {
    // A GET still in flight (first load, focus refetch) would land after this and overwrite the
    // optimistic value with the old one; cancel it first — the standard optimistic-update move.
    void qc.cancelQueries({ queryKey: PREFS_KEY });
    const mine = ++seq;
    qc.setQueryData(PREFS_KEY, next);
    writeCachedPrefs(next);
    chain = chain.then(async () => {
      try {
        const saved = await api.putPrefs(next);
        // Only adopt the server's copy if nothing newer was set meanwhile.
        if (mine === seq) { qc.setQueryData(PREFS_KEY, saved); writeCachedPrefs(saved); }
      } catch {
        toast.error(t(next.lang, "common.saveFailed"));
        await qc.invalidateQueries({ queryKey: PREFS_KEY });
      }
    });
  }, [qc]);

  const setPrefs = useCallback((update: (p: Prefs) => Prefs) => {
    write(update(qc.getQueryData<Prefs>(PREFS_KEY) ?? DEFAULT_PREFS));
  }, [qc, write]);
  const resetPrefs = useCallback(() => write(DEFAULT_PREFS), [write]);

  return { prefs, setPrefs, resetPrefs };
}
