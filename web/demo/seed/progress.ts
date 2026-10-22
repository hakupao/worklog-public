// How far each 案件 had come on a given day: its milestones spread evenly over the days it was really worked on
// (≥ 20 active minutes), so plan progress lines and 週報 digests tell the same story as the sessions.
import type { SessionRec } from "./sessions";
import type { Tri } from "./types";
import type { TaskDef } from "./world";

const WORKED_MIN = 20;

export class Progress {
  private days = new Map<string, string[]>();
  private objects = new Map<string, Tri>();
  private minutes = new Map<string, Map<string, number>>();

  constructor(recs: SessionRec[]) {
    const byTask = new Map<string, Map<string, number>>();
    const longest = new Map<string, number>();
    for (const r of recs) {
      if (!r.task || r.hide) continue;
      const m = byTask.get(r.task.id) ?? byTask.set(r.task.id, new Map()).get(r.task.id)!;
      for (const [d, v] of r.byDate) m.set(d, (m.get(d) ?? 0) + v);
      const key = `${r.task.id}|${r.date}`;
      if (r.object && r.minutes > (longest.get(key) ?? -1)) { longest.set(key, r.minutes); this.objects.set(key, r.object); }
    }
    this.minutes = byTask;
    for (const [id, m] of byTask) this.days.set(id, [...m].filter(([, v]) => v >= WORKED_MIN).map(([d]) => d).sort());
  }

  /** Index into task.milestones reached by the end of `date`; -1 before the first worked day. */
  indexAt(task: TaskDef, date: string): number {
    const days = this.days.get(task.id) ?? [], M = task.milestones.length;
    let k = -1;
    for (let i = 0; i < days.length && days[i] <= date; i++) k = i;
    if (k < 0) return -1;
    return days.length === 1 ? M - 1 : Math.round((k * (M - 1)) / (days.length - 1));
  }

  milestoneAt(task: TaskDef, date: string): Tri | null {
    const i = this.indexAt(task, date);
    return i < 0 ? null : task.milestones[i];
  }

  /** True when `date` is a worked day that reached a milestone the previous worked day had not. */
  movedOn(task: TaskDef, date: string): boolean {
    const days = this.days.get(task.id) ?? [], k = days.indexOf(date);
    if (k < 0) return false;
    return k === 0 || this.indexAt(task, date) > this.indexAt(task, days[k - 1]);
  }

  /** Active minutes on the task that JST day (hidden sessions left out). */
  minutesOn(taskId: string, date: string): number {
    return this.minutes.get(taskId)?.get(date) ?? 0;
  }

  /** What the day's longest session on the task worked on. */
  objectOn(task: TaskDef, date: string): Tri {
    return this.objects.get(`${task.id}|${date}`) ?? task.objects[0];
  }
}
