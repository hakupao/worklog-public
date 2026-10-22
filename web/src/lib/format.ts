const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Minutes as hours, one decimal place, trailing ".0" dropped: 150 -> "2.5h", 60 -> "1h".
 *  Non-finite or negative input (a bad server value should never render as "NaNh"/"-5h") -> "0h". */
export function hours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "0h";
  const h = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

/** Last path segment; accepts either slash style. "" -> "(不明)" for a session with no cwd. */
export function dirName(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "(不明)";
}

/** "12 分前" / "3 小时前" / "2 天前" — coarsest unit that still fits, floored. Clamped at 0: ordinary
 *  clock skew between the browser and the server can put `iso` slightly ahead of `now`, which must
 *  read "0 分前", never a negative count. */
export function agoLabel(iso: string, now: Date = new Date()): string {
  const diffMs = Math.max(0, now.getTime() - new Date(iso).getTime());
  const minutes = Math.floor(diffMs / MINUTE);
  if (minutes < 60) return `${minutes} 分前`;
  const hoursCount = Math.floor(diffMs / HOUR);
  if (hoursCount < 24) return `${hoursCount} 小时前`;
  return `${Math.floor(diffMs / DAY)} 天前`;
}

/** True once an instant is more than 24 hours old. A future `iso` (clock skew) gives a negative
 *  difference, which is never > DAY, so it is never stale — no separate clamp needed. */
export function isStale(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() > DAY;
}

const DEFAULT_MAX_HOURS = 24;

export type HoursParseResult = { ok: true; minutes: number } | { ok: false; reason: string };

/** Parses a user-typed hours figure (the unit an inline hours edit shows, not minutes) into whole
 *  minutes, rounding to the nearest minute: "2.5" -> 150, "0" -> 0 (a real value, not empty).
 *  Comma is accepted as a decimal separator ("2,5" -> 150). A strict digits-only regex (rather than
 *  a bare `Number()`/`parseFloat()`) is deliberate: it rejects "-1", "1e3" and other technically-
 *  numeric strings that are never what someone means when typing an hours figure by hand, alongside
 *  empty input and non-numeric text.
 *
 *  `opts.maxHours` defaults to 24 — right for a single session's or note's duration (past that it
 *  is certainly a typo). A TASK's `hours_manual` (task 9) is a cumulative override for the whole
 *  task, not one sitting, and can legitimately run well past a day for a multi-day task — the
 *  server itself has no cap (`server/src/schemas.ts`'s `hours_manual` is just `z.number().min(0)`)
 *  — so its caller passes a much larger `maxHours` instead of reusing the session-scoped default.
 *  The rejection message always names the actual limit in effect, whichever it is. */
export function parseHoursInput(text: string, opts?: { maxHours?: number }): HoursParseResult {
  const maxHours = opts?.maxHours ?? DEFAULT_MAX_HOURS;
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "请输入工时" };
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return { ok: false, reason: "请输入有效的工时，例如 2.5" };
  const value = Number(trimmed.replace(",", "."));
  const minutes = Math.round(value * 60);
  if (minutes > Math.round(maxHours * 60)) return { ok: false, reason: `工时不能超过 ${maxHours} 小时` };
  return { ok: true, minutes };
}

/** The inverse of the hours half of `parseHoursInput`: minutes -> a compact hours string suitable
 *  as an edit box's initial draft (no unit suffix, unlike `hours()`). Rounds to 2 decimal places
 *  and drops trailing zeros so re-opening an untouched box round-trips to the same text. */
export function minutesToHoursInput(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "0";
  return String(Math.round((minutes / 60) * 100) / 100);
}

/** A count in at most three significant figures with a K/M/B suffix: 950 -> "950", 1234 -> "1.2K",
 *  34567 -> "35K", 1234567 -> "1.2M". Non-finite or negative input -> "0". */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  for (const [unit, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (n >= unit) {
      const v = n / unit;
      const shown = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
      // 999.96K rounds up to "1000K"; say "1M" instead.
      if (shown >= 1000 && suffix !== "B") return compactCount(shown * unit);
      return `${shown}${suffix}`;
    }
  }
  return String(Math.round(n));
}

/** US dollars to the cent, "$1,234.50"; a positive amount under a cent is "<$0.01", not "$0.00". */
export function usd(amount: number): string {
  if (amount > 0 && amount < 0.005) return "<$0.01";
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
