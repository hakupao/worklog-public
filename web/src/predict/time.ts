import { addDays, DAY, utcDay, weekdayOfDate } from "./dates";
import { MODE_IDS, type ModeCfg, type ModeId } from "../prefs/types";

// Tokyo calendar on instants (ms). Japan has no DST, so a fixed +9h shift read through the UTC getters
// is exact on any host — the same approach as web/src/lib/jst.ts. Never use Date's local getters here.
// These are ms twins of lib/jst.ts (todayJst) and i18n/format.ts (fmtHm): the snapshot works on epoch ms
// throughout, and an ISO round-trip per dot of the run chart would be wasted work.
export { addDays, daysBetween, DAY, weekdayOfDate } from "./dates";
export const MIN = 60_000;
export const HOUR = 3_600_000;
const JST = 9 * HOUR;
const pad = (n: number) => String(n).padStart(2, "0");

export const jstDate = (ms: number) => new Date(ms + JST).toISOString().slice(0, 10);
export const jstMinute = (ms: number) => { const d = new Date(ms + JST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
/** ISO weekday of the Tokyo day: 1 = Monday … 7 = Sunday. */
export const jstWeekday = (ms: number) => new Date(ms + JST).getUTCDay() || 7;
export const dayStart = (date: string) => utcDay(date) - JST;
/** The workday before `date`. Default: weekends only (this module stays a leaf, so the mobile shell does not pull in
 *  the 祝日 table); 此刻 and the other v2 pages pass `makeCalendar(prefs.cal).isOff` (祝日 and company breaks too). */
export function prevWorkday(date: string, off: (d: string) => boolean = (d) => weekdayOfDate(d) > 5): string {
  let d = addDays(date, -1);
  // Bounded: a break set covering every day (accepted by prefs) must not hang the page.
  for (let i = 0; i < 400 && off(d); i++) d = addDays(d, -1);
  return off(d) ? addDays(date, -1) : d;
}
export const hmOf = (ms: number) => { const m = jstMinute(ms); return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const mdOf = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
export const hmToMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Tokyo dates the span [a, b) touches; a zero-length span is on a's day. */
export function daysOf(a: number, b: number): string[] {
  const out = [jstDate(a)], last = jstDate(Math.max(a, b - 1));
  while (out[out.length - 1] < last) out.push(addDays(out[out.length - 1], 1));
  return out;
}

/** Minutes since the window opened, or null outside it. `to` before `from` crosses midnight, and the
 *  part after midnight belongs to the weekday the window opened on; `from === to` is the whole day. */
export function windowAge(ms: number, w: ModeCfg): number | null {
  const m = jstMinute(ms), wd = jstWeekday(ms), f = hmToMin(w.from), t = hmToMin(w.to);
  if (f === t) return w.days.includes(wd) ? m : null;
  if (f < t) return w.days.includes(wd) && m >= f && m < t ? m - f : null;
  if (m >= f) return w.days.includes(wd) ? m - f : null;
  if (m < t) return w.days.includes(wd === 1 ? 7 : wd - 1) ? m + 1440 - f : null;
  return null;
}
export const inWindow = (ms: number, w: ModeCfg) => windowAge(ms, w) !== null;

/** The mode on the 下一步 heading: of the modes whose window holds `ms`, the one that opened last
 *  (Fri 16:30 is 週報, not 专注; 18:45 is 收工, not 週報). Ties keep MODE_IDS order. */
export function currentMode(ms: number, modes: Record<ModeId, ModeCfg>): ModeId | null {
  let best: ModeId | null = null, age = Infinity;
  for (const id of MODE_IDS) {
    const a = windowAge(ms, modes[id]);
    if (a !== null && a < age) { best = id; age = a; }
  }
  return best;
}
