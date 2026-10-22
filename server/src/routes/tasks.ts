import { Hono } from "hono";
import { assignMissingBadges } from "../badge/assign";
import { buildGuardedUpdate, conflictOrNotFound, isUniqueViolation } from "../concurrency";
import { deriveTask, loadVerdicts } from "../deliverables/derive";
import { withEffective } from "../effective";
import type { AppEnv } from "../env";
import { langOf } from "../i18n/langs";
import { dropUnchanged, localize, localizeSessions } from "../i18n/store";
import { translateSoon } from "../i18n/sweep";
import { jstDate, jstNow } from "../jst";
import { TaskCreate, TaskIn, TaskPatch, invalid } from "../schemas";

export const tasks = new Hono<AppEnv>();

const toJson = (r: Record<string, unknown>) => ({ ...r, deliverables: JSON.parse(r.deliverables as string) });
const TASK_TEXT = ["title", "project", "thinking"];
const TASK_MAP = { title: "title", project: "project", thinking: "thinking" };
/** Spec §3 / plan B1 constraint 8: a badge failure never fails the request that triggered it (the next GET /api/tasks retries). */
const assignSoon = async (db: D1Database, limit: number, id?: string) => { try { await assignMissingBadges(db, limit, id); } catch (e) { console.error("[badge] assign failed", e); } };
// D1 queries per fill: 1 probe + 2 batch + `limit` writes. Measured (counting proxy) for GET /api/tasks: 20 rows to fill = 24 statements (probe 1 + batch 2 + 20 writes + the list SELECT; 25 with X-Lang, which adds the translations SELECT), none to fill = 2 (3 with X-Lang); the Workers Free cap is 50.
const GET_FILL_LIMIT = 20;

tasks.put("/:id", async (c) => {
  const parsed = TaskIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const t = parsed.data;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, requester, project, title, status, received_at, done_at, thinking,
                        deliverables, hours_manual, machine, ts, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(id) DO UPDATE SET
       requester=excluded.requester, project=excluded.project, title=excluded.title,
       status=excluded.status, received_at=excluded.received_at, done_at=excluded.done_at,
       thinking=excluded.thinking, deliverables=excluded.deliverables,
       hours_manual=excluded.hours_manual, machine=excluded.machine, ts=excluded.ts,
       updated_at=excluded.updated_at`,
  )
    .bind(
      c.req.param("id"), t.requester, t.project, t.title, t.status, t.received_at, t.done_at,
      t.thinking, JSON.stringify(t.deliverables), t.hours_manual, t.machine, t.ts, now,
    )
    .run();
  await assignSoon(c.env.DB, 3, c.req.param("id"));
  return c.json({ id: c.req.param("id") });
});

tasks.get("/", async (c) => {
  // Self-heal (no cron): fills up to GET_FILL_LIMIT unassigned 案件 — any row, not only those the ?status filter returns — before the SELECT, so this response carries them.
  await assignSoon(c.env.DB, GET_FILL_LIMIT);
  const statuses = (c.req.query("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const where = statuses.length ? `WHERE status IN (${statuses.map(() => "?").join(",")})` : "";
  const { results } = await c.env.DB.prepare(`SELECT * FROM tasks ${where} ORDER BY id`)
    .bind(...statuses)
    .all<Record<string, unknown>>();
  return c.json(await localize(c.env.DB, langOf(c), "task", results.map(toJson), TASK_TEXT, undefined, { meta: true }));
});

/**
 * Every task's 累计 and 最近 for the 案件 list (sub-project 4), in one read. The same 合计 as
 * `GET /api/tasks/:id` — not-hidden sessions' effective minutes plus linked notes' minutes; hours_manual
 * is not applied there either — and the last day anything not hidden happened on it: a session's Tokyo
 * end date or a note's date (notes.ts stores a Tokyo wall-clock `ts`). Registered before `/:id`, which
 * would otherwise take "totals" for a task id.
 */
tasks.get("/totals", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id,
       COALESCE((SELECT SUM(COALESCE(minutes_override, active_minutes)) FROM sessions WHERE task_id = t.id AND hidden = 0), 0)
         + COALESCE((SELECT SUM(minutes) FROM notes WHERE task_id = t.id), 0) AS total_minutes,
       (SELECT ended_at FROM sessions WHERE task_id = t.id AND hidden = 0 ORDER BY unixepoch(ended_at) DESC LIMIT 1) AS last_end,
       (SELECT MAX(substr(ts, 1, 10)) FROM notes WHERE task_id = t.id) AS last_note
     FROM tasks t ORDER BY t.id`,
  ).all<{ id: string; total_minutes: number; last_end: string | null; last_note: string | null }>();
  return c.json(results.map((r) => {
    const s = r.last_end ? jstDate(r.last_end) : null, n = r.last_note;
    return { id: r.id, total_minutes: r.total_minutes, last_date: s && n ? (s > n ? s : n) : s ?? n };
  }));
});

