// The demo's calendar: about eight weeks of work ending at DEMO_NOW, in Asia/Tokyo. Day / week math is the server's own
// (server/src/jst.ts, server/src/report/week.ts), so the seed and the pages agree on every boundary.
import { addDays, isoWeekOf, jstDate } from "../../../server/src/jst";

export { addDays, isoWeekOf, jstDate };

/** DEMO_NOW = 2026-10-15T15:20:00+09:00, a Thursday afternoon. */
export const TODAY = "2026-10-15";
export const FIRST_DAY = "2026-08-22";
/** 敬老の日, 国民の休日, 秋分の日, スポーツの日 (the web calendar reads the same dates from @holiday-jp). */
export const HOLIDAYS = new Set(["2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12"]);

/** Every date from FIRST_DAY to TODAY. */
export const ALL_DAYS: string[] = (() => {
  const out: string[] = [];
  for (let d = FIRST_DAY; d <= TODAY; d = addDays(d, 1)) out.push(d);
  return out;
})();

/** 1 = Monday … 7 = Sunday. */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
export const isWorkday = (date: string) => weekday(date) <= 5 && !HOLIDAYS.has(date);
export const WORKDAYS = ALL_DAYS.filter(isWorkday);

/** Minute of a JST day → "HH:MM:SS" (seconds optional; minutes may pass 24:00 into the next day). */
export function clock(minute: number, second = 0): { dayOffset: number; hms: string } {
  const total = Math.round(minute * 60) + second;
  const dayOffset = Math.floor(total / 86_400);
  const t = total - dayOffset * 86_400;
  const p = (n: number) => String(n).padStart(2, "0");
  return { dayOffset, hms: `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}` };
}

/** Epoch ms of a JST wall-clock time on `date`, `minute` minutes after midnight (may run past midnight). */
export const jstMs = (date: string, minute: number, second = 0) =>
  Date.parse(`${date}T00:00:00+09:00`) + Math.round(minute * 60_000) + second * 1000;

/** UTC ISO instant ("…Z") of epoch ms. */
export const iso = (ms: number) => new Date(ms).toISOString();

/** The naive JST wall clock of epoch ms, as the CLI writes `ts`: "YYYY-MM-DDTHH:MM:SS". */
export const naive = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19);

/** "YYYYMMDD-HHMMSS" in JST, the stamp server/src/plans/ids.ts puts in plan ids. */
export const stamp = (ms: number) => naive(ms).replace(/[-:]/g, "").replace("T", "-");

/** ISO weeks (Mon–Sun) that hold demo days, oldest first: 2026-W34 … 2026-W42. */
export const ISO_WEEKS = [...new Set(ALL_DAYS.map(isoWeekOf))];
