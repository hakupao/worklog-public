import { describe, expect, it } from "vitest";
import type { ReportDownload } from "../src/api/types";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import type { RuleId, RuleParams } from "../src/prefs/types";
import { dayItem, dayPlan, J, machine, planItem, session, task, taskRef } from "../src/predict/fixtures";
import { predict } from "../src/predict/predict";
import { RULES } from "../src/predict/rules";
import { buildSnapshot, type SnapInput, type Snapshot } from "../src/predict/snapshot";

const T = (s: string) => Date.parse(J(s));
const P = DEFAULT_PREFS.predict.rules;
const snap = (now: string, o: Partial<SnapInput> = {}) =>
  buildSnapshot({ now: T(now), machines: [], sessions: [], tasks: [], planItems: [], dayPlan: null, downloads: [], ...o }, 10);
const run = (id: RuleId, s: Snapshot, params: RuleParams = P[id].params) => RULES[id].run(s, params);

describe("unlinked.yesterday", () => {
  const y = [session("A", "2026-10-01 19:10", "2026-10-01 19:30"), session("B", "2026-10-01 19:30", "2026-10-01 19:57")];
  it("hit: the last workday's unlinked sessions, counted and summed", () => {
    expect(run("unlinked.yesterday", snap("2026-10-02 09:05", { sessions: y }))).toEqual([expect.objectContaining({
      target: "unlinked:2026-10-01", action: "link", href: "#/v2/timeline?unlinked=1", when: { kind: "label", key: "yesterday" },
      machine: "macmini", vars: { n: 2, m: 47, day: "10/1" }, urgency: 1,
    })]);
  });
  it("Monday reads Friday and shows it by date", () => {
    const [h] = run("unlinked.yesterday", snap("2026-10-05 09:05", { sessions: [session("F", "2026-10-02 18:00", "2026-10-02 18:30")] }));
    expect(h.when).toEqual({ kind: "date", md: "10/2" });
  });
  it("miss: under minMinutes, or linked", () => {
    const s = snap("2026-10-02 09:05", {
      sessions: [session("A", "2026-10-01 10:00", "2026-10-01 10:04"), session("L", "2026-10-01 11:00", "2026-10-01 12:00", { task_id: "T1" })],
      tasks: [task("T1", "x")],
    });
    expect(run("unlinked.yesterday", s)).toEqual([]);
    expect(run("unlinked.yesterday", s, { minMinutes: 0 })).toHaveLength(1);
  });
  it("counts only the share on that day for a cross-midnight session", () => {
    const s = snap("2026-10-02 09:05", { sessions: [session("X", "2026-10-01 23:30", "2026-10-02 00:20")] });
    expect(run("unlinked.yesterday", s)[0].vars.m).toBe(30);
    expect(run("unlinked.yesterday", s, { minMinutes: 31 })).toEqual([]);
  });
  it("final review M-3: a session still running (since yesterday) is not counted", () => {
    const s = snap("2026-10-02 09:05", {
      machines: [machine("macmini", "2026-10-02 09:00")], sessions: [session("R", "2026-10-01 23:00", "2026-10-02 09:00")],
    });
    expect(s.running.map((r) => r.session.id)).toEqual(["R"]);
    expect(run("unlinked.yesterday", s, { minMinutes: 0 })).toEqual([]);
  });
});

