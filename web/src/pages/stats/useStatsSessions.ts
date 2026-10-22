import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "../../api/client";
import { keys, useTasks } from "../../api/queries";
import type { StatsSessions, Task } from "../../api/types";
import { REFRESH_MS } from "../now/useNowData";

export interface StatsSessionsData {
  /** The sessions on screen. While another range loads this is still the previous one (see `stale`);
   *  undefined = nothing yet. */
  data: StatsSessions | undefined;
  /** The sessions query's failure; null = none. */
  error: unknown;
  /** The sessions on screen belong to another range (kept while the new one loads). */
  stale: boolean;
  /** Every task (titles, 依頼元, projects for the views); undefined until loaded. */
  tasks: Task[] | undefined;
  /** The task table's request has settled — loaded or failed (A5: the views wait for it, then use ids if it failed). */
  tasksIn: boolean;
  refetch: () => void;
}

/** The 统计 page's views' data: the range's sessions (5:00 days) and plans, re-read every REFRESH_MS like the
 *  dashboard (useStatsData), and the whole task table on the shared ["tasks", null] key. */
export function useStatsSessions(from: string, to: string): StatsSessionsData {
  const q = useQuery({ queryKey: keys.statsSessions(from, to), queryFn: () => api.statsSessions(from, to), placeholderData: keepPreviousData, refetchInterval: REFRESH_MS });
  const tasks = useTasks();
  const { refetch: refetchQ } = q;
  const refetch = useCallback(() => { void refetchQ(); }, [refetchQ]);
  return { data: q.data, error: q.error ?? null, stale: q.isPlaceholderData, tasks: Array.isArray(tasks.data) ? tasks.data : undefined, tasksIn: !tasks.isPending, refetch };
}
