import type { Dashboard, KeyMinutes, RequesterShare } from "../../api/types";
import { isValidWeek, weekDates } from "../../lib/jst";

// Each section reads its own part of the dashboard and checks its shape, the way StatsPage's usable() checks
// the top: a part that isn't what the page expects is null (the section says 暂无数据), a bad row is skipped.

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";
const rowsOf = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(obj) : []);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const LEDGER_ROWS = 10;

/** `cost.minutes` are the task's minutes in sessions with token data — the cost's own base, so $/h leaves out the notes
 *  and token-less sessions that `minutes` (the ledger's time) counts. */
export interface LedgerRow { taskId: string; title: string; minutes: number; cost: { usd: number; partial: boolean; minutes: number } | null }
/** 时间花在哪's ledger: the first LEDGER_ROWS tasks by time, each with its cost from the AI section if it has one. */
export function ledgerRows(d: Dashboard): LedgerRow[] | null {
  const time: unknown = d.time, ai: unknown = d.ai;
  if (!obj(time) || !Array.isArray(time.by_task)) return null;
  const costs = new Map<string, { usd: number; partial: boolean; minutes: number }>();
  for (const c of rowsOf(obj(ai) ? ai.by_task_cost : null)) {
    if (str(c.task_id) && num(c.cost_usd)) costs.set(c.task_id, { usd: c.cost_usd, partial: c.cost_partial === true, minutes: num(c.minutes) ? c.minutes : 0 });
  }
  return rowsOf(time.by_task).filter((r) => str(r.task_id) && num(r.minutes)).slice(0, LEDGER_ROWS).map((r) => ({
    taskId: r.task_id as string, title: str(r.title) ? r.title : (r.task_id as string), minutes: r.minutes as number, cost: costs.get(r.task_id as string) ?? null,
  }));
}

export const COST_ROWS = 5;

export interface TaskCostRow { taskId: string; title: string; usd: number; partial: boolean }
/** AI 使用效率's 按案件费用: the first COST_ROWS tasks by cost (the ledger is by time, so a costly task low on hours
 *  shows its cost here). */
export function taskCostRows(d: Dashboard): TaskCostRow[] | null {
  const ai: unknown = d.ai;
  if (!obj(ai) || !Array.isArray(ai.by_task_cost)) return null;
  return rowsOf(ai.by_task_cost).filter((c) => str(c.task_id) && num(c.cost_usd))
    .map((c) => ({ taskId: c.task_id as string, title: str(c.title) ? c.title : (c.task_id as string), usd: c.cost_usd as number, partial: c.cost_partial === true }))
    .sort((a, b) => b.usd - a.usd).slice(0, COST_ROWS);
}

/** Time on no task: sessions (to link on the timeline) and notes (picked in the note itself); null when none. */
export function unlinkedOf(d: Dashboard): { total: number; sessions: number; notes: number } | null {
  const time: unknown = d.time;
  if (!obj(time) || !num(time.unlinked_minutes) || time.unlinked_minutes <= 0) return null;
  const notes = num(time.unlinked_note_minutes) ? Math.max(0, time.unlinked_note_minutes) : 0;
  return { total: time.unlinked_minutes, notes, sessions: Math.max(0, time.unlinked_minutes - notes) };
}

export interface WeekRow { week: string; from: string; to: string; partial: boolean; minutes: number; projects: KeyMinutes[] }
/** 每周: one row per ISO week with its total, its days cut to the range the figures are for (W37 when the range
 *  starts on a Wednesday), and its projects for the hover tip (U7). */
export function weekRows(d: Dashboard): WeekRow[] | null {
  const time: unknown = d.time, range: unknown = d.range;
  if (!obj(time) || !Array.isArray(time.weekly)) return null;
  const cut = obj(range) && str(range.from) && DATE.test(range.from) && str(range.to) && DATE.test(range.to) ? { from: range.from, to: range.to } : null;
  return rowsOf(time.weekly).filter((w) => str(w.week) && isValidWeek(w.week) && Array.isArray(w.by_project)).map((w) => {
    const days = weekDates(w.week as string);
    const projects = rowsOf(w.by_project).filter((p) => str(p.key) && num(p.minutes)) as unknown as KeyMinutes[];
    const from = cut && cut.from > days[0] ? cut.from : days[0], to = cut && cut.to < days[6] ? cut.to : days[6];
    return { week: w.week as string, from, to, partial: from !== days[0] || to !== days[6], minutes: projects.reduce((s, p) => s + p.minutes, 0), projects };
  });
}

/** 按依頼元: the server's rows (minutes desc, 未关联 an ordinary row), tokens 0 when missing. */
export function requesterRows(d: Dashboard): RequesterShare[] | null {
  const rs: unknown = d.requesters;
  if (!Array.isArray(rs)) return null;
  return rowsOf(rs).filter((r) => str(r.requester) && num(r.minutes)).map((r) => ({
    requester: r.requester as string, minutes: r.minutes as number, tokens: num(r.tokens) ? r.tokens : 0,
    cost_usd: num(r.cost_usd) ? r.cost_usd : 0, cost_partial: r.cost_partial === true,
  }));
}

