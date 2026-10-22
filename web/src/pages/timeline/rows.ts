import type { Note, Session, Task } from "../../api/types";
import type { Band } from "./week";

/** One line of the day list: a session (with the day it is listed under) or a note. */
export type TlRow =
  | { kind: "s"; s: Session; date: string | null; key: string }
  | { kind: "n"; n: Note; key: string };

/** A task id that names a 案件 that exists; anything else reads as 未关联 (same rule as the cross-week list). */
export const linkedTask = (s: { task_id: string | null }, tasks: Record<string, Task>) => (s.task_id !== null && tasks[s.task_id] ? s.task_id : null);

/** The selected day: its sessions by start, then its notes; 只看此目录 keeps that directory's sessions and
 *  no notes (a note has no directory) — the old timeline's contract 5. */
export function dayRows(band: Band, dir: string | null): TlRow[] {
  const ss = band.sessions.filter((s) => !dir || s.cwd === dir)
    .slice().sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || (a.id < b.id ? -1 : 1));
  return [
    ...ss.map((s): TlRow => ({ kind: "s", s, date: band.date, key: `s:${s.id}` })),
    ...(dir ? [] : band.notes.map((n): TlRow => ({ kind: "n", n, key: `n:${n.id}` }))),
  ];
}

/** 未关联 filter: the cross-week list (server order: longest first), each row with its own date. */
export function unlinkedRows(list: Session[], dir: string | null, dateOf: (iso: string) => string): TlRow[] {
  return list.filter((s) => !dir || s.cwd === dir).map((s): TlRow => ({ kind: "s", s, date: dateOf(s.started_at), key: `s:${s.id}` }));
}

/** 未关联 filter's notes (user 10/6, the old 只看未关联 listed them): the displayed week's notes with no task,
 *  after the sessions. There is no cross-week notes endpoint, so it is this week's only; none under 只看此目录. */
export function unlinkedNotes(bands: { notes: Note[] }[], tasks: Record<string, Task>, dir: string | null): TlRow[] {
  if (dir) return [];
  return bands.flatMap((b) => b.notes).filter((n) => !linkedTask(n, tasks)).map((n): TlRow => ({ kind: "n", n, key: `n:${n.id}` }));
}

/** The day to list when the hash names none: today when it is in the week, else the first band with
 *  sessions, else the first band. */
export function defaultDay(bands: Band[]): string | null {
  return (bands.find((b) => b.isToday) ?? bands.find((b) => b.sessions.length > 0) ?? bands[0])?.date ?? null;
}

/** 关联 suggestions for an unlinked session (assumption 2): open / hold tasks that another session in the
 *  same directory is linked to, most minutes first; at most three. */
export function suggestTasks(s: Session, pool: Session[], tasks: Record<string, Task>): string[] {
  const by = new Map<string, number>();
  for (const x of pool) {
    const k = linkedTask(x, tasks);
    if (x.id === s.id || x.cwd !== s.cwd || !k || tasks[k].status === "done") continue;
    by.set(k, (by.get(k) ?? 0) + x.minutes_effective);
  }
  return [...by].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).slice(0, 3).map(([k]) => k);
}
