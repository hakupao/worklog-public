import { deriveTask, type DeriveSession, type StoredVerdict } from "../deliverables/derive";
import { withEffective } from "../effective";
import type { Lang } from "../i18n/langs";
import { localize, localizeSessions } from "../i18n/store";
import { splitRequesters } from "../requesters";
import type { DayRow, SessionLite, TaskLike, TaskRow, WeekData, WeekDeliverable, WeekSummary } from "./types";
import { UNLINKED, daySum, dayTotal, wallSplit, wallWindow, type Wall, type WallSession } from "./wall";
import { day5Of, dayStart5, reportWeekRange } from "./week";

/** The 週報's data for one Sat→Fri report week (design 2026-10-08 §3), hours on the wall clock
 *  (wall.ts). Began as a port of src/worklog/report/weekly.py:build. Sessions hidden by a human are invisible here. */

export const UNASSIGNED_LABEL = "その他・調査";

/** Code-point order, like Python tuple comparison and SQLite's BINARY collation. */
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const roundQuarter = (hours: number) => Math.round(hours * 4) / 4;
export const round2 = (x: number) => Math.round(x * 100) / 100;

export type TaskDbRow = Record<string, unknown> & {
  id: string; requester: string; project: string; title: string; status: TaskLike["status"];
  received_at: string; done_at: string | null; thinking: string; deliverables: string;
  hours_manual: number | null;
};
export type SessionDbRow = Record<string, unknown> & {
  id: string; started_at: string; ended_at: string; summary: string; summary_edited: string | null;
  active_minutes: number; minutes_override: number | null; task_id: string | null;
  active_intervals: string | null;
};
type NoteDbRow = Record<string, unknown> & {
  id: string; ts: string; text: string; minutes: number | null; task_id: string | null;
};
type Session = ReturnType<typeof withEffective<SessionDbRow>>;

export const toWallSession = (s: Session): WallSession => ({
  id: s.id, task_id: s.task_id, started_at: s.started_at, intervals: s.active_intervals,
  minutes: s.minutes_effective, override: s.minutes_override !== null,
});

/** Minutes per bucket (task id, or UNLINKED) over every day of a wall, in one pass. */
export function bucketTotals(w: Wall): Map<string, number> {
  const by = new Map<string, number>();
  for (const day of w.days.values()) for (const [bucket, m] of day) by.set(bucket, (by.get(bucket) ?? 0) + m);
  return by;
}

export const toTask = (r: TaskDbRow): TaskLike => ({
  id: r.id, requester: r.requester, project: r.project, title: r.title, status: r.status,
  received_at: r.received_at, done_at: r.done_at, thinking: r.thinking,
  deliverables: JSON.parse(r.deliverables) as string[], hours_manual: r.hours_manual,
});

const toLite = (s: Session): SessionLite => ({
  id: s.id, started_at: s.started_at, summary: s.summary_effective,
  minutes: s.minutes_effective, task_id: s.task_id,
});

/** `path` relative to `cwd` when it is under it (either separator; a Windows path compared case-insensitively),
 *  else as is — how the 案件 drawer shows a written file. */
function relativeTo(path: string, cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, "");
  if (!base) return path;
  const win = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
  const norm = (p: string) => (win ? p.replace(/\\/g, "/").toLowerCase() : p);
  return norm(path).startsWith(norm(base) + "/") && path.length > base.length + 1 ? path.slice(base.length + 1) : path;
}

export type AutoDeliverable = { kind: "file" | "artifact"; key: string; label: string; mine: string[]; last_at: string };
/** A 案件's automatic 成果物 (verdict in) written / published by one of `ours`, derived over every session of the 案件
 *  (so a × on one mount's path covers the other); `label` = the path relative to its session's cwd, or the page's
 *  title. The 週報 asks with its week's sessions, the range xlsx with the range's. */
export function autoDeliverables(task: TaskLike, sessions: DeriveSession[], verdicts: Map<string, StoredVerdict>,
                                 ours: (id: string) => boolean, cwdOf: Map<string, string>): AutoDeliverable[] {
  const out: AutoDeliverable[] = [];
  for (const a of deriveTask(task.deliverables, sessions, verdicts)) {
    const mine = a.sessions.filter(ours);
    if (a.verdict !== "in" || mine.length === 0) continue;
    out.push({ kind: a.kind, key: a.key, mine, last_at: a.last_at,
      label: a.kind === "artifact" ? (a.title ?? a.key) : relativeTo(a.key, cwdOf.get(a.sessions[0]) ?? "") });
  }
  return out;
}

/** The 週報's date and order for automatic 成果物: a page published inside the scope is dated by its publication, else
 *  by the last 05:00 day in scope a session of `mine` had time; sorted by date, then label. buildWeek's scope is its
 *  week, the range xlsx's the range or one of its weeks (the wall may be uncut: days outside the scope are ignored). */
