import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribeHash } from "../../lib/hash";
import { SCENARIO_IDS, type ScenarioId } from "../../predict/scenarios";
import { isTypingTarget } from "../../ui/Shell";

/** localStorage.setItem("wl-v2-sim", "1") turns 情境模拟 on for this browser; removeItem turns it off. */
export const SIM_KEY = "wl-v2-sim";
const DIGITS = ["1", "2", "3", "4"];

/** The dev switch (assumption 15): `?sim=1` in the hash for this view, or the localStorage key. */
export function simEnabled(hash: string): boolean {
  const i = hash.indexOf("?");
  if (i >= 0 && new URLSearchParams(hash.slice(i + 1)).get("sim") === "1") return true;
  try { return localStorage.getItem(SIM_KEY) === "1"; } catch { return false; }
}

/** 情境模拟 (spec §3.2): keys 1–4 pick a moment, 0 returns to live data — only while the switch is on. */
export function useSim(): { on: boolean; scenario: ScenarioId | null; pick: (s: ScenarioId | null) => void } {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const on = simEnabled(hash);
  const [scenario, setScenario] = useState<ScenarioId | null>(null);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      const i = DIGITS.indexOf(e.key);
      if (i >= 0) setScenario(SCENARIO_IDS[i]);
      else if (e.key === "0") setScenario(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);
  return { on, scenario: on ? scenario : null, pick: setScenario };
}