describe("unlinked.stale", () => {
  it("hit: ended at least `minutes` ago today and still unlinked", () => {
    const [h] = run("unlinked.stale", snap("2026-10-02 14:20", {
      machines: [machine("macmini", "2026-10-02 14:00")], sessions: [session("S", "2026-10-02 13:07", "2026-10-02 13:37")],
    }));
    expect(h).toMatchObject({ target: "session:S", when: { kind: "time", hm: "13:07" }, vars: { from: "13:07", to: "13:37", m: 43 }, urgency: 1 });
  });
  it("miss: still running, too recent, or not today", () => {
    expect(run("unlinked.stale", snap("2026-10-02 14:40", {
      machines: [machine("macmini", "2026-10-02 14:00")], sessions: [session("R", "2026-10-02 13:00", "2026-10-02 13:52")],
    }))).toEqual([]);
    expect(run("unlinked.stale", snap("2026-10-02 14:00", { sessions: [session("N", "2026-10-02 13:40", "2026-10-02 13:45")] }))).toEqual([]);
    expect(run("unlinked.stale", snap("2026-10-02 14:20", { sessions: [session("Y", "2026-10-01 13:00", "2026-10-01 13:30")] }))).toEqual([]);
  });
  it("audit fix: a session under minMinutes today is ignored", () => {
    const s = snap("2026-10-02 14:20", { sessions: [session("S", "2026-10-02 13:00", "2026-10-02 13:04")] });
    expect(P["unlinked.stale"].params.minMinutes).toBe(5);
    expect(run("unlinked.stale", s)).toEqual([]);
    expect(run("unlinked.stale", s, { minutes: 30, minMinutes: 0 })).toHaveLength(1);
  });
  it("minMinutes counts only today's share of a cross-midnight session", () => {
    const s = snap("2026-10-02 01:00", { sessions: [session("X", "2026-10-01 23:30", "2026-10-02 00:20")] });
    expect(run("unlinked.stale", s, { minutes: 30, minMinutes: 20 })).toHaveLength(1);
    expect(run("unlinked.stale", s, { minutes: 30, minMinutes: 21 })).toEqual([]);
  });
  it("a session that crossed midnight is today's too", () => {
    expect(run("unlinked.stale", snap("2026-10-02 01:00", { sessions: [session("X", "2026-10-01 23:30", "2026-10-02 00:20")] }))[0].vars.m).toBe(40);
  });
});

describe("week.unlinked", () => {
  it("hit: every unlinked session of the snapshot's two weeks (this + last ISO week), nothing older", () => {
    const [h] = run("week.unlinked", snap("2026-10-02 16:30", { sessions: [
      session("M", "2026-09-28 10:00", "2026-09-28 10:30"), session("T", "2026-10-01 19:10", "2026-10-01 19:57"),
      session("P", "2026-09-25 10:00", "2026-09-25 11:00"), session("O", "2026-09-18 10:00", "2026-09-18 11:00"),
    ] }));
    expect(h).toMatchObject({ target: "unlinked:2026-W40", when: { kind: "label", key: "lastweek" }, vars: { n: 3, m: 137 } });
    expect(h.urgency).toBe(1);   // capped (final review): 137 min would be 137/60 elsewhere
  });
  it("labels the chip 本周 when every session is from this week", () => {
    const [h] = run("week.unlinked", snap("2026-10-02 16:30", { sessions: [session("T", "2026-10-01 19:10", "2026-10-01 19:57")] }));
    expect(h).toMatchObject({ target: "unlinked:2026-W40", when: { kind: "label", key: "week" }, vars: { n: 1, m: 47 } });
  });
  it("fix A: today's sessions are unlinked.stale's job, not week.unlinked's (a cross-midnight one included)", () => {
    const s = snap("2026-10-02 16:30", { sessions: [
      session("D", "2026-10-02 10:00", "2026-10-02 11:00"), session("X", "2026-10-01 23:30", "2026-10-02 00:20"),
      session("T", "2026-10-01 19:10", "2026-10-01 19:57"),
    ] });
    expect(run("week.unlinked", s)).toEqual([expect.objectContaining({ vars: { n: 1, m: 47 } })]);
    expect(run("week.unlinked", snap("2026-10-02 16:30", { sessions: [session("D", "2026-10-02 10:00", "2026-10-02 11:00")] }))).toEqual([]);
  });
  it("final review I-2: minMinutes applies per session (its minutes in the two weeks); default 5", () => {
    const s = snap("2026-10-02 16:30", { sessions: [
      session("S", "2026-09-29 10:00", "2026-09-29 10:03"), session("L", "2026-09-30 10:00", "2026-09-30 10:30"),
    ] });
    expect(P["week.unlinked"].params.minMinutes).toBe(5);
    expect(run("week.unlinked", s)).toEqual([expect.objectContaining({ vars: { n: 1, m: 30 } })]);
    expect(run("week.unlinked", s, { minMinutes: 0 })).toEqual([expect.objectContaining({ vars: { n: 2, m: 33 } })]);
    expect(run("week.unlinked", s, { minMinutes: 31 })).toEqual([]);
  });
  it("final review: urgency is capped at 1, so its score never exceeds its weight", () => {
    const [h] = run("week.unlinked", snap("2026-10-02 16:30", { sessions: [session("L", "2026-09-29 09:00", "2026-09-29 15:00")] }));
    expect(h.vars.m).toBe(360);
    expect(h.urgency).toBe(1);
  });
  it("miss: a session still running is not counted", () => {
    expect(run("week.unlinked", snap("2026-10-02 16:30", {
      machines: [machine("macmini", "2026-10-02 16:00")], sessions: [session("R", "2026-10-02 15:00", "2026-10-02 16:00")],
    }))).toEqual([]);
  });
  it("audit fix: on Monday, last week's leftovers still count", () => {
    const [h] = run("week.unlinked", snap("2026-10-05 09:00", { sessions: [session("P", "2026-10-02 10:00", "2026-10-02 11:00")] }));
    expect(h).toMatchObject({ target: "unlinked:2026-W41", when: { kind: "label", key: "lastweek" }, vars: { n: 1, m: 60 } });
  });
  it("audit fix: with the default prefs, a session from two workdays ago is an alert on Thursday 14:20, and 依据 agrees", () => {
    const s = snap("2026-10-01 14:20", { sessions: [session("A", "2026-09-29 14:00", "2026-09-29 15:25")] });
    const p = predict(s, DEFAULT_PREFS.predict);
    expect(p.alerts.map((x) => x.rule)).toEqual(["week.unlinked"]);
    expect(p.alerts[0].vars).toEqual({ n: 1, m: 85 });
    expect(p.basis.unlinked).toBe(1);
  });
});

