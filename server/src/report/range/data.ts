// The range report's data (spec 2026-10-13 §6): one D1 batch, then everything per week in memory, so the number of D1
// statements does not grow with the weeks (Workers Free: 50). Per-week figures come from weekly.ts weekFigures over
// one all-time wall sweep cut per week (wallWindow equals a windowed sweep), so each week equals the 週報's.
import { paperColor } from "../../badge/palette";
import { tokenTotal } from "../../dashboard/stats";
import type { TokenCounts } from "../../dashboard/types";
import type { DeriveSession, StoredVerdict } from "../../deliverables/derive";
import { withEffective } from "../../effective";
import type { Lang } from "../../i18n/langs";
import { localize } from "../../i18n/store";
import { addDays, isoWeekOf } from "../../jst";
import { splitRequesters } from "../../requesters";
import { digestId } from "../digests";
import type { TaskLike } from "../types";
import { UNLINKED as UNLINKED_BUCKET, wallSplit, wallWindow, type WallNote, type WallSession } from "../wall";
import { day5Of, dayStart5, reportWeekOf, reportWeekRange } from "../week";
import { autoDeliverables, bucketTotals, cmp, datedDeliverables, round2, roundQuarter, toTask, toWallSession, weekFigures, type AutoDeliverable, type SessionDbRow, type TaskDbRow } from "../weekly";
import { RANGE_LABELS, type RangeLabels } from "./labels";
import { NONE, OTHER, TOP_SERIES, UNLINKED, foldSeries, seriesLabel } from "./series";
import type { RangeData, RangeDay, RangeDayTask, RangeTask, RangeWeek, RangeWeekTask } from "./types";

export const MAX_WEEKS = 52;

/** Weeks from → to inclusive, counted from the two Saturdays without walking; null as rangeWeeks. */
export function rangeLength(from: string, to: string): number | null {
  const a = reportWeekRange(from), b = reportWeekRange(to);
  if (!a || !b || a.startMs > b.startMs) return null;
  return Math.round((b.startMs - a.startMs) / (7 * 86_400_000)) + 1;
}

/** Report weeks from → to inclusive; null when either is not an ISO week or from comes after to. Stops after
 *  MAX_WEEKS + 1 weeks (a backstop: the route counts the weeks with rangeLength and refuses before walking). */
export function rangeWeeks(from: string, to: string): string[] | null {
  const a = reportWeekRange(from), b = reportWeekRange(to);
  if (!a || !b || a.startMs > b.startMs) return null;
  const out: string[] = [];
  for (let sat = a.days[0]; sat <= b.days[0] && out.length <= MAX_WEEKS; sat = addDays(sat, 7)) out.push(isoWeekOf(addDays(sat, 6)));
  return out;
}

type Tokens = { by_model: Record<string, TokenCounts>; cost_usd: number | null; cost_partial?: boolean } | null;
export type RangeSession = WallSession & { tokens: Tokens };
export interface RangeInput {
  tasks: TaskLike[];                                   // titles / projects in the export language
  sessions: RangeSession[];                            // every visible session, all history
  notes: Array<WallNote & { id: string }>;
  digests: Map<string, { oneliner: string | null; pdf_text: string | null; text: string | null }>;   // week → its digest, in the export language
  derive: { verdicts: Map<string, StoredVerdict>; byTask: Map<string, DeriveSession[]>; cwdOf: Map<string, string> };
  badgeColor: Map<string, number | null>;              // tasks.badge_color per 案件 id (the day charts' 案件 colours)
}

