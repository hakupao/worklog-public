import { daysBetween, isoWeekOf, jstDate, jstClock } from "../jst";
import { splitRequesters } from "../requesters";
import { splitPieces, type MinutePiece } from "../split";
import { datesIn, type Range } from "./range";
import type {
  AiStats, DashInput, DashNote, DashSession, DashTask, KeyMinutes, OutputStats, Overview, RequesterShare, RhythmStats, TimeStats,
  TokenCounts,
} from "./types";

export const UNLINKED = "未关联";
const NO_PROJECT = "（无项目）";
const NO_REQUESTER = "（无依頼元）";
const OTHER = "其他";
const TOP_N = 10;

const inRange = (date: string, r: Range) => date >= r.from && date <= r.to;
export const sessionDate = (s: DashSession) => jstDate(s.started_at);
// notes.ts is a naive Tokyo wall-clock string, so its date prefix IS the Tokyo day (see routes/weeks.ts).
export const noteDate = (n: DashNote) => n.ts.slice(0, 10);

/** A session's part that falls inside the range. A session runs across midnights (an open window
 *  used again the next day), so its minutes are spread over the Tokyo days and hours it was active
 *  (split.ts) and only the pieces on days in the range count here. `weight` is the share of the
 *  whole session that is in range; tokens and cost have no timestamps of their own, so they follow
 *  it — a session started yesterday costs today what it worked today, and two adjacent ranges never
 *  count it twice. A session with no minutes at all belongs wholly to its start day. */
export interface Share { s: DashSession; minutes: number; weight: number; pieces: MinutePiece[] }

const splits = new WeakMap<DashSession, MinutePiece[]>();
const piecesOf = (s: DashSession) => {
  let p = splits.get(s);
  if (!p) { p = splitPieces(s).pieces; splits.set(s, p); }
  return p;
};

/** Visible (not hidden) sessions with time on a Tokyo day in the range, as their in-range parts. */
export function sharesIn(i: DashInput, r: Range): Share[] {
  const out: Share[] = [];
  for (const s of i.sessions) {
    if (s.hidden) continue;
    const pieces = piecesOf(s).filter((p) => inRange(p.date, r));
    const minutes = pieces.reduce((n, p) => n + p.minutes, 0);
    const weight = s.minutes > 0 ? minutes / s.minutes : inRange(sessionDate(s), r) ? 1 : 0;
    if (minutes > 0 || (s.minutes === 0 && weight === 1)) out.push({ s, minutes, weight, pieces });
  }
  return out;
}
export const sessionsIn = (i: DashInput, r: Range) => sharesIn(i, r).map((x) => x.s);
export const notesIn = (i: DashInput, r: Range) => i.notes.filter((n) => inRange(noteDate(n), r));

/** Same formula as web/src/lib/tokens.ts tokenTotal: reasoning is not added. */
export const tokenTotal = (byModel: Record<string, TokenCounts>) =>
  Object.values(byModel).reduce((n, c) => n + c.input + c.output + c.cache_read + c.cache_write_5m + c.cache_write_1h, 0);

const taskMap = (i: DashInput) => new Map(i.tasks.map((t) => [t.id, t]));
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

function add(map: Map<string, number>, key: string, minutes: number) {
  map.set(key, (map.get(key) ?? 0) + minutes);
}

/** Sorted by minutes desc then key; beyond TOP_N the tail is merged into 其他. */
export function topN(map: Map<string, number>, n = TOP_N): KeyMinutes[] {
  // Shares of a multi-requester task make thirds; two decimals keep the JSON (and the review
  // prompt built from it) readable without changing any whole-minute figure.
  const rows = [...map].map(([key, minutes]) => ({ key, minutes: round(minutes, 2) }))
    .sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key));
  if (rows.length <= n) return rows;
  const rest = rows.slice(n).reduce((sum, r) => sum + r.minutes, 0);
  return [...rows.slice(0, n), { key: OTHER, minutes: rest }];
}

export function overview(i: DashInput, r: Range): Overview {
  const shares = sharesIn(i, r);
  const notes = notesIn(i, r);
  const days = new Set<string>();
  let minutes = 0;
  for (const x of shares) { minutes += x.minutes; for (const p of x.pieces) if (p.minutes > 0) days.add(p.date); }
  for (const n of notes) { minutes += n.minutes ?? 0; if ((n.minutes ?? 0) > 0) days.add(noteDate(n)); }
  let tokens = 0, cost = 0, partial = false;
  for (const { s, weight } of shares) {
    if (s.tokens === null) { partial = true; continue; }
    tokens += tokenTotal(s.tokens.by_model) * weight;
    if (s.tokens.cost_usd !== null) cost += s.tokens.cost_usd * weight;
    if (s.tokens.cost_usd === null || s.tokens.cost_partial) partial = true;
  }
  const tasks_done = i.tasks.filter((t) => t.status === "done" && t.done_at !== null && inRange(t.done_at, r)).length;
  return {
    minutes, active_days: days.size, sessions: shares.length, tasks_done,
    tokens: Math.round(tokens), cost_usd: round(cost, 4), cost_partial: partial,
  };
}

