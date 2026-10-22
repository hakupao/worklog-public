import { RULE_IDS, type PredictPrefs } from "../prefs/types";
import { olderUnlinked, RULES, weekUnlinked, yesterdayUnlinked } from "./rules";
import type { Snapshot } from "./snapshot";
import { currentMode, hmOf, inWindow } from "./time";
import type { Prediction, Suggestion } from "./types";

export const MAX_NEXT = 3;
const rank = (x: Suggestion) => RULE_IDS.indexOf(x.rule);
/** Higher score first; equal scores keep the default rule order, then the target, so the board is stable. */
const cmp = (a: Suggestion, b: Suggestion) =>
  b.score - a.score || rank(a) - rank(b) || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0);

/** Snapshot → rules → suggestions → top 3 (spec §7.1). */
export function predict(s: Snapshot, cfg: PredictPrefs): Prediction {
  const all: Suggestion[] = [];
  for (const id of RULE_IDS) {
    const rc = cfg.rules[id];
    // assumption 10: a rule's 时间窗 is the window of the mode it belongs to (a deliberate reading of spec §7.3)
    if (!rc.on || (rc.mode !== "all" && !inWindow(s.now, cfg.modes[rc.mode]))) continue;
    for (const h of RULES[id].run(s, rc.params)) all.push({ ...h, rule: id, alert: RULES[id].alert, score: rc.weight * h.urgency });
  }
  // One slot, not two, for the same sessions: when week.unlinked counts nothing that unlinked.yesterday
  // does not already count, it says nothing new (Task 15b, controller ruling B).
  const has = (id: string) => all.some((x) => x.rule === id);
  const y = has("unlinked.yesterday") && has("week.unlinked") ? new Set(yesterdayUnlinked(s).map((x) => x.id)) : null;
  const hits = y && olderUnlinked(s, cfg.rules["week.unlinked"].params.minMinutes ?? 5).every((x) => y.has(x.id)) ? all.filter((x) => x.rule !== "week.unlinked") : all;
  const best = new Map<string, Suggestion>();
  for (const x of hits) {
    const b = best.get(x.target);
    if (!b || cmp(x, b) < 0) best.set(x.target, x);
  }
  const ranked = [...best.values()].sort(cmp);
  const dp = s.dayPlan;
  return {
    mode: currentMode(s.now, cfg.modes),
    suggestions: ranked.slice(0, MAX_NEXT),
    alerts: ranked.filter((x) => x.alert),
    basis: {
      hm: hmOf(s.now), running: s.running.length,
      plan: dp ? { a: dp.items.filter((i) => i.final_status === "done").length, b: dp.items.length } : null,
      unlinked: weekUnlinked(s).length,
    },
  };
}
