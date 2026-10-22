import { Hono } from "hono";
import { buildGuardedUpdate } from "../concurrency";
import type { AppEnv } from "../env";
import { langOf, type Lang } from "../i18n/langs";
import type { Entity } from "../i18n/registry";
import { dropUnchanged, localize, localizeTaskRefs } from "../i18n/store";
import { translateSoon } from "../i18n/sweep";
import { isoWeekOf, jstNow } from "../jst";
import { newId } from "../plans/ids";
import { parseTasks, replaceLinks, tasksJson, uniqueIds, unknownTasks, type TaskRef } from "../plans/tasks";
import { PlanItemCreate, PlanItemPatch, invalid } from "../schemas";

export const planItems = new Hono<AppEnv>();

export type PlanItemRow = {
  id: string; horizon: "daily" | "week" | "near" | "far"; text: string; task_id: string | null;
  status: "active" | "done" | "dropped"; week: string | null; until_date: string | null; sort: number;
  created_at: string; done_at: string | null; updated_at: string;
  tasks_json: string | null;
};

/** The item columns plus its linked tasks (`tasks_json`); callers append WHERE / ORDER BY. */
export const PLAN_ITEM_SELECT = `SELECT p.*, ${tasksJson("plan_item_tasks", "plan_item_id", "p")} FROM plan_items p`;
const ORDER = ` ORDER BY CASE p.horizon WHEN 'daily' THEN 0 WHEN 'week' THEN 1 WHEN 'near' THEN 2 ELSE 3 END,
  p.sort, p.created_at, p.id`;

/** A daily item is in effect while active, not past until_date, and either linked to no task or to at
 *  least one task that is not done. */
export function effectiveDaily(row: Pick<PlanItemRow, "horizon" | "status" | "until_date">, tasks: TaskRef[], today: string): boolean {
  return row.horizon === "daily" && row.status === "active"
    && (tasks.length === 0 || tasks.some((t) => t.status !== "done"))
    && (row.until_date === null || row.until_date >= today);
}

export function planItemOut(row: PlanItemRow, today: string) {
  const { tasks_json, task_id: _unused, ...rest } = row;
  const tasks = parseTasks(tasks_json);
  return {
    ...rest,
    tasks,
    effective: effectiveDaily(row, tasks, today),
    stale: row.horizon === "week" && row.status === "active" && row.week !== null && row.week < isoWeekOf(today),
  };
}

/** Plan rows as sent (planItemOut / dayPlanItemOut) with their text fields and linked task titles
 *  localized; all items' task refs go through one read. */
export async function localizeWithTasks<T extends { id: string; tasks: TaskRef[] }>(
  db: D1Database, lang: Lang | null, entity: Entity, rows: T[], fields: string[],
): Promise<T[]> {
  if (!lang || rows.length === 0) return rows;
  const items = await localize(db, lang, entity, rows, fields, undefined, { meta: true });
  const refs = await localizeTaskRefs(db, lang, items.flatMap((i) => i.tasks));
  let at = 0;
  return items.map((i) => ({ ...i, tasks: refs.slice(at, (at += i.tasks.length)) }));
}

const localizeOut = (db: D1Database, lang: Lang | null, rows: ReturnType<typeof planItemOut>[]) =>
  localizeWithTasks(db, lang, "plan_item", rows, ["text"]);

async function readOne(db: D1Database, id: string) {
  return db.prepare(`${PLAN_ITEM_SELECT} WHERE p.id = ?1`).bind(id).first<PlanItemRow>();
}

planItems.get("/", async (c) => {
  const closed = c.req.query("status") === "closed";
  const sql = closed
    ? `${PLAN_ITEM_SELECT} WHERE p.status <> 'active' ORDER BY p.done_at DESC, p.id DESC LIMIT 100`
    : `${PLAN_ITEM_SELECT} WHERE p.status = 'active'${ORDER}`;
  const { results } = await c.env.DB.prepare(sql).all<PlanItemRow>();
  const today = jstNow().date;
  return c.json(await localizeOut(c.env.DB, langOf(c), results.map((r) => planItemOut(r, today))));
});

