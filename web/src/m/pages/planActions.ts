// web/src/m/pages/planActions.ts
import { api } from "../../api/client";
import type { DayPlanItemPatch } from "../../api/types";
import { useFresh, usePlanQueue } from "../../pages/plan/write";

/** The row is no longer in the cache — deleted elsewhere. A save must not look like it succeeded. */
export class PlanGoneError extends Error { constructor() { super("day-plan item gone"); } }

export interface PlanActions {
  start(): Promise<unknown>;
  add(text: string): Promise<unknown>;
  toggle(id: string): Promise<unknown>;
  /** Throws on failure (the sheet keeps the draft and reports it). */
  save(id: string, patch: DayPlanItemPatch): Promise<unknown>;
  /** Throws on failure. */
  remove(id: string): Promise<unknown>;
}

/** The phone's day-plan writes, one after another through the desktop's queue. Each reads the row's updated_at from
 *  the cache at its turn (useFresh), so a write right after another carries the new token. A toggle decides 完成 / 未做
 *  at its turn too, and a second toggle of the same row while the first is in flight is dropped (key). */
export function usePlanActions(date: string): PlanActions {
  const queue = usePlanQueue();
  const fresh = useFresh();
  return {
    start: () => queue(() => api.startDayPlan(date), { key: `start:${date}` }),
    add: (text) => queue(() => api.addDayPlanItem(date, { text })),
    toggle: (id) => queue(async () => {
      const it = fresh.day(date, id);
      if (!it) return undefined;
      return api.patchDayPlanItem(id, it.updated_at, { manual_status: it.final_status === "done" ? "none" : "done" });
    }, { key: `toggle:${id}` }),
    save: (id, patch) => queue(async () => {
      const it = fresh.day(date, id);
      if (!it) throw new PlanGoneError();
      return api.patchDayPlanItem(id, it.updated_at, patch);
    }, { rethrow: true }),
    remove: (id) => queue(async () => {
      const it = fresh.day(date, id);
      if (!it) return undefined;
      await api.deleteDayPlanItem(id, it.updated_at);
      return true;
    }, { rethrow: true }),
  };
}
