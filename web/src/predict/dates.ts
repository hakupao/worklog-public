// Leaf module (imports nothing): arithmetic on YYYY-MM-DD calendar dates. predict/time.ts re-exports it,
// and cal/calendar.ts imports from here so the two do not form an import cycle.
export const DAY = 86_400_000;
export const utcDay = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date: string, n: number) => new Date(utcDay(date) + n * DAY).toISOString().slice(0, 10);
export const weekdayOfDate = (date: string) => new Date(utcDay(date)).getUTCDay() || 7;
export const daysBetween = (a: string, b: string) => Math.round((utcDay(b) - utcDay(a)) / DAY);
