import type { DayStatus, PlanItem } from "../api/types";
import type { StrKey } from "../i18n/strings";
import { shiftWeek } from "../lib/jst";
import type { RuleId, RuleParams } from "../prefs/types";
import { minutesOn, type Snapshot, type SnapSession } from "./snapshot";
import { MIN, addDays, dayStart, daysBetween, hmOf, jstDate, mdOf, weekdayOfDate } from "./time";
import type { Hit, When, WhenKey } from "./types";

/** 关联 opens the timeline's 未关联 filter (sub-project 3 replaced the old #/unlinked page for these links). */
export const UNLINKED_HREF = "#/v2/timeline?unlinked=1";
/** The 计划 page (sub-project 5): a 今日安排 item's drawer, a plan item's drawer, or the board (排进今日 / 排下周
 *  happen on the board itself: 从计划添加, ＋ 新增条目). */
export const PLAN_HREF = "#/v2/plan";
/** The v2 週報 of a week, on its default sheet (日別作業). */
export const reportHref = (week: string) => `#/v2/report/${encodeURIComponent(week)}`;
const dayHref = (id: string) => `${PLAN_HREF}?day=${encodeURIComponent(id)}`;
const itemHref = (id: string) => `${PLAN_HREF}?item=${encodeURIComponent(id)}`;

// The ten default rules of spec §7.2, as pure functions of the snapshot. Which rules run (mode window,
// on/off) and how they rank is predict.ts; a rule only says what it found and how urgent it is.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const label = (key: WhenKey): When => ({ kind: "label", key });
const TODAY = label("today");
function dayWhen(s: Snapshot, date: string): When {
  if (date === s.date) return TODAY;
  if (date === addDays(s.date, -1)) return label("yesterday");
  return { kind: "date", md: mdOf(date) };
}
function mostCommon(xs: string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best: string | null = null, k = 0;
  for (const [x, c] of n) if (c > k) { best = x; k = c; }
  return best;
}
/** The seven Tokyo dates of the snapshot's ISO week, Monday first. */
export function weekDates(s: Snapshot): string[] {
  const mon = addDays(s.date, 1 - weekdayOfDate(s.date));
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}
const unlinkedOn = (s: Snapshot, dates: string[]) => s.sessions.filter((x) => x.taskId === null && x.days.some((d) => dates.includes(d)));
const minutesIn = (list: SnapSession[], dates: string[]) => list.reduce((n, x) => n + dates.reduce((m, d) => m + minutesOn(x, d), 0), 0);
/** The fourteen Tokyo dates the snapshot holds: last ISO week and this one, Monday first. */
export function rangeDates(s: Snapshot): string[] {
  const mon = addDays(s.date, 1 - weekdayOfDate(s.date) - 7);
  return Array.from({ length: 14 }, (_, i) => addDays(mon, i));
}
/** Unlinked sessions of the snapshot's two weeks (so a Monday still sees last week's leftovers), minus
 *  the ones still running (harvest may yet auto-link a session in progress, and the board must not turn
 *  red over what the user is doing right now). 依据 counts these — a fact line, today's included. */
export function weekUnlinked(s: Snapshot): SnapSession[] {
  const live = new Set(s.running.map((r) => r.session.id));
  return unlinkedOn(s, rangeDates(s)).filter((x) => !live.has(x.id));
}
/** What `week.unlinked` reminds of: the above minus every session that touches today, which is
 *  `unlinked.stale`'s job (its wait and minimum keep a session that just ended from turning the lamp red),
 *  minus every session with fewer than `minMinutes` in the two weeks. The minimum is per session (final
 *  review, user ruling), measured like `unlinked.stale`'s (minutesOn the dates in view, summed over them) —
 *  `unlinked.yesterday` sums its one day instead because it is one suggestion for one day. */
export function olderUnlinked(s: Snapshot, minMinutes: number): SnapSession[] {
  const dates = rangeDates(s);
  return weekUnlinked(s).filter((x) => !x.days.includes(s.date) && minutesIn([x], dates) >= minMinutes);
}
/** What `unlinked.yesterday` counts: the last workday's unlinked sessions, minus the ones still running
 *  (same reason as weekUnlinked). */
export function yesterdayUnlinked(s: Snapshot): SnapSession[] {
  const live = new Set(s.running.map((r) => r.session.id));
  return unlinkedOn(s, [s.prevWorkday]).filter((x) => !live.has(x.id));
}

