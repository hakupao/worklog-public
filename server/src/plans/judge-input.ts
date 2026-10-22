import { withEffective } from "../effective";
import { addDays } from "../jst";
import { splitMinutes } from "../split";
import { parseTasks, tasksJson } from "./tasks";

type SessionRow = Record<string, any> & {
  id: string; agent: string; cwd: string; started_at: string; task_id: string | null; turns: number;
  task_title: string | null;
};

export type JudgeSession = {
  id: string; agent: string; task_id: string | null; task_title: string | null; project: string;
  summary: string; minutes: number; turns: number; turns_estimated: boolean;
};

/** Last path segment of a cwd, for either separator. */
const project = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? "";

/** The part of each session that falls on `date` (Tokyo). Turns are not recorded per interval, so a
 *  session active on several days gives `date` the share of its turns its minutes there carry. */
export function daySessions(rows: SessionRow[], date: string): JudgeSession[] {
  const out: JudgeSession[] = [];
  for (const raw of rows) {
    if (raw.hidden) continue;
    const s = withEffective(raw);
    const split = splitMinutes({ started_at: s.started_at, active_intervals: s.active_intervals, minutes: s.minutes_effective });
    const minutes = split.byDay.get(date);
    if (minutes === undefined) continue;
    const whole = split.byDay.size === 1;
    out.push({
      id: s.id, agent: s.agent, task_id: s.task_id, task_title: raw.task_title, project: project(s.cwd),
      summary: s.summary_effective, minutes,
      turns: whole || s.minutes_effective === 0 ? s.turns : Math.round((s.turns * minutes) / s.minutes_effective),
      turns_estimated: !whole,
    });
  }
  return out;
}

export async function fingerprintOf(parts: { items: unknown[]; sessions: JudgeSession[]; notes: unknown[] }): Promise<string> {
  const canonical = JSON.stringify([
    parts.items,
    parts.sessions.map((s) => [s.id, s.minutes, s.turns, s.summary, s.task_id]),
    parts.notes,
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildJudgeInput(db: D1Database, date: string) {
  const plan = await db.prepare("SELECT judge_fingerprint FROM day_plans WHERE date = ?1").bind(date).first<{ judge_fingerprint: string | null }>();
  if (!plan) return null;
  const startUnix = Date.parse(`${date}T00:00:00+09:00`) / 1000;
  const endUnix = startUnix + 86_400;
  const [itemRes, sessionRes, noteRes] = await db.batch([
    db.prepare(
      `SELECT d.id, d.text, d.detail, ${tasksJson("day_plan_item_tasks", "day_plan_item_id", "d")}
       FROM day_plan_items d WHERE d.date = ?1 ORDER BY d.sort, d.id`,
    ).bind(date),
    db.prepare(
      `SELECT s.*, t.title AS task_title FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id
       WHERE unixepoch(s.started_at) < ?2 AND unixepoch(s.ended_at) >= ?1
       ORDER BY unixepoch(s.started_at), s.id`,
    ).bind(startUnix, endUnix),
    // notes.ts is a naive JST wall-clock string, so its date prefix IS the JST day.
    db.prepare("SELECT id, text, task_id, minutes FROM notes WHERE ts >= ?1 AND ts < ?2 ORDER BY ts, id").bind(date, addDays(date, 1)),
  ]);
  // task_ids / task_titles in the same (id) order, so the fingerprint sees a sorted id list.
  const items = (itemRes.results as { id: string; text: string; detail: string; tasks_json: string | null }[]).map((i) => {
    const tasks = parseTasks(i.tasks_json);
    return { id: i.id, text: i.text, detail: i.detail, task_ids: tasks.map((t) => t.id), task_titles: tasks.map((t) => t.title) };
  });
  const sessions = daySessions(sessionRes.results as SessionRow[], date);
  const notes = noteRes.results as { id: string; text: string; task_id: string | null; minutes: number | null }[];
  const fingerprint = await fingerprintOf({
    items: items.map((i) => [i.id, i.text, i.detail, i.task_ids]), sessions, notes,
  });
  return { date, fingerprint, judged_fingerprint: plan.judge_fingerprint, items, sessions, notes };
}