tasks.post("/", async (c) => {
  const parsed = TaskCreate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const t = parsed.data;
  const db = c.env.DB;
  const now = jstNow();
  const received = t.received_at ?? now.date;
  const prefix = `T${received.replaceAll("-", "")}-`;

  // Single-user system: a collision needs two creates in the same instant. Retry once rather than lock.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Sort by length first: lexicographic id DESC alone would return "-99" over "-100".
    const last = await db
      .prepare("SELECT id FROM tasks WHERE id LIKE ?1 ORDER BY length(id) DESC, id DESC LIMIT 1")
      .bind(`${prefix}%`)
      .first<{ id: string }>();
    const next = (last ? Number(last.id.slice(prefix.length)) : 0) + 1;
    const id = `${prefix}${String(next).padStart(2, "0")}`;
    try {
      await db
        .prepare(
          `INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, '[]', ?7, ?8, ?9)`,
        )
        .bind(id, t.requester, t.project, t.title, received, t.thinking, t.machine, now.naive, new Date().toISOString())
        .run();
      await assignSoon(db, 3, id);
      const row = (await db.prepare("SELECT * FROM tasks WHERE id = ?1").bind(id).first<Record<string, unknown>>())!;
      const [out] = await localize(db, langOf(c), "task", [toJson(row)], TASK_TEXT, undefined, { meta: true });
      translateSoon(c, "task", id);
      return c.json(out, 201);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      if (attempt === 1) return c.json({ error: "could not allocate id" }, 500);
    }
  }
  return c.json({ error: "could not allocate id" }, 500);
});

tasks.patch("/:id", async (c) => {
  const parsed = TaskPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { updated_at, ...fields } = parsed.data;
  const id = c.req.param("id");
  const db = c.env.DB;
  const lang = langOf(c);
  const sent = Object.keys(fields).length;
  await dropUnchanged(db, lang, "task", id, fields, TASK_MAP);

  const patch: Record<string, unknown> = { ...fields };
  if (fields.deliverables !== undefined) patch.deliverables = JSON.stringify(fields.deliverables);
  if (fields.status !== undefined && fields.done_at === undefined) {
    if (fields.status === "done") {
      const cur = await db.prepare("SELECT done_at FROM tasks WHERE id = ?1").bind(id).first<{ done_at: string | null }>();
      if (cur && !cur.done_at) patch.done_at = jstNow().date;
    } else {
      patch.done_at = null;
    }
  }
  const localizeRow = async (r: Record<string, unknown>) => (await localize(db, lang, "task", [r], TASK_TEXT, undefined, { meta: true }))[0];
  if (Object.keys(patch).length === 0) {
    if (sent === 0) return c.json({ error: "invalid", issues: [{ path: "", message: "nothing to update" }] }, 400);
    // Every field was re-sent as shown: nothing to write, but a stale tab still learns it is stale.
    const row = await db.prepare("SELECT * FROM tasks WHERE id = ?1 AND updated_at = ?2").bind(id, updated_at).first<Record<string, unknown>>();
    return row ? c.json(await localizeRow(toJson(row))) : conflictOrNotFound(c, "tasks", id, toJson, localizeRow);
  }

  const TASK_COLUMNS = ["requester", "title", "project", "status", "received_at", "done_at", "thinking", "deliverables", "hours_manual"];
  const { sql, args } = buildGuardedUpdate("tasks", TASK_COLUMNS, patch, id, updated_at);
  const res = await db.prepare(sql).bind(...args).run();
  if (res.meta.changes === 0) return conflictOrNotFound(c, "tasks", id, toJson, localizeRow);
  translateSoon(c, "task", id);
  const row = (await db.prepare("SELECT * FROM tasks WHERE id = ?1").bind(id).first<Record<string, unknown>>())!;
  return c.json(await localizeRow(toJson(row)));
});

/**
 * Deleting a 案件 REFUSES while anything still points at it: no cascade, no orphaning. The guard
 * lives in the DELETE's own WHERE (`NOT EXISTS` over sessions/notes/plan rows) rather than in a read-then-
 * delete pair, so a session linked between the check and the delete cannot slip through — D1 runs
 * the one statement atomically. That makes 0 changes ambiguous, so the reasons are told apart
 * afterwards, most specific first: no such row (404) before links (409 `linked`) before a stale
 * `updated_at` (409 `conflict`) — the row's absence is the only one of the three a client can't
 * fix by refreshing, and sessions.task_id/notes.task_id carry no foreign key (migrations
 * 0001_init.sql), so rows CAN still name a task id that no longer exists.
 */