export function datedDeliverables(autos: AutoDeliverable[], wall: Wall, inScope: (date: string) => boolean): WeekDeliverable[] {
  const lastDay = (id: string) => [...(wall.sessions.get(id)?.entries() ?? [])].filter(([d, m]) => m > 0 && inScope(d)).map(([d]) => d).sort().at(-1);
  const out = autos.map((a): WeekDeliverable => {
    const published = a.kind === "artifact" ? day5Of(Date.parse(a.last_at)) : null;
    const date = published !== null && inScope(published) ? published : a.mine.map(lastDay).filter((d) => d !== undefined).sort().at(-1)!;
    return { kind: a.kind, key: a.key, label: a.label, date };
  });
  return out.sort((x, y) => cmp(x.date, y.date) || cmp(x.label, y.label));
}

export type WeekFigures = {
  totals: Map<string, number>; touched: TaskLike[]; new: number; done: number; ongoing: number;
  total_minutes: number; total_hours: number; unassigned_hours: number; sum_minutes: number; day_minutes: Array<[string, number]>;
};

/** The week's figures from a wall cut to its days: the 案件 it shows (received / done in it, time in it, or a note in it),
 *  bucket minutes, the summary counts. buildWeek and the range report (range/data.ts) share it, so the two agree. */
export function weekFigures(tasks: TaskLike[], weekWall: Wall, noteTaskIds: Set<string>, dates: string[]): WeekFigures {
  const [start, end] = [dates[0], dates[6]];
  const inWeek = (date: string) => date >= start && date <= end;
  const totals = bucketTotals(weekWall);
  const touched = tasks.filter((t) => inWeek(t.received_at) || (t.done_at !== null && inWeek(t.done_at)) || (totals.get(t.id) ?? 0) > 0 || noteTaskIds.has(t.id));
  const done = touched.filter((t) => t.done_at !== null && inWeek(t.done_at)).length;
  const day_minutes = dates.map((date): [string, number] => [date, dayTotal(weekWall, date)]);
  const total_minutes = day_minutes.reduce((acc, [, m]) => acc + m, 0);
  return {
    totals, touched, new: touched.filter((t) => inWeek(t.received_at)).length, done, ongoing: touched.length - done,
    total_minutes, total_hours: round2(total_minutes / 60), unassigned_hours: round2((totals.get(UNLINKED) ?? 0) / 60),
    sum_minutes: dates.reduce((acc, d) => acc + daySum(weekWall, d), 0), day_minutes,
  };
}

function groupByTask<T extends { task_id: string | null }>(rows: T[]): Map<string, T[]> {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    if (r.task_id === null) continue;
    const list = by.get(r.task_id);
    if (list) list.push(r);
    else by.set(r.task_id, [r]);
  }
  return by;
}

/** `history: false` skips the 累計 (all-history) figures: only sessions overlapping the week ±1 day are read and
 *  swept, and a task's `hours` is then hours_manual or its week minutes alone (the digests need nothing more).
 *  The ±1 day margin takes in a session whose recorded end is a little short of its intervals. */
