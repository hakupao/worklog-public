import { Hono } from "hono";
import { buildGuardedUpdate, isUniqueViolation } from "../concurrency";
import type { AppEnv } from "../env";
import { langOf, type Lang } from "../i18n/langs";
import { dropUnchanged, localizeSessions } from "../i18n/store";
import { translateSoon } from "../i18n/sweep";
import { buildJudgeInput } from "../plans/judge-input";
import { newId } from "../plans/ids";
import { parseTasks, replaceLinks, tasksJson, uniqueIds, unknownTasks } from "../plans/tasks";
import { DayPlanItemCreate, DayPlanItemPatch, JudgementIn, invalid, isDate } from "../schemas";
import { PLAN_ITEM_SELECT, effectiveDaily, localizeWithTasks, type PlanItemRow } from "./plan-items";

export const dayPlans = new Hono<AppEnv>();
export const dayPlanItems = new Hono<AppEnv>();

type Status = "done" | "partial" | "none";
export type DayPlanItemRow = {
  id: string; date: string; plan_item_id: string | null; task_id: string | null; text: string; detail: string;
  sort: number; ai_status: Status | null; ai_progress: string | null; ai_evidence: string; ai_note: string | null;
  manual_status: Status | null; updated_at: string; tasks_json: string | null;
};

const ITEM_SELECT = `SELECT d.*, ${tasksJson("day_plan_item_tasks", "day_plan_item_id", "d")} FROM day_plan_items d`;

export function dayPlanItemOut(r: DayPlanItemRow) {
  const { tasks_json, task_id: _unused, ...rest } = r;
  return {
    ...rest,
    tasks: parseTasks(tasks_json),
    ai_evidence: JSON.parse(r.ai_evidence || "[]") as string[],
    final_status: (r.manual_status ?? r.ai_status ?? "none") as Status,
  };
}

const ITEM_TEXT = ["text", "detail", "ai_progress", "ai_note"];
const localizeOut = (db: D1Database, lang: Lang | null, rows: ReturnType<typeof dayPlanItemOut>[]) =>
  localizeWithTasks(db, lang, "day_plan_item", rows, ITEM_TEXT);

const readItem = (db: D1Database, id: string) => db.prepare(`${ITEM_SELECT} WHERE d.id = ?1`).bind(id).first<DayPlanItemRow>();

export async function readDayPlan(db: D1Database, date: string, lang: Lang | null = null) {
  const [planRes, itemRes] = await db.batch([
    db.prepare("SELECT date, started_at, judged_at, judge_machine, judge_model, updated_at FROM day_plans WHERE date = ?1").bind(date),
    db.prepare(`${ITEM_SELECT} WHERE d.date = ?1 ORDER BY d.sort, d.id`).bind(date),
  ]);
  const plan = planRes.results[0] as Record<string, unknown> | undefined;
  if (!plan) return null;
  const items = await localizeOut(db, lang, (itemRes.results as DayPlanItemRow[]).map(dayPlanItemOut));
  // 依据 shows what each cited session was about; a session deleted since is simply left out.
  const ids = [...new Set(items.flatMap((i) => i.ai_evidence))];
  const byId = new Map<string, EvidenceSession>();
  if (ids.length > 0) {
    const { results } = await db.prepare(
      `SELECT id, summary_edited, summary, started_at FROM sessions
       WHERE id IN (SELECT value FROM json_each(?1))`,
    ).bind(JSON.stringify(ids)).all<EvidenceRow>();
    for (const r of await localizeSessions(db, lang, results)) {
      byId.set(r.id, { id: r.id, summary: r.summary_edited ?? r.summary, started_at: r.started_at });
    }
  }
  return {
    ...plan,
    items: items.map((i) => ({ ...i, ai_evidence_sessions: i.ai_evidence.flatMap((id) => byId.get(id) ?? []) })),
  };
}
type EvidenceSession = { id: string; summary: string | null; started_at: string };
type EvidenceRow = EvidenceSession & { summary_edited: string | null };

