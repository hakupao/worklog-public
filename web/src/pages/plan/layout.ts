import type { DayPlan, DayPlanItem, DayStatus, Horizon, PlanItem } from "../../api/types";
import type { SnapSession } from "../../predict/snapshot";
import { addDays, weekdayOfDate } from "../../predict/time";
import type { Band, WeekLayout } from "../timeline/week";

// The 计划 page (prototype page-plan.html): the day's 今日安排 rows, the AI 对账 week, and the four-horizon
// timetable. Time on a plan's tasks comes from the timeline's own week layout (the same per-day session split,
// task check and 运行中 rule as 时间线, 此刻 and 案件). Pure.

export const HORIZONS: Horizon[] = ["daily", "week", "near", "far"];

/** What a day row flips to every 8 s (prototype altLine): the AI's note, else its progress (the old page showed it on
 *  every row — preflight R5), else the concrete goal, else the time on its tasks that day with the first session's
 *  summary, else "no related sessions". */
export type AltLine =
  | { kind: "note"; text: string } | { kind: "progress"; text: string } | { kind: "detail"; text: string }
  | { kind: "time"; minutes: number; n: number; summary: string } | { kind: "idle" }
  /** The day's week is not loaded (yet): not "no sessions" (review B). */
  | { kind: "wait" };

export interface DayRow {
  item: DayPlanItem; status: DayStatus;
  /** Who decided the status: you (改判), the AI, or nobody yet. */
  by: "manual" | "ai" | null;
  taskIds: string[];
  /** The item's tasks' sessions on that day (their share of it) — 0 / none when it has no task. */
  minutes: number; sessions: SnapSession[];
  alt: AltLine;
}

/** The sessions on the item's tasks that the band lists for its day, in first-start order. */
function onBand(band: Band | null | undefined, ids: string[]): { minutes: number; sessions: SnapSession[] } {
  const tr = (band?.tracks ?? []).filter((x) => x.taskId !== null && ids.includes(x.taskId));
  return {
    minutes: tr.reduce((n, x) => n + x.minutes, 0),
    sessions: tr.flatMap((x) => x.sessions).sort((a, b) => a.start - b.start),
  };
}

/** `band`: the day's band; null = its week has no band for it (a quiet weekend); undefined = the week is not loaded. */
export function dayRows(plan: DayPlan, band: Band | null | undefined): DayRow[] {
  return plan.items.map((item): DayRow => {
    const taskIds = item.tasks.map((x) => x.id), { minutes, sessions } = onBand(band, taskIds);
    const note = item.ai_note?.trim(), progress = item.ai_progress?.trim(), detail = item.detail.trim();
    const alt: AltLine = note ? { kind: "note", text: note } : progress ? { kind: "progress", text: progress } : detail ? { kind: "detail", text: detail }
      : sessions.length ? { kind: "time", minutes, n: sessions.length, summary: sessions[0].summary } : band === undefined ? { kind: "wait" } : { kind: "idle" };
    return {
      item, status: item.final_status, by: item.manual_status ? "manual" : item.ai_status ? "ai" : null,
      taskIds, minutes, sessions, alt,
    };
  });
}

/** Monday to Friday of a date's ISO week. */
export function weekdaysOf(date: string): string[] {
  const mon = addDays(date, 1 - weekdayOfDate(date));
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
}

/** The AI 对账 bars: per weekday the share of that day's items that ended done (0 when not started, empty or
 *  not loaded — the prototype draws all three as an empty bar). */
export function doneShare(plans: (DayPlan | null | undefined)[]): number[] {
  return plans.map((p) => (p && p.items.length ? p.items.filter((i) => i.final_status === "done").length / p.items.length : 0));
}

export interface TtRow {
  item: PlanItem;
  /** A daily item out of its period (past 截止日, or every linked task done): dimmed, tagged 不在期. */
  idle: boolean;
  /** Minutes per weekday of this week on any of its tasks (drawn on / off). */
  perDay: number[];
  /** 01, 02 … within its horizon; null for a closed one. */
  order: number | null;
  tag: "stale" | "idle" | "done" | "dropped" | null;
}

/** A closed item is never 不在期: the server computes `effective` for active ones only (every closed daily item comes
 *  back false — review A), so a done / dropped one keeps its own tag. */
export const isIdle = (p: PlanItem) => p.horizon === "daily" && p.status === "active" && !p.effective;

function ttRow(p: PlanItem, bands: (Band | null)[], order: number | null): TtRow {
  const ids = p.tasks.map((x) => x.id), idle = isIdle(p);
  return {
    item: p, idle, order,
    perDay: bands.map((b) => (ids.length ? onBand(b, ids).minutes : 0)),
    tag: p.stale ? "stale" : idle ? "idle" : p.status === "done" ? "done" : p.status === "dropped" ? "dropped" : null,
  };
}

/** This week's weekday bands, Monday to Friday (null for a day the layout does not have). */
export function weekBands(week: WeekLayout | null, days: string[]): (Band | null)[] {
  return days.map((d) => week?.bands.find((b) => b.date === d) ?? null);
}

/** The four groups in horizon order, active items in the server's order (sort, then created). */
export function ttGroups(items: PlanItem[], bands: (Band | null)[]): { horizon: Horizon; rows: TtRow[] }[] {
  return HORIZONS.map((horizon) => ({
    horizon,
    rows: items.filter((p) => p.horizon === horizon && p.status === "active").map((p, i) => ttRow(p, bands, i + 1)),
  }));
}
export const closedRows = (items: PlanItem[], bands: (Band | null)[]): TtRow[] => items.filter((p) => p.status !== "active").map((p) => ttRow(p, bands, null));

/** Before a day starts: the daily items it will bring in (the server also carries over the last plan's
 *  unfinished items — which plan that is, only the server knows; user ruling U2). In effect ON THAT DAY — the rule
 *  the server's start uses (routes/plan-items.ts effectiveDaily with the day) — not `effective`, which is as of
 *  today (preflight R7): no tasks or one not done, and no 截止日 or one not before the day. */
export const preview = (items: PlanItem[], date: string) => items.filter((p) => p.horizon === "daily" && p.status === "active"
  && (p.tasks.length === 0 || p.tasks.some((x) => x.status !== "done")) && (p.until_date === null || p.until_date >= date));

/** 从计划添加: active items not already in the day, by horizon (the old page's list). */
export function pickable(items: PlanItem[], plan: DayPlan): PlanItem[] {
  const placed = new Set(plan.items.map((i) => i.plan_item_id));
  return HORIZONS.flatMap((h) => items.filter((p) => p.horizon === h && p.status === "active" && !placed.has(p.id)));
}
