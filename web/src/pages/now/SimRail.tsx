import { useEffect, useRef } from "react";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { SCENARIO_IDS, type ScenarioId } from "../../predict/scenarios";
import { useV2 } from "../../ui/context";
import { applyGlass } from "../../ui/glass";

/** The moment switcher: a narrow glass rail on the right edge (prototype world-now.html:199-201, 283-285). */
export function SimRail({ scenario, pick }: { scenario: ScenarioId | null; pick: (s: ScenarioId | null) => void }) {
  const { lang } = useV2();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { if (ref.current) applyGlass(ref.current); }, []);
  return (
    <nav ref={ref} className="simp lg2" data-edge="10" aria-label={t(lang, "sim.title")}>
      <span className="lbl">{t(lang, "sim.title")}</span>
      <button type="button" className={`dk${scenario === null ? " on" : ""}`} aria-pressed={scenario === null} onClick={() => pick(null)}>
        {`0 · ${t(lang, "sim.real")}`}
      </button>
      {SCENARIO_IDS.map((id, i) => (
        <button key={id} type="button" className={`dk${scenario === id ? " on" : ""}`} aria-pressed={scenario === id} onClick={() => pick(id)}>
          {`${i + 1} · ${t(lang, `sim.${id}` as StrKey)}`}
        </button>
      ))}
    </nav>
  );
}
