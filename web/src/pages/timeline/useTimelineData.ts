import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { makeCalendar } from "../../cal/calendar";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { Session, Task } from "../../api/types";
import { useV2 } from "../../ui/context";
import { REFRESH_MS, useMinute } from "../now/useNowData";
import { layoutWeek, type WeekLayout } from "./week";

export interface TimelineData {
  layout: WeekLayout | null;
  tasks: Record<string, Task>;
  /** The cross-week 未关联 list (GET /api/sessions?unlinked=1): the filter's rows and the key's count. */
  unlinked: Session[] | null;
  /** That list's own failure: the filter must say so, never read it as "nothing unlinked" (preflight R2). */
  unlinkedError: unknown; refetchUnlinked: () => void;
  error: unknown; fetching: boolean; refetch: () => void;
}

/** The week on the old pages' cache keys, so a write anywhere (old page, 此刻, this drawer) refreshes it. */
export function useTimelineData(week: string, includeHidden: boolean): TimelineData {
  const { prefs } = useV2();
  const now = useMinute();
  const o = { refetchInterval: REFRESH_MS };
  // a new week or the 已隐藏 toggle keeps the last answer on screen until the new one lands (no blank board)
  const tl = useQuery({ queryKey: keys.timeline(week, includeHidden), queryFn: () => api.timeline(week, includeHidden), placeholderData: keepPreviousData, ...o });
  const tasks = useQuery({ queryKey: keys.tasks(undefined), queryFn: () => api.tasks(), ...o });
  const machines = useQuery({ queryKey: keys.machines, queryFn: api.machines, ...o });
  const un = useQuery({ queryKey: keys.unlinked, queryFn: api.unlinkedSessions, ...o });
  const byId = useMemo(() => Object.fromEntries((tasks.data ?? []).map((t) => [t.id, t])) as Record<string, Task>, [tasks.data]);
  const layout = useMemo(() => (tl.data && tasks.data && machines.data
    ? layoutWeek({ timeline: tl.data, tasks: tasks.data, machines: machines.data, now: now.getTime(), runningMin: prefs.predict.runningMin, isOff: makeCalendar(prefs.cal).isOff })
    : null), [tl.data, tasks.data, machines.data, now, prefs.predict.runningMin, prefs.cal]);
  return {
    layout, tasks: byId, unlinked: un.data ?? null,
    unlinkedError: un.data === undefined ? un.error ?? null : null, refetchUnlinked: () => { void un.refetch(); },
    error: [tl, tasks, machines].find((q) => q.error)?.error ?? null,
    fetching: tl.isFetching && tl.isPlaceholderData,
    refetch: () => { void tl.refetch(); void tasks.refetch(); void machines.refetch(); },
  };
}
