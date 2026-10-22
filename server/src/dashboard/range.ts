import { addDays, daysBetween } from "../jst";

export interface Range { from: string; to: string }

export const MAX_SPAN_DAYS = 366;
const DEFAULT_SPAN_DAYS = 28;

const isDate = (s: string) => {
  const t = Date.parse(s + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** from/to are inclusive Tokyo calendar dates. Both absent = the 28 days ending today; one alone is an error. */
export function parseRange(
  from: string | undefined, to: string | undefined, today: string,
): { range: Range; prev: Range } | { error: string } {
  if ((from === undefined) !== (to === undefined)) return { error: "from and to go together" };
  const range = from === undefined || to === undefined
    ? { from: addDays(today, -(DEFAULT_SPAN_DAYS - 1)), to: today }
    : { from, to };
  if (!isDate(range.from) || !isDate(range.to)) return { error: "dates must be YYYY-MM-DD" };
  const span = daysBetween(range.from, range.to) + 1;
  if (span < 1) return { error: "from is after to" };
  if (span > MAX_SPAN_DAYS) return { error: `range is longer than ${MAX_SPAN_DAYS} days` };
  return { range, prev: { from: addDays(range.from, -span), to: addDays(range.from, -1) } };
}

export function datesIn(r: Range): string[] {
  const n = daysBetween(r.from, r.to) + 1;
  return Array.from({ length: n }, (_, i) => addDays(r.from, i));
}