describe("dayplan.untouched", () => {
  it("hit: a not-done item with tasks that no session touched today", () => {
    const s = snap("2026-10-02 14:20", {
      tasks: [task("T1", "a"), task("T2", "b")],
      sessions: [session("A", "2026-10-02 10:00", "2026-10-02 11:00", { task_id: "T1" }), session("B", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "T2" })],
      dayPlan: dayPlan("2026-10-02", [
        dayItem({ id: "D1", text: "one", tasks: [taskRef("T1")] }), dayItem({ id: "D2", text: "two", tasks: [taskRef("T2")] }),
        dayItem({ id: "D3", text: "free" }), dayItem({ id: "D4", text: "done", tasks: [taskRef("T2")], manual_status: "done" }),
      ]),
    });
    expect(run("dayplan.untouched", s).map((h) => [h.target, h.subject, h.vars, h.taskId])).toEqual([["day:D2", "two", { a: 1, b: 4 }, "T2"]]);
  });
  it("miss: the day has not been started", () => {
    expect(run("dayplan.untouched", snap("2026-10-02 14:20"))).toEqual([]);
  });
});

describe("plan.unplaced", () => {
  const items = [
    planItem({ id: "P0", horizon: "daily", text: "every day" }),
    planItem({ id: "P1", horizon: "daily", text: "until the 9th", until_date: "2026-10-09" }),
    planItem({ id: "P2", horizon: "week", text: "this week", week: "2026-W40" }),
    planItem({ id: "P3", horizon: "week", text: "carried", week: "2026-W39", stale: true }),
    planItem({ id: "P4", horizon: "daily", text: "ended", effective: false }),
    planItem({ id: "P5", horizon: "near", text: "near" }),
  ];
  it("before the day starts: daily items in effect and this week's items", () => {
    const hits = run("plan.unplaced", snap("2026-10-02 09:05", { planItems: items }));
    expect(hits.map((h) => [h.target, h.whyKey, h.subject])).toEqual([
      ["plan:P0", "rule.plan.unplaced.why.daily", "every day"],
      ["plan:P1", "rule.plan.unplaced.why.dailyDue", "until the 9th"],
      ["plan:P2", "rule.plan.unplaced.why.week", "this week"],
    ]);
    expect(hits[1].urgency).toBeCloseTo(1 + 1 / 8);
    expect(hits[1].vars.due).toBe("10/9");
  });
  it("an item already in today's plan is left out", () => {
    const s = snap("2026-10-02 09:05", { planItems: items.slice(0, 1), dayPlan: dayPlan("2026-10-02", [dayItem({ id: "D1", text: "every day", plan_item_id: "P0" })]) });
    expect(run("plan.unplaced", s)).toEqual([]);
  });
});