export interface DoneRow { taskId: string; title: string; received: string; done: string; leadDays: number; deliverables: number }
export interface GapRow { taskId: string; title: string; manual: number; actual: number }
export interface OutputView { done: DoneRow[]; avgLead: number | null; deliverables: number; gaps: GapRow[] }
/** 产出: the done tasks, their average lead time, deliverables, and the tasks whose manual hours differ. */
export function outputOf(d: Dashboard): OutputView | null {
  const o: unknown = d.output;
  if (!obj(o) || !Array.isArray(o.done_tasks) || !Array.isArray(o.estimate_gaps)) return null;
  const title = (r: Obj) => (str(r.title) ? r.title : (r.task_id as string));
  return {
    done: rowsOf(o.done_tasks).filter((r) => str(r.task_id) && num(r.lead_days)).map((r) => ({
      taskId: r.task_id as string, title: title(r), received: str(r.received_at) ? r.received_at : "", done: str(r.done_at) ? r.done_at : "",
      leadDays: r.lead_days as number, deliverables: num(r.deliverables) ? r.deliverables : 0,
    })),
    avgLead: num(o.avg_lead_days) ? o.avg_lead_days : null,
    deliverables: num(o.deliverables_count) ? o.deliverables_count : 0,
    gaps: rowsOf(o.estimate_gaps).filter((r) => str(r.task_id) && num(r.manual_hours) && num(r.actual_hours)).map((r) => ({
      taskId: r.task_id as string, title: title(r), manual: r.manual_hours as number, actual: r.actual_hours as number,
    })),
  };
}

export interface RhythmView {
  daily: { date: string; minutes: number }[];
  /** 7 weekdays (Monday first) × 24 hours of minutes; null when the server's matrix isn't that shape. */
  heat: number[][] | null;
  focus: { bucket: string; count: number }[];
  start: string | null; end: string | null; late: number | null; weekend: number | null;
}
/** 工作节奏: the four figures, the days, the weekday × hour matrix and the session-length buckets. */
export function rhythmOf(d: Dashboard): RhythmView | null {
  const r: unknown = d.rhythm;
  if (!obj(r) || !Array.isArray(r.daily)) return null;
  const hm = r.heatmap;
  const heat = Array.isArray(hm) && hm.length === 7 && hm.every((row) => Array.isArray(row) && row.length === 24 && row.every(num))
    ? (hm as number[][]).map((row) => row.map((v) => Math.max(0, v))) : null;
  const share = (v: unknown) => (num(v) ? v : null);
  return {
    daily: rowsOf(r.daily).filter((x) => str(x.date) && DATE.test(x.date) && num(x.minutes)).map((x) => ({ date: x.date as string, minutes: Math.max(0, x.minutes as number) })),
    heat,
    focus: rowsOf(r.focus_blocks).filter((x) => str(x.bucket) && num(x.count)).map((x) => ({ bucket: x.bucket as string, count: x.count as number })),
    start: str(r.avg_start) ? r.avg_start : null, end: str(r.avg_end) ? r.avg_end : null,
    late: share(r.late_night_share), weekend: share(r.weekend_share),
  };
}

export interface AiView {
  sub: number | null; cache: number | null; cph: number | null; uncollected: number;
  models: { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; total: number }[];
  agents: { agent: string; sessions: number; minutes: number; cost: number | null; partial: boolean }[];
  top: { id: string; summary: string; cost: number; tokens: number; startedAt: string }[];
}
/** AI 使用效率: the three ratios, tokens by model, the two agents, the costliest sessions (the server's first 5). */
export function aiOf(d: Dashboard): AiView | null {
  const a: unknown = d.ai;
  if (!obj(a) || !Array.isArray(a.by_model) || !Array.isArray(a.by_agent) || !Array.isArray(a.top_sessions)) return null;
  const n0 = (v: unknown) => (num(v) ? v : 0);
  return {
    sub: num(a.subagent_share) ? a.subagent_share : null, cache: num(a.cache_hit_rate) ? a.cache_hit_rate : null,
    cph: num(a.cost_per_hour) ? a.cost_per_hour : null, uncollected: n0(a.uncollected_sessions),
    models: rowsOf(a.by_model).filter((m) => str(m.model) && num(m.total)).map((m) => ({
      model: m.model as string, input: n0(m.input), output: n0(m.output), cacheRead: n0(m.cache_read), cacheWrite: n0(m.cache_write), total: m.total as number,
    })),
    agents: rowsOf(a.by_agent).filter((g) => str(g.agent) && num(g.sessions) && num(g.minutes)).map((g) => ({
      agent: g.agent as string, sessions: g.sessions as number, minutes: g.minutes as number, cost: num(g.cost_usd) ? g.cost_usd : null, partial: g.cost_partial === true,
    })),
    top: rowsOf(a.top_sessions).filter((s) => str(s.id) && num(s.cost_usd) && str(s.started_at) && !Number.isNaN(Date.parse(s.started_at))).map((s) => ({
      id: s.id as string, summary: str(s.summary) ? s.summary : "", cost: s.cost_usd as number, tokens: n0(s.tokens), startedAt: s.started_at as string,
    })),
  };
}
