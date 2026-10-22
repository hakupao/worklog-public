export type TaskRef = { id: string; title: string; status: "open" | "done" | "hold" };

/** SQL fragment: the item's linked tasks as a JSON array, for `<alias>.id` in `<linkTable>.<linkCol>`. */
export const tasksJson = (linkTable: "plan_item_tasks" | "day_plan_item_tasks", linkCol: "plan_item_id" | "day_plan_item_id", alias: string) =>
  `(SELECT json_group_array(json_object('id', t.id, 'title', t.title, 'status', t.status))
    FROM ${linkTable} l JOIN tasks t ON t.id = l.task_id WHERE l.${linkCol} = ${alias}.id) AS tasks_json`;

export const parseTasks = (json: string | null): TaskRef[] =>
  (JSON.parse(json ?? "[]") as TaskRef[]).filter((t) => t && t.id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Distinct ids in first-seen order. */
export const uniqueIds = (ids: string[]) => [...new Set(ids)];

/** 400 response body when any id is not a task, else null. */
export async function unknownTasks(db: D1Database, ids: string[]) {
  if (ids.length === 0) return null;
  const { results } = await db.prepare("SELECT id FROM tasks WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(ids)).all<{ id: string }>();
  return results.length === ids.length ? null : { error: "invalid", issues: [{ path: "task_ids", message: "unknown task" }] };
}

/** Statements that replace an item's links, guarded so they only run while the item still carries
 *  `expectedUpdatedAt`. Put them in one batch BEFORE the optimistic `UPDATE … AND updated_at = expected`:
 *  the batch is one transaction, so links and row are written together or not at all. (Guarding on the
 *  NEW updated_at after the UPDATE could misfire: a stale token's nextUpdatedAt can equal the row's
 *  current value when both writes land in the same millisecond.) */
export function replaceLinks(db: D1Database, kind: "plan" | "day", itemId: string, taskIds: string[], expectedUpdatedAt: string): D1PreparedStatement[] {
  const [link, col, owner] = kind === "plan"
    ? ["plan_item_tasks", "plan_item_id", "plan_items"] as const
    : ["day_plan_item_tasks", "day_plan_item_id", "day_plan_items"] as const;
  const guard = `EXISTS (SELECT 1 FROM ${owner} WHERE id = ?1 AND updated_at = ?2)`;
  return [
    db.prepare(`DELETE FROM ${link} WHERE ${col} = ?1 AND ${guard}`).bind(itemId, expectedUpdatedAt),
    ...taskIds.map((t) => db.prepare(`INSERT INTO ${link} (${col}, task_id) SELECT ?1, ?3 WHERE ${guard}`).bind(itemId, expectedUpdatedAt, t)),
  ];
}
