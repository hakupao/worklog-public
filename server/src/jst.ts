const DAY = 86_400_000;
const JST_OFFSET = 9 * 3_600_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** ISO-8601 week in the Asia/Tokyo calendar. Calendar math is done on UTC midnights, then shifted by -9h. */
export function weekRange(week: string): { days: string[]; startUnix: number; endUnix: number } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const wk = Number(m[2]);
  if (wk < 1 || wk > 53) return null;
  const jan4 = Date.UTC(year, 0, 4); // Jan 4th is always in ISO week 1
  const weekday = new Date(jan4).getUTCDay() || 7;
  const monday = jan4 - (weekday - 1) * DAY + (wk - 1) * 7 * DAY;
  // A week belongs to the year of its Thursday; this rejects W53 in years that do not have one.
  if (new Date(monday + 3 * DAY).getUTCFullYear() !== year) return null;
  return {
    days: Array.from({ length: 7 }, (_, i) => isoDay(monday + i * DAY)),
    startUnix: (monday - JST_OFFSET) / 1000,
    endUnix: (monday + 7 * DAY - JST_OFFSET) / 1000,
  };
}

/** Calendar day in Asia/Tokyo of an ISO-8601 instant. Never slice the stored string instead. */
export function jstDate(iso: string): string {
  return isoDay(new Date(iso).getTime() + JST_OFFSET);
}

export function jstNow(): { date: string; stamp: string; naive: string } {
  const naive = new Date(Date.now() + JST_OFFSET).toISOString().slice(0, 19);
  return { date: naive.slice(0, 10), stamp: naive.replace(/[-:]/g, "").replace("T", "-"), naive };
}

const dayMs = (date: string) => Date.parse(date + "T00:00:00Z");

export function addDays(date: string, n: number): string {
  return isoDay(dayMs(date) + n * DAY);
}

/** Whole days from a to b (b - a). Both are calendar dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY);
}

/** ISO-8601 week of a calendar date: the week belongs to the year of its Thursday. */
export function isoWeekOf(date: string): string {
  const ms = dayMs(date);
  const weekday = new Date(ms).getUTCDay() || 7;
  const thursday = ms + (4 - weekday) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Tokyo calendar date, weekday (Mon=0..Sun=6) and minute of day of an ISO-8601 instant. */
export function jstClock(iso: string): { date: string; weekday: number; minuteOfDay: number } {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET);
  return {
    date: isoDay(d.getTime()),
    weekday: (d.getUTCDay() + 6) % 7,
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}
