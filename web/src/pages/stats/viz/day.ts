// 5:00 days (U15) on the Tokyo wall clock. Times are epoch ms; JST is a fixed UTC+9 (no DST), so everything reads
// UTC fields of a shifted instant and never depends on the host's time zone (see src/lib/jst.ts).

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
const JST = 9 * HOUR_MS;
/** A 5:00 day's date is the calendar date of `ms + 9h − 5h`. */
const SHIFT = JST - 5 * HOUR_MS;

/** UTC-midnight ms of a "YYYY-MM-DD" calendar date. */
const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => isoDay(utcDay(date) + n * DAY_MS);

/** 05:00 JST of `date`. */
export function dayStartMs(date: string): number {
  return Date.parse(`${date}T05:00:00+09:00`);
}

/** The 5:00 day ("YYYY-MM-DD") containing `ms`. */
export function day5(ms: number): string {
  return isoDay(Math.floor((ms + SHIFT) / DAY_MS) * DAY_MS);
}

/** Every date from `from` to `to`, both included; empty when `to` is before `from`. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = utcDay(from), e = utcDay(to); d <= e; d += DAY_MS) out.push(isoDay(d));
  return out;
}

/** Hours since the 05:00 that starts `ms`'s day, in [0, 24). */
export function hourOf5(ms: number): number {
  return (((ms + SHIFT) % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS;
}

/** JST clock hour 0–23. */
export function clockHour(ms: number): number {
  return Math.floor((((ms + JST) % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: string): number {
  return (new Date(utcDay(date)).getUTCDay() + 6) % 7;
}

export function weekMonday(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/** ISO-8601 week ("2026-W40"): the week belongs to the year of its Thursday. */
export function isoWeekKey(date: string): string {
  const thursday = utcDay(weekMonday(date)) + 3 * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** [a, b) cut at every 05:00, each piece tagged with its 5:00 day. */
export function cutDays(a: number, b: number): { date: string; a: number; b: number }[] {
  const out: { date: string; a: number; b: number }[] = [];
  while (a < b) {
    const date = day5(a);
    const e = Math.min(b, dayStartMs(date) + DAY_MS);
    out.push({ date, a, b: e });
    a = e;
  }
  return out;
}
