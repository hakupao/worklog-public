import { Hono } from "hono";
import { withEffective } from "../effective";
import type { AppEnv } from "../env";
import { langOf } from "../i18n/langs";
import { localize, localizeSessions } from "../i18n/store";
import { weekRange } from "../jst";
import { dayTotal, wallSplit } from "../report/wall";
import { splitMinutes } from "../split";

export const weeks = new Hono<AppEnv>();

type SessionRow = Record<string, unknown> & {
  started_at: string; ended_at: string; summary: string; summary_edited: string | null; active_minutes: number;
  minutes_override: number | null; hidden: number; task_id: string | null; active_intervals: string | null;
};
type NoteRow = Record<string, unknown> & { ts: string; minutes: number | null };

weeks.get("/:week/timeline", async (c) => {
  const range = weekRange(c.req.param("week"));
  if (!range) return c.json({ error: "invalid week" }, 400);
  const includeHidden = c.req.query("include_hidden") === "1";
  const db = c.env.DB;

  // unixepoch() parses 'Z', '+09:00' and fractional seconds, so the comparison is on instants, not strings.
  // A session that started before the week can still have active time inside it (a window left open
  // over midnight), so the filter is "overlaps the week", not "started in the week".
  const [sessionRes, noteRes] = await db.batch([
    db.prepare(
      `SELECT * FROM sessions WHERE unixepoch(started_at) < ?2 AND unixepoch(ended_at) >= ?1
       ORDER BY unixepoch(started_at), id`,
    ).bind(range.startUnix, range.endUnix),
    // notes.ts is a naive JST wall-clock string, so a date-prefix comparison IS the JST day.
    db.prepare("SELECT * FROM notes WHERE ts >= ?1 AND ts < ?2 ORDER BY ts, id")
      .bind(range.days[0], nextDay(range.days[6])),
  ]);
  const lang = langOf(c);
  const sessions = await localizeSessions(db, lang, sessionRes.results as (SessionRow & { id: string })[], { meta: true });
  const notes = await localize(db, lang, "note", noteRes.results as NoteRow[], ["text"], undefined, { meta: true });

  const days = range.days.map((date) => ({ date, minutes: 0, sessions: [] as unknown[], notes: [] as unknown[] }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  let unassigned = 0;
  let hidden = 0;

  for (const s of sessions) {
    const withEff = withEffective(s);
    // The session's minutes spread over the Tokyo days it was active on; the same card appears
    // under each of those days with that day's share, and the whole-session figures unchanged.
    const split = splitMinutes({
      started_at: s.started_at, active_intervals: withEff.active_intervals, minutes: withEff.minutes_effective,
    });
    let shown = false;
    for (const [date, minutes_on_day] of split.byDay) {
      const day = byDate.get(date);
      if (!day) continue;   // a share outside the week (or a pre-intervals row that started before it)
      if (s.hidden && !includeHidden) { shown = true; continue; }
      day.sessions.push({ ...withEff, minutes_on_day });
      if (!s.hidden) day.minutes += minutes_on_day;
      shown = true;
    }
    if (!shown) continue;
    if (s.hidden) hidden += 1;
    else if (s.task_id === null) unassigned += 1;
  }
  // 工作时间 beside the sum (user 10/9): the wall clock of the same days (calendar days, parallel sessions once —
  // report/wall.ts, the 週報's sweep with the day starting at 00:00), hidden sessions left out like the sum.
  const wall = wallSplit(sessions.filter((s) => !s.hidden).map((s) => {
    const e = withEffective(s);
    return { id: s.id as string, task_id: s.task_id, started_at: s.started_at, intervals: e.active_intervals, minutes: e.minutes_effective, override: s.minutes_override !== null };
  }), notes.map((n) => ({ id: n.id as string, task_id: (n.task_id as string | null) ?? null, ts: n.ts, minutes: n.minutes })),
  { from: range.days[0], to: range.days[6] }, 0);
  for (const n of notes) {
    const day = byDate.get(n.ts.slice(0, 10));
    if (!day) continue;
    day.notes.push(n);
    day.minutes += n.minutes ?? 0;
  }

  // The two place a few minutes differently (an override crossing midnight sits on its start day in the sweep but
  // is apportioned by splitMinutes here), so a day's wall is capped at its sum: 工作时间 never exceeds 累计.
  const wallOf = (d: { date: string; minutes: number }) => Math.min(dayTotal(wall, d.date), d.minutes);
  return c.json({
    week: c.req.param("week"),
    days: days.map((d) => ({ ...d, wall_minutes: wallOf(d) })),
    total_minutes: days.reduce((sum, d) => sum + d.minutes, 0),
    total_wall_minutes: days.reduce((sum, d) => sum + wallOf(d), 0),
    unassigned,
    hidden,
  });
});

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