planItems.post("/", async (c) => {
  const parsed = PlanItemCreate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const p = parsed.data;
  const taskIds = uniqueIds(p.task_ids);
  const db = c.env.DB;
  const bad = await unknownTasks(db, taskIds);
  if (bad) return c.json(bad, 400);
  const today = jstNow().date;
  const id = newId("P");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO plan_items (id, horizon, text, status, week, until_date, sort, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'active', ?4, ?5, 0, ?6, ?6)`,
    ).bind(id, p.horizon, p.text, p.horizon === "week" ? isoWeekOf(today) : null,
      p.horizon === "daily" ? p.until_date : null, now),
    ...taskIds.map((t) => db.prepare("INSERT INTO plan_item_tasks (plan_item_id, task_id) VALUES (?1, ?2)").bind(id, t)),
  ]);
  translateSoon(c, "plan_item", id);
  const [out] = await localizeOut(db, langOf(c), [planItemOut((await readOne(db, id))!, today)]);
  return c.json(out, 201);
});

const COLUMNS = ["text", "horizon", "status", "until_date", "sort", "week", "done_at"] as const;

planItems.patch("/:id", async (c) => {
  const parsed = PlanItemPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { updated_at, task_ids, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0 && task_ids === undefined) {
    return c.json({ error: "invalid", issues: [{ path: "", message: "nothing to update" }] }, 400);
  }
  const db = c.env.DB;
  const taskIds = task_ids === undefined ? undefined : uniqueIds(task_ids);
  const bad = taskIds && await unknownTasks(db, taskIds);
  if (bad) return c.json(bad, 400);
  const id = c.req.param("id");
  const today = jstNow().date;
  await dropUnchanged(db, langOf(c), "plan_item", id, fields, { text: "text" });
  if (Object.keys(fields).length === 0 && taskIds === undefined) {
    // The text was re-sent as shown: nothing to write, but a stale tab still learns it is stale.
    const current = await readOne(db, id);
    if (!current) return c.json({ error: "not found" }, 404);
    const [out] = await localizeOut(db, langOf(c), [planItemOut(current, today)]);
    return current.updated_at === updated_at ? c.json(out) : c.json({ error: "conflict", current: out }, 409);
  }
  const patch: Record<string, unknown> = { ...fields };
  // Horizon moves own the week column: into 本周 = this week (unless the caller named one), out of it = none.
  if (fields.horizon !== undefined) {
    if (fields.horizon === "week") patch.week = fields.week ?? isoWeekOf(today);
    else patch.week = null;
    if (fields.horizon !== "daily") patch.until_date = null;
  }
  if (fields.status !== undefined) patch.done_at = fields.status === "active" ? null : new Date().toISOString();
  const { sql, args } = buildGuardedUpdate("plan_items", COLUMNS, patch, id, updated_at);
  // Links first, guarded on the same token as the UPDATE: one transaction, both or neither.
  const results = await db.batch([
    ...(taskIds ? replaceLinks(db, "plan", id, taskIds, updated_at) : []),
    db.prepare(sql).bind(...args),
  ]);
  if (results[results.length - 1].meta.changes === 0) {
    // 409's current has the same shape as a 200 (tasks included), so it is read here, not via conflictOrNotFound.
    const current = await readOne(db, id);
    if (!current) return c.json({ error: "not found" }, 404);
    const [out] = await localizeOut(db, langOf(c), [planItemOut(current, today)]);
    return c.json({ error: "conflict", current: out }, 409);
  }
  translateSoon(c, "plan_item", id);
  const [out] = await localizeOut(db, langOf(c), [planItemOut((await readOne(db, id))!, today)]);
  return c.json(out);
});
