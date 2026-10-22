import { Hono } from "hono";
import { parseRange } from "../dashboard/range";
import type { AppEnv } from "../env";
import { langOf } from "../i18n/langs";
import { localize, localizeSessions } from "../i18n/store";
import { jstNow } from "../jst";
import { parseTasks, tasksJson } from "../plans/tasks";
import { byStart, coarseBounds, statsSession, windowOf, type PlanRow } from "../stats/sessions";
import type { StatsSession, StatsSessions } from "../stats/types";

export const stats = new Hono<AppEnv>();

// No stats.get("/"): GET /api/stats is meta's row counts.
stats.get("/sessions", async (c) => {
  const from = c.req.query("from"), to = c.req.query("to");
  // Unlike the dashboard, no default range: both are required.
  if (from === undefined || to === undefined) return c.json({ error: "from and to are required" }, 400);
  const parsed = parseRange(from, to, jstNow().date);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const { range } = parsed;
  const win = windowOf(range);
  const [lo, hi] = coarseBounds(win);
  const db = c.env.DB;
  const [s, p] = await db.batch([
    db.prepare("SELECT * FROM sessions WHERE hidden = 0 AND started_at < ?2 AND ended_at >= ?1").bind(lo, hi),
    db.prepare(`SELECT d.id, d.date, d.text, d.ai_status, d.manual_status, ${tasksJson("day_plan_item_tasks", "day_plan_item_id", "d")}
      FROM day_plan_items d WHERE d.date BETWEEN ?1 AND ?2 ORDER BY d.date, d.sort, d.id`).bind(range.from, range.to),
  ]);
  const lang = langOf(c);
  // Localized before statsSession, which cuts the summary to its first 80 characters.
  const sessions = (await localizeSessions(db, lang, s.results as any[]) as Record<string, any>[])
    .map((row) => statsSession(row, win))
    .filter((x): x is StatsSession => x !== null)
    .sort(byStart);
  const plans = (await localize(db, lang, "day_plan_item", p.results as unknown as PlanRow[], ["text"])).map((r) => ({
    date: r.date, text: r.text, task_ids: parseTasks(r.tasks_json).map((t) => t.id), ai_status: r.ai_status, manual_status: r.manual_status,
  }));
  const out: StatsSessions = { range, day_start: "05:00", sessions, plans };
  return c.json(out);
});