export function buildRange(input: RangeInput, weeks: string[], L: RangeLabels, generated: string): RangeData {
  const allWall = wallSplit(input.sessions, input.notes);
  const allTotals = bucketTotals(allWall);
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  // A bucket's series keys: a 案件's 依頼元 (split evenly when several), NONE when blank, UNLINKED when the bucket is
  // unlinked or its 案件 is gone.
  const keysOf = (bucket: string): string[] => {
    const t = bucket === UNLINKED_BUCKET ? undefined : byId.get(bucket);
    if (!t) return [UNLINKED];
    const ns = splitRequesters(t.requester);
    return ns.length ? ns : [NONE];
  };

  const dateWeek = new Map<string, string>();
  const per = weeks.map((week) => {
    const days = reportWeekRange(week)!.days;
    for (const d of days) dateWeek.set(d, week);
    const ww = wallWindow(allWall, days[0], days[6]);
    const noteTasks = new Set<string>();
    for (const n of input.notes) if (n.task_id !== null && ww.notes.has(n.id)) noteTasks.add(n.task_id);
    const f = weekFigures(input.tasks, ww, noteTasks, days);
    const byKey = new Map<string, number>();
    for (const [bucket, m] of f.totals) { const ks = keysOf(bucket); for (const k of ks) byKey.set(k, (byKey.get(k) ?? 0) + m / ks.length); }
    return { week, days, f, byKey };
  });

  const rangeByKey = new Map<string, number>();
  for (const { byKey } of per) for (const [k, m] of byKey) rangeByKey.set(k, (rangeByKey.get(k) ?? 0) + m);
  const { keys, keyOf } = foldSeries(rangeByKey);

  // Sessions with time in the range (the 成果物 rule) and AI cost / tokens: a session's share per week = its wall share
  // there ÷ its whole wall share (same 05:00 calendar as the hours); with no wall share at all, the week it started in.
  // weekSessions: per week, the sessions with time in it (the 週報's 成果物 rule, week by week).
  const inRange = new Set(weeks), rangeSessions = new Set<string>(), cost = new Map<string, { usd: number; tokens: number }>();
  const weekSessions = new Map(weeks.map((w) => [w, new Set<string>()]));
  let partial = false;
  for (const s of input.sessions) {
    const shares = allWall.sessions.get(s.id), weight = new Map<string, number>();
    const total = shares ? [...shares.values()].reduce((a, b) => a + b, 0) : 0;
    if (total > 0) for (const [d, v] of shares!) { const w = dateWeek.get(d); if (w && v > 0) { weight.set(w, (weight.get(w) ?? 0) + v / total); rangeSessions.add(s.id); weekSessions.get(w)!.add(s.id); } }
    else { const t = Date.parse(s.started_at); if (Number.isFinite(t) && inRange.has(reportWeekOf(t))) weight.set(reportWeekOf(t), 1); }
    if (weight.size === 0) continue;
    if (!s.tokens) { partial = true; continue; }
    if (s.tokens.cost_usd === null || s.tokens.cost_partial) partial = true;
    const tk = tokenTotal(s.tokens.by_model);
    for (const [w, x] of weight) { const c = cost.get(w) ?? { usd: 0, tokens: 0 }; c.usd += (s.tokens.cost_usd ?? 0) * x; c.tokens += tk * x; cost.set(w, c); }
  }

  // 成果物: hand-picked, then the automatic ones (verdict in) written / published by a session with time in the range —
  // weekly.ts's rule over the whole range; derived over every session of the 案件 so a × on one mount covers the other.
  // Derived once per 案件 for the range; a week keeps those one of its own sessions wrote (deriveTask × weeks is too slow).
  const autos = new Map<string, AutoDeliverable[]>();
  const autoOf = (t: TaskLike): AutoDeliverable[] => {
    let a = autos.get(t.id);
    if (!a) autos.set(t.id, (a = autoDeliverables(t, input.derive.byTask.get(t.id) ?? [], input.derive.verdicts, (id) => rangeSessions.has(id), input.derive.cwdOf)));
    return a;
  };
  // The automatic ones of `ours` (a week's sessions, or the range's), dated and ordered as the 週報 does. A hand-picked
  // path equal to an automatic label collapses into one entry (the hand-picked place).
  const deliverablesOf = (t: TaskLike, inScope: (date: string) => boolean, ours: (id: string) => boolean = () => true) => {
    const autos = autoOf(t).flatMap((a) => { const mine = a.mine.filter(ours); return mine.length ? [{ ...a, mine }] : []; });
    return [...new Set([...t.deliverables, ...datedDeliverables(autos, allWall, inScope).map((a) => a.label)])];
  };
  const byRequester = (a: { requester: string; received_at: string; id: string }, b: typeof a) =>
    cmp(a.requester, b.requester) || cmp(a.received_at, b.received_at) || cmp(a.id, b.id);
  const totalHours = (t: TaskLike) => t.hours_manual ?? roundQuarter((allTotals.get(t.id) ?? 0) / 60);

  let cum = 0;
  const out: RangeWeek[] = per.map(({ week, days, f, byKey }) => {
    cum += f.done;
    const bySeries = keys.map(() => 0);
    for (const [k, m] of byKey) if (m > 0) bySeries[keys.indexOf(keyOf(k))] += m / 60;
    const top = [...f.totals].filter(([b, m]) => m > 0 && byId.has(b)).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 3).map(([b]) => byId.get(b)!.title);
    const c = cost.get(week), mine = weekSessions.get(week)!, dg = input.digests.get(week);
    const tasks: RangeWeekTask[] = [...f.touched].sort(byRequester).map((t) => ({
      id: t.id, requester: t.requester, title: t.title, status: t.status, week_hours: round2((f.totals.get(t.id) ?? 0) / 60),
      total_hours_all_time: totalHours(t), deliverables: deliverablesOf(t, (d) => dateWeek.get(d) === week, (id) => mine.has(id)),
    }));
    return { week, start: days[0], end: days[6], hours: f.total_hours, sum_hours: round2(f.sum_minutes / 60), new: f.new, done: f.done, done_cum: cum,
      by_series: bySeries.map(round2), cost_usd: round2(c?.usd ?? 0), tokens: Math.round(c?.tokens ?? 0), oneliner: dg?.oneliner || null, top_tasks: top,
      digest_text: dg?.pdf_text || dg?.text || null, tasks };   // the 週報 PDF: pdf_text, else the text (a hand edit clears pdf_text)
  });

  const rangeMin = new Map<string, number>(), touched = new Set<string>();
  for (const { f } of per) { for (const [b, m] of f.totals) rangeMin.set(b, (rangeMin.get(b) ?? 0) + m); for (const t of f.touched) touched.add(t.id); }
  const tasks: RangeTask[] = input.tasks.filter((t) => touched.has(t.id)).map((t) => ({
    id: t.id, requester: t.requester, title: t.title, project: t.project, status: t.status, received_at: t.received_at, done_at: t.done_at,
    // 期間内 rounds like 通算 (quarter hours), so it never reads above it; a hand 通算 is shown as typed and flagged.
    range_hours: (t.hours_manual === null ? roundQuarter : round2)((rangeMin.get(t.id) ?? 0) / 60),
    total_hours: totalHours(t), total_manual: t.hours_manual !== null, deliverables: deliverablesOf(t, (d) => dateWeek.has(d)),
  })).sort(byRequester);

  const { days, day_tasks } = lastWeekDays(input, per[per.length - 1], allWall, byId, keysOf, keys, keyOf, L);
  return {
    from: weeks[0], to: weeks[weeks.length - 1], generated, weeks: out, days, day_tasks,
    series_keys: keys, series: keys.map((k) => seriesLabel(k, L)),
    share: keys.map((k, i): [string, number] => [seriesLabel(k, L), round2(out.reduce((a, w) => a + w.by_series[i], 0))]),
    totals: {
      hours: round2(per.reduce((a, { f }) => a + f.total_minutes, 0) / 60), sum_hours: round2(per.reduce((a, { f }) => a + f.sum_minutes, 0) / 60),
      done: cum, cost_usd: round2(out.reduce((a, w) => a + w.cost_usd, 0)), tokens: out.reduce((a, w) => a + w.tokens, 0), cost_partial: partial,
    },
    tasks,
  };
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** 本周日别: the range's last week day by day (05:00 days, as the week's hours). 案件 series: the week's top 6 by wall
 *  minutes (ties by id), the rest folded into OTHER, unlinked time (or a gone 案件's) UNLINKED — like the 依頼元 fold. */
function lastWeekDays(input: RangeInput, last: { days: string[]; f: ReturnType<typeof weekFigures> }, allWall: ReturnType<typeof wallSplit>,
                      byId: Map<string, TaskLike>, keysOf: (bucket: string) => string[], keys: string[], keyOf: (k: string) => string, L: RangeLabels): { days: RangeDay[]; day_tasks: RangeDayTask[] } {
  const ranked = [...last.f.totals].filter(([b, m]) => m > 0 && byId.has(b)).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([b]) => b);
  const top = ranked.slice(0, TOP_SERIES), kept = new Set(top);
  const unlinked = [...last.f.totals].some(([b, m]) => m > 0 && !byId.has(b));
  const taskKeys = [...top, ...(ranked.length > TOP_SERIES ? [OTHER] : []), ...(unlinked ? [UNLINKED] : [])];
  const taskOf = (bucket: string) => (!byId.has(bucket) ? UNLINKED : kept.has(bucket) ? bucket : OTHER);
  const day_tasks = taskKeys.map((k): RangeDayTask => ({
    key: k, label: k === OTHER ? L.otherTask : k === UNLINKED ? L.unassigned : byId.get(k)!.title,
    color: k === OTHER || k === UNLINKED ? "" : paperColor(k, input.badgeColor.get(k)).slice(1).toUpperCase(),
  }));

  // Session time per day, as the wall places it: the intervals, else started_at + minutes. An overridden session: its
  // minutes from started_at, all on started_at's 05:00 day (the wall books them there), cut at that day's end.
  // Notes have no span.
  const span = new Map<string, [number, number]>();
  for (const s of input.sessions) {
    if (s.override && s.minutes <= 0) continue;
    const t0 = Date.parse(s.started_at);
    if (!Number.isFinite(t0) && (s.override || !s.intervals?.length)) continue;   // nothing to place, as in wall.ts
    const ivs: [number, number][] = !s.override && s.intervals?.length
      ? s.intervals.map(([x, y]) => [Date.parse(x), Date.parse(y)]) : [[t0, t0 + s.minutes * MIN]];
    const onDays = s.override ? last.days.filter((d) => d === day5Of(t0)) : last.days;
    for (const [x, y] of ivs) for (const d of onDays) {
      const lo = dayStart5(d), a = Math.max(x, lo), b = Math.min(y, lo + DAY);
      if (!(Number.isFinite(a) && Number.isFinite(b) && b > a)) continue;
      const cur = span.get(d);
      span.set(d, cur ? [Math.min(cur[0], a), Math.max(cur[1], b)] : [a, b]);
    }
  }
  // Hours after the date's 00:00 JST (= its 05:00 start − 5 h), to the minute.
  const clock = (d: string, ms: number) => Math.round(((ms - (dayStart5(d) - 5 * HOUR)) / HOUR) * 60) / 60;

  const days = last.f.day_minutes.map(([date, minutes]): RangeDay => {
    const bySeries = keys.map(() => 0), byTask = taskKeys.map(() => 0);
    for (const [bucket, m] of allWall.days.get(date) ?? []) {
      if (!(m > 0)) continue;
      const ks = keysOf(bucket);
      for (const k of ks) bySeries[keys.indexOf(keyOf(k))] += m / ks.length / 60;
      byTask[taskKeys.indexOf(taskOf(bucket))] += m / 60;
    }
    const sp = span.get(date);
    return { date, hours: round2(minutes / 60), by_series: bySeries.map(round2), by_task: byTask.map(round2),
      start: sp ? clock(date, sp[0]) : null, end: sp ? clock(date, sp[1]) : null };
  });
  return { days, day_tasks };
}

