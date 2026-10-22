// What the 週報 digests read beyond the week's work (design 2026-10-08-s2c §2.1): the plan goals hung on the week's
// tasks, the days' plans with their judgement, and last report week's summary. One D1 batch.
import { reportWeekOf, reportWeekRange } from "./week";

export type PlanGoal = { task_id: string; horizon: "daily" | "week" | "near" | "far"; text: string; status: "active" | "done" };
export type DayPlanLine = { date: string; text: string; detail: string; status: "done" | "partial" | "none" | null; progress: string | null; task_ids: string[] };
export type DigestContext = { plans: PlanGoal[]; dayPlans: DayPlanLine[]; lastWeek: string | null };

/** As of the week's end: a goal made by then, not closed before the week began; done within the week shows done,
 *  closed (done or dropped) at or after the end counts as active. created_at / done_at are UTC ISO instants.
 *  Task links live in plan_item_tasks / day_plan_item_tasks since 0008; the old task_id columns are read too (emptied, harmless). */
export async function loadDigestContext(db: D1Database, week: string, dates: string[]): Promise<DigestContext> {
  const range = reportWeekRange(week)!;
  const prev = reportWeekOf(range.startMs - 1), iso = (ms: number) => new Date(ms).toISOString();
  const [plans, dayPlans, last] = await db.batch([
    db.prepare(`SELECT COALESCE(pt.task_id, p.task_id) AS task_id, p.horizon, p.text,
                       CASE WHEN p.status = 'done' AND p.done_at < ?2 THEN 'done' ELSE 'active' END AS status
                FROM plan_items p LEFT JOIN plan_item_tasks pt ON pt.plan_item_id = p.id
                WHERE p.created_at < ?2
                  AND (p.status = 'active' OR p.done_at >= ?2 OR (p.status = 'done' AND p.done_at >= ?1))
                  AND COALESCE(pt.task_id, p.task_id) IS NOT NULL
                ORDER BY p.horizon, p.sort, p.id, task_id`).bind(iso(range.startMs), iso(range.endMs)),
    db.prepare(`SELECT d.date, d.text, d.detail, COALESCE(d.manual_status, d.ai_status) AS status, d.ai_progress AS progress,
                       (SELECT json_group_array(x) FROM (SELECT t.task_id AS x FROM day_plan_item_tasks t WHERE t.day_plan_item_id = d.id
                                                         UNION SELECT d.task_id WHERE d.task_id IS NOT NULL)) AS task_ids
                FROM day_plan_items d WHERE d.date BETWEEN ?1 AND ?2 ORDER BY d.date, d.sort, d.id`).bind(dates[0], dates[6]),
    db.prepare("SELECT text FROM report_digests WHERE week = ?1 AND day = ''").bind(prev),
  ]);
  return {
    plans: plans.results as PlanGoal[],
    dayPlans: (dayPlans.results as Array<Omit<DayPlanLine, "task_ids"> & { task_ids: string }>)
      .map((r) => ({ ...r, task_ids: (JSON.parse(r.task_ids) as string[]).sort() })),
    lastWeek: (last.results[0] as { text?: string } | undefined)?.text ?? null,
  };
}
