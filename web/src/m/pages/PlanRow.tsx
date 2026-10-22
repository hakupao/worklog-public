import type { DayPlanItem } from "../../api/types";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { BADGE_H, TaskBadges } from "../../ui/TaskBadge";

const MARK: Record<DayPlanItem["final_status"], string> = { done: "[x]", partial: "[~]", none: "[ ]" };

/** One day-plan item: its status mark [x] / [~] / [ ] (a button when `onToggle` is given) and its text (a button when `onOpen` is
 *  given). The sub-line is the goal (`detail`) if any, else the model's note on it. */
export function PlanRow({ item, onToggle, onOpen }: { item: DayPlanItem; onToggle?: () => void; onOpen?: () => void }) {
  const { lang } = useV2();
  const st = item.final_status;
  const box = <span className={`m-x ${st}`} aria-hidden="true">{MARK[st]}</span>;
  const ai = item.manual_status === null && item.ai_status !== null && item.ai_status !== "none";
  const sub = item.detail ? t(lang, "m.plan.goal", { t: item.detail }) : item.ai_note ?? item.ai_progress ?? "";
  const text = <><span className={`m-t1${ai ? " m-t1-ai" : ""}`}>{ai ? <span className="m-tt">{item.text}</span> : item.text}{ai && <span className="m-ai">{t(lang, "m.plan.aiTag")}</span>}</span>{sub && <span className="m-t2">{sub}</span>}</>;
  return (
    <div className="m-row">
      {onToggle
        ? <button type="button" className="m-status" aria-label={t(lang, "m.plan.toggle")} aria-pressed={st === "done"} onClick={onToggle}>{box}</button>
        : <span className="m-status">{box}</span>}
      {item.tasks.length > 0 && <TaskBadges ids={item.tasks.map((r) => r.id)} height={BADGE_H.mRow} />}
      {onOpen ? <button type="button" className="m-col m-open" onClick={onOpen}>{text}</button> : <span className="m-col">{text}</span>}
    </div>
  );
}
