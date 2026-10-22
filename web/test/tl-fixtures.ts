import type { Note, Session, Timeline } from "../src/api/types";
import { addDays, dayStart, DAY } from "../src/predict/time";

/** A week timeline the way the server builds it (routes/weeks.ts): a session is listed under every Tokyo
 *  day it was active, with that day's share of its minutes; hidden ones only when includeHidden. */
export function weekTl(week: string, monday: string, sessions: Session[], notes: Note[] = [], includeHidden = false): Timeline {
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const days = dates.map((date) => ({ date, minutes: 0, sessions: [] as Session[], notes: [] as Note[] }));
  let unassigned = 0, hidden = 0;
  for (const s of sessions) {
    const iv = (s.active_intervals ?? [[s.started_at, s.ended_at]]).map(([a, b]) => [Date.parse(a), Date.parse(b)]);
    const all = iv.reduce((n, [a, b]) => n + (b - a), 0);
    let shown = false;
    for (const d of days) {
      const a0 = dayStart(d.date), on = iv.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, a0 + DAY) - Math.max(a, a0)), 0);
      if (on <= 0) continue;
      shown = true;
      if (s.hidden && !includeHidden) continue;
      const share = all > 0 ? Math.round((s.minutes_effective * on) / all) : s.minutes_effective;
      if (share === 0 && s.minutes_effective > 0) continue;   // server split.ts drops a day whose share rounds to 0
      d.sessions.push({ ...s, minutes_on_day: share });
      if (!s.hidden) d.minutes += share;
    }
    if (!shown) continue;
    if (s.hidden) hidden++; else if (s.task_id === null) unassigned++;
  }
  for (const n of notes) { const d = days.find((x) => x.date === n.ts.slice(0, 10)); if (d) { d.notes.push(n); d.minutes += n.minutes ?? 0; } }
  return { week, days, total_minutes: days.reduce((n, d) => n + d.minutes, 0), unassigned, hidden };
}
export const note = (id: string, ts: string, o: Partial<Note> = {}): Note =>
  ({ id, text: `note ${id}`, task_id: null, minutes: null, machine: "macmini", ts, updated_at: "2026-10-01T00:00:00Z", ...o });