export async function buildWeek(db: D1Database, week: string, lang: Lang | null = null,
                                opts: { history?: boolean } = {}): Promise<WeekData | null> {
  const range = reportWeekRange(week);
  if (!range) return null;
  const dates = range.days, history = opts.history ?? true;
  const [start, end] = [dates[0], dates[6]];
  const inWeek = (date: string) => date >= start && date <= end;

  // Wall clock needs every parallel neighbour, so every non-hidden session is read (and every note:
  // task 累計 hours count the whole history); without history, every one near the week.
  const [lo, hi] = [dayStart5(start) / 1000 - 86_400, (dayStart5(end) + 86_400_000) / 1000 + 86_400];
  const [taskRes, sessionRes, noteRes, verdictRes] = await db.batch([
    db.prepare("SELECT * FROM tasks ORDER BY id"),
    history
      ? db.prepare("SELECT * FROM sessions WHERE hidden = 0 ORDER BY unixepoch(started_at), id")
      : db.prepare(`SELECT * FROM sessions WHERE hidden = 0 AND unixepoch(started_at) < ?2 AND unixepoch(ended_at) >= ?1
                    ORDER BY unixepoch(started_at), id`).bind(lo, hi),
    db.prepare("SELECT * FROM notes ORDER BY ts, id"),
    // deliverables/derive.ts loadVerdicts, inside this batch: the week's automatic 成果物.
    db.prepare("SELECT * FROM deliverable_verdicts"),
  ]);
  const sessionRows = sessionRes.results as SessionDbRow[], noteRows = noteRes.results as NoteDbRow[];
  const raw = sessionRows.map(withEffective);
  const wallSessions: WallSession[] = raw.map(toWallSession);
  // One sweep: all time, cut to the week (wallWindow equals the windowed sweep); without history, the window only.
  const allWall = history ? wallSplit(wallSessions, noteRows) : null;
  const weekWall = allWall ? wallWindow(allWall, start, end) : wallSplit(wallSessions, noteRows, { from: start, to: end });
  // A session's wall-clock share of the week, summed once; a session without one is in no row and is not localized.
  const shareOf = new Map<string, number>();
  for (const [id, m] of weekWall.sessions) shareOf.set(id, [...m.values()].reduce((x, y) => x + y, 0));
  const weekShare = (s: { id: string }) => shareOf.get(s.id) ?? 0;
  const hasShare = (s: { id: string }) => weekShare(s) > 0;

  const [taskDbRows, sharedRows, notes] = await Promise.all([
    localize(db, lang, "task", taskRes.results as TaskDbRow[], ["title", "project", "thinking"]),
    localizeSessions(db, lang, sessionRows.filter(hasShare)),
    localize(db, lang, "note", noteRows.filter((n) => weekWall.notes.has(n.id)), ["text"]),
  ]);
  const tasks = taskDbRows.map(toTask);
  const sessions = sharedRows.map(withEffective);   // the week's sessions only, in query order
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const titleOf = (id: string | null) => (id !== null && titles.has(id) ? titles.get(id)! : UNASSIGNED_LABEL);
  const sessionsByTask = groupByTask(sessions);
  const tasksWithWeekNote = new Set(notes.flatMap((n) => (n.task_id !== null ? [n.task_id] : [])));
  const fig = weekFigures(tasks, weekWall, tasksWithWeekNote, dates);
  // Bucket totals in one pass each, not bucketTotal per task over every day of history (10 ms CPU budget).
  const allTotals = allWall ? bucketTotals(allWall) : fig.totals;

  const taskRows: TaskRow[] = fig.touched
    .map((task) => ({
      task,
      hours: task.hours_manual ?? roundQuarter((allTotals.get(task.id) ?? 0) / 60),
      week_minutes: fig.totals.get(task.id) ?? 0,
      sessions: (sessionsByTask.get(task.id) ?? [])
        .map((s) => ({ ...toLite(s), minutes: Math.round(weekShare(s)) })),
    }));

  // The week's automatic 成果物: derived over every session read for the task (so a × on one mount's path covers
  // the other), kept when one of the week's sessions wrote / published it. Only with history: without it only the
  // sessions near the week are read, too few to derive from, and nothing that builds without it (PDF, digests)
  // reads 成果物.
  const verdicts = new Map((verdictRes.results as StoredVerdict[]).map((v) => [v.key, v]));
  const rawByTask = groupByTask(raw);
  const cwdOf = new Map(raw.map((s) => [s.id, s.cwd as string]));
  for (const r of history ? taskRows : []) {
    const week = new Set((sessionsByTask.get(r.task.id) ?? []).map((s) => s.id));
    if (week.size === 0) continue;
    const auto = datedDeliverables(autoDeliverables(r.task, (rawByTask.get(r.task.id) ?? []) as unknown as DeriveSession[], verdicts, (id) => week.has(id), cwdOf),
      weekWall, inWeek);
    if (auto.length) r.auto = auto;
  }

  const days: DayRow[] = [];
  const row = (date: string, task_id: string | null, text: string, minutes: number,
               source: DayRow["source"]): DayRow => ({
    date, task_id, task_title: titleOf(task_id), text, minutes, source,
  });
  // One row per (session, 05:00 day): a session that ran past 05:00 reads as two rows with that day's share.
  for (const s of sessions) {
    for (const [date, share] of weekWall.sessions.get(s.id) ?? []) {
      const minutes = Math.round(share);
      if (minutes > 0) days.push(row(date, s.task_id, s.summary_effective, minutes, { kind: "session", id: s.id }));
    }
  }
  for (const n of notes) {
    const placed = weekWall.notes.get(n.id);
    if (placed) days.push(row(placed.date, n.task_id, n.text, placed.minutes, { kind: "note", id: n.id }));
  }
  // Array.prototype.sort is stable, so the query order breaks ties: sessions (by instant, then id)
  // before notes (by ts, then id).
  days.sort((a, b) => cmp(a.date, b.date) || cmp(a.task_id ?? "", b.task_id ?? ""));

  const byRequester = new Map<string, number>();
  // A task with several 依頼元 counts once under EACH of them, so the counts can sum past the task count.
  for (const r of taskRows) {
    for (const name of splitRequesters(r.task.requester)) byRequester.set(name, (byRequester.get(name) ?? 0) + 1);
  }
  const done = fig.done;
  const day_minutes = fig.day_minutes;
  const day_sum_minutes = dates.map((date): [string, number] => [date, daySum(weekWall, date)]);
  const day_buckets = Object.fromEntries(dates.map((date) => [date, Object.fromEntries(weekWall.days.get(date) ?? [])]));
  // Distinct sessions: a split session has several rows but is one thing to go and link.
  const unassigned = sessions.filter((s) => s.task_id === null);

  const summary: WeekSummary = {
    week,
    week_start: start,
    week_end: end,
    new: fig.new,
    done,
    ongoing: fig.ongoing,
    by_requester: [...byRequester],
    total_hours: fig.total_hours,
    unassigned_hours: fig.unassigned_hours,
  };

  return {
    tasks: taskRows,
    days,
    summary,
    dates,
    day_minutes,
    day_sum_minutes,
    day_buckets,
    unassigned_sessions: unassigned.length,
    unassigned_minutes: Math.round(unassigned.reduce((acc, s) => acc + weekShare(s), 0)),
  };
}