/** Plan items that could go into today's plan: daily ones in effect and this week's (not carried
 *  over), not already placed. The 今日安排 line shows how many there are before the day starts. */
export function unplacedPlanItems(s: Snapshot): PlanItem[] {
  const placed = new Set((s.dayPlan?.items ?? []).map((i) => i.plan_item_id).filter((x): x is string => x !== null));
  return s.planItems.filter((p) => p.status === "active" && !placed.has(p.id)
    && ((p.horizon === "daily" && p.effective) || (p.horizon === "week" && !p.stale)));
}

const CONFIRM_WHY: Record<DayStatus, StrKey> = {
  done: "rule.dayplan.confirm.why.done", partial: "rule.dayplan.confirm.why.partial", none: "rule.dayplan.confirm.why.none",
};

type Rule = { alert: boolean; run: (s: Snapshot, p: RuleParams) => Hit[] };

export const RULES: Record<RuleId, Rule> = {
  "unlinked.yesterday": { alert: true, run: (s, p) => {
    const day = s.prevWorkday, list = yesterdayUnlinked(s), m = minutesIn(list, [day]);
    if (list.length === 0 || m < (p.minMinutes ?? 5)) return [];
    return [{
      target: `unlinked:${day}`, urgency: clamp(m / 60, 1, 3), action: "link", href: UNLINKED_HREF, when: dayWhen(s, day),
      taskId: null, machine: mostCommon(list.map((x) => x.machine)),
      textKey: "rule.unlinked.yesterday.text", whyKey: "rule.unlinked.yesterday.why", vars: { n: list.length, m, day: mdOf(day) },
    }];
  } },

  "unlinked.stale": { alert: true, run: (s, p) => {
    const limit = (p.minutes ?? 30) * MIN, min = p.minMinutes ?? 5, live = new Set(s.running.map((r) => r.session.id));
    return s.sessions
      .filter((x) => x.taskId === null && !live.has(x.id) && x.days.includes(s.date) && s.now - x.end >= limit
        && minutesOn(x, s.date) >= min)
      .map((x): Hit => {
        const ago = Math.round((s.now - x.end) / MIN);
        return {
          target: `session:${x.id}`, urgency: clamp(ago / 60, 1, 3), action: "link", href: UNLINKED_HREF,
          when: { kind: "time", hm: hmOf(x.start) }, taskId: null, machine: x.machine,
          textKey: "rule.unlinked.stale.text", whyKey: "rule.unlinked.stale.why", vars: { from: hmOf(x.start), to: hmOf(x.end), m: ago },
        };
      });
  } },

  "week.unlinked": { alert: true, run: (s, p) => {
    const dates = rangeDates(s), list = olderUnlinked(s, p.minMinutes ?? 5), m = minutesIn(list, dates);
    if (list.length === 0) return [];
    // the chip says how far back it reaches: 上周 once any of them is from last week
    const old = list.some((x) => x.days.some((d) => d < dates[7]));
    return [{
      // Urgency fixed at 1 (final review, user ruling): a specific unlinked.yesterday / unlinked.stale goes
      // first by default. Their urgency is clamped to ≥ 1, so their minimum default scores are 100×1 = 100
      // and 90×1 = 90; this one's score is its weight, 80×1 = 80 < 90 (uncapped it reached 80×3 = 240).
      target: `unlinked:${s.week}`, urgency: 1, action: "link", href: UNLINKED_HREF, when: label(old ? "lastweek" : "week"),
      taskId: null, machine: mostCommon(list.map((x) => x.machine)),
      textKey: "rule.week.unlinked.text", whyKey: "rule.week.unlinked.why", vars: { n: list.length, m },
    }];
  } },

  "dayplan.untouched": { alert: false, run: (s) => {
    const dp = s.dayPlan;
    if (!dp) return [];
    const done = dp.items.filter((i) => i.final_status === "done").length;
    const touched = new Set(s.sessions.filter((x) => x.taskId !== null && x.days.includes(s.date)).map((x) => x.taskId as string));
    return dp.items
      .filter((i) => i.final_status !== "done" && i.tasks.length > 0 && !i.tasks.some((t) => touched.has(t.id)))
      .map((i): Hit => ({
        target: `day:${i.id}`, urgency: 1, action: "start", href: dayHref(i.id), when: TODAY, taskId: i.tasks[0].id, machine: null,
        textKey: "rule.dayplan.untouched.text", whyKey: "rule.dayplan.untouched.why", vars: { a: done, b: dp.items.length }, subject: i.text,
      }));
  } },

  "plan.unplaced": { alert: false, run: (s) => unplacedPlanItems(s).map((p): Hit => ({
    target: `plan:${p.id}`,
    urgency: p.until_date ? 1 + 1 / (Math.max(0, daysBetween(s.date, p.until_date)) + 1) : 1,
    action: "plan", href: PLAN_HREF, when: TODAY, taskId: p.tasks[0]?.id ?? null, machine: null,
    textKey: "rule.plan.unplaced.text",
    whyKey: p.horizon === "week" ? "rule.plan.unplaced.why.week" : p.until_date ? "rule.plan.unplaced.why.dailyDue" : "rule.plan.unplaced.why.daily",
    vars: { due: p.until_date ? mdOf(p.until_date) : "" }, subject: p.text,
  })) },

  "report.undownloaded": { alert: false, run: (s) => (s.downloads.some((d) => d.week === s.reportWeek) ? [] : [{
    target: `report:${s.reportWeek}`, urgency: 1, action: "report", href: reportHref(s.reportWeek), when: label("week"),
    taskId: null, machine: null, textKey: "rule.report.undownloaded.text", whyKey: "rule.report.undownloaded.why",
    vars: { week: s.reportWeek.slice(5) },
  }]) },

  "dayplan.confirm": { alert: false, run: (s) => (s.dayPlan?.items ?? [])
    .filter((i) => i.ai_status !== null && i.manual_status === null)
    .map((i): Hit => ({
      target: `day:${i.id}`, urgency: 1, action: "confirm", href: dayHref(i.id), when: TODAY, taskId: i.tasks[0]?.id ?? null, machine: null,
      textKey: "rule.dayplan.confirm.text", whyKey: CONFIRM_WHY[i.ai_status ?? "none"], vars: {}, subject: i.text,
    })) },

  "task.waiting": { alert: false, run: (s, p) => {
    const since = dayStart(addDays(s.date, -(p.days ?? 3))), kws = p.keywords ?? [];
    const live = new Set(s.running.map((r) => r.session.taskId));
    const latest = new Map<string, SnapSession>();
    for (const x of s.sessions) {
      if (x.taskId === null || x.end < since || x.end > s.now) continue;
      if ((latest.get(x.taskId)?.end ?? -Infinity) < x.end) latest.set(x.taskId, x);
    }
    const out: Hit[] = [];
    for (const [id, x] of latest) {
      const t = s.tasks[id];
      if (!t || t.status === "done" || live.has(id)) continue;
      const low = x.summary.toLowerCase(), kw = kws.find((k) => low.includes(k.toLowerCase()));
      if (!kw) continue;
      const day = jstDate(x.end);
      out.push({
        target: `task:${id}`, urgency: 1, action: "reply", href: `#/v2/tasks/${encodeURIComponent(id)}`, when: dayWhen(s, day),
        taskId: id, machine: x.machine, textKey: "rule.task.waiting.text", whyKey: "rule.task.waiting.why",
        vars: { kw, day: mdOf(day) }, subject: t.title,
      });
    }
    return out;
  } },

  "plan.stale": { alert: false, run: (s) => s.planItems.filter((p) => p.status === "active" && p.stale).map((p): Hit => ({
    target: `plan:${p.id}`, urgency: 1, action: "schedule", href: itemHref(p.id), when: label("lastweek"),
    taskId: p.tasks[0]?.id ?? null, machine: null, textKey: "rule.plan.stale.text", whyKey: "rule.plan.stale.why",
    vars: { week: p.week ?? "" }, subject: p.text,
  })) },

  // Assumption 6: POST pins `week` to the current week and the UI never sets another (PATCH would accept
  // one, but nothing offers it), so a "next week" item does not occur in practice. The rule asks instead
  // whether ANY this-week or near item is still open — those roll over and become next week's plan (the
  // near horizon counts too: it is where the user actually keeps the coming days' work, audit 2026-10-06).
  "nextweek.empty": { alert: false, run: (s) => (s.planItems.some((p) => p.status === "active" && (p.horizon === "week" || p.horizon === "near")) ? [] : [{
    target: `nextweek:${shiftWeek(s.week, 1)}`, urgency: 1, action: "nextweek", href: PLAN_HREF, when: label("nextweek"),
    taskId: null, machine: null, textKey: "rule.nextweek.empty.text", whyKey: "rule.nextweek.empty.why", vars: {},
  }]) },
};
