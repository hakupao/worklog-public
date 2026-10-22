// The 週報's own calendar (design 2026-10-08 §3.1): a day runs from 05:00 JST, a report week from
// Saturday 05:00 to the next Saturday 05:00, keyed by the ISO week of its Friday. Only report code uses
// this; the timeline / stats / plans keep jst.ts's ISO weeks.
import { addDays, isoWeekOf, weekRange } from "../jst";

const DAY = 86_400_000;
const JST = 9 * 3_600_000;
export const DAY5_MS = 5 * 3_600_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The 05:00-day (YYYY-MM-DD) an instant belongs to. */
export const day5Of = (ms: number): string => isoDay(ms + JST - DAY5_MS);

/** Epoch ms of `date` 05:00 JST. */
export const dayStart5 = (date: string): number => Date.parse(`${date}T00:00:00Z`) - JST + DAY5_MS;

export function reportWeekRange(week: string) {
  const iso = weekRange(week);
  if (!iso) return null;
  const saturday = addDays(iso.days[0], -2);              // Monday − 2
  const days = Array.from({ length: 7 }, (_, i) => addDays(saturday, i));
  const startMs = dayStart5(saturday), endMs = startMs + 7 * DAY;
  return { days, startMs, endMs, startUnix: startMs / 1000, endUnix: endMs / 1000 };
}

/** The report week an instant belongs to: the ISO week of the Friday ending its Sat→Fri week. */
export function reportWeekOf(ms: number): string {
  const d = day5Of(ms);
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();      // 0 Sun … 6 Sat
  const toFriday = (5 - wd + 7) % 7;                      // Sat → 6, Sun → 5, Mon → 4 … Fri → 0
  return isoWeekOf(addDays(d, toFriday));
}
