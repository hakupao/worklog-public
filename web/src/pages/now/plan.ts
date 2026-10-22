import type { DayStatus } from "../../api/types";
import { minutesOn, type Snapshot } from "../../predict/snapshot";

/** One 今日安排 item as a board row (user 10/6: 「每条一行」 with today's minutes and the AI's progress). */
export interface PlanRow {
  id: string; status: DayStatus; taskIds: string[]; text: string; detail: string;
  /** Minutes today on the item's tasks (the timeline's own per-day split), 0 when it has none. */
  minutes: number;
  /** ai_progress; else the verdict without words (yours, then the AI's); else what is missing. */
  progress: { kind: "ai"; text: string } | { kind: "manual" | "judged"; status: DayStatus } | { kind: "noTask" | "noSession" | "unjudged" };
  note: string | null;
}

export const MAX_PLAN_ROWS = 4;

/** How many of `total` plan rows the board shows: at most MAX_PLAN_ROWS, and only rows of `rowH` px that fit whole in
 *  the `boxH` px the column leaves (T10 F2). Unmeasured (0 / NaN, e.g. jsdom) shows the cap. */
export function shownPlanRows(total: number, boxH: number, rowH: number): number {
  const cap = Math.min(total, MAX_PLAN_ROWS);
  if (!(boxH > 0) || !(rowH > 0)) return cap;
  return Math.min(cap, Math.floor((boxH + 0.5) / rowH));
}

export function planRows(s: Snapshot): PlanRow[] {
  if (!s.dayPlan) return [];
  return s.dayPlan.items.map((it): PlanRow => {
    const taskIds = it.tasks.map((t) => t.id), ids = new Set(taskIds);
    const minutes = s.sessions.filter((x) => x.taskId !== null && ids.has(x.taskId)).reduce((n, x) => n + minutesOn(x, s.date), 0);
    const progress: PlanRow["progress"] = it.ai_progress?.trim() ? { kind: "ai", text: it.ai_progress.trim() }
      : it.manual_status ? { kind: "manual", status: it.manual_status }
      : it.ai_status ? { kind: "judged", status: it.ai_status }
      : { kind: taskIds.length === 0 ? "noTask" : minutes === 0 ? "noSession" : "unjudged" };
    return { id: it.id, status: it.final_status, taskIds, text: it.text, detail: it.detail, minutes, progress, note: it.ai_note };
  });
}