export function timeStats(i: DashInput, r: Range): TimeStats {
  const tasks = taskMap(i);
  const byProject = new Map<string, number>(), byRequester = new Map<string, number>(), byTask = new Map<string, number>();
  const weekly = new Map<string, Map<string, number>>();
  for (const d of datesIn(r)) {
    const w = isoWeekOf(d);
    if (!weekly.has(w)) weekly.set(w, new Map());
  }
  let unlinked = 0, unlinkedNotes = 0;
  const record = (taskId: string | null, date: string, minutes: number, fromNote = false) => {
    const t = taskId === null ? undefined : tasks.get(taskId);
    const projectKey = t ? t.project || NO_PROJECT : UNLINKED;
    add(weekly.get(isoWeekOf(date))!, projectKey, minutes);
    if (!t) { unlinked += minutes; if (fromNote) unlinkedNotes += minutes; return; }
    add(byProject, projectKey, minutes);
    for (const [name, share] of requesterShares(t)) add(byRequester, name, minutes * share);
    add(byTask, t.id, minutes);
  };
  for (const { s, pieces } of sharesIn(i, r)) for (const p of pieces) record(s.task_id, p.date, p.minutes);
  for (const n of notesIn(i, r)) record(n.task_id, noteDate(n), n.minutes ?? 0, true);
  return {
    by_project: topN(byProject),
    by_requester: topN(byRequester),
    by_task: [...byTask].map(([task_id, minutes]) => ({ task_id, title: tasks.get(task_id)!.title, minutes }))
      .sort((a, b) => b.minutes - a.minutes || a.task_id.localeCompare(b.task_id)),
    unlinked_minutes: unlinked,
    unlinked_note_minutes: unlinkedNotes,
    weekly: [...weekly].map(([week, m]) => ({ week, by_project: topN(m) })),
  };
}

/** A task's 依頼元 with the share of its work each one gets: "A、B" -> A 1/2, B 1/2. A task saved
 *  with a blank requester is filed under （无依頼元） so its minutes are not lost. */
function requesterShares(t: DashTask): [string, number][] {
  const names = splitRequesters(t.requester);
  if (!names.length) return [[NO_REQUESTER, 1]];
  return names.map((name) => [name, 1 / names.length]);
}

/** Time, tokens and cost per 依頼元 over the range, every visible session and note included:
 *  unlinked work is 未关联, a multi-requester task is split evenly (see requesterShares). Shares
 *  are rounded to two decimals at the end, so the sums match overview()'s minutes and tokens to
 *  within rounding — a chart's centre should show the overview figure itself, not this sum.
 *  Sorted by minutes desc; not truncated — the web folds the tail. */
export function requesterStats(i: DashInput, r: Range): RequesterShare[] {
  const tasks = taskMap(i);
  const acc = new Map<string, { minutes: number; tokens: number; cost_usd: number; cost_partial: boolean }>();
  const sharesOf = (taskId: string | null): [string, number][] => {
    const t = taskId === null ? undefined : tasks.get(taskId);
    return t ? requesterShares(t) : [[UNLINKED, 1]];
  };
  const record = (taskId: string | null, minutes: number, tokens: number, cost: number, partial: boolean) => {
    for (const [name, share] of sharesOf(taskId)) {
      const a = acc.get(name) ?? { minutes: 0, tokens: 0, cost_usd: 0, cost_partial: false };
      a.minutes += minutes * share; a.tokens += tokens * share; a.cost_usd += cost * share;
      a.cost_partial ||= partial;
      acc.set(name, a);
    }
  };
  for (const { s, minutes, weight } of sharesIn(i, r)) {
    if (s.tokens === null) record(s.task_id, minutes, 0, 0, true);
    else record(s.task_id, minutes, tokenTotal(s.tokens.by_model) * weight, (s.tokens.cost_usd ?? 0) * weight,
      s.tokens.cost_usd === null || s.tokens.cost_partial);
  }
  for (const n of notesIn(i, r)) record(n.task_id, n.minutes ?? 0, 0, 0, false);
  return [...acc]
    .map(([requester, a]) => ({
      requester, minutes: round(a.minutes, 2), tokens: round(a.tokens, 2), cost_usd: round(a.cost_usd, 4),
      cost_partial: a.cost_partial,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.requester.localeCompare(b.requester));
}

/** Minutes of every visible session and note linked to each task, over its whole history. */
export function allTimeTaskMinutes(i: DashInput): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of i.sessions) if (!s.hidden && s.task_id !== null) add(m, s.task_id, s.minutes);
  for (const n of i.notes) if (n.task_id !== null) add(m, n.task_id, n.minutes ?? 0);
  return m;
}

