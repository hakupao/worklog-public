import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { Dashboard, Review } from "../../api/types";
import { REFRESH_MS } from "../now/useNowData";

export interface StatsData {
  /** The dashboard on screen. While another range loads this is still the previous one (see `stale`);
   *  undefined = nothing yet. */
  dash: Dashboard | undefined;
  /** The dashboard query's failure; null = none. */
  error: unknown;
  /** Nothing to show yet and no failure: the first load. */
  loading: boolean;
  /** A dashboard is on screen and a newer one is being fetched (a range switch, or a refresh). */
  updating: boolean;
  /** The dashboard on screen belongs to another range (kept while the new one loads). */
  stale: boolean;
  /** The weekly reviews, newest first; null until loaded (or failed, or an odd answer). */
  reviews: Review[] | null;
  /** The reviews' own failure — the review section shows it alone; null = none. */
  reviewsError: unknown;
  /** The first reviews load is in flight (false once it lands or fails). */
  reviewsLoading: boolean;
  refetch: () => void;
  refetchReviews: () => void;
}

/** Everything the 统计 page reads, on the old 首页's cache keys, so the writes that invalidate ["dashboard"]
 *  (sessions, notes, tasks) refresh this page too. The dashboard and the reviews (which nothing invalidates: only the
 *  CLI writes them) are also re-read every REFRESH_MS like the other v2 pages' data (the old page's useDashboard /
 *  useReviews do not, and keep their behaviour). */
export function useStatsData(from: string, to: string): StatsData {
  const dash = useQuery({ queryKey: keys.dashboard(from, to), queryFn: () => api.dashboard(from, to), placeholderData: keepPreviousData, refetchInterval: REFRESH_MS });
  const rv = useQuery({ queryKey: keys.reviews, queryFn: () => api.reviews(8), refetchInterval: REFRESH_MS });
  const { refetch: refetchDash } = dash, { refetch: refetchRv } = rv;
  const refetch = useCallback(() => { void refetchDash(); }, [refetchDash]);
  const refetchReviews = useCallback(() => { void refetchRv(); }, [refetchRv]);
  return {
    dash: dash.data,
    error: dash.error ?? null,
    loading: dash.data === undefined && !dash.error,
    updating: dash.data !== undefined && dash.isFetching,
    stale: dash.isPlaceholderData,
    reviews: Array.isArray(rv.data) ? rv.data : null,
    reviewsError: rv.error ?? null,
    reviewsLoading: rv.isPending,
    refetch,
    refetchReviews,
  };
}