dayPlans.get("/:date", async (c) => {
  const date = c.req.param("date");
  if (!isDate(date)) return c.json({ error: "invalid date" }, 400);
  const plan = await readDayPlan(c.env.DB, date, langOf(c));
  return plan ? c.json(plan) : c.json({ error: "no plan" }, 404);
});

/** The draft: every daily item in effect on `date`, then the unfinished items of the latest earlier
 *  plan. A carried item that names a plan item already in the list lends it its detail instead of
 *  being added twice; one whose plan item is no longer active is dropped; a free item is deduped by text. */
dayPlans.post("/:date/start", async (c) => {
  const date = c.req.param("date");
  if (!isDate(date)) return c.json({ error: "invalid date" }, 400);
  const db = c.env.DB;
  const now = new Date().toISOString();
  const { results: active } = await db.prepare(`${PLAN_ITEM_SELECT} WHERE p.status = 'active' ORDER BY p.sort, p.created_at, p.id`).all<PlanItemRow>();
  const activeById = new Map(active.map((p) => [p.id, p]));
  const prev = await db.prepare("SELECT date FROM day_plans WHERE date < ?1 ORDER BY date DESC LIMIT 1").bind(date).first<{ date: string }>();
  // Each carried item brings its own task set (one query reads the links of all of them).
  const carried = prev
    ? ((await db.prepare(
        `${ITEM_SELECT} WHERE d.date = ?1 AND COALESCE(d.manual_status, d.ai_status, 'none') <> 'done' ORDER BY d.sort, d.id`,
      ).bind(prev.date).all()).results as DayPlanItemRow[])
    : [];

  type Draft = { plan_item_id: string | null; task_ids: string[]; text: string; detail: string };
  const drafts: Draft[] = active
    .filter((p) => effectiveDaily(p, parseTasks(p.tasks_json), date))
    .map((p) => ({ plan_item_id: p.id, task_ids: parseTasks(p.tasks_json).map((t) => t.id), text: p.text, detail: "" }));
  for (const r of carried) {
    if (r.plan_item_id !== null) {
      const src = activeById.get(r.plan_item_id);
      // A daily item follows the same rule as the draft: all its tasks done or until_date passed ends it.
      if (!src || (src.horizon === "daily" && !effectiveDaily(src, parseTasks(src.tasks_json), date))) continue;
      const same = drafts.find((d) => d.plan_item_id === r.plan_item_id);
      if (same) { if (!same.detail) same.detail = r.detail; continue; }
    } else if (drafts.some((d) => d.plan_item_id === null && d.text === r.text)) continue;
    drafts.push({ plan_item_id: r.plan_item_id, task_ids: parseTasks(r.tasks_json).map((t) => t.id), text: r.text, detail: r.detail });
  }
  // One batch (a transaction): a failed item insert must not leave an empty plan that 409s every retry.
  try {
    await db.batch([
      db.prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES (?1, ?2, ?2)").bind(date, now),
      ...drafts.flatMap((d, i) => {
        const id = newId("D");
        return [
          db.prepare(
            `INSERT INTO day_plan_items (id, date, plan_item_id, text, detail, sort, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
          ).bind(id, date, d.plan_item_id, d.text, d.detail, i, now),
          ...d.task_ids.map((t) => db.prepare("INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES (?1, ?2)").bind(id, t)),
        ];
      }),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: "exists" }, 409);
    throw e;
  }
  return c.json(await readDayPlan(db, date, langOf(c)), 201);
});

dayPlans.post("/:date/items", async (c) => {
  const date = c.req.param("date");
  if (!isDate(date)) return c.json({ error: "invalid date" }, 400);
  const parsed = DayPlanItemCreate.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;
  const db = c.env.DB;
  if (!(await db.prepare("SELECT 1 FROM day_plans WHERE date = ?1").bind(date).first())) return c.json({ error: "no plan" }, 404);
  let text = b.text;
  let taskIds = b.task_ids ?? [];
  if (b.plan_item_id !== undefined) {
    const p = await db.prepare(`${PLAN_ITEM_SELECT} WHERE p.id = ?1`).bind(b.plan_item_id).first<PlanItemRow>();
    if (!p) return c.json({ error: "invalid", issues: [{ path: "plan_item_id", message: "unknown plan item" }] }, 400);
    text = text ?? p.text;
    // No task_ids given: today's item starts with all of the plan item's tasks.
    if (b.task_ids === undefined) taskIds = parseTasks(p.tasks_json).map((t) => t.id);
  }
  taskIds = uniqueIds(taskIds);
  const bad = await unknownTasks(db, taskIds);
  if (bad) return c.json(bad, 400);
  const id = newId("D");
  const max = await db.prepare("SELECT COALESCE(MAX(sort), -1) AS m FROM day_plan_items WHERE date = ?1").bind(date).first<{ m: number }>();
  await db.batch([
    db.prepare(
      `INSERT INTO day_plan_items (id, date, plan_item_id, text, detail, sort, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(id, date, b.plan_item_id ?? null, text!, b.detail, (max?.m ?? -1) + 1, new Date().toISOString()),
    ...taskIds.map((t) => db.prepare("INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES (?1, ?2)").bind(id, t)),
  ]);
  translateSoon(c, "day_plan_item", id);
  const [out] = await localizeOut(db, langOf(c), [dayPlanItemOut((await readItem(db, id))!)]);
  return c.json(out, 201);
});

dayPlanItems.patch("/:id", async (c) => {
  const parsed = DayPlanItemPatch.safeParse(await c.req.json().catch(() => null));
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
  await dropUnchanged(db, langOf(c), "day_plan_item", id, fields, { text: "text", detail: "detail" });
  if (Object.keys(fields).length === 0 && taskIds === undefined) {
    // Every field was re-sent as shown: nothing to write, but a stale tab still learns it is stale.
    const current = await readItem(db, id);
    if (!current) return c.json({ error: "not found" }, 404);
    const [out] = await localizeOut(db, langOf(c), [dayPlanItemOut(current)]);
    return current.updated_at === updated_at ? c.json(out) : c.json({ error: "conflict", current: out }, 409);
  }
  const { sql, args } = buildGuardedUpdate("day_plan_items", ["text", "detail", "sort", "manual_status"], fields, id, updated_at);
  // Links first, guarded on the same token as the UPDATE: one transaction, both or neither.
  // A real change to text, detail or the linked tasks is a new goal, so the old verdict goes with it:
  // the judgement does not downgrade a done (see below), and this is what lets the next one judge afresh.
  // It runs before the links are replaced, so it compares against the links as they were.
  const resetVerdict = fields.text !== undefined || fields.detail !== undefined || taskIds !== undefined
    ? [db.prepare(
        `UPDATE day_plan_items SET ai_status = NULL, ai_progress = NULL, ai_evidence = '[]', ai_note = NULL
         WHERE id = ?1 AND updated_at = ?2 AND (text <> COALESCE(?3, text) OR detail <> COALESCE(?4, detail) OR (?5 IS NOT NULL AND (
           (SELECT COUNT(*) FROM day_plan_item_tasks WHERE day_plan_item_id = ?1) <> json_array_length(?5)
           OR EXISTS (SELECT 1 FROM day_plan_item_tasks WHERE day_plan_item_id = ?1 AND task_id NOT IN (SELECT value FROM json_each(?5))))))`,
      ).bind(id, updated_at, fields.text ?? null, fields.detail ?? null, taskIds ? JSON.stringify(taskIds) : null)]
    : [];
  const results = await db.batch([
    ...resetVerdict,
    ...(taskIds ? replaceLinks(db, "day", id, taskIds, updated_at) : []),
    db.prepare(sql).bind(...args),
  ]);
  if (results[results.length - 1].meta.changes === 0) {
    // 409's current has the same shape as a 200 (tasks included), so it is read here, not via conflictOrNotFound.
    const current = await readItem(db, id);
    if (!current) return c.json({ error: "not found" }, 404);
    const [out] = await localizeOut(db, langOf(c), [dayPlanItemOut(current)]);
    return c.json({ error: "conflict", current: out }, 409);
  }
  translateSoon(c, "day_plan_item", id);
  const [out] = await localizeOut(db, langOf(c), [dayPlanItemOut((await readItem(db, id))!)]);
  return c.json(out);
});

dayPlanItems.delete("/:id", async (c) => {
  const updatedAt = c.req.query("updated_at");
  if (!updatedAt) return c.json({ error: "invalid", issues: [{ path: "updated_at", message: "required" }] }, 400);
  const id = c.req.param("id");
  const db = c.env.DB;
  const [res] = await db.batch([
    db.prepare("DELETE FROM day_plan_items WHERE id = ?1 AND updated_at = ?2").bind(id, updatedAt),
    db.prepare("DELETE FROM day_plan_item_tasks WHERE day_plan_item_id = ?1 AND NOT EXISTS (SELECT 1 FROM day_plan_items WHERE id = ?1)").bind(id),
  ]);
  if (res.meta.changes === 0) {
    const current = await readItem(db, id);
    return current ? c.json({ error: "conflict", current: dayPlanItemOut(current) }, 409) : c.json({ error: "not found" }, 404);
  }
  return c.body(null, 204);
});

dayPlans.get("/:date/judge-input", async (c) => {
  const date = c.req.param("date");
  if (!isDate(date)) return c.json({ error: "invalid date" }, 400);
  const input = await buildJudgeInput(c.env.DB, date);
  return input ? c.json(input) : c.json({ error: "no plan" }, 404);
});

/** Only the ai_* columns are written: manual_status is the human's and always wins on display. The
 *  fingerprint must match the input as it is NOW, or the model judged data that has since changed.
 *  A done is not downgraded: a later session saying "still changing" does not undo the day's goal.
 *  Editing text, detail or links clears the verdict (PATCH above), so a stored done judged the current
 *  goal; it may still be overwritten once none of the sessions it cited is in today's input any more
 *  (hidden, deleted, re-linked off the day). */
dayPlans.post("/:date/judgement", async (c) => {
  const date = c.req.param("date");
  if (!isDate(date)) return c.json({ error: "invalid date" }, 400);
  const parsed = JudgementIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const j = parsed.data;
  const db = c.env.DB;
  const input = await buildJudgeInput(db, date);
  if (!input) return c.json({ error: "no plan" }, 404);
  if (input.fingerprint !== j.fingerprint) return c.json({ error: "stale" }, 409);
  const itemIds = new Set(input.items.map((i) => i.id));
  const sessionIds = new Set(input.sessions.map((s) => s.id));
  const now = new Date().toISOString();
  // updated_at is left alone: it is the optimistic lock of the human's edits, and judged_at already
  // records when the judgement ran. A repeated id keeps its first row.
  const seen = new Set<string>();
  const daySessionIds = JSON.stringify([...sessionIds]);
  const rows = j.items.filter((i) => itemIds.has(i.id) && !seen.has(i.id) && seen.add(i.id));
  const writes = rows.map((i) => db.prepare(
    `UPDATE day_plan_items SET ai_status = ?1, ai_progress = ?2, ai_evidence = ?3, ai_note = ?4
     WHERE id = ?5 AND date = ?6 AND (ai_status IS NOT 'done' OR ?1 = 'done'
       OR NOT EXISTS (SELECT 1 FROM json_each(ai_evidence) WHERE value IN (SELECT value FROM json_each(?7))))`,
  ).bind(i.status, i.progress, JSON.stringify(i.evidence.filter((e) => sessionIds.has(e))), i.note, i.id, date, daySessionIds));
  writes.push(db.prepare(
    "UPDATE day_plans SET judged_at = ?1, judge_fingerprint = ?2, judge_machine = ?3, judge_model = ?4, updated_at = ?1 WHERE date = ?5",
  ).bind(now, j.fingerprint, j.machine, j.model, date));
  await db.batch(writes);
  return c.json({ stored: writes.length - 1 });
});