tasks.delete("/:id", async (c) => {
  const updatedAt = c.req.query("updated_at");
  if (!updatedAt) return c.json({ error: "invalid", issues: [{ path: "updated_at", message: "required" }] }, 400);
  const id = c.req.param("id");
  const db = c.env.DB;

  const res = await db
    .prepare(
      `DELETE FROM tasks WHERE id = ?1 AND updated_at = ?2
         AND NOT EXISTS (SELECT 1 FROM sessions WHERE task_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM notes WHERE task_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM plan_item_tasks WHERE task_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM day_plan_item_tasks WHERE task_id = ?1)`,
    )
    .bind(id, updatedAt)
    .run();
  if (res.meta.changes > 0) {
    // Report overrides are keyed by a cell's coordinates, not by a foreign key, so nothing else
    // ever clears them — and task ids are RE-USED (`tasks.post` allocates the next free suffix for
    // the received date, so deleting the day's last task hands that exact id to the next one).
    // Left behind, a deleted task's hand-edited 週報 cells would silently reappear on an unrelated
    // new task. Both shapes a task id takes as a `row_key` are covered: the tasks sheet stores the
    // bare id, and the retired 派遣元 日別 sheet stored `<date>|<id>` (kept for rows written before the
    // templates merged).
    //
    // The 成果物 sheet keys its rows the other way round, `<id>|<index>` and `<id>|d:<hash>` (layout.ts), so a prefix
    // match clears those too.
    //
    // Matched with `substr`, not `LIKE '%|' || ?1`: `PUT /api/tasks/:id` takes the id straight from
    // the path (that is how the CLI writes a task), so an id is not guaranteed free of `_`, which
    // LIKE would read as a wildcard and quietly delete another task's overrides too.
    //
    // A separate statement rather than one batch with the DELETE above: the batch would have to
    // run this unconditionally, and it must run ONLY when a task was really deleted. Failing
    // between the two leaves exactly the orphan rows that every release before this one left.
    await db
      .prepare(
        `DELETE FROM report_overrides
         WHERE row_key = ?1 OR substr(row_key, length(row_key) - length(?1)) = '|' || ?1
            OR substr(row_key, 1, length(?1) + 1) = ?1 || '|'`,
      )
      .bind(id)
      .run();
    return c.body(null, 204);
  }

  // One batch, so the two answers describe the same instant: a session linked (or the row deleted)
  // between two separate round trips would otherwise produce a 404 that contradicts the counts, or
  // a "conflict" for a task that by then has links.
  const [existing, counted] = await db.batch<Record<string, number>>([
    db.prepare("SELECT 1 AS found FROM tasks WHERE id = ?1").bind(id),
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM sessions WHERE task_id = ?1) AS sessions,
                (SELECT COUNT(*) FROM notes    WHERE task_id = ?1) AS notes,
                (SELECT COUNT(*) FROM plan_item_tasks WHERE task_id = ?1)
                  + (SELECT COUNT(*) FROM day_plan_item_tasks WHERE task_id = ?1) AS plans`,
      )
      .bind(id),
  ]);
  if (existing.results.length === 0) return c.json({ error: "not found" }, 404);
  const counts = counted.results[0] as { sessions: number; notes: number; plans: number };
  if (counts.sessions > 0 || counts.notes > 0 || counts.plans > 0) {
    return c.json({ error: "linked", sessions: counts.sessions, notes: counts.notes, plans: counts.plans }, 409);
  }
  return conflictOrNotFound(c, "tasks", id, toJson);
});

tasks.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = c.env.DB;
  const task = await db.prepare("SELECT * FROM tasks WHERE id = ?1").bind(id).first<Record<string, unknown>>();
  if (!task) return c.json({ error: "not found" }, 404);
  const [s, n] = await db.batch([
    db.prepare("SELECT * FROM sessions WHERE task_id = ?1 ORDER BY unixepoch(started_at), id").bind(id),
    db.prepare("SELECT * FROM notes WHERE task_id = ?1 ORDER BY ts, id").bind(id),
  ]);
  const verdicts = await loadVerdicts(db);
  const lang = langOf(c);
  const sessions = (await localizeSessions(db, lang, s.results as any[], { meta: true })).map(withEffective);
  const notes = await localize(db, lang, "note", n.results as Record<string, any>[], ["text"], undefined, { meta: true });
  const total_minutes =
    sessions.filter((r) => !r.hidden).reduce((sum, r) => sum + r.minutes_effective, 0) +
    notes.reduce((sum, r) => sum + (r.minutes ?? 0), 0);
  const [taskOut] = await localize(db, lang, "task", [toJson(task)], TASK_TEXT, undefined, { meta: true });
  // The automatic 成果物 (deliverables/derive.ts), beside the hand-picked task.deliverables.
  const auto_deliverables = deriveTask(taskOut.deliverables as string[], sessions, verdicts);
  return c.json({ task: taskOut, sessions, notes, total_minutes, auto_deliverables });
});
