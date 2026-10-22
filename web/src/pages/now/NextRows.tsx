import { useEffect } from "react";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { Prediction, Suggestion } from "../../predict/types";
import { useV2 } from "../../ui/context";
import { machineLabel } from "../../ui/machine";
import { Led } from "../../ui/Led";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { basisText, plain, suggestionSegs, taskCode, whenText } from "./format";
import { useTip } from "../../ui/TipHost";

/** 下一步 (spec §7.1): the mode on the heading, the 依据 line, up to three ranked suggestions. */
export function NextRows({ pred }: { pred: Prediction }) {
  const { lang } = useV2();
  const head = pred.mode ? `${t(lang, "now.next.title")} · ${t(lang, `mode.${pred.mode}` as StrKey)}` : t(lang, "now.next.title");
  const basis = basisText(lang, pred.basis);
  return (
    <>
      <div className="sec next-h">
        <Led ui size={12} tier={2} fit text={`${head} ${pred.suggestions.length}`} />
        <span className="basis"><Led ui tier={3} clip className="fill" text={basis} /></span>
      </div>
      {pred.suggestions.length === 0
        ? <div className="row next empty"><span className="nm"><Led ui tier={3} clip className="fill" text={t(lang, "now.next.empty")} /></span></div>
        : pred.suggestions.map((s, i) => <NextRow key={s.target} s={s} first={i === 0} basis={basis} />)}
    </>
  );
}

function NextRow({ s, first, basis }: { s: Suggestion; first: boolean; basis: string }) {
  const { lang } = useV2();
  // the row owns its tip: replaced by a refetch under a still mouse, it takes the tip with it
  const onTip = useTip();
  // A different suggestion on the same row after a refetch: drop the tip that describes the old one (sub3
  // review A). Keyed on what the suggestion is, not its numbers: "ended 43 minutes ago" moves every minute
  // with the board's clock, and that alone must not knock the tip away.
  const what = `${s.rule}|${s.target}|${s.textKey}|${s.whyKey}|${s.subject ?? ""}`;
  useEffect(() => { onTip(null); }, [what, onTip]);
  const segs = suggestionSegs(lang, s), why = t(lang, s.whyKey, s.vars), act = t(lang, `act.${s.action}` as StrKey);
  const k = s.taskId ?? undefined;
  const body = (
    <>
      <div className="h"><span>{plain(segs)}</span></div>
      <div className="s">{why}</div>
      <div className="m">{t(lang, "now.tip.rule", { id: s.rule })} · {basis}</div>
    </>
  );
  return (
    <div className="row next" data-task={k} data-rule={s.rule}
      onPointerMove={(e) => onTip({ x: e.clientX, y: e.clientY, body })} onPointerLeave={() => onTip(null)}>
      <Led ui tier={2} fit text={whenText(lang, s.when)} />
      {s.taskId ? <TaskBadge id={s.taskId} height={BADGE_H.row} /> : <Led tier={1} fit text={[{ t: taskCode(null), kind: "dim" }]} />}
      <span className="nm"><Led ui tier={1} clip className="fill" task={k} text={segs} /></span>
      <Led tier={2} fit className="mach" text={s.machine ? machineLabel(s.machine) : "--"} />
      <span className="end">
        <a className={`key${first ? " pri" : " dim"}`} href={s.href} aria-label={`${act} · ${plain(segs)}`}
          onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); onTip({ x: r.left, y: r.bottom, body }); }}
          onBlur={() => onTip(null)}>
          <Led ui tier={1} fit text={act} />
        </a>
      </span>
      <span className="v2-sr">{why}</span>
    </div>
  );
}
