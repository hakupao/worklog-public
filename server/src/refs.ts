import type { Context } from "hono";
import type { AppEnv } from "./env";

/** Returns a 400 response if `taskId` is set but no such task exists; otherwise null. */
export async function unknownTask(c: Context<AppEnv>, taskId: string | null | undefined) {
  if (taskId === null || taskId === undefined) return null;
  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?1").bind(taskId).first();
  return task ? null : c.json({ error: "invalid", issues: [{ path: "task_id", message: "unknown task" }] }, 400);
}
