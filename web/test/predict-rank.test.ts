import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { RULE_IDS, type ModeCfg, type PredictPrefs, type RuleId } from "../src/prefs/types";
import { dayItem, dayPlan, J, machine, planItem, session, task, taskRef } from "../src/predict/fixtures";
import { predict } from "../src/predict/predict";
import { buildSnapshot, type SnapInput } from "../src/predict/snapshot";

const T = (s: string) => Date.parse(J(s));
/** Fri 14:20: an input on which every default rule finds something (nextweek.empty needs no carried item). */
function everything(withCarried = true): SnapInput {
  return {
    now: T("2026-10-02 14:20"), machines: [machine("macmini", "2026-10-02 14:00")],
    sessions: [
      session("Y", "2026-10-01 10:00", "2026-10-01 10:30"),                                        // unlinked yesterday + this week
      session("O", "2026-09-29 10:00", "2026-09-29 10:50"),                                        // unlinked, older: week.unlinked only
      session("S", "2026-10-02 12:00", "2026-10-02 12:50"),                                        // unlinked, ended 90 min ago
      session("A", "2026-10-02 09:00", "2026-10-02 10:00", { task_id: "T1" }),                     // touches D2's task today
      session("W", "2026-10-01 15:00", "2026-10-01 16:00", { task_id: "T3", summary: "先方の確認待ち" }),
    ],
    tasks: [task("T1", "a"), task("T2", "b"), task("T3", "c")],
    planItems: [
      planItem({ id: "P1", horizon: "daily", text: "daily" }),
      ...(withCarried ? [planItem({ id: "P2", horizon: "week", text: "carried", week: "2026-W39", stale: true })] : []),
    ],
    dayPlan: dayPlan("2026-10-02", [
      dayItem({ id: "D1", text: "untouched", tasks: [taskRef("T2")] }),
      dayItem({ id: "D2", text: "judged", tasks: [taskRef("T1")], ai_status: "partial" }),
    ]),
    downloads: [],
  };
}
const clone = (): PredictPrefs => structuredClone(DEFAULT_PREFS.predict);
/** Every rule runs regardless of the clock. */
function always(): PredictPrefs { const p = clone(); for (const r of RULE_IDS) p.rules[r].mode = "all"; return p; }
const only = (p: PredictPrefs, ids: RuleId[]) => { for (const r of RULE_IDS) p.rules[r].on = ids.includes(r); return p; };

describe("predict: ranking", () => {
  it("top 3 by weight × urgency; alerts are every alert-rule hit, ranked", () => {
    const r = predict(buildSnapshot(everything(), 10), always());
    // stale 90×1.5=135, yesterday 100×1, week 80×1 (urgency capped), untouched 70, unplaced 60, report 50, confirm 40, waiting 30, carried 20
    expect(r.suggestions.map((x) => x.rule)).toEqual(["unlinked.stale", "unlinked.yesterday", "week.unlinked"]);
    expect(r.alerts.map((x) => x.rule)).toEqual(["unlinked.stale", "unlinked.yesterday", "week.unlinked"]);
    expect(r.suggestions[0].score).toBeCloseTo(135);
  });
  it("equal scores keep the default rule order", () => {
    const p = only(always(), ["dayplan.untouched", "plan.unplaced"]);
    p.rules["plan.unplaced"].weight = 70;
    expect(predict(buildSnapshot(everything(), 10), p).suggestions.map((x) => x.rule)).toEqual(["dayplan.untouched", "plan.unplaced"]);
  });
  it("the same target keeps only its higher-scoring rule", () => {
    const input = { ...everything(), dayPlan: dayPlan("2026-10-02", [dayItem({ id: "D1", text: "x", tasks: [taskRef("T2")], ai_status: "partial" })]) };
    const p = only(always(), ["dayplan.untouched", "dayplan.confirm"]);
    expect(predict(buildSnapshot(input, 10), p).suggestions.map((x) => [x.rule, x.target])).toEqual([["dayplan.untouched", "day:D1"]]);
    p.rules["dayplan.confirm"].weight = 100;
    expect(predict(buildSnapshot(input, 10), p).suggestions.map((x) => [x.rule, x.target])).toEqual([["dayplan.confirm", "day:D1"]]);
  });
  it("all rules off: nothing to suggest, nothing alerting, the basis still reads", () => {
    const p = clone();
    for (const r of RULE_IDS) p.rules[r].on = false;
    const r = predict(buildSnapshot(everything(), 10), p);
    expect([r.suggestions, r.alerts]).toEqual([[], []]);
    expect(r.basis).toEqual({ hm: "14:20", running: 0, plan: { a: 0, b: 2 }, unlinked: 3 });   // Y, S (today) and O
    expect(r.mode).toBe("focus");
  });
  it("weight 0 still ranks, after everything else", () => {
    const p = only(always(), ["unlinked.stale", "plan.stale"]);
    p.rules["unlinked.stale"].weight = 0;
    expect(predict(buildSnapshot(everything(), 10), p).suggestions.map((x) => [x.rule, x.score])).toEqual([["plan.stale", 20], ["unlinked.stale", 0]]);
  });
  it("basis without a day plan", () => {
    expect(predict(buildSnapshot({ ...everything(), dayPlan: null }, 10), clone()).basis.plan).toBeNull();
  });
});

