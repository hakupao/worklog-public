/**
 * The one place that decides whether a piece of text names a real calendar day, shared by the two
 * halves that have to agree about it: `coerce` (overrides.ts), which decides what the page shows,
 * and the workbook writer (xlsx.ts), which decides what the download holds.
 *
 * Phase A review, S1: matching `\d{4}-\d{2}-\d{2}` is not the same question. `Date.UTC` never
 * rejects a day the calendar has no room for, it rolls it over — 2026-02-31 becomes 2026-03-03 and
 * 2026-13-45 becomes 2027-02-14 — and it maps a two-digit year onto 19xx, so a typed 2026-02-31
 * used to read as a date everywhere and then appear in the workbook as some other day entirely.
 * Printing the day back out and comparing is what tells a real one from a well-formed impostor.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC midnight of the day `value` names, or `null` if it names none. */
export function parseDay(value: string): Date | null {
  const m = DATE.exec(value);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return day.toISOString().slice(0, 10) === value ? day : null;
}