export function outputStats(i: DashInput, r: Range): OutputStats {
  const done = i.tasks
    .filter((t): t is DashTask & { done_at: string } => t.status === "done" && t.done_at !== null && inRange(t.done_at, r))
    .sort((a, b) => a.done_at.localeCompare(b.done_at) || a.id.localeCompare(b.id));
  const done_tasks = done.map((t) => ({
    task_id: t.id, title: t.title, received_at: t.received_at, done_at: t.done_at,
    lead_days: daysBetween(t.received_at, t.done_at), deliverables: t.deliverables.length,
  }));
  const avg = done_tasks.length ? round(done_tasks.reduce((s, d) => s + d.lead_days, 0) / done_tasks.length, 1) : null;

  const active = new Set<string>([
    ...done.map((t) => t.id),
    ...sessionsIn(i, r).flatMap((s) => (s.task_id ? [s.task_id] : [])),
    ...notesIn(i, r).flatMap((n) => (n.task_id ? [n.task_id] : [])),
  ]);
  const minutes = allTimeTaskMinutes(i);
  const estimate_gaps = i.tasks
    .filter((t) => t.hours_manual !== null && active.has(t.id))
    .map((t) => ({ task_id: t.id, title: t.title, manual_hours: t.hours_manual!, actual_hours: round((minutes.get(t.id) ?? 0) / 60, 2) }));

  return { done_tasks, avg_lead_days: avg, deliverables_count: done_tasks.reduce((s, d) => s + d.deliverables, 0), estimate_gaps };
}

export const LATE_NIGHT_FROM = 22;   // 22:00 ..
export const LATE_NIGHT_UNTIL = 5;   // .. 05:00, by the Tokyo hour of each active piece
export const FOCUS_BUCKETS: { bucket: string; below: number }[] = [
  { bucket: "<15", below: 15 }, { bucket: "15–30", below: 30 }, { bucket: "30–60", below: 60 },
  { bucket: "60–120", below: 120 }, { bucket: "≥120", below: Infinity },
];

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

export function aiStats(i: DashInput, r: Range): AiStats {
  const tasks = taskMap(i);
  const shares = sharesIn(i, r);
  const models = new Map<string, { input: number; output: number; cache_read: number; cache_write: number }>();
  const agents = new Map<string, { sessions: number; minutes: number; cost_usd: number; priced: boolean; unpriced: boolean }>();
  const taskCost = new Map<string, { cost_usd: number; cost_partial: boolean; minutes: number }>();
  let all = 0, sub = 0, cacheRead = 0, inputSide = 0, pricedCost = 0, pricedMinutes = 0, uncollected = 0;

  // Token counts are scaled by the share's weight (see Share) and rounded only when reported.
  for (const { s, minutes, weight } of shares) {
    const agent = agents.get(s.agent) ?? { sessions: 0, minutes: 0, cost_usd: 0, priced: false, unpriced: false };
    agent.sessions += 1; agent.minutes += minutes;
    agents.set(s.agent, agent);
    if (s.tokens === null) { uncollected += 1; continue; }
    for (const [model, c] of Object.entries(s.tokens.by_model)) {
      const m = models.get(model) ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
      m.input += c.input * weight; m.output += c.output * weight; m.cache_read += c.cache_read * weight;
      m.cache_write += (c.cache_write_5m + c.cache_write_1h) * weight;
      models.set(model, m);
      cacheRead += c.cache_read * weight;
      inputSide += (c.input + c.cache_read + c.cache_write_5m + c.cache_write_1h) * weight;
    }
    all += tokenTotal(s.tokens.by_model) * weight;
    sub += tokenTotal(s.tokens.subagent) * weight;
    const cost = s.tokens.cost_usd === null ? null : s.tokens.cost_usd * weight;
    if (cost !== null) { agent.cost_usd += cost; agent.priced = true; pricedCost += cost; pricedMinutes += minutes; }
    if (cost === null || s.tokens.cost_partial) agent.unpriced = true;
    if (s.task_id !== null && tasks.has(s.task_id)) {
      const t = taskCost.get(s.task_id) ?? { cost_usd: 0, cost_partial: false, minutes: 0 };
      t.cost_usd += cost ?? 0; t.minutes += minutes;
      t.cost_partial ||= cost === null || s.tokens.cost_partial;
      taskCost.set(s.task_id, t);
    }
  }
  const sessions = shares.map((x) => x.s);

  return {
    by_model: [...models].map(([model, m]) => {
      const c = { input: Math.round(m.input), output: Math.round(m.output), cache_read: Math.round(m.cache_read), cache_write: Math.round(m.cache_write) };
      return { model, ...c, total: c.input + c.output + c.cache_read + c.cache_write };
    }).sort((a, b) => b.total - a.total || a.model.localeCompare(b.model)),
    by_agent: [...agents].map(([agent, a]) => ({
      agent, sessions: a.sessions, minutes: a.minutes,
      cost_usd: a.priced ? round(a.cost_usd, 4) : null,
      cost_partial: a.priced && a.unpriced,
    })).sort((a, b) => a.agent.localeCompare(b.agent)),
    subagent_share: ratio(sub, all),
    cost_per_hour: pricedCost > 0 ? ratio(pricedCost, pricedMinutes / 60) : null,
    cache_hit_rate: ratio(cacheRead, inputSide),
    by_task_cost: [...taskCost].map(([task_id, t]) => ({ task_id, title: tasks.get(task_id)!.title, ...t, cost_usd: round(t.cost_usd, 4) }))
      .sort((a, b) => b.cost_usd - a.cost_usd || a.task_id.localeCompare(b.task_id)),
    top_sessions: sessions
      .filter((s) => s.tokens !== null && s.tokens.cost_usd !== null)
      .map((s) => ({ id: s.id, summary: s.summary, cost_usd: s.tokens!.cost_usd!, tokens: tokenTotal(s.tokens!.by_model), started_at: s.started_at }))
      .sort((a, b) => b.cost_usd - a.cost_usd || a.id.localeCompare(b.id))
      .slice(0, 5),
    uncollected_sessions: uncollected,
  };
}