describe("report.undownloaded", () => {
  const dl = (week: string): ReportDownload[] => [{ week, template: "agency", at: J("2026-10-02 10:00") }];
  it("hit until this week's report has been downloaded", () => {
    expect(run("report.undownloaded", snap("2026-10-02 16:30", { downloads: dl("2026-W39") }))).toEqual([expect.objectContaining({
      target: "report:2026-W40", action: "report", href: "#/v2/report/2026-W40", vars: { week: "W40" },
    })]);
    expect(run("report.undownloaded", snap("2026-10-02 16:30", { downloads: dl("2026-W40") }))).toEqual([]);
  });
  it("follows the Sat→Fri report week: on Saturday 10/3 the report due is W41, while s.week stays ISO W40", () => {
    const s = snap("2026-10-03 10:00", { downloads: dl("2026-W40") });
    expect(s).toMatchObject({ week: "2026-W40", reportWeek: "2026-W41" });
    expect(run("report.undownloaded", s)).toEqual([expect.objectContaining({
      target: "report:2026-W41", href: "#/v2/report/2026-W41", vars: { week: "W41" },
    })]);
    expect(run("report.undownloaded", snap("2026-10-03 10:00", { downloads: dl("2026-W41") }))).toEqual([]);
    // before 05:00 Saturday is still Friday's day: W40's report
    expect(run("report.undownloaded", snap("2026-10-03 04:30", { downloads: dl("2026-W40") }))).toEqual([]);
  });
});

describe("dayplan.confirm", () => {
  it("hit: judged by the AI, not confirmed by hand", () => {
    const s = snap("2026-10-02 18:45", { dayPlan: dayPlan("2026-10-02", [
      dayItem({ id: "D1", text: "a", ai_status: "partial" }), dayItem({ id: "D2", text: "b", ai_status: "done", manual_status: "done" }),
      dayItem({ id: "D3", text: "c" }),
    ]) });
    expect(run("dayplan.confirm", s).map((h) => [h.target, h.whyKey, h.subject])).toEqual([["day:D1", "rule.dayplan.confirm.why.partial", "a"]]);
  });
});

describe("task.waiting", () => {
  const t1 = [task("T1", "ORION-B")];
  const wait = (id: string, from: string, to: string) => session(id, from, to, { task_id: "T1", summary: "waiting for review" });
  it("hit: the task's latest session mentions a waiting keyword", () => {
    const [h] = run("task.waiting", snap("2026-10-02 09:05", { tasks: t1, sessions: [
      session("A", "2026-09-30 10:00", "2026-09-30 11:00", { task_id: "T1", summary: "作業中" }),
      session("B", "2026-10-01 16:00", "2026-10-01 17:10", { task_id: "T1", summary: "Sam さんの確認待ち" }),
    ] }));
    expect(h).toMatchObject({ target: "task:T1", action: "reply", href: "#/v2/tasks/T1", when: { kind: "label", key: "yesterday" },
      vars: { kw: "確認待ち", day: "10/1" }, subject: "ORION-B", machine: "macmini" });
  });
  it("matches keywords case-insensitively", () => {
    expect(run("task.waiting", snap("2026-10-02 09:05", { tasks: t1, sessions: [
      session("A", "2026-10-01 10:00", "2026-10-01 11:00", { task_id: "T1", summary: "Waiting on QA" }),
    ] }))[0].vars.kw).toBe("waiting");
  });
  it("miss: a later session moved on, the task is done, it is running, or it is older than `days`", () => {
    expect(run("task.waiting", snap("2026-10-02 09:05", { tasks: t1, sessions: [
      wait("A", "2026-10-01 10:00", "2026-10-01 11:00"), session("B", "2026-10-01 15:00", "2026-10-01 16:00", { task_id: "T1", summary: "再開" }),
    ] }))).toEqual([]);
    expect(run("task.waiting", snap("2026-10-02 09:05", { tasks: [task("T1", "x", "done")], sessions: [wait("A", "2026-10-01 10:00", "2026-10-01 11:00")] }))).toEqual([]);
    expect(run("task.waiting", snap("2026-10-02 11:10", { tasks: t1, machines: [machine("macmini", "2026-10-02 11:00")],
      sessions: [wait("A", "2026-10-02 10:00", "2026-10-02 11:00")] }))).toEqual([]);
    const old = snap("2026-10-02 09:05", { tasks: t1, sessions: [wait("A", "2026-09-28 10:00", "2026-09-28 11:00")] });
    expect(run("task.waiting", old)).toEqual([]);
    expect(run("task.waiting", old, { ...P["task.waiting"].params, days: 7 })).toHaveLength(1);
  });
});

