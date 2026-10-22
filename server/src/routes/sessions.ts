import { Hono } from "hono";
import { conflictOrNotFound, nextUpdatedAt } from "../concurrency";
import { decodeSessionJson, withEffective } from "../effective";
import type { AppEnv } from "../env";
import { langOf } from "../i18n/langs";
import { dropUnchanged, localizeSessions } from "../i18n/store";
import { translateSoon } from "../i18n/sweep";
import { unknownTask } from "../refs";
import { SessionPatch, invalid } from "../schemas";

export const sessions = new Hono<AppEnv>();

// The 未关联 list, across all weeks. Same definition as the dashboard's unlinked hint
// (dashboard/hints.ts): visible, and either no task or a task_id whose 案件 no longer exists.
// Only the filtered list is served; there is no use for listing every session at once.
sessions.get("/", async (c) => {
  if (c.req.query("unlinked") !== "1") {
    return c.json({ error: "invalid", issues: [{ path: "unlinked", message: "only ?unlinked=1 is supported" }] }, 400);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT s.* FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id
     WHERE s.hidden = 0 AND t.id IS NULL
     ORDER BY COALESCE(s.minutes_override, s.active_minutes) DESC, s.started_at, s.id`,
  ).all<Record<string, any>>();
  return c.json((await localizeSessions(c.env.DB, langOf(c), results as any[], { meta: true })).map(withEffective));
});

sessions.patch("/:id", async (c) => {
  const parsed = SessionPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const p = parsed.data;
  const id = c.req.param("id");
  const db = c.env.DB;
  const lang = langOf(c);
  const sent = p.summary_edited !== undefined;
  // null / "" restore the collector's summary and are never dropped.
  await dropUnchanged(db, lang, "session", id, p, { summary_edited: "summary" });
  const localizeRow = async (r: Record<string, unknown>) => (await localizeSessions(db, lang, [r as any], { meta: true }))[0];

  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (column: string, value: unknown) => { args.push(value); sets.push(`${column} = ?${args.length}`); };

  if (p.summary_edited !== undefined) set("summary_edited", p.summary_edited || null);
  if (p.minutes_override !== undefined) set("minutes_override", p.minutes_override);
  if (p.hidden !== undefined) set("hidden", p.hidden ? 1 : 0);
  if (p.task_id !== undefined) {
    const bad = await unknownTask(c, p.task_id);
    if (bad) return bad;
    set("task_id", p.task_id);
    // Assigning AND unassigning are both human decisions the collector must not undo.
    set("link_method", "manual");
  }
  if (sets.length === 0) {
    if (!sent) return c.json({ error: "invalid", issues: [{ path: "", message: "nothing to update" }] }, 400);
    // The summary was re-sent as shown: nothing to write, but a stale tab still learns it is stale.
    const row = await db.prepare("SELECT * FROM sessions WHERE id = ?1 AND updated_at = ?2").bind(id, p.updated_at).first<Record<string, any>>();
    return row ? c.json(withEffective(await localizeRow(row) as any)) : conflictOrNotFound(c, "sessions", id, decodeSessionJson, localizeRow);
  }
  set("updated_at", nextUpdatedAt(p.updated_at));

  args.push(id, p.updated_at);
  const res = await db
    .prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?${args.length - 1} AND updated_at = ?${args.length}`)
    .bind(...args)
    .run();
  if (res.meta.changes === 0) return conflictOrNotFound(c, "sessions", id, decodeSessionJson, localizeRow);
  if (p.summary_edited !== undefined) translateSoon(c, "session", id);

  const row = (await db.prepare("SELECT * FROM sessions WHERE id = ?1").bind(id).first<Record<string, any>>())!;
  return c.json(withEffective(await localizeRow(row) as any));
});
