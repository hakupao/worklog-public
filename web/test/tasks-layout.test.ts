import { describe, expect, it } from "vitest";
import type { Task, TaskTotal } from "../src/api/types";
import { layoutTasks } from "../src/pages/tasks/layout";
import { layoutWeek } from "../src/pages/timeline/week";
import { J, machine, session, task } from "../src/predict/fixtures";
import { note, weekTl } from "./tl-fixtures";

const W = "2026-W40", MON = "2026-09-28";
const recv = (t: Task, received_at: string): Task => ({ ...t, received_at });
const tasks = [recv(task("T0901-01", "alpha"), "2026-09-01"), recv(task("T0915-01", "beta", "hold"), "2026-09-15"),
  recv(task("T0915-02", "gamma", "done"), "2026-09-15"), recv(task("T0920-01", "delta"), "2026-09-20")];
const lay = (ss: ReturnType<typeof session>[], o: { notes?: ReturnType<typeof note>[]; totals?: TaskTotal[] | null; now?: string; list?: Task[] } = {}) => {
  const L = layoutWeek({ timeline: weekTl(W, MON, ss, o.notes), tasks: o.list ?? tasks, machines: [machine("macmini", o.now ?? "2026-10-02 14:20")],
    now: Date.parse(J(o.now ?? "2026-10-02 14:20")), runningMin: 10 });
  return layoutTasks({ tasks: o.list ?? tasks, totals: o.totals === undefined ? [] : o.totals, week: L });
};

describe("layoutTasks", () => {
  it("rows newest received first, then id descending (the old page's order)", () => {
    expect(lay([]).rows.map((r) => r.task.id)).toEqual(["T0920-01", "T0915-02", "T0915-01", "T0901-01"]);
  });
  it("per day: the task's sessions' share of that day plus its notes' minutes; 本周 is their sum", () => {
    const R = lay([
      session("a", "2026-09-29 10:00", "2026-09-29 11:00", { task_id: "T0901-01" }),
      // crosses midnight: 60 on Tue, 60 on Wed
      session("b", "2026-09-29 23:00", "2026-09-30 01:00", { task_id: "T0901-01" }),
      session("c", "2026-10-01 10:00", "2026-10-01 10:30", { task_id: "T0915-01" }),
      session("u", "2026-10-01 11:00", "2026-10-01 11:30"),
    ], { notes: [note("1", "2026-10-02T12:00:00", { task_id: "T0901-01", minutes: 15 }), note("2", "2026-10-02T13:00:00", { minutes: 40 })] });
    expect(R.days).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    const a = R.rows.find((r) => r.task.id === "T0901-01")!;
    expect(a.perDay).toEqual([0, 120, 60, 0, 15]);
    expect(a.week).toBe(195);
    expect(R.rows.find((r) => r.task.id === "T0915-01")!.week).toBe(30);
  });
  it("a hidden session counts nowhere; a weekend column only when the week has a weekend band", () => {
    const R = lay([
      session("h", "2026-09-29 10:00", "2026-09-29 11:00", { task_id: "T0901-01", hidden: 1 }),
      session("w", "2026-10-03 10:00", "2026-10-03 10:20", { task_id: "T0901-01" }),
    ]);
    expect(R.days.at(-1)).toBe("2026-10-03");
    expect(R.rows.find((r) => r.task.id === "T0901-01")!.perDay).toEqual([0, 0, 0, 0, 0, 20]);
  });
  it("累计 and 最近 come from the totals; null while they are not loaded", () => {
    const R = lay([], { totals: [{ id: "T0901-01", total_minutes: 600, last_date: "2026-09-30" }] });
    const a = R.rows.find((r) => r.task.id === "T0901-01")!, d = R.rows.find((r) => r.task.id === "T0920-01")!;
    expect([a.total, a.last]).toEqual([600, "2026-09-30"]);
    // a task missing from the totals (created after they loaded) reads as nothing yet, not as unknown
    expect([d.total, d.last]).toEqual([0, null]);
    const N = lay([session("x", "2026-09-30 10:00", "2026-09-30 10:30", { task_id: "T0920-01" })], { totals: null }).rows;
    expect(N.map((r) => [r.task.id, r.total, r.last])[0]).toEqual(["T0920-01", null, "2026-09-30"]);    // 最近 from the week alone
    expect([N[1].total, N[1].last]).toEqual([null, null]);
  });
  it("运行中 by the 此刻 rule; 最近 is today when a session of today is in the week", () => {
    const R = lay([session("r", "2026-10-02 13:00", "2026-10-02 14:15", { task_id: "T0920-01" })],
      { totals: [{ id: "T0920-01", total_minutes: 75, last_date: "2026-10-01" }] });
    const d = R.rows.find((r) => r.task.id === "T0920-01")!;
    expect(d.running).toBe(true);
    // the totals were fetched before today's session landed: the week's own data is newer
    expect(d.last).toBe("2026-10-02");
    expect(R.today).toBe("2026-10-02");
  });
  it("counts per status for the filter keys", () => {
    expect(lay([]).counts).toEqual({ open: 2, hold: 1, done: 1 });
  });
});
