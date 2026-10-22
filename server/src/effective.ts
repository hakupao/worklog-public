import type { SessionArtifact } from "./schemas";

// Every session a route returns goes through here, so this is also where the JSON-encoded columns
// (files_written, tokens, active_intervals, artifacts) are decoded, the way tasks.ts's toJson decodes deliverables.
// decodeSessionJson alone is for a raw row (a 409's `current`), which carries no *_effective fields.
export const decodeSessionJson = <T extends Record<string, any>>(r: T) => ({
  ...r,
  files_written: JSON.parse(r.files_written ?? "[]") as string[],
  // NULL = never collected; the client shows that, so it must stay null and not become {}.
  tokens: r.tokens == null ? null : (JSON.parse(r.tokens) as Record<string, unknown>),
  // NULL = never collected: the row is charged to its start day. Stays null for the same reason.
  active_intervals: r.active_intervals == null ? null : (JSON.parse(r.active_intervals) as [string, string][]),
  // NULL = never collected (not "published none"), so it stays null too.
  artifacts: r.artifacts == null ? null : (JSON.parse(r.artifacts) as SessionArtifact[]),
});

export const withEffective = <T extends Record<string, any>>(r: T) => ({
  ...decodeSessionJson(r),
  summary_effective: r.summary_edited ?? r.summary,
  minutes_effective: r.minutes_override ?? r.active_minutes,
});
