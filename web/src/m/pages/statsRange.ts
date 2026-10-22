import { weekDates, weekOfDate } from "../../lib/jst";
import { addDays } from "../../predict/time";
import type { StatsRange } from "../route";

/** 今天 / 本周 (ISO, Mon–Sun) / 本月 (calendar), as Tokyo dates. */
export function rangeDates(range: StatsRange, today: string): { from: string; to: string } {
  if (range === "today") return { from: today, to: today };
  if (range === "week") { const d = weekDates(weekOfDate(today)); return { from: d[0], to: d[6] }; }
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${today.slice(0, 7)}-01`, to: addDays(next, -1) };
}
export function datesOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
/** The ISO weeks whose timelines cover [from, to], in order. */
export function weeksOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (const d of datesOf(from, to)) { const w = weekOfDate(d); if (out[out.length - 1] !== w) out.push(w); }
  return out;
}
/** The n largest rows, the rest summed into one row named otherTitle (only when there is a rest). */
export function topTasks(rows: { title: string; minutes: number }[], n: number, otherTitle: string) {
  const sorted = [...rows].sort((a, b) => b.minutes - a.minutes);
  const head = sorted.slice(0, n), rest = sorted.slice(n).reduce((s, r) => s + r.minutes, 0);
  return rest > 0 ? [...head, { title: otherTitle, minutes: rest }] : head;
}
