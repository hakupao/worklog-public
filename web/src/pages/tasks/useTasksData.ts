import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { makeCalendar } from "../../cal/calendar";
import { api } from "../../api/client";
import { keys, useTaskTotals } from "../../api/queries";
import type { Task } from "../../api/types";
import { currentWeek } from "../../lib/jst";
import { useV2 } from "../../ui/context";
import { REFRESH_MS, useMinute } from "../now/useNowData";
import { layoutWeek, type WeekLayout } from "../timeline/week";
import { layoutTasks, type TasksLayout } from "./layout";

export interface TasksData {
  layout: TasksLayout | null; week: WeekLayout | null; tasks: Record<string, Task>;
  /** 累计 / 最近 failed on their own: the rows still show, with "--" there (never 0). */
  totalsError: unknown;
  error: unknown; refetch: () => void;
}

/** This week and every task on the old pages' cache keys (shared with 时间线 and 此刻), plus the totals. */
export function useTasksData(): TasksData {
  const { prefs } = useV2();
  const now = useMinute();
  const week = currentWeek(now);
  const o = { refetchInterval: REFRESH_MS };
  const tl = useQuery({ queryKey: keys.timeline(week, false), queryFn: () => api.timeline(week, false), ...o });
  const tasks = useQuery({ queryKey: keys.tasks(undefined), queryFn: () => api.tasks(), ...o });
  const machines = useQuery({ queryKey: keys.machines, queryFn: api.machines, ...o });
  const totals = useTaskTotals(o);
  // Defensive like layoutWeek: an odd answer (not an array) is "not loaded", never a crash.
  const list = Array.isArray(tasks.data) ? tasks.data : null;
  const byId = useMemo(() => Object.fromEntries((list ?? []).map((t) => [t.id, t])) as Record<string, Task>, [list]);
  const wk = useMemo(() => (tl.data && list && machines.data
    ? layoutWeek({ timeline: tl.data, tasks: list, machines: machines.data, now: now.getTime(), runningMin: prefs.predict.runningMin, isOff: makeCalendar(prefs.cal).isOff })
    : null), [tl.data, list, machines.data, now, prefs.predict.runningMin, prefs.cal]);
  const tot = Array.isArray(totals.data) ? totals.data : null;
  const layout = useMemo(() => (wk && list ? layoutTasks({ tasks: list, totals: tot, week: wk }) : null), [wk, list, tot]);
  return {
    layout, week: wk, tasks: byId,
    totalsError: tot === null ? totals.error ?? null : null,
    error: [tl, tasks, machines].find((q) => q.error)?.error ?? null,
    refetch: () => { void tl.refetch(); void tasks.refetch(); void machines.refetch(); void totals.refetch(); },
  };
}