describe("plan.stale", () => {
  it("hit for each carried-over week item", () => {
    const s = snap("2026-10-02 14:20", { planItems: [
      planItem({ id: "P1", horizon: "week", text: "LEDGER", week: "2026-W39", stale: true }), planItem({ id: "P2", horizon: "week", text: "now", week: "2026-W40" }),
    ] });
    expect(run("plan.stale", s).map((h) => [h.target, h.when, h.vars, h.action])).toEqual([["plan:P1", { kind: "label", key: "lastweek" }, { week: "2026-W39" }, "schedule"]]);
  });
});

describe("the plan rules open the v2 计划 page (sub-project 5)", () => {
  it("a 今日安排 item's drawer for 开始 / 确认, a plan item's for 加入安排, the board for 排进今日 / 排下周", () => {
    const s = snap("2026-10-02 14:20", {
      tasks: [task("T1", "a")],
      planItems: [planItem({ id: "P1", horizon: "daily", text: "d" }), planItem({ id: "P 2", horizon: "week", text: "w", week: "2026-W39", stale: true })],
      dayPlan: dayPlan("2026-10-02", [dayItem({ id: "D1", text: "x", tasks: [taskRef("T1")], ai_status: "partial" })]),
    });
    expect(run("dayplan.untouched", s).map((h) => h.href)).toEqual(["#/v2/plan?day=D1"]);
    expect(run("dayplan.confirm", s).map((h) => h.href)).toEqual(["#/v2/plan?day=D1"]);
    expect(run("plan.stale", s).map((h) => h.href)).toEqual(["#/v2/plan?item=P%202"]);
    expect(run("plan.unplaced", s).map((h) => h.href)).toEqual(["#/v2/plan"]);
    expect(run("nextweek.empty", snap("2026-10-02 16:30")).map((h) => h.href)).toEqual(["#/v2/plan"]);
  });
});

describe("nextweek.empty (assumption 6)", () => {
  it("hit only when no week or near item is active, carried-over ones included", () => {
    expect(run("nextweek.empty", snap("2026-10-02 16:30"))).toEqual([expect.objectContaining({ target: "nextweek:2026-W41", action: "nextweek" })]);
    expect(run("nextweek.empty", snap("2026-10-02 16:30", { planItems: [planItem({ id: "P", horizon: "week", text: "old", week: "2026-W39", stale: true })] }))).toEqual([]);
    expect(run("nextweek.empty", snap("2026-10-02 16:30", { planItems: [planItem({ id: "P", horizon: "week", text: "x", status: "done" })] }))).toHaveLength(1);
  });
  it("audit fix: an active near item is a plan too", () => {
    expect(run("nextweek.empty", snap("2026-10-02 16:30", { planItems: [planItem({ id: "N", horizon: "near", text: "x" })] }))).toEqual([]);
    expect(run("nextweek.empty", snap("2026-10-02 16:30", { planItems: [planItem({ id: "N", horizon: "near", text: "x", status: "done" })] }))).toHaveLength(1);
    expect(run("nextweek.empty", snap("2026-10-02 16:30", { planItems: [planItem({ id: "F", horizon: "far", text: "x" })] }))).toHaveLength(1);
  });
});
