import type { DayPlan, Machine, PlanItem, ReportDownload, Session, Task, TaskStatus } from "../api/types";
import { currentWeek, reportWeekOf } from "../lib/jst";
import { DAY, MIN, dayStart, daysOf, jstDate, prevWorkday } from "./time";

/** What the page (or a scenario, or the replay) hands the prediction. `sessions` may repeat a session
 *  (the week timeline lists a cross-midnight session under each day); the snapshot dedupes by id. */
export interface SnapInput {
  now: number; machines: Machine[]; sessions: Session[]; tasks: Task[];
  planItems: PlanItem[]; dayPlan: DayPlan | null; downloads: ReportDownload[];
  /** session id → Tokyo date → the timeline's minutes_on_day (the server's own split). */
  dayMinutes?: Record<string, Record<string, number>>;
}
export interface SnapSession {
  id: string; machine: string; taskId: string | null; start: number; end: number; minutes: number; summary: string;
  intervals: [number, number][]; hasIntervals: boolean; days: string[]; perDay: Record<string, number> | null;
  cost: number | null; costPartial: boolean;
}
export interface MachineState { name: string; lastSeen: number | null; fresh: boolean }
export interface Running { session: SnapSession; since: number; until: number }
export interface Snapshot {
  /** `week`: the ISO week (未关联, 下周计划); `reportWeek`: the 週報's Sat→Fri week (report.undownloaded). */
  now: number; date: string; week: string; reportWeek: string; prevWorkday: string;
  machines: MachineState[]; sessions: SnapSession[];
  tasks: Record<string, { title: string; status: TaskStatus }>;
  planItems: PlanItem[]; dayPlan: DayPlan | null; downloads: ReportDownload[];
  running: Running[];
}

/** A machine whose last collection is older than this runs nothing: hourly harvest + 30 min slack. An
 *  idle machine and a stopped collector look the same in the data (last_seen_at moves only when a
 *  changed session is pushed), so past this the board stops claiming anything is running there. */
export const FRESH_MIN = 90;

function toSnap(s: Session, known: (id: string) => boolean, perDay: Record<string, number> | undefined): SnapSession | null {
  const start = Date.parse(s.started_at), end = Date.parse(s.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const hasIntervals = !!s.active_intervals?.length;
  const raw = s.active_intervals?.length ? s.active_intervals : [[s.started_at, s.ended_at] as [string, string]];
  const intervals = raw.map(([a, b]) => [Date.parse(a), Date.parse(b)] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a)
    .sort((x, y) => x[0] - y[0]);
  if (intervals.length === 0) intervals.push([start, Math.max(start, end)]);
  return {
    id: s.id, machine: s.machine, taskId: s.task_id !== null && known(s.task_id) ? s.task_id : null,
    start, end: Math.max(start, end), minutes: s.minutes_effective, summary: s.summary_effective, intervals, hasIntervals,
    // a row without intervals is charged to its start day, as server/src/split.ts does
    days: hasIntervals ? [...new Set(intervals.flatMap(([a, b]) => daysOf(a, b)))].sort() : [jstDate(start)],
    perDay: perDay ?? null,
    cost: s.tokens?.cost_usd ?? null, costPartial: !s.tokens || s.tokens.cost_usd === null || s.tokens.cost_partial,
  };
}

/** The interval that ends last: the session's current (or final) burst of activity. */
export const lastActivity = (x: SnapSession): [number, number] => x.intervals.reduce((b, iv) => (iv[1] > b[1] ? iv : b));

/** Active ms of x inside [from, to). */
export function activeMs(x: SnapSession, from: number, to: number): number {
  return x.intervals.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);
}

/** A session's minutes on a Tokyo day. The timeline's own split when it was given; else the server's
 *  rules: no intervals → all on the start day, otherwise by the share of active time (rounded, so it can
 *  differ by a minute from the server's largest-remainder split — only scenarios and the replay get here). */
export function minutesOn(x: SnapSession, date: string): number {
  if (x.perDay) return x.perDay[date] ?? 0;
  if (!x.hasIntervals) return date === jstDate(x.start) ? x.minutes : 0;
  const all = activeMs(x, -Infinity, Infinity);
  if (all <= 0) return x.days.includes(date) ? x.minutes : 0;
  const a = dayStart(date);
  return Math.round((x.minutes * activeMs(x, a, a + DAY)) / all);
}

export function buildSnapshot(i: SnapInput, runningMin: number, isOff?: (d: string) => boolean): Snapshot {
  const tasks: Snapshot["tasks"] = Object.fromEntries(i.tasks.map((t) => [t.id, { title: t.title, status: t.status }]));
  const seen = new Set<string>(), sessions: SnapSession[] = [];
  for (const s of i.sessions) {
    if (s.hidden || seen.has(s.id)) continue;
    seen.add(s.id);
    const x = toSnap(s, (id) => Object.hasOwn(tasks, id), i.dayMinutes?.[s.id]);
    if (x) sessions.push(x);
  }
  sessions.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const machines: MachineState[] = i.machines.map((m) => {
    const t = Date.parse(m.last_seen_at), lastSeen = Number.isFinite(t) ? t : null;
    return { name: m.name, lastSeen, fresh: lastSeen !== null && i.now - lastSeen <= FRESH_MIN * MIN && lastSeen <= i.now + 5 * MIN };
  }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Running = "as of the last collection" (spec §7.4): the last burst ended within runningMin of the
  // collection of the session's own machine.
  const running: Running[] = [];
  for (const m of machines) {
    if (!m.fresh || m.lastSeen === null) continue;
    for (const x of sessions) {
      if (x.machine !== m.name || x.start > m.lastSeen) continue;
      const [a, b] = lastActivity(x);
      if (b < m.lastSeen - runningMin * MIN) continue;
      const until = Math.min(b, m.lastSeen);
      running.push({ session: x, since: Math.min(a, until), until });
    }
  }
  running.sort((a, b) => a.since - b.since || (a.session.id < b.session.id ? -1 : 1));

  const date = jstDate(i.now);
  return {
    now: i.now, date, week: currentWeek(new Date(i.now)), reportWeek: reportWeekOf(i.now), prevWorkday: prevWorkday(date, isOff), machines, sessions, tasks,
    planItems: i.planItems.filter((p) => p.status === "active"), dayPlan: i.dayPlan, downloads: i.downloads, running,
  };
}
