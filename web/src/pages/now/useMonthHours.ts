import { useMemo } from "react";
import { useStatsSessions } from "../stats/useStatsSessions";
import { perDay, prepare } from "../stats/viz/wall";

/** Heat tier of a day's wall-clock minutes: 0 none, 1 <4h, 2 <7h, 3 <9.5h, 4 more. */
export function hourTier(min: number | undefined): 0 | 1 | 2 | 3 | 4 {
  if (!min || min <= 0) return 0;
  if (min < 240) return 1;
  if (min < 420) return 2;
  if (min < 570) return 3;
  return 4;
}

export interface MonthHours {
  /** 05:00 day → wall-clock minutes (days with none are absent). */
  byDate: Map<string, number>;
  /** Days with minutes > 0. */
  recorded: number;
  /** Days of the month up to and including today. */
  pastDays: number;
}

/** Wall-clock work minutes per 05:00 day, from the 1st of `today`'s month through `today`; null until loaded.
 *  Also null while the query still shows another month (keepPreviousData): at a month rollover last month's days
 *  must not be counted against the new month's `pastDays`. A day change inside the month keeps the previous
 *  days on screen while the longer range loads (they are a subset of it). */
export function useMonthHours(today: string): MonthHours | null {
  const first = `${today.slice(0, 8)}01`;
  const { data } = useStatsSessions(first, today);
  return useMemo(() => {
    if (data?.range?.from !== first) return null;      // also a malformed answer: the strip is on the home page
    const byDate = new Map<string, number>();
    for (const d of perDay(prepare(data))) if (d.union > 0) byDate.set(d.date, d.union);
    return { byDate, recorded: byDate.size, pastDays: Number(today.slice(8, 10)) };
  }, [data, first, today]);
}
