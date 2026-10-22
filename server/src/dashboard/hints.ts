import { daysBetween, isoWeekOf, jstDate } from "../jst";
import type { Range } from "./range";
import { noteDate, sessionDate, sharesIn, tokenTotal, UNLINKED } from "./stats";
import type { DashInput, DashTask, Hint, RhythmStats } from "./types";

/** Every threshold a hint uses, in one place so they can be tuned without reading the rules. */
export const THRESHOLDS = {
  staleOpenDays: 14,
  machineSilentDays: 3,
  lateNightShare: 0.2,
  weekendShare: 0.2,
  costlySessionUsd: 100,
  subagentHeavyShare: 0.8,
  subagentHeavyMinTokens: 10_000_000,
};
const MAX_LINKS = 3;
const pctOf = (x: number) => Math.round(x * 100);
const pct = (x: number) => `${pctOf(x)}%`;
const hoursOf = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
const weekLinks = (dates: string[]) =>
  [...new Set(dates.map(isoWeekOf))].sort().reverse().slice(0, MAX_LINKS).map((w) => ({ label: w, href: `#/v2/timeline/${w}` }));
const taskLinks = (tasks: DashTask[]) => tasks.slice(0, MAX_LINKS).map((t) => ({ label: t.title, href: `#/v2/tasks/${encodeURIComponent(t.id)}` }));

export function buildHints(i: DashInput, r: Range, rhythm: RhythmStats, now: Date): Hint[] {
  const today = jstDate(now.toISOString());
  const taskIds = new Set(i.tasks.map((t) => t.id));
  const shares = sharesIn(i, r);
  const inRangeSessions = shares.map((x) => x.s);
  const out: Hint[] = [];

  // Hours are the in-range part of each session (see stats.ts Share), like the overview's total.
  const unlinked = shares.filter(({ s }) => s.task_id === null || !taskIds.has(s.task_id));
  if (unlinked.length) {
    const hours = hoursOf(unlinked.reduce((n, x) => n + x.minutes, 0));
    out.push({ id: "unlinked", level: "warn",
      text: `${unlinked.length} 个会话${UNLINKED}案件（${hours}h），不会进入周报的案件工时`,
      links: [{ label: "去关联（全部）", href: "#/v2/timeline?unlinked=1" }], params: { n: unlinked.length, hours } });
  }

  const doneEmpty = i.tasks.filter((t) => t.status === "done" && t.deliverables.length === 0);
  if (doneEmpty.length) {
    out.push({ id: "done-no-deliverable", level: "warn", text: `${doneEmpty.length} 个已完了的案件没有填写成果物`, links: taskLinks(doneEmpty),
      params: { n: doneEmpty.length } });
  }

  const silent = i.machines.map((m) => ({ name: m.name, days: daysBetween(jstDate(m.last_seen_at), today) }))
    .filter((m) => m.days > THRESHOLDS.machineSilentDays);
  if (silent.length) {
    out.push({ id: "machine-silent", level: "warn",
      text: silent.map((m) => `${m.name} 已 ${m.days} 天没有新会话`).join("；"), links: [],
      params: { names: silent.map((m) => m.name).join("、"), days: Math.min(...silent.map((m) => m.days)) } });
  }

  const lastActivity = new Map<string, string>();
  const touch = (id: string | null, date: string) => {
    if (id !== null && (lastActivity.get(id) ?? "") < date) lastActivity.set(id, date);
  };
  for (const s of i.sessions) if (!s.hidden) touch(s.task_id, sessionDate(s));
  for (const n of i.notes) touch(n.task_id, noteDate(n));
  const stale = i.tasks.filter((t) => t.status === "open" &&
    daysBetween(lastActivity.get(t.id) ?? t.received_at, today) > THRESHOLDS.staleOpenDays);
  if (stale.length) {
    out.push({ id: "stale-open", level: "info", text: `${stale.length} 个 open 案件超过 ${THRESHOLDS.staleOpenDays} 天没有进展`, links: taskLinks(stale),
      params: { n: stale.length, days: THRESHOLDS.staleOpenDays } });
  }

  const fallback = inRangeSessions.filter((s) => s.summary_source === "fallback");
  if (fallback.length) {
    out.push({ id: "summary-fallback", level: "info", text: `${fallback.length} 个会话的摘要生成失败，显示的是首句`, links: weekLinks(fallback.map(sessionDate)),
      params: { n: fallback.length } });
  }

  if (rhythm.late_night_share !== null && rhythm.late_night_share > THRESHOLDS.lateNightShare) {
    out.push({ id: "late-night", level: "info", text: `深夜（22–5 时）的工作占 ${pct(rhythm.late_night_share)}`, links: [],
      params: { pct: pctOf(rhythm.late_night_share) } });
  }
  if (rhythm.weekend_share !== null && rhythm.weekend_share > THRESHOLDS.weekendShare) {
    out.push({ id: "weekend", level: "info", text: `周末工作占 ${pct(rhythm.weekend_share)}`, links: [],
      params: { pct: pctOf(rhythm.weekend_share) } });
  }

  const costly = inRangeSessions.filter((s) => (s.tokens?.cost_usd ?? 0) > THRESHOLDS.costlySessionUsd)
    .sort((a, b) => b.tokens!.cost_usd! - a.tokens!.cost_usd!);
  if (costly.length) {
    const max = Math.round(costly[0].tokens!.cost_usd!);
    out.push({ id: "costly-session", level: "info",
      text: `${costly.length} 个会话的等价费用超过 $${THRESHOLDS.costlySessionUsd}（最高 $${max}）`,
      links: weekLinks(costly.map(sessionDate)), params: { n: costly.length, usd: THRESHOLDS.costlySessionUsd, max } });
  }
  const heavy = inRangeSessions.filter((s) => {
    if (!s.tokens) return false;
    const all = tokenTotal(s.tokens.by_model);
    return all > THRESHOLDS.subagentHeavyMinTokens && tokenTotal(s.tokens.subagent) / all > THRESHOLDS.subagentHeavyShare;
  });
  if (heavy.length) {
    out.push({ id: "subagent-heavy", level: "info",
      text: `${heavy.length} 个会话超过 ${pct(THRESHOLDS.subagentHeavyShare)} 的 token 花在子 agent 上`,
      links: weekLinks(heavy.map(sessionDate)), params: { n: heavy.length, pct: pctOf(THRESHOLDS.subagentHeavyShare) } });
  }

  // warn before info; within a level the order above is kept (sort is stable).
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
}
