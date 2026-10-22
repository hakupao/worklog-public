import { useMemo } from "react";
import { t } from "../i18n/t";
import { makeCalendar } from "../cal/calendar";
import { predict } from "../predict/predict";
import { buildSnapshot, type Snapshot } from "../predict/snapshot";
import { scenarioInput } from "../predict/scenarios";
import type { Prediction } from "../predict/types";
import { useV2 } from "../ui/context";
import { Led } from "../ui/Led";
import { Mod } from "../ui/Mod";
import { TipHost } from "../ui/TipHost";
import { isModuleHidden } from "../world/modules";
import { useWorld } from "../world/store";
import { CostPanel } from "./now/CostPanel";
import { InfoPanel } from "./now/InfoPanel";
import { NextRows } from "./now/NextRows";
import { PlanRows } from "./now/PlanRows";
import { RunChart } from "./now/RunChart";
import { RunRows } from "./now/RunRows";
import { ScenePlate } from "./now/ScenePlate";
import { SimRail } from "./now/SimRail";
import { useSim } from "./now/sim";
import { TimeStrip } from "./now/TimeStrip";
import { useNowData } from "./now/useNowData";

const LEFT = ["now.scene", "now.dia"], RIGHT = ["now.run", "now.next", "now.plan", "now.info", "now.cost"];

/** 此刻 (relayout spec §2.1, layout C3a): the home board. Left: the scene plate over today's run chart; right: running,
 *  next, today's plan, status, AI cost; below, across the page: the title block (countdowns, month, date). */
export function NowPage() {
  const { prefs, lang } = useV2();
  const live = useNowData();
  const sim = useSim();
  const simInput = useMemo(() => (sim.scenario ? scenarioInput(sim.scenario) : null), [sim.scenario]);
  const input = simInput ?? live.input;
  const isOff = useMemo(() => makeCalendar(prefs.cal).isOff, [prefs.cal]);
  const snap = useMemo(() => (input ? buildSnapshot(input, prefs.predict.runningMin, isOff) : null), [input, prefs.predict.runningMin, isOff]);
  const pred = useMemo(() => (snap ? predict(snap, prefs.predict) : null), [snap, prefs.predict]);
  // One TipHost for the whole page (one persistent tooltip); the loading line and the board swap inside it.
  return (
    <TipHost>
      {snap && pred
        ? <NowBoard snap={snap} pred={pred} />
        : <section className="now now-wait"><Led ui tier={2} fit text={t(lang, live.error ? "now.error" : "now.loading")} /></section>}
      {sim.on && <SimRail scenario={sim.scenario} pick={sim.pick} />}
    </TipHost>
  );
}

function NowBoard({ snap, pred }: { snap: Snapshot; pred: Prediction }) {
  const { prefs } = useV2(), world = useWorld();
  const hidden = (id: string) => isModuleHidden(id, prefs.omote.hide, world);
  const leftGone = LEFT.every(hidden), rightGone = RIGHT.every(hidden);
  const depGone = ["now.run", "now.next", "now.plan"].every(hidden);
  return (
    <div className="now">
      {!(leftGone && rightGone) && (
        <div className={`now-top${leftGone || rightGone ? " solo" : ""}`}>
          {!leftGone && (
            <div className="now-left">
              <Mod id="now.scene"><ScenePlate now={snap.now} alert={pred.alerts.length > 0} /></Mod>
              <Mod id="now.dia"><RunChart snap={snap} /></Mod>
            </div>
          )}
          {!leftGone && !rightGone && <span className="vr" />}
          {!rightGone && (
            <aside className="side">
              {!depGone && (
                <section className="dep">
                  <Mod id="now.run"><RunRows snap={snap} /></Mod>
                  <Mod id="now.next"><NextRows pred={pred} /></Mod>
                  <Mod id="now.plan"><PlanRows snap={snap} /></Mod>
                </section>
              )}
              <Mod id="now.info"><InfoPanel pred={pred} snap={snap} /></Mod>
              <Mod id="now.cost"><CostPanel snap={snap} /></Mod>
            </aside>
          )}
        </div>
      )}
      <Mod id="now.time"><TimeStrip now={snap.now} /></Mod>
    </div>
  );
}
