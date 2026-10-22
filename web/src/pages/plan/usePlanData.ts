import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { makeCalendar } from "../../cal/calendar";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { DayPlan, Machine, PlanItem, Task } from "../../api/types";
import { currentWeek, weekOfDate } from "../../lib/jst";
import { jstDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { REFRESH_MS, useMinute } from "../now/useNowData";
import { layoutWeek, type Band, type WeekLayout } from "../timeline/week";
import { weekBands, weekdaysOf } from "./layout";

export interface PlanData {
  /** undefined = loading (or failed: see dayError); null = the day has not been started. */
  plan: DayPlan | null | undefined; dayError: unknown;
  /** Active plan items; null until loaded. */
  items: PlanItem[] | null; itemsError: unknown;
  /** The chosen day's band (its sessions by task); null = the day has no band; undefined = its week is not loaded. */
  band: Band | null | undefined;
  /** Monday–Friday of the chosen day's week and their day plans (the AI 对账 bars; user ruling U1). */
  histDays: string[]; histPlans: (DayPlan | null | undefined)[];
  /** Monday–Friday of the current week and their bands (the timetable's week strip = this week, like 案件). */
  stripDays: string[]; stripBands: (Band | null)[];
  today: string;
  tasks: Task[] | null;
  refetchDay: () => void; refetchItems: () => void;
}

/** One week's layout on the timeline's cache key (shared with 时间线, 此刻 and 案件). */
function useWeek(week: string, now: Date, tasks: Task[] | null, machines: Machine[] | undefined): WeekLayout | null {
  const { prefs } = useV2();
  const tl = useQuery({ queryKey: keys.timeline(week, false), queryFn: () => api.timeline(week, false), refetchInterval: REFRESH_MS, placeholderData: keepPreviousData });
  // a kept-previous answer for another week must not draw on this one
  const data = tl.data && tl.data.week === week ? tl.data : null;
  return useMemo(() => (data && tasks && machines
    ? layoutWeek({ timeline: data, tasks, machines, now: now.getTime(), runningMin: prefs.predict.runningMin, isOff: makeCalendar(prefs.cal).isOff })
    : null), [data, tasks, machines, now, prefs.predict.runningMin, prefs.cal]);
}

/** Everything the 计划 page reads, on the old pages' cache keys: a write anywhere refreshes every view. */
export function usePlanData(date: string): PlanData {
  const now = useMinute();
  const o = { refetchInterval: REFRESH_MS };
  const day = useQuery({ queryKey: keys.dayPlan(date), queryFn: () => api.dayPlan(date), ...o });
  const items = useQuery({ queryKey: keys.planItems(false), queryFn: () => api.planItems(false), ...o });
  const tasksQ = useQuery({ queryKey: keys.tasks(undefined), queryFn: () => api.tasks(), ...o });
  const machines = useQuery({ queryKey: keys.machines, queryFn: api.machines, ...o });
  const histDays = useMemo(() => weekdaysOf(date), [date]);
  const hist = useQueries({ queries: histDays.map((d) => ({ queryKey: keys.dayPlan(d), queryFn: () => api.dayPlan(d), ...o })) });
  // Defensive like useTasksData: an odd answer (not an array) is "not loaded", never a crash.
  const tasks = Array.isArray(tasksQ.data) ? tasksQ.data : null;
  const today = jstDate(now.getTime());
  const dayWeek = useWeek(weekOfDate(date), now, tasks, machines.data);
  const curWeek = useWeek(currentWeek(now), now, tasks, machines.data);
  const stripDays = useMemo(() => weekdaysOf(today), [today]);
  const plan = day.data === undefined ? undefined : planOf(day.data);
  return {
    plan, dayError: day.error ?? null,
    items: Array.isArray(items.data) ? items.data : null, itemsError: items.error ?? null,
    band: dayWeek ? dayWeek.bands.find((b) => b.date === date) ?? null : undefined,
    histDays, histPlans: hist.map((q) => (q.data === undefined ? undefined : planOf(q.data))),
    stripDays, stripBands: weekBands(curWeek, stripDays),
    today, tasks,
    refetchDay: () => { void day.refetch(); },
    refetchItems: () => { void items.refetch(); },
  };
}

/** A day plan as the page can use it; a malformed answer is "not started" rather than a crash (useNowData's planOf). */
function planOf(x: unknown): DayPlan | null {
  return x && typeof x === "object" && Array.isArray((x as DayPlan).items) ? (x as DayPlan) : null;
}
