import { useEffect } from "react";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { Snapshot } from "../../predict/snapshot";
import type { Prediction } from "../../predict/types";
import { useV2 } from "../../ui/context";
import { Led, type LedSeg } from "../../ui/Led";
import { useTip } from "../../ui/TipHost";
import { useWorld } from "../../world/store";
import { plain, suggestionSegs, syncText } from "./format";

/** 运行情报 (spec §7.1): red only when an alert rule fired; otherwise the collection times, whole, on the heading's own row
 *  (user decision 9b: the right column's quiet sections give their second line to 今日安排). An alert folds onto that
 *  row too (user decision 2026-10-21: the alert's two extra lines left 今日安排 two rows at 929px): in 表 the title, how
 *  many, the first alert and its action; in 里 the first alert and its action only. The why (and in 里 the count) is
 *  the row's tip. The red lamp and the red text here are the one red place on
 *  the page. */
export function InfoPanel({ pred, snap }: { pred: Prediction; snap: Snapshot }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip();
  const a = pred.alerts[0];
  const why = a ? t(lang, a.whyKey, a.vars) : "";
  // 表's type fits the whole sentence; 里's pixel row holds a dozen glyphs, so there the alert itself comes first and the
  // title and the count move to the tip (user decision 2026-10-21)
  const ura = world !== "omote", n = pred.alerts.length;
  // a refetch or a world switch that changes the tip under a still mouse: drop the old tip (as 今日安排's rows do)
  const sig = `${why}|${n}|${ura}`;
  useEffect(() => { setTip(null); }, [sig, setTip]);
  if (!a) {
    return (
      <section className="info">
        <div className="sec">
          <Led ui size={12} tier={2} fit text={t(lang, "now.info.title")} />
          <Led key="ok" ui tier={1} fit text={syncText(lang, snap)} />
        </div>
      </section>
    );
  }
  const segs: LedSeg[] = [...(ura ? [] : [{ t: `${t(lang, "now.info.needs", { n })} · ` }]), { t: t(lang, "now.info.delay"), kind: "alert" },
    ...suggestionSegs(lang, a).map((x): LedSeg => ({ ...x, kind: "alert" }))];
  const head = `${t(lang, "now.info.title")} · ${t(lang, "now.info.needs", { n })}`, act = t(lang, `act.${a.action}` as StrKey);
  const tip = <>{ura && <div className="m">{head}</div>}<div className="s">{why}</div></>;
  return (
    <section className="info">
      <div className="sec" onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: tip })} onPointerLeave={() => setTip(null)}>
        {!ura && <Led ui size={12} tier={2} fit text={t(lang, "now.info.title")} />}
        <span className="lamp red" />
        <Led key="alert" ui size={12} tier={0} clip className="fill" text={segs} />
        <a className="key pri" href={a.href} aria-label={`${act} · ${plain(segs)}`}
          onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ x: r.left, y: r.bottom, body: tip }); }}
          onBlur={() => setTip(null)}>
          <Led ui tier={1} fit text={act} />
        </a>
        {/* the board shows only the alert; screen readers get what the tip carries (as 接下来's rows do) */}
        <span className="v2-sr">{ura ? `${head} · ${why}` : why}</span>
      </div>
    </section>
  );
}
