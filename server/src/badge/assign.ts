// Task badges B1 (spec §3): fills every 案件 whose badge is not assigned yet — a new one (after POST / PUT) and, on
// every GET /api/tasks, the ones that existed before migration 0019 (the backfill). Never overwrites a stored badge.
import { allocateBadge, countUsage, emptyUsage } from "./alloc";

const ACTIVE = new Set(["open", "hold"]);
/** Guarded: a row another writer filled between our SELECT and this UPDATE is left alone. */
export const ASSIGN_SQL = "UPDATE tasks SET badge_obj = ?1, badge_color = ?2 WHERE id = ?3 AND badge_obj IS NULL";

/** Fills at most `limit` unassigned rows, oldest first (plan B1 constraint 13: D1 queries per invocation). With `prefer`
 *  (an id) that row goes first even when older unassigned rows exist, so a just-written 案件 gets its badge at once. */
export async function assignMissingBadges(db: D1Database, limit: number, prefer?: string): Promise<number> {
  if (!(await db.prepare("SELECT 1 AS x FROM tasks WHERE badge_obj IS NULL LIMIT 1").first())) return 0;
  const [used, missing] = await db.batch<{ id: string; status: string; badge_obj: string | null; badge_color: number | null }>([
    db.prepare("SELECT id, status, badge_obj, badge_color FROM tasks WHERE status IN ('open','hold') AND badge_obj IS NOT NULL"),
    prefer === undefined
      ? db.prepare("SELECT id, status, badge_obj, badge_color FROM tasks WHERE badge_obj IS NULL ORDER BY received_at, id LIMIT ?1").bind(limit)
      : db.prepare("SELECT id, status, badge_obj, badge_color FROM tasks WHERE badge_obj IS NULL ORDER BY (id = ?2) DESC, received_at, id LIMIT ?1").bind(limit, prefer),
  ]);
  if (!missing.results.length) return 0;
  const u = emptyUsage();
  for (const r of used.results) countUsage(u, r.badge_obj!, r.badge_color as number);
  const writes = missing.results.map((r) => {
    const b = allocateBadge(r.id, u);
    if (ACTIVE.has(r.status)) countUsage(u, b.obj, b.color);
    return db.prepare(ASSIGN_SQL).bind(b.obj, b.color, r.id);
  });
  const res = await db.batch(writes);
  return res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}