describe("predict: week.unlinked yields to unlinked.yesterday when it adds nothing (Task 15b fix B)", () => {
  const at = (sessions: SnapInput["sessions"]) => predict(buildSnapshot({
    now: T("2026-10-02 09:05"), machines: [], sessions, tasks: [], planItems: [], dayPlan: null, downloads: [],
  }, 10), DEFAULT_PREFS.predict);
  it("drops week.unlinked from suggestions and alerts when every session it counts is yesterday's", () => {
    const r = at([session("Y1", "2026-10-01 10:00", "2026-10-01 10:30"), session("Y2", "2026-10-01 11:00", "2026-10-01 11:20")]);
    expect(r.suggestions.map((x) => x.rule)).not.toContain("week.unlinked");
    expect(r.alerts.map((x) => x.rule)).toEqual(["unlinked.yesterday"]);
    expect(r.basis.unlinked).toBe(2);
  });
  it("keeps both when week.unlinked also counts older sessions", () => {
    const r = at([session("Y1", "2026-10-01 10:00", "2026-10-01 10:30"), session("O", "2026-09-29 10:00", "2026-09-29 10:20")]);
    expect(r.alerts.map((x) => [x.rule, x.vars.n])).toEqual([["unlinked.yesterday", 1], ["week.unlinked", 2]]);
  });
  it("a session under week.unlinked's minMinutes no longer triggers it (final review I-2)", () => {
    const r = at([session("Y1", "2026-10-01 10:00", "2026-10-01 10:03")]);
    expect(r.alerts).toEqual([]);
    expect(r.basis.unlinked).toBe(1);   // 依据 still counts it: a fact line
  });
  it("keeps week.unlinked when unlinked.yesterday does not hit (yesterday's total under its minimum, older ones over)", () => {
    const p = structuredClone(DEFAULT_PREFS.predict);
    p.rules["unlinked.yesterday"].params.minMinutes = 60;
    const r = predict(buildSnapshot({
      now: T("2026-10-02 09:05"), machines: [], sessions: [session("Y1", "2026-10-01 10:00", "2026-10-01 10:30"), session("O", "2026-09-29 10:00", "2026-09-29 10:20")],
      tasks: [], planItems: [], dayPlan: null, downloads: [],
    }, 10), p);
    expect(r.alerts.map((x) => [x.rule, x.vars.n])).toEqual([["week.unlinked", 2]]);
  });
  it("only sessions over week.unlinked's minimum keep it next to unlinked.yesterday", () => {
    const r = at([session("Y1", "2026-10-01 10:00", "2026-10-01 10:30"), session("O", "2026-09-29 10:00", "2026-09-29 10:03")]);
    expect(r.alerts.map((x) => x.rule)).toEqual(["unlinked.yesterday"]);
  });
});

describe("predict: by default a specific unlinked suggestion ranks before week.unlinked (final review, user ruling)", () => {
  it("yesterday + week both hit, week counting hours of older sessions: yesterday first", () => {
    const r = predict(buildSnapshot({
      now: T("2026-10-02 09:05"), machines: [], tasks: [], planItems: [], dayPlan: null, downloads: [],
      sessions: [
        session("Y1", "2026-10-01 10:00", "2026-10-01 10:05"),
        session("O1", "2026-09-29 09:00", "2026-09-29 13:00"), session("O2", "2026-09-24 09:00", "2026-09-24 13:00"),
      ],
    }, 10), DEFAULT_PREFS.predict);
    expect(r.suggestions.map((x) => [x.rule, x.score])).toEqual([["unlinked.yesterday", 100], ["week.unlinked", 80]]);
  });
  it("the default weights keep week.unlinked's maximum below both specific rules' minimum", () => {
    const R = DEFAULT_PREFS.predict.rules;
    expect(R["week.unlinked"].weight * 1).toBeLessThan(Math.min(R["unlinked.yesterday"].weight, R["unlinked.stale"].weight) * 1);
  });
});

describe("predict: every rule fires only inside its mode window (start inclusive, end exclusive)", () => {
  for (const id of RULE_IDS) {
    it(id, () => {
      const s = buildSnapshot(everything(id !== "nextweek.empty"), 10);
      const fires = (from: string, to: string) => {
        const p = only(clone(), [id]), m = p.rules[id].mode === "all" ? "focus" : p.rules[id].mode;
        p.rules[id].mode = m;
        p.modes[m] = { from, to, days: [5] } satisfies ModeCfg;
        return predict(s, p).suggestions.some((x) => x.rule === id);
      };
      expect(fires("14:20", "15:00")).toBe(true);
      expect(fires("14:21", "15:00")).toBe(false);
      expect(fires("13:00", "14:20")).toBe(false);
      expect(fires("13:00", "14:21")).toBe(true);
    });
  }
});
