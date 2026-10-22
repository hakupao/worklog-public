import { Hono } from "hono";
import { buildDashboard } from "../dashboard/build";
import { deriveTask, type DeriveSession, type StoredVerdict } from "../deliverables/derive";
import { parseRange } from "../dashboard/range";
import type { DashInput, DashSession, DashTask } from "../dashboard/types";
import { withEffective } from "../effective";
import type { AppEnv } from "../env";
import { langOf, type Lang } from "../i18n/langs";
import { loadTr, localize, localizeSessions } from "../i18n/store";
import { jstNow } from "../jst";

export const dashboard = new Hono<AppEnv>();

/** Tasks with each `project` replaced by ONE label per distinct source string: the fresh translation
 *  of the lowest task id that has one, else the source. The dashboard groups minutes by project
 *  text, and translations are per task, so a per-task label could split one project into buckets. */
async function localizeProjects(db: D1Database, lang: Lang | null, rows: Record<string, any>[]) {
  if (!lang || rows.length === 0) return rows;
  const tr = await loadTr(db, "task", rows.map((r) => r.id));
  const label = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (typeof r.project !== "string" || r.project === "" || label.has(r.project)) continue;
    const t = tr.get(`${r.id}\u0000project`);
    if (t && t.source_text === r.project && t[lang] != null) label.set(r.project, t[lang]!);
  }
  return rows.map((r) => (label.has(r.project) ? { ...r, project: label.get(r.project) } : r));
}

// The whole tables are read on purpose: stale-task, estimate-gap and 成果物 figures need every
// task's full history, and the dataset is a few hundred rows. Revisit if sessions reach ~10k.
dashboard.get("/", async (c) => {
  const parsed = parseRange(c.req.query("from"), c.req.query("to"), jstNow().date);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const db = c.env.DB;
  const [s, n, t, m, v] = await db.batch([
    db.prepare("SELECT * FROM sessions"),
    db.prepare("SELECT id, task_id, ts, minutes FROM notes"),
    db.prepare("SELECT * FROM tasks"),
    db.prepare("SELECT name, last_seen_at FROM machines"),
    db.prepare("SELECT * FROM deliverable_verdicts"),   // deliverables/derive.ts loadVerdicts, in the same round trip
  ]);
  const lang = langOf(c);
  const [sessionRows, taskRows] = await Promise.all([
    localizeSessions(db, lang, s.results as any[]) as Promise<Record<string, any>[]>,
    localize(db, lang, "task", t.results as Record<string, any>[], ["title"])
      .then((rows) => localizeProjects(db, lang, rows)),
  ]);
  // A task's 成果物 are the hand-picked ones plus the automatic ones in (deliverables/derive.ts), so 成果物 counts
  // and the done-without-成果物 hint see what the 案件 drawer shows.
  const verdicts = new Map((v.results as StoredVerdict[]).map((x) => [x.key, x]));
  const decoded = sessionRows.map((row) => withEffective(row));
  const byTask = new Map<string, DeriveSession[]>();
  for (const r of decoded) {
    if (r.task_id) (byTask.get(r.task_id) ?? byTask.set(r.task_id, []).get(r.task_id)!).push(r as unknown as DeriveSession);
  }
  const deliverablesOf = (id: string, manual: string[]) =>
    [...manual, ...deriveTask(manual, byTask.get(id) ?? [], verdicts).filter((a) => a.verdict === "in").map((a) => a.key)];
  const input: DashInput = {
    sessions: decoded.map((r): DashSession => {
      return {
        id: r.id, machine: r.machine, agent: r.agent, started_at: r.started_at, ended_at: r.ended_at,
        active_intervals: r.active_intervals, minutes: r.minutes_effective, summary: r.summary_effective, summary_source: r.summary_source,
        task_id: r.task_id, hidden: Boolean(r.hidden),
        tokens: r.tokens as DashSession["tokens"], files_written: r.files_written,
      };
    }),
    notes: n.results as DashInput["notes"],
    tasks: taskRows.map((r): DashTask => ({
      id: r.id, title: r.title, project: r.project, requester: r.requester, status: r.status,
      received_at: r.received_at, done_at: r.done_at, deliverables: deliverablesOf(r.id, JSON.parse(r.deliverables)),
      hours_manual: r.hours_manual,
    })),
    machines: m.results as DashInput["machines"],
  };
  return c.json(buildDashboard(input, parsed.range, parsed.prev, new Date()));
});