/** One batch of 5 + 2 localize reads = 7 D1 statements, whatever the number of weeks (+1 download record in the route).
 *  No report_overrides (spec §2). */
export async function loadRange(db: D1Database, weeks: string[], lang: Lang, generated: string): Promise<RangeData> {
  const [taskRes, sessionRes, noteRes, verdictRes, digestRes] = await db.batch([
    db.prepare("SELECT * FROM tasks ORDER BY id"),
    db.prepare("SELECT * FROM sessions WHERE hidden = 0 ORDER BY unixepoch(started_at), id"),
    db.prepare("SELECT * FROM notes ORDER BY ts, id"),
    db.prepare("SELECT * FROM deliverable_verdicts"),
    db.prepare(`SELECT week, oneliner, pdf_text, text FROM report_digests WHERE day = ''
                AND week IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(weeks)),
  ]);
  const [taskRows, digests] = await Promise.all([
    localize(db, lang, "task", taskRes.results as TaskDbRow[], ["title", "project"]),
    localize(db, lang, "digest", digestRes.results as Array<{ week: string; oneliner: string | null; pdf_text: string | null; text: string | null }>, ["oneliner", "pdf_text", "text"], (r) => digestId(r.week, "")),
  ]);
  const raw = (sessionRes.results as SessionDbRow[]).map(withEffective);
  const byTask = new Map<string, DeriveSession[]>();
  for (const s of raw) if (s.task_id !== null) byTask.set(s.task_id, [...(byTask.get(s.task_id) ?? []), s as unknown as DeriveSession]);
  return buildRange({
    tasks: taskRows.map(toTask),
    sessions: raw.map((s): RangeSession => ({ ...toWallSession(s), tokens: s.tokens as Tokens })),
    notes: noteRes.results as Array<WallNote & { id: string }>,
    digests: new Map(digests.map((d) => [d.week, { oneliner: d.oneliner, pdf_text: d.pdf_text, text: d.text }])),
    derive: { verdicts: new Map((verdictRes.results as StoredVerdict[]).map((v) => [v.key, v])), byTask, cwdOf: new Map(raw.map((s) => [s.id, s.cwd as string])) },
    badgeColor: new Map((taskRes.results as TaskDbRow[]).map((t) => [t.id, (t.badge_color as number | null | undefined) ?? null])),
  }, weeks, RANGE_LABELS[lang], generated);
}
