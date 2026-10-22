import { Hono } from "hono";
import { deriveTask, loadVerdicts, type DeriveSession } from "../deliverables/derive";
import { decodeSessionJson } from "../effective";
import type { AppEnv } from "../env";
import { DeliverableModelVerdicts, DeliverableUserVerdict, invalid } from "../schemas";

// The collector's side (mounted under /api/ingest/deliverables): what is left for its model to judge, and the verdicts.
export const deliverablesIngest = new Hono<AppEnv>();

const PENDING_LIMIT = 200;

/**
 * The files on `machine` that the rule left gray and nobody has judged: one path per file (the drawer's key),
 * from that machine's not-hidden sessions linked to a 案件 — only that machine can read them. Each comes with its
 * 案件's title and project, which is most of what tells a deliverable from a working note.
 */
deliverablesIngest.get("/pending", async (c) => {
  const machine = c.req.query("machine");
  if (!machine) return c.json({ error: "invalid", issues: [{ path: "machine", message: "required" }] }, 400);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || PENDING_LIMIT, 1), PENDING_LIMIT);
  const db = c.env.DB;
  const [s, t] = await db.batch([
    db.prepare(
      `SELECT id, task_id, cwd, hidden, ended_at, files_written, artifacts FROM sessions
       WHERE machine = ?1 AND task_id IS NOT NULL AND hidden = 0 ORDER BY unixepoch(started_at) DESC, id`,
    ).bind(machine),
    db.prepare("SELECT id, title, project, deliverables FROM tasks"),
  ]);
  const verdicts = await loadVerdicts(db);
  const tasks = new Map((t.results as { id: string; title: string; project: string; deliverables: string }[]).map((r) => [r.id, r]));
  const byTask = new Map<string, DeriveSession[]>();
  for (const r of s.results as (Omit<DeriveSession, "files_written" | "artifacts"> & { task_id: string })[]) {
    if (!tasks.has(r.task_id)) continue;
    const list = byTask.get(r.task_id) ?? byTask.set(r.task_id, []).get(r.task_id)!;
    list.push(decodeSessionJson(r));
  }
  const seen = new Set<string>();
  const items: { key: string; task_id: string; task_title: string; project: string }[] = [];
  for (const [taskId, sessions] of byTask) {
    const task = tasks.get(taskId)!;
    for (const d of deriveTask(JSON.parse(task.deliverables), sessions, verdicts)) {
      if (d.verdict !== "pending" || seen.has(d.key)) continue;
      seen.add(d.key);
      items.push({ key: d.key, task_id: taskId, task_title: task.title, project: task.project });
    }
  }
  return c.json({ items: items.slice(0, limit), total: items.length });
});

/** The model's verdicts. Never over an existing one: a user's × / ＋ stands, and two machines judging the same
 *  file at once is harmless (the first wins). */
deliverablesIngest.post("/verdicts", async (c) => {
  const parsed = DeliverableModelVerdicts.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { verdicts } = parsed.data;
  if (verdicts.length === 0) return c.json({ inserted: 0 });
  const db = c.env.DB;
  const now = new Date().toISOString();
  const results = await db.batch(
    verdicts.map((v) =>
      db.prepare(
        `INSERT INTO deliverable_verdicts (key, kind, verdict, source, reason, judged_at)
         VALUES (?1, 'file', ?2, 'model', ?3, ?4) ON CONFLICT(key) DO NOTHING`,
      ).bind(v.key, v.verdict, v.reason, now),
    ),
  );
  return c.json({ inserted: results.reduce((n, r) => n + r.meta.changes, 0) });
});

// The user's side (mounted at /api/deliverable-verdicts).
export const deliverableVerdicts = new Hono<AppEnv>();

/** × (out) or ＋ (in) on an automatic 成果物. Replaces whatever verdict the key had: the user's word is final. */
deliverableVerdicts.put("/", async (c) => {
  const parsed = DeliverableUserVerdict.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { key, kind, verdict } = parsed.data;
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO deliverable_verdicts (key, kind, verdict, source, reason, judged_at)
     VALUES (?1, ?2, ?3, 'user', NULL, ?4)
     ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, verdict = excluded.verdict, source = 'user',
       reason = NULL, judged_at = excluded.judged_at`,
  ).bind(key, kind, verdict, now).run();
  return c.json({ key, kind, verdict, source: "user", judged_at: now });
});
