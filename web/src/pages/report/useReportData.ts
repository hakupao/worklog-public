import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { ReportDownload, ReportPreview, Task, Timeline } from "../../api/types";
import { reportWeekDates, weekOfDate } from "../../lib/jst";
import { REFRESH_MS } from "../now/useNowData";

export interface ReportData {
  /** The preview on screen. While another week loads this is still the previous one (see `updating`);
   *  check `preview.week` before trusting it for the address's week. undefined = nothing yet. */
  preview: ReportPreview | undefined;
  /** The preview query's failure (an ApiError: 400 / 404 = no report can be built for that week); null = none. */
  error: unknown;
  /** Nothing to show yet and no failure: the first load. */
  loading: boolean;
  /** A preview is on screen and a newer one is being fetched (a week switch, or a refresh). */
  updating: boolean;
  /** The preview on screen belongs to another week (kept while the new one loads). */
  stale: boolean;
  /** The timeline (without hidden sessions) of the preview's report week — the U1 task_id source and the drawer's 来源.
   *  Made of two ISO-week timelines (the Saturday's and the Friday's, see reportTimeline), keyed by the report week.
   *  While another week loads, the preview on screen is the previous week's: then this is that week's timeline
   *  from the cache even when the new week's has already arrived (preflight R6), so the shown matrix does not
   *  flash 读取中. undefined until both of the preview's week's are there (matrix.ts: the matrix is then pending). */
  timeline: Timeline | undefined;
  timelineError: unknown;
  /** All 案件; null until loaded (or an odd answer). */
  tasks: Task[] | null;
  /** This week's downloads (the xlsx, the PDF, and xlsx rows from before the templates merged; rows of another
   *  week dropped); null until loaded — also while another week's list is kept on screen. */
  downloads: ReportDownload[] | null;
  /** The week's newest download of any kind, or null (never downloaded / not loaded). */
  lastDownload: ReportDownload | null;
  refetch: () => void;
  refetchTimeline: () => void;
  refetchDownloads: () => void;
}

/** The ISO week a report week's Saturday falls in (the one before `week`): its Saturday / Sunday come from there. */
const satWeek = (week: string) => weekOfDate(reportWeekDates(week)[0]);

/** The report week's timeline from the two ISO-week timelines it spans, as `{ week, days }`: every day of both, in
 *  date order — not only the report week's seven, since the timeline's days are midnight days and the report's run
 *  from 05:00 (a session on Sat 01:00 is under the timeline's Saturday but the report's Friday; matrix.ts re-places
 *  them, and its columns stay the report week's). undefined until both are there — a half week would show a
 *  matrix with the weekend's rows placed by title. */
export function reportTimeline(week: string, sat: Timeline | undefined, fri: Timeline | undefined): Timeline | undefined {
  if (!sat || !fri || !Array.isArray(sat.days) || !Array.isArray(fri.days)) return undefined;
  const days = [...new Map([...sat.days, ...fri.days].map((d) => [d.date, d])).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const unlinked = new Set(days.flatMap((d) => d.sessions.filter((s) => !s.task_id && !s.hidden).map((s) => s.id)));
  // `hidden` cannot be told from days without hidden sessions; nothing on the 週報 reads it (nor the other two)
  return { week, days, total_minutes: days.reduce((n, d) => n + d.minutes, 0), unassigned: unlinked.size, hidden: 0 };
}

/** Everything the 週報 page reads, on the old page's and the other v2 pages' cache keys, so a write anywhere
 *  (a session linked on 时间线, a cell edited here) refreshes every view. */
export function useReportData(week: string): ReportData {
  const qc = useQueryClient();
  const o = { refetchInterval: REFRESH_MS };
  const report = useQuery({ queryKey: keys.report(week, "weekly"), queryFn: () => api.report(week, "weekly"), ...o, placeholderData: keepPreviousData });
  // the report week spans two ISO weeks (Sat / Sun of the one before): both, on the 时间线's own cache keys
  const sw = satWeek(week);
  const tlSat = useQuery({ queryKey: keys.timeline(sw, false), queryFn: () => api.timeline(sw, false), ...o, placeholderData: keepPreviousData });
  const tl = useQuery({ queryKey: keys.timeline(week, false), queryFn: () => api.timeline(week, false), ...o, placeholderData: keepPreviousData });
  const tasksQ = useQuery({ queryKey: keys.tasks(undefined), queryFn: () => api.tasks(), ...o });
  const dl = useQuery({ queryKey: keys.reportDownloads(week), queryFn: () => api.reportDownloads(week), ...o, placeholderData: keepPreviousData });
  const preview = report.data;
  const pWeek = preview && typeof preview.week === "string" ? preview.week : undefined;
  // the preview's week's two timelines: the queries' when they are that week's, else the cache's (preflight R6)
  const own = (q: { data?: Timeline }, w: string) => (q.data?.week === w ? q.data : qc.getQueryData<Timeline>(keys.timeline(w, false)));
  const satTl = pWeek === undefined ? undefined : own(tlSat, satWeek(pWeek));
  const friTl = pWeek === undefined ? undefined : own(tl, pWeek);
  const timeline = useMemo(() => (pWeek === undefined ? undefined : reportTimeline(pWeek, satTl, friTl)), [pWeek, satTl, friTl]);
  // the list kept from another week while this week's loads is not this week's: none yet (no 还没下载过 flash),
  // and a row of another week never counts
  const downloads = Array.isArray(dl.data) && !dl.isPlaceholderData ? dl.data.filter((d) => d.week === week) : null;
  const lastDownload = downloads
    ?.reduce<ReportDownload | null>((a, d) => (!a || d.at > a.at ? d : a), null) ?? null;
  const { refetch: refetchReport } = report, { refetch: refetchTl } = tl, { refetch: refetchSat } = tlSat, { refetch: refetchDl } = dl;
  const refetch = useCallback(() => { void refetchReport(); }, [refetchReport]);
  const refetchTimeline = useCallback(() => { void refetchSat(); void refetchTl(); }, [refetchSat, refetchTl]);
  const refetchDownloads = useCallback(() => { void refetchDl(); }, [refetchDl]);
  return {
    preview,
    error: report.error ?? null,
    loading: preview === undefined && !report.error,
    updating: preview !== undefined && report.isFetching,
    stale: report.isPlaceholderData,
    timeline,
    timelineError: tlSat.error ?? tl.error ?? null,
    tasks: Array.isArray(tasksQ.data) ? tasksQ.data : null,
    downloads,
    lastDownload,
    refetch,
    refetchTimeline,
    refetchDownloads,
  };
}
