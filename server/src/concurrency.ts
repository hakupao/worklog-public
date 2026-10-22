import type { Context } from "hono";
import type { AppEnv } from "./env";

/**
 * Call after an `UPDATE/DELETE … WHERE id=? AND updated_at=?` changed no rows, to say why.
 * `toJson` — when the table stores a column as an encoded string that every OTHER response for
 * that table decodes before sending (tasks' `deliverables`, sessions' `files_written`/`tokens`) — applies
 * the same decoding here, so a 409's `current` has exactly the same shape as a 200 for that table.
 * Omit it for a table with no such column (notes: its rows are already client-ready as stored).
 * `localizeRow` — the same X-Lang localization the 200 for that table gets, applied after `toJson`.
 */
export async function conflictOrNotFound(
  c: Context<AppEnv>,
  table: "sessions" | "tasks" | "notes" | "plan_items" | "day_plan_items",
  id: string,
  toJson?: (row: Record<string, unknown>) => Record<string, unknown>,
  localizeRow?: (row: Record<string, unknown>) => Promise<Record<string, unknown>>,
) {
  const current = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
  if (!current) return c.json({ error: "not found" }, 404);
  const shaped = toJson ? toJson(current) : current;
  return c.json({ error: "conflict", current: localizeRow ? await localizeRow(shaped) : shaped }, 409);
}

// updated_at has millisecond resolution. `previous` is the value an `UPDATE ... WHERE
// updated_at = ?` requires the row to currently hold, so on success it IS the row's previous
// updated_at: basing the new value on it (never less than previous + 1ms) guarantees a strictly
// later timestamp without a second round trip, even when a write lands in the same millisecond
// as the read that produced `previous`. On a stale/mismatched token the WHERE simply matches no
// rows, so what we compute here is moot. A non-date `previous` (Date.parse -> NaN) falls back to
// now; it can never match a stored row anyway, since the WHERE clause compares the raw string.
/** New `updated_at`, guaranteed strictly greater than `previous` (the row's prior value). */
export function nextUpdatedAt(previous: string): string {
  const prevMs = Date.parse(previous);
  const nowMs = Date.now();
  return new Date(Number.isNaN(prevMs) ? nowMs : Math.max(nowMs, prevMs + 1)).toISOString();
}

// Coupled to SQLite's error text as surfaced by D1 (SQLITE_CONSTRAINT_PRIMARYKEY / UNIQUE):
// there is no structured error code to check instead.
/** True if `e` is a D1/SQLite unique-constraint violation, as opposed to any other failure. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && e.message.includes("UNIQUE constraint failed");
}

/**
 * Builds `UPDATE <table> SET … WHERE id=? AND updated_at=?` from a patch whose keys MUST all be
 * in `allowed`. Column names are interpolated into SQL text, so they are checked against an
 * explicit allow-list here rather than trusting that the caller's zod schema stays strict.
 * Throws on any other key. Appends `updated_at = nextUpdatedAt(expectedUpdatedAt)` itself, so
 * callers must not set `updated_at` in `patch`.
 */
export function buildGuardedUpdate(
  table: "sessions" | "tasks" | "notes" | "plan_items" | "day_plan_items",
  allowed: readonly string[],
  patch: Record<string, unknown>,
  id: string,
  expectedUpdatedAt: string,
): { sql: string; args: unknown[] } {
  const keys = Object.keys(patch);
  for (const key of keys) {
    if (!allowed.includes(key)) throw new Error(`column not allowed: ${key}`);
  }
  const columns = [...keys, "updated_at"];
  const values = [...keys.map((k) => patch[k]), nextUpdatedAt(expectedUpdatedAt)];
  const sql =
    `UPDATE ${table} SET ${columns.map((col, i) => `${col} = ?${i + 1}`).join(", ")}` +
    ` WHERE id = ?${values.length + 1} AND updated_at = ?${values.length + 2}`;
  return { sql, args: [...values, id, expectedUpdatedAt] };
}
