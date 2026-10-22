import type { Task, TaskStatus, TaskTotal } from "../../api/types";
import { linkedTask } from "../timeline/rows";
import type { WeekLayout } from "../timeline/week";

// The 案件 list (prototype page-tasks.html): one row per task with this week's per-day minutes, 本周,
// 累计 and 最近. This week comes from the timeline's own layout (the same session split, task check and
// 运行中 rule as 时间线 and 此刻); 累计 / 最近 from GET /api/tasks/totals. Pure.

export interface TaskRow {
  task: Task;
  /** Minutes per day of `days`: the task's sessions' share of that day plus its notes' minutes. */
  perDay: number[]; week: number;
  /** null = the totals are not loaded (or failed): shown as "--", never as 0. 最近 then still knows this week. */
  total: number | null; last: string | null;
  running: boolean;
}
export interface TasksLayout {
  rows: TaskRow[];
  /** The week's shown days (weekdays, plus Saturday / Sunday when something happened on them). */
  days: string[]; today: string | null;
  counts: Record<TaskStatus, number>;
}

/** received_at DESC, then id DESC — both fixed-format strings, compared as strings (the old page's sort). */
export const byReceived = (a: Task, b: Task) =>
  a.received_at !== b.received_at ? (a.received_at < b.received_at ? 1 : -1) : a.id < b.id ? 1 : -1;

export function layoutTasks({ tasks, totals, week }: { tasks: Task[]; totals: TaskTotal[] | null; week: WeekLayout }): TasksLayout {
  const byId: Record<string, Task> = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const days = week.bands.map((b) => b.date);
  const per = new Map<string, number[]>();
  const add = (k: string, i: number, m: number) => { let a = per.get(k); if (!a) per.set(k, (a = days.map(() => 0))); a[i] += m; };
  const lastInWeek = new Map<string, string>(), running = new Set<string>();
  week.bands.forEach((b, i) => {
    for (const tr of b.tracks) {
      if (tr.taskId === null) continue;
      add(tr.taskId, i, tr.minutes);
      if (tr.minutes > 0) lastInWeek.set(tr.taskId, b.date);
      if (tr.running) running.add(tr.taskId);
    }
    for (const n of b.notes) {
      const k = linkedTask(n, byId);
      if (!k) continue;
      add(k, i, n.minutes ?? 0);
      lastInWeek.set(k, b.date);
    }
  });
  const tot = totals ? new Map(totals.map((x) => [x.id, x])) : null;
  const counts: Record<TaskStatus, number> = { open: 0, hold: 0, done: 0 };
  const rows = [...tasks].sort(byReceived).map((task): TaskRow => {
    counts[task.status]++;
    const perDay = per.get(task.id) ?? days.map(() => 0), t = tot?.get(task.id);
    // the totals may be older than the week (fetched before the last refresh): the later of the two days
    const w = lastInWeek.get(task.id) ?? null, l = tot ? t?.last_date ?? null : null;
    return {
      task, perDay, week: perDay.reduce((n, m) => n + m, 0),
      total: tot ? t?.total_minutes ?? 0 : null,
      last: w && (!l || w > l) ? w : l,
      running: running.has(task.id),
    };
  });
  const today = week.bands.find((b) => b.isToday)?.date ?? null;
  return { rows, days, today, counts };
}
