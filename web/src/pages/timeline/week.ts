import type { Machine, Note, Session, Task, Timeline } from "../../api/types";
import { coverage, STEP_MIN } from "../../chart/dots";
import { activeMs, buildSnapshot, minutesOn, type SnapSession } from "../../predict/snapshot";
import { DAY, MIN, dayStart, weekdayOfDate } from "../../predict/time";

// The week as five (or seven) day bands of the run-chart grammar (prototype page-timeline.html:280-370):
// per day one dot row per task, tasks in first-start order, the unlinked sessions on one red row.
// Pure: the page hands in the fetched timeline and gets back everything it draws and counts.

export interface BandTrack {
  /** null = 未关联: no task, or a task that no longer exists (the same rule as the cross-week list). */
  taskId: string | null;
  sessions: SnapSession[]; cov: Float32Array; minutes: number; running: boolean;
}
export interface Band {
  date: string; /** 1 = Monday … 7 = Sunday */ dow: number; isToday: boolean;
  /** The server's day total: not-hidden sessions' share of the day plus the day's notes. */
  minutes: number; cost: number; costPartial: boolean;
  /** 工作时间: the day's wall clock (parallel sessions once); `minutes` is the 累计 beside it (user 10/9) */
  wall: number;
  tracks: BandTrack[];
  /** The rows of the day as the server listed them (hidden ones only when 已隐藏 is on). */
  sessions: Session[]; notes: Note[];
}
export interface WeekLayout {
  week: string; h0: number; h1: number; ndot: number; bands: Band[];
  /** Every line drawn this week, first appearance first, 未关联 last. */
  legend: (string | null)[];
  totalMinutes: number; totalWall: number; sessionCount: number; cost: number; costPartial: boolean; hidden: number;
  /** Sessions 运行中 as of their machine's last collection (the 此刻 rule). */
  running: string[];
  /** Today's "now" as a dot index on today's band; null when today is not in this week. */
  nowIdx: number | null; nowMin: number;
}
export interface WeekInput {
  timeline: Timeline; tasks: Task[]; machines: Machine[]; now: number; runningMin: number;
  /** The shared business-day rule (cal); omitted = default holidays. */
  isOff?: (d: string) => boolean;
}

/** A day's share of a session's cost: by active time when it crosses midnight (the same split as its minutes). */
function costOn(x: SnapSession, date: string): number {
  if (x.cost === null) return 0;
  if (x.days.length <= 1) return x.days[0] === date ? x.cost : 0;
  const all = activeMs(x, -Infinity, Infinity), a = dayStart(date);
  return all > 0 ? (x.cost * activeMs(x, a, a + DAY)) / all : 0;
}

