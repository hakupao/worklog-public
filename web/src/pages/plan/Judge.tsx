import { useEffect, useState } from "react";
import type { DayPlan } from "../../api/types";
import { useCanvas } from "../../chart/useCanvas";
import { loadPixelFont } from "../../led/fonts";
import { glyphOf, t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { machineLabel, seenText } from "../../ui/machine";
import { C } from "../../ui/palette";
import { useWorld } from "../../world/store";
import { drawHistOmote, drawHistUra, histWidth } from "./hist";
import { dowShort } from "./codes";
import { doneShare } from "./layout";

/** AI 对账 (prototype page-plan.html fillJudge / drawHist): the chosen day's done / items in big digits, when and
 *  where it was last judged, and the week's bars (Monday–Friday of the chosen day's week; user ruling U1). */
export function Judge({ plan, failed, days, plans, date }: {
  plan: DayPlan | null | undefined;
  /** The day failed to load: say so, not "not checked yet" (preflight R9). */
  failed: boolean;
  days: string[]; plans: (DayPlan | null | undefined)[]; date: string;
}) {
  const { lang } = useV2();
  const done = plan ? plan.items.filter((i) => i.final_status === "done").length : 0;
  const all = plan ? plan.items.length > 0 && done === plan.items.length : false;
  const judged = plan?.judged_at ? Date.parse(plan.judged_at) : null;
  const vals = doneShare(plans);
  const sr = days.map((d, i) => `${mdOf(d)} ${plans[i] ? `${plans[i]!.items.filter((x) => x.final_status === "done").length}/${plans[i]!.items.length}` : "--"}`).join(", ");
  return (
    <>
      <div className="sec">
        <Led ui tier={1} fit text={t(lang, "pl.j.title")} />
        <span className="nm"><Led ui tier={2} clip className="fill" text={t(lang, "pl.j.sub")} /></span>
      </div>
      <div className="big">
        <Led size={8} scale={2} tier={0} fit color={all ? C.GREEN : C.AMBER} text={plan ? `${done}/${plan.items.length}` : "--/--"} />
        <Led ui tier={1} fit color={all ? C.GREEN : C.AMBER} text={plan ? t(lang, "pl.j.done") : ""} />
      </div>
      <div className="jline">
        <span className={`lamp${judged === null ? " dim" : " live"}`} />
        <span className="nm"><Led ui tier={2} clip className="fill"
          text={plan === undefined ? t(lang, failed ? "now.error" : "now.loading")
            : judged === null ? t(lang, "pl.j.never") : t(lang, "pl.j.when", { t: seenText(judged, date), m: machineLabel(plan?.judge_machine ?? "") })} /></span>
      </div>
      <div className="hist">
        <Led ui tier={1} fit text={t(lang, "pl.j.hist")} />
        <Hist vals={vals} labels={days.map((d) => dowShort(lang, d))} today={days.indexOf(date)} />
        <span className="v2-sr">{sr}</span>
      </div>
    </>
  );
}

function Hist({ vals, labels, today }: { vals: number[]; labels: string[]; today: number }) {
  const { lang } = useV2(), world = useWorld(), glyph = glyphOf(lang);
  // the dot-glyph labels need the pixel font: redraw once it has loaded (WeekChart's fontTick)
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => { let live = true; void loadPixelFont(10, glyph).then(() => { if (live) setFontTick((n) => n + 1); }); return () => { live = false; }; }, [glyph]);
  const ref = useCanvas((x, w, h, offX, offY) => {
    if (world === "omote") drawHistOmote(x, vals, labels, today, { w, h }, (wt) => `${wt} 11px ${getComputedStyle(document.body).fontFamily}`);
    else drawHistUra(x, vals, labels, today, { w, h, offX, offY }, glyph);
  }, [vals.join(","), labels.join(","), today, world, glyph, fontTick]);
  return <canvas ref={ref} className="hist-cv" aria-hidden="true" style={{ width: `${histWidth()}px`, height: "93px" }} />;
}
