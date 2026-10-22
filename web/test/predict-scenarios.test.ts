import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import type { ModeId, RuleId } from "../src/prefs/types";
import { J, session } from "../src/predict/fixtures";
import { predict } from "../src/predict/predict";
import { collectedAt, SCENARIO_IDS, scenarioInput, type ScenarioId } from "../src/predict/scenarios";
import { buildSnapshot } from "../src/predict/snapshot";
import { hmOf } from "../src/predict/time";

const run = (id: ScenarioId) => {
  const s = buildSnapshot(scenarioInput(id), DEFAULT_PREFS.predict.runningMin);
  return { s, p: predict(s, DEFAULT_PREFS.predict) };
};
const EXPECT: Record<ScenarioId, { mode: ModeId; next: RuleId[]; alerts: RuleId[] }> = {
  morning: { mode: "morning", next: ["unlinked.yesterday", "plan.unplaced", "task.waiting"], alerts: ["unlinked.yesterday"] },
  // week.unlinked runs all day since the 2026-10-06 audit (Task 15b): at 14:20 it adds 10/1's sessions
  day: { mode: "focus", next: ["unlinked.stale", "week.unlinked", "dayplan.untouched"], alerts: ["unlinked.stale", "week.unlinked"] },
  weekly: { mode: "weekly", next: ["week.unlinked", "report.undownloaded", "plan.stale"], alerts: ["week.unlinked"] },
  wrap: { mode: "wrap", next: ["week.unlinked", "report.undownloaded", "dayplan.confirm"], alerts: ["week.unlinked"] },
};

describe("scenarios (the four moments of world-now.html, run through the real rules)", () => {
  for (const id of SCENARIO_IDS) {
    it(`${id}: mode, the three next steps and the alerts`, () => {
      const { p } = run(id);
      expect(p.mode).toBe(EXPECT[id].mode);
      expect(p.suggestions.map((x) => x.rule)).toEqual(EXPECT[id].next);
      expect(p.alerts.map((x) => x.rule)).toEqual(EXPECT[id].alerts);
    });
  }
  it("morning: both machines last collected yesterday, so nothing runs", () => {
    const { s } = run("morning");
    expect(s.machines.map((m) => [m.name, m.lastSeen, m.fresh])).toEqual([
      ["macmini", Date.parse(J("2026-10-01 20:00")), false], ["win11", Date.parse(J("2026-10-01 18:00")), false],
    ]);
    expect(s.running).toEqual([]);
    expect(s.dayPlan).toBeNull();
  });
  it("day: two sessions running as of the 14:00 collection; basis reads 2 running, plan 1/2, 3 unlinked", () => {
    const { s, p } = run("day");
    expect(s.running.map((r) => [r.session.id, hmOf(r.since), hmOf(r.until)])).toEqual([["S6", "13:40", "14:00"], ["S7", "13:50", "14:00"]]);
    expect(p.basis).toEqual({ hm: "14:20", running: 2, plan: { a: 1, b: 2 }, unlinked: 3 });
  });
});

describe("collectedAt", () => {
  it("cuts at the last whole hour; the machine's collection is the hour its last activity was picked up", () => {
    const c = collectedAt([
      session("A", "2026-10-02 13:07", "2026-10-02 13:37"),
      session("B", "2026-10-02 13:40", "2026-10-02 18:50", {}, 5),
      session("C", "2026-10-02 14:05", "2026-10-02 14:30", { machine: "win11" }),
    ], Date.parse(J("2026-10-02 14:20")));
    expect(c.sessions.map((x) => [x.id, x.ended_at])).toEqual([["A", J("2026-10-02 13:37")], ["B", J("2026-10-02 14:00")]]);
    expect(c.sessions[1].minutes_effective).toBe(20);
    expect(c.machines).toEqual([{ name: "macmini", last_seen_at: J("2026-10-02 14:00") }]);
  });
});
