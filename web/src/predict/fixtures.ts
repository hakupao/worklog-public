import type { DayPlan, DayPlanItem, Machine, PlanItem, Session, Task, TaskRef, TaskStatus } from "../api/types";

// Builders for API-shaped data. Used by the 情境模拟 scenarios, the predict tests and the rule-A replay,
// so all three go through the same buildSnapshot path the live page uses.

/** Tokyo wall clock "YYYY-MM-DD HH:MM" → UTC ISO instant. */
export const J = (wall: string) => new Date(`${wall.replace(" ", "T")}:00+09:00`).toISOString();

export function session(id: string, from: string, to: string, o: Partial<Session> = {}, cost: number | null = 1): Session {
  const a = J(from), b = J(to), minutes = Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
  const s: Session = {
    id, machine: "macmini", agent: "claude-code", session_id: `${id}-full`, cwd: "/w", started_at: a, ended_at: b,
    active_minutes: minutes, turns: 1, summary: "", summary_source: "llm", task_id: null, link_method: "none",
    summary_edited: null, minutes_override: null, hidden: 0, files_written: [],
    tokens: { by_model: {}, subagent: {}, cost_usd: cost, cost_partial: false },
    active_intervals: [[a, b]], ts: a, updated_at: a, summary_effective: "", minutes_effective: minutes,
    ...o,
  };
  s.summary_effective = s.summary_edited ?? s.summary;
  s.minutes_effective = s.minutes_override ?? s.active_minutes;
  return s;
}
export const task = (id: string, title: string, status: TaskStatus = "open"): Task => ({
  id, requester: "r", project: "", title, status, received_at: "2026-09-01", done_at: null, thinking: "",
  deliverables: [], hours_manual: null, machine: "macmini", ts: "2026-09-01T09:00:00", updated_at: "2026-09-01T00:00:00Z",
});
export const taskRef = (id: string, title = id, status: TaskStatus = "open"): TaskRef => ({ id, title, status });
export function planItem(o: Partial<PlanItem> & Pick<PlanItem, "id" | "horizon" | "text">): PlanItem {
  return {
    tasks: [], status: "active", week: null, until_date: null, sort: 0, created_at: "2026-09-01T00:00:00Z", done_at: null,
    updated_at: "2026-09-01T00:00:00Z", effective: o.horizon === "daily", stale: false, ...o,
  };
}
export function dayItem(o: Partial<DayPlanItem> & Pick<DayPlanItem, "id" | "text">): DayPlanItem {
  const it: DayPlanItem = {
    date: "2026-10-02", plan_item_id: null, tasks: [], detail: "", sort: 0, ai_status: null, ai_progress: null,
    ai_evidence: [], ai_note: null, manual_status: null, updated_at: "2026-10-02T00:00:00Z", final_status: "none", ...o,
  };
  it.final_status = it.manual_status ?? it.ai_status ?? "none";
  return it;
}
export const dayPlan = (date: string, items: DayPlanItem[], o: Partial<DayPlan> = {}): DayPlan => ({
  date, started_at: J(`${date} 09:00`), judged_at: null, judge_machine: null, judge_model: null,
  updated_at: J(`${date} 09:00`), items, ...o,
});
export const machine = (name: string, at: string): Machine => ({ name, last_seen_at: J(at) });
