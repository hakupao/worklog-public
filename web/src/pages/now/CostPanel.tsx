import { fmtMoney } from "../../i18n/format";
import { t } from "../../i18n/t";
import type { Snapshot } from "../../predict/snapshot";
import { hmOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { machineLabel, seenText } from "../../ui/machine";
import { costOf } from "./cost";

/** AI 费用: the heading row carries today's figure only (whole, never clipped); one line under it says what the figure
 *  counts and the week so far, each machine's share first (the line clips at its end) (user decision 9b + ruling: two lines, not four). */
export function CostPanel({ snap }: { snap: Snapshot }) {
  const { lang } = useV2();
  const c = costOf(snap);
  const asOf = c.asOf === null ? hmOf(snap.now) : seenText(c.asOf, snap.date);
  const split = c.byMachine.map((m) => `${machineLabel(m.name)} ${fmtMoney(m.usd, lang)}`).join(" · ");
  return (
    <section className="cost">
      <div className="sec"><Led ui size={12} tier={2} fit text={t(lang, "now.cost.title")} /><Led ui tier={3} fit className="sub" text={t(lang, "now.cost.sub")} /></div>
      <div className="cost-big">
        <Led size={12} tier={1} fit text={`${fmtMoney(c.today, lang)}${c.partial ? "*" : ""}`} />
      </div>
      <div className="cost-foot">
        <Led ui tier={3} clip className="fill"
          text={`${split ? `${split} · ` : ""}${t(lang, "now.cost.sessions", { n: c.n, t: asOf })} · ${t(lang, "now.cost.foot", { x: fmtMoney(c.week, lang) })}${c.partial ? ` · ${t(lang, "now.cost.partial")}` : ""}`} />
      </div>
    </section>
  );
}