export function layoutWeek(i: WeekInput): WeekLayout {
  // Defensive like useNowData: an odd answer (a proxy page, a schema change) renders an empty week, not NaN or a crash.
  const days = (Array.isArray(i.timeline.days) ? i.timeline.days : [])
    .filter((d) => d && typeof d.date === "string")
    .map((d) => ({ ...d, minutes: Number(d.minutes) || 0, sessions: Array.isArray(d.sessions) ? d.sessions : [], notes: Array.isArray(d.notes) ? d.notes : [] }));
  const dayMinutes: Record<string, Record<string, number>> = {};
  for (const d of days) for (const x of d.sessions) if (typeof x.minutes_on_day === "number") (dayMinutes[x.id] ??= {})[d.date] = x.minutes_on_day;
  // One snapshot of the whole week: the same session parsing, task check and 运行中 rule as 此刻.
  const snap = buildSnapshot({
    now: i.now, machines: i.machines, sessions: days.flatMap((d) => d.sessions), tasks: i.tasks,
    planItems: [], dayPlan: null, downloads: [], dayMinutes,
  }, i.runningMin, i.isOff);
  const running = new Set(snap.running.map((r) => r.session.id));
  const today = snap.date, nowMin = Math.round((i.now - dayStart(today)) / MIN);

  // Weekdays always; Saturday / Sunday only when something happened (a weekend band with nothing on it is noise).
  const shown = days.filter((d) => weekdayOfDate(d.date) <= 5 || d.sessions.length > 0 || d.notes.length > 0);
  let first = Infinity, last = -Infinity;
  for (const d of shown) {
    const a0 = dayStart(d.date);
    // the same day rule as the bands below: a 0-minute share the server does not list must not widen the axis
    for (const x of snap.sessions) if (!x.perDay || x.perDay[d.date] !== undefined) for (const [a, b] of x.intervals) {
      const lo = Math.max(a, a0), hi = Math.min(b, a0 + DAY);
      if (hi > lo) { first = Math.min(first, (lo - a0) / MIN); last = Math.max(last, (hi - a0) / MIN); }
    }
  }
  const hasToday = shown.some((d) => d.date === today);
  if (hasToday) last = Math.max(last, nowMin);
  // One axis for the whole week, so the hour columns line up across the bands: 9–21 at least, whole hours.
  const h0 = Number.isFinite(first) ? Math.min(9, Math.floor(first / 60)) : 9;
  const h1 = Number.isFinite(last) ? Math.min(24, Math.max(21, Math.ceil(last / 60))) : 21;
  const ndot = ((h1 - h0) * 60) / STEP_MIN;

  const legend: (string | null)[] = [];
  const bands = shown.map((d): Band => {
    const a0 = dayStart(d.date), from = a0 + h0 * 60 * MIN;
    // the server's own listing decides the day (split.ts drops a day whose share rounds to 0 minutes):
    // a session the day list doesn't show must not light a dot on its band either (preflight R4)
    const ss = snap.sessions.filter((x) => x.days.includes(d.date) && (!x.perDay || x.perDay[d.date] !== undefined));
    const order: (string | null)[] = [];
    for (const x of ss) if (!order.includes(x.taskId)) order.push(x.taskId);
    // 未关联 last on the band too, so the red row is always at the bottom
    order.sort((a, b) => Number(a === null) - Number(b === null));
    for (const k of order) if (k !== null && !legend.includes(k)) legend.push(k);
    if (order.includes(null) && !legend.includes(null)) legend.push(null);
    return {
      date: d.date, dow: weekdayOfDate(d.date), isToday: d.date === today, minutes: d.minutes, wall: d.wall_minutes ?? d.minutes,
      cost: ss.reduce((n, x) => n + costOn(x, d.date), 0), costPartial: ss.some((x) => x.costPartial),
      tracks: order.map((taskId) => {
        const mine = ss.filter((x) => x.taskId === taskId);
        return {
          taskId, sessions: mine, running: mine.some((x) => running.has(x.id)),
          cov: coverage(mine.flatMap((x) => x.intervals), from, ndot),
          minutes: mine.reduce((n, x) => n + minutesOn(x, d.date), 0),
        };
      }),
      sessions: d.sessions, notes: d.notes,
    };
  });
  legend.sort((a, b) => Number(a === null) - Number(b === null));
  return {
    week: i.timeline.week, h0, h1, ndot, bands, legend,
    totalMinutes: Number(i.timeline.total_minutes) || 0, sessionCount: snap.sessions.length,
    totalWall: Number(i.timeline.total_wall_minutes ?? i.timeline.total_minutes) || 0,
    // the week's cost is its days' (a session reaching into last week brings only this week's part — R5)
    cost: bands.reduce((n, b) => n + b.cost, 0), costPartial: bands.some((b) => b.costPartial),
    hidden: Number(i.timeline.hidden) || 0, running: [...running],
    nowIdx: hasToday ? Math.max(-1, Math.min(ndot - 1, Math.floor((nowMin - h0 * 60) / STEP_MIN))) : null, nowMin,
  };
}
