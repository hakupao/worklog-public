import type { CSSProperties } from "react";
import type { Session, Task } from "../../api/types";
import { fmtMoney } from "../../i18n/format";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { hmOf, mdOf } from "../../predict/time";
import { machineLabel } from "../../ui/machine";
import { lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { taskCode } from "../now/format";
import { linkedTask } from "./rows";

/** The glass tip for a session, from a band dot or a row: task (or 未关联), when, where, how long, cost, summary. */
export function SessionTip({ s, date, tasks, lang, live, from, to }: {
  s: Session; date: string; tasks: Record<string, Task>; lang: Lang; live: boolean; from?: number; to?: number;
}) {
  const k = linkedTask(s, tasks), task = k ? tasks[k] : undefined;
  const a = from ?? Date.parse(s.started_at), b = to ?? Date.parse(s.ended_at);
  const cost = s.tokens?.cost_usd ?? null;
  return (
    <>
      <div className="h">
        {k && <><TaskBadge id={k} height={BADGE_H.tip} /><span className="code" style={{ "--lc": lineColor(k) } as CSSProperties}>{taskCode(k)}</span></>}
        {task ? <span>{task.title}</span> : <span className="un">{t(lang, "tl.unlinked")}</span>}
      </div>
      <div className="m">
        {mdOf(date)} {hmOf(a)}–{hmOf(b)} · {machineLabel(s.machine)} · {t(lang, "now.tip.min", { n: s.minutes_on_day ?? s.minutes_effective })}
        {live ? ` · ${t(lang, "now.tip.live")}` : ""}
        {cost !== null ? ` · ${fmtMoney(cost, lang)}` : ""}
      </div>
      {s.summary_effective && <div className="s">{s.summary_effective}</div>}
    </>
  );
}
