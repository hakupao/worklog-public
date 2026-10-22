import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { keys, usePlanWrite } from "../../api/queries";
import type { DayPlan, DayPlanItem, PlanItem } from "../../api/types";
import { useV2 } from "../../ui/context";
import { reportWriteError } from "../writeError";

/** One plan write at a time per caller: a second click while the first is in flight is ignored (it would carry
 *  the same updated_at and 409 on its own token — the old page's quick back-to-back writes). A failure is
 *  reported in the interface language; the result is undefined then. */
export function usePlanRun(): <R>(fn: () => Promise<R>) => Promise<R | undefined> {
  const write = usePlanWrite();
  const { lang } = useV2();
  const busy = useRef(false);
  return useCallback(async <R,>(fn: () => Promise<R>) => {
    if (busy.current) return undefined;
    busy.current = true;
    try { return await write(fn); } catch (err) { reportWriteError(lang, err); return undefined; } finally { busy.current = false; }
  }, [write, lang]);
}

export interface QueueOpts {
  /** The same key as the write queued just before, still waiting or running: this one is dropped (a double click on
   *  one control). Only the last one counts: 完成 → 自动 → 完成 sends all three (review A). */
  key?: string;
  /** Throw the failure to the caller instead of reporting it (InlineEdit keeps the draft and says why itself). */
  rethrow?: boolean;
}

/** A drawer's writes, one after another (preflight R1): a save that is still in flight — its refetch included — must
 *  not swallow the next click on another control (具体要求 saved on blur, then 判定 clicked: both are sent, in that
 *  order). A write's turn comes after the one before has been answered AND refetched, so `fn` must read what it
 *  builds on from the cache then (`useFresh`): the updated_at, and for a list or an order the current list — never a
 *  value computed at the click (review A / C: two quick × would re-link the first). The same control twice in a row
 *  (same `key` as the last one queued) is sent once. */
export function usePlanQueue(): <R>(fn: () => Promise<R>, o?: QueueOpts) => Promise<R | undefined> {
  const write = usePlanWrite();
  const { lang } = useV2();
  const tail = useRef<Promise<unknown>>(Promise.resolve()), last = useRef<{ key: string | undefined; live: boolean }>({ key: undefined, live: false });
  return useCallback(<R,>(fn: () => Promise<R>, o: QueueOpts = {}) => {
    if (o.key !== undefined && last.current.live && last.current.key === o.key) return Promise.resolve(undefined);
    const me = { key: o.key, live: true };
    last.current = me;
    const done = () => { me.live = false; };
    const job = tail.current.then(() => write(fn)).then(
      (r) => { done(); return r as R | undefined; },
      (err) => { done(); if (o.rethrow) throw err; reportWriteError(lang, err); return undefined; },
    );
    tail.current = job.catch(() => undefined);
    return job;
  }, [write, lang]);
}

/** A segmented control's value as the user last chose it: the one queued and not yet answered, else the server's.
 *  A click compares against this, not the render (final review: 部分 then quickly 自动 must end on 自动). */
export function useChosen<T>(server: T): [T, (v: T, write: () => Promise<unknown>) => void] {
  const want = useRef<{ v: T } | null>(null);
  const cur = want.current ? want.current.v : server;
  const choose = (v: T, write: () => Promise<unknown>) => {
    if ((want.current ? want.current.v : server) === v) return;
    const me = { v };
    want.current = me;
    void write().finally(() => { if (want.current === me) want.current = null; });
  };
  return [cur, choose];
}

/** The cached rows as of the click, not as of the render: the previous write's answer is written through into the
 *  cache at once, while the props that carried this row may still be one render behind. */
export function useFresh() {
  const qc = useQueryClient();
  return {
    day: (date: string, id: string): DayPlanItem | undefined => qc.getQueryData<DayPlan | null>(keys.dayPlan(date))?.items.find((i) => i.id === id),
    /** The day's items in their current order. */
    dayItems: (date: string): DayPlanItem[] | undefined => qc.getQueryData<DayPlan | null>(keys.dayPlan(date))?.items,
    /** The active plan items in their current order. */
    items: (): PlanItem[] | undefined => qc.getQueryData<PlanItem[]>(keys.planItems(false)),
    item: (id: string): PlanItem | undefined => {
      for (const closed of [false, true]) {
        const hit = qc.getQueryData<PlanItem[]>(keys.planItems(closed))?.find((p) => p.id === id);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}