/** A session's working-day spans: each active cluster (active_intervals) belongs to the Tokyo day it
 *  began on, and runs from its first to its last message in minutes since that day's midnight — a
 *  cluster that carries on past midnight reads 24:xx on its start day. A window left open for days
 *  is several clusters, so its idle hours never stretch a day's end. Without intervals the session
 *  is one cluster of its effective minutes from started_at (ended_at is when the window closed). */
export function daySpans(s: DashSession): { date: string; start: number; end: number }[] {
  const ivs: [string, string][] = s.active_intervals?.length
    ? s.active_intervals
    : [[s.started_at, new Date(Date.parse(s.started_at) + s.minutes * 60_000).toISOString()]];
  return ivs.map(([from, to]) => {
    const c = jstClock(from);
    return { date: c.date, start: c.minuteOfDay, end: c.minuteOfDay + (Date.parse(to) - Date.parse(from)) / 60_000 };
  });
}

// Round first so 599.7 minutes reads 10:00, never 09:60.
const clock = (minutes: number) => {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function rhythmStats(i: DashInput, r: Range): RhythmStats {
  const shares = sharesIn(i, r);
  const daily = new Map(datesIn(r).map((d) => [d, 0]));
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const focus = FOCUS_BUCKETS.map((b) => ({ bucket: b.bucket, count: 0 }));
  const firstStart = new Map<string, number>(), lastEnd = new Map<string, number>();
  let total = 0, late = 0, weekend = 0;

  for (const { s, minutes, pieces } of shares) {
    // Minutes go to the day and hour they were worked, not to the session's start.
    for (const p of pieces) {
      daily.set(p.date, (daily.get(p.date) ?? 0) + p.minutes);
      heatmap[p.weekday][p.hour] += p.minutes;
      if (p.hour >= LATE_NIGHT_FROM || p.hour < LATE_NIGHT_UNTIL) late += p.minutes;
      if (p.weekday >= 5) weekend += p.minutes;
    }
    total += minutes;
    // A focus block is the whole session; the working day's first start and last end come from
    // its active clusters (daySpans), each on the day it began.
    focus[FOCUS_BUCKETS.findIndex((b) => s.minutes < b.below)].count += 1;
    for (const sp of daySpans(s)) {
      if (!inRange(sp.date, r)) continue;
      firstStart.set(sp.date, Math.min(firstStart.get(sp.date) ?? Infinity, sp.start));
      lastEnd.set(sp.date, Math.max(lastEnd.get(sp.date) ?? -Infinity, sp.end));
    }
  }
  for (const n of notesIn(i, r)) daily.set(noteDate(n), (daily.get(noteDate(n)) ?? 0) + (n.minutes ?? 0));

  const mean = (m: Map<string, number>) => (m.size ? [...m.values()].reduce((a, b) => a + b, 0) / m.size : null);
  const avgStart = mean(firstStart), avgEnd = mean(lastEnd);
  return {
    daily: [...daily].map(([date, minutes]) => ({ date, minutes })),
    heatmap,
    late_night_share: ratio(late, total),
    weekend_share: ratio(weekend, total),
    focus_blocks: focus,
    avg_start: avgStart === null ? null : clock(avgStart),
    avg_end: avgEnd === null ? null : clock(avgEnd),
  };
}
