// All calendar math here happens on the Tokyo wall clock: shift the instant by a fixed +9h and
// read UTC fields. Japan has no DST, so the fixed offset is exact and immune to the host's own
// time zone (browser locale, CI runner, ...). Never use Date's local-time getters
// (getDay/getDate/getMonth/getFullYear/getHours/getMinutes) or an unzoned formatter here.
//
// The ISO-week algorithm mirrors server/src/jst.ts (`weekRange`): Jan 4th is always in week 1,
// and a week belongs to the year of its Thursday.

const DAY = 86_400_000;
const JST_OFFSET = 9 * 3_600_000;
const WEEKDAY_KANJI = ["日", "月", "火", "水", "木", "金", "土"]; // index = getUTCDay()

/** UTC-midnight timestamp of the Tokyo calendar day containing this instant. */
const jstDayStart = (ms: number) => Math.floor((ms + JST_OFFSET) / DAY) * DAY;

/** "YYYY-MM-DD" of a UTC-midnight timestamp. */
const isoDay = (dayMs: number) => new Date(dayMs).toISOString().slice(0, 10);

/** "M/D" (no leading zeros) of a UTC-midnight timestamp. */
function monthDay(dayMs: number): string {
  const [, mm, dd] = isoDay(dayMs).split("-");
  return `${Number(mm)}/${Number(dd)}`;
}

/** ISO-8601 week label ("YYYY-Wnn") of a calendar day given as a UTC-midnight timestamp. */
function weekLabelOfDay(dayMs: number): string {
  const weekday = new Date(dayMs).getUTCDay() || 7; // Monday=1 ... Sunday=7
  const thursday = dayMs + (4 - weekday) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4); // Jan 4th is always in ISO week 1
  const jan4Weekday = new Date(jan4).getUTCDay() || 7;
  const week1Monday = jan4 - (jan4Weekday - 1) * DAY;
  const monday = dayMs - (weekday - 1) * DAY;
  const week = Math.round((monday - week1Monday) / (7 * DAY)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday of an ISO week, as a UTC-midnight timestamp. Does not validate `wk`'s range — see isValidWeek. */
function mondayOfWeek(week: string): number {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new Error(`invalid week: ${week}`);
  const year = Number(m[1]);
  const wk = Number(m[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = new Date(jan4).getUTCDay() || 7;
  return jan4 - (jan4Weekday - 1) * DAY + (wk - 1) * 7 * DAY;
}

/** True for a real ISO week: right shape, week in 1..53, and it must actually be the canonical
 *  week of that number in that year (rejects e.g. "2025-W53", a year with only 52 weeks) —
 *  mirrors server/src/jst.ts's weekRange validation. Untrusted input (URL hash) must go through
 *  this before shiftWeek/weekLabel. */
export function isValidWeek(week: string): boolean {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return false;
  const wk = Number(m[2]);
  if (wk < 1 || wk > 53) return false;
  return weekLabelOfDay(mondayOfWeek(week)) === week;
}

export function currentWeek(now: Date = new Date()): string {
  return weekLabelOfDay(jstDayStart(now.getTime()));
}

export function shiftWeek(week: string, delta: number): string {
  if (!isValidWeek(week)) throw new Error(`invalid week: ${week}`);
  return weekLabelOfDay(mondayOfWeek(week) + delta * 7 * DAY);
}

/** The seven Tokyo calendar days ("YYYY-MM-DD") of an ISO week, Monday first. Throws on a bad week, like shiftWeek. */
export function weekDates(week: string): string[] {
  if (!isValidWeek(week)) throw new Error(`invalid week: ${week}`);
  const monday = mondayOfWeek(week);
  return Array.from({ length: 7 }, (_, i) => isoDay(monday + i * DAY));
}

export function weekLabel(week: string): string {
  if (!isValidWeek(week)) throw new Error(`invalid week: ${week}`);
  const monday = mondayOfWeek(week);
  return `${week} (${monthDay(monday)}〜${monthDay(monday + 6 * DAY)})`;
}

export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  const dayMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${Number(m[2])}/${Number(m[3])} (${WEEKDAY_KANJI[new Date(dayMs).getUTCDay()]})`;
}

function hm(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function timeRange(startIso: string, endIso: string): string {
  return `${hm(startIso)}-${hm(endIso)}`;
}

export function todayJst(now: Date = new Date()): string {
  return isoDay(jstDayStart(now.getTime()));
}

/** ISO-8601 week label ("YYYY-Wnn") of a plain "YYYY-MM-DD" calendar-day string — no time-zone
 *  conversion, since the string already denotes a Tokyo calendar day (e.g. a note's `date` field,
 *  entered via `<input type="date">` and sent to the API as-is). Task 8 uses this to tell whether
 *  a newly created note landed inside the week currently on screen. */
export function weekOfDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`invalid date: ${date}`);
  return weekLabelOfDay(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** The Tokyo calendar date ("YYYY-MM-DD") containing the instant `iso` denotes — matches the
 *  server's own `jstDate` (server/src/jst.ts): both shift by +9h and read the calendar day, so
 *  the boundary between two Tokyo days is 15:00Z. Task 9 uses this to link a session row to the
 *  week that contains it: `weekOfDate(jstDateOf(session.started_at))`. */
export function jstDateOf(iso: string): string {
  return isoDay(jstDayStart(new Date(iso).getTime()));
}

// ---- the 週報's own week (server/src/report/week.ts) ------------------------------------------------
// A report day runs from 05:00 JST; a report week from Saturday 05:00 to the next Saturday 05:00, keyed by
// the ISO week of its Friday (W40 = Sat 9/26 → Fri 10/2). Only report code uses these; the timeline /
// stats / plans keep the ISO weeks above.

const DAY5 = 5 * 3_600_000;

/** The report week an instant belongs to: the ISO week of the Friday ending its Sat→Fri week. */
export function reportWeekOf(now: Date | number = new Date()): string {
  const ms = typeof now === "number" ? now : now.getTime();
  const day = Math.floor((ms + JST_OFFSET - DAY5) / DAY) * DAY;   // the 05:00 day, as a UTC-midnight timestamp
  const toFriday = (5 - new Date(day).getUTCDay() + 7) % 7;       // Sat → 6, Sun → 5, Mon → 4 … Fri → 0
  return weekLabelOfDay(day + toFriday * DAY);
}

/** The seven days ("YYYY-MM-DD") of a report week, Saturday first. Throws on a bad week, like weekDates. */
export function reportWeekDates(week: string): string[] {
  if (!isValidWeek(week)) throw new Error(`invalid week: ${week}`);
  const saturday = mondayOfWeek(week) - 2 * DAY;
  return Array.from({ length: 7 }, (_, i) => isoDay(saturday + i * DAY));
}

/** "2026-W40 (9/26(土)〜10/2(金))", like weekLabel; `range` (the preview's) wins over the computed days. */
export function reportWeekLabel(week: string, range?: { from: string; to: string }): string {
  const dates = reportWeekDates(week);
  const md = (date: string) => { const ms = Date.parse(`${date}T00:00:00Z`); return `${monthDay(ms)}(${WEEKDAY_KANJI[new Date(ms).getUTCDay()]})`; };
  return `${week} (${md(range?.from ?? dates[0])}〜${md(range?.to ?? dates[6])})`;
}
