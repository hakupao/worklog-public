import type { Session } from "../api/types";
import { parseHoursInput } from "./format";

// The 案件 detail's pure rules, shared by the old TaskDrawer and the v2 案件 drawer (sub-project 4).
// Moved verbatim from pages/TaskDrawer.tsx; the exports are the only change.

/** Sessions sorted by `started_at` as INSTANTS (Date.getTime — never a local-time getter, never
 *  a raw string compare: unlike a task's `id`/`received_at`, a session's `started_at` is not
 *  guaranteed to be one fixed-width format — the collector can emit fractional seconds or an
 *  explicit "+09:00" offset). */
export function sortSessionsByStartedAt(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
}

const WINDOWS_ABS = /^(?:[A-Za-z]:[\\/]|\\\\)/;

/** `path` relative to `cwd` when the file is under it, otherwise `path` unchanged. A Windows cwd is
 *  compared the way its file system does — either separator, any case — and the remainder keeps
 *  the path's own spelling. */
export function relativeToCwd(path: string, cwd: string): string {
  const windows = WINDOWS_ABS.test(cwd);
  const base = cwd.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  if (!base) return path; // no cwd, or "/" — nothing to be relative to
  const norm = (p: string) => (windows ? p.replace(/\\/g, "/").toLowerCase() : p);
  const under = norm(path).startsWith(norm(base) + "/") && path.length > base.length + 1;
  return under ? path.slice(base.length + 1) : path;
}

/** hours_manual is stored/sent in HOURS (a decimal, e.g. 2.5) — unlike a session's
 *  minutes_override, which is minutes. parseHoursInput/minutesToHoursInput/hours all operate on
 *  MINUTES, so every use here multiplies by 60 first (or divides by 60 after) to reuse them
 *  without a second, hours-flavored copy of the same formatting/parsing rule. */
export const HOURS_TO_MINUTES = 60;

/** Fix round 1 (F2): hours_manual is a cumulative override for the WHOLE task, not one sitting —
 *  parseHoursInput's 24h default (right for a session/note) would reject an entirely ordinary
 *  multi-day total. The server itself has no cap, so this is generous rather than another
 *  session-scoped guess. */
export const TASK_HOURS_MAX = 10_000;

export function parseTaskHours(text: string) {
  return parseHoursInput(text, { maxHours: TASK_HOURS_MAX });
}
