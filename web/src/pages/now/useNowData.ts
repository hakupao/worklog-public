import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { DayPlan, Session, Timeline } from "../../api/types";
import { currentWeek, reportWeekOf, shiftWeek, todayJst } from "../../lib/jst";
import type { SnapInput } from "../../predict/snapshot";

/** Harvest is hourly; five minutes keeps the board fresh without hammering D1. */
export const REFRESH_MS = 5 * 60_000;

/** "Now" for the board: moves at each whole minute (the header clock ticks on its own). */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id = 0;
    const arm = () => { id = window.setTimeout(() => { setNow(new Date()); arm(); }, 60_000 - (Date.now() % 60_000)); };
    arm();
    return () => clearTimeout(id);
  }, []);
  return now;
}

const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const daysOf = (x: Timeline | undefined) => (x && Array.isArray(x.days) ? x.days : []);
const planOf = (x: DayPlan | null | undefined) => (x && Array.isArray(x.items) ? x : null);

/** Every query the snapshot needs (see the plan's 规则 → 数据来源 table), on the same cache keys as the
 *  old pages, so their writes invalidate this board too. */
export function useNowData(): { input: SnapInput | null; error: unknown } {
  const now = useMinute();
  const week = currentWeek(now), prev = shiftWeek(week, -1), today = todayJst(now);
  // Downloads are keyed by the 週報's Sat→Fri week, which report.undownloaded tests (not the ISO week).
  const reportWeek = reportWeekOf(now);
  const o = { refetchInterval: REFRESH_MS };
  // Date- and week-keyed queries keep the previous key's data while the new key loads, so the board does not
  // flash 「读取中」 at Tokyo midnight or on Monday 00:00.
  const kept = { ...o, placeholderData: keepPreviousData };
  const machines = useQuery({ queryKey: keys.machines, queryFn: api.machines, ...o });
  const cur = useQuery({ queryKey: keys.timeline(week, false), queryFn: () => api.timeline(week, false), ...kept });
  const last = useQuery({ queryKey: keys.timeline(prev, false), queryFn: () => api.timeline(prev, false), ...kept });
  const tasks = useQuery({ queryKey: keys.tasks(undefined), queryFn: () => api.tasks(), ...o });
  const plan = useQuery({ queryKey: keys.planItems(false), queryFn: () => api.planItems(false), ...o });
  const day = useQuery({ queryKey: keys.dayPlan(today), queryFn: () => api.dayPlan(today), ...kept });
  const dl = useQuery({ queryKey: keys.reportDownloads(reportWeek), queryFn: () => api.reportDownloads(reportWeek), ...kept });
  // The download list feeds one rule only: if it fails, read it as "none yet" rather than blank the board.
  const error = [machines, cur, last, tasks, plan, day].find((q) => q.error)?.error ?? null;
  const input = useMemo<SnapInput | null>(() => {
    if (machines.data === undefined || cur.data === undefined || last.data === undefined || tasks.data === undefined
      || plan.data === undefined || day.data === undefined || (dl.data === undefined && !dl.isError)) return null;
    const days = [...daysOf(last.data), ...daysOf(cur.data)];
    // the timeline's own per-day split of each session (server split.ts), keyed by session and date
    const dayMinutes: Record<string, Record<string, number>> = {};
    for (const d of days) for (const x of list<Session>(d.sessions)) {
      if (typeof x.minutes_on_day === "number") (dayMinutes[x.id] ??= {})[d.date] = x.minutes_on_day;
    }
    return {
      now: now.getTime(),
      machines: list(machines.data),
      sessions: days.flatMap((d) => list<Session>(d.sessions)),
      tasks: list(tasks.data), planItems: list(plan.data), dayPlan: planOf(day.data),
      downloads: dl.isError ? [] : list(dl.data), dayMinutes,
    };
  }, [now, machines.data, cur.data, last.data, tasks.data, plan.data, day.data, dl.data, dl.isError]);
  return { input, error };
}
