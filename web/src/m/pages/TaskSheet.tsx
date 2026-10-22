import { useTask } from "../../api/queries";
import { jstDateOf } from "../../lib/jst";
import { fmtHm } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { hours1 } from "../format";
import { Sheet } from "../ui/Sheet";
import { ErrorState, Loading } from "../ui/State";

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** A 案件, read-only: requester, status, total, the ten latest sessions, its deliverables (hand-picked + accepted automatic). */
export function TaskSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { lang } = useV2();
  const d = useTask(id);
  const task = d.data?.task;
  const recent = [...(d.data?.sessions ?? [])].filter((s) => !s.hidden).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 10);
  const outs = [...new Set([...(task?.deliverables ?? []), ...(d.data?.auto_deliverables ?? []).filter((x) => x.verdict === "in").map((x) => x.title ?? baseName(x.key))])];
  return (
    <Sheet title={task?.title ?? id} onClose={onClose}>
      {d.error && !d.data ? <ErrorState onRetry={() => void d.refetch()} /> : !d.data || !task ? <Loading rows={3} /> : <>
        <div className="m-hero"><TaskBadge id={id} height={BADGE_H.mSheet} /></div>
        <dl className="m-kv">
          <dt>{t(lang, "m.tasks.requester")}</dt><dd>{task.requester}</dd>
          <dt>{t(lang, "m.tasks.status")}</dt><dd>{t(lang, `m.tasks.st.${task.status}` as StrKey)}</dd>
          <dt>{t(lang, "m.tasks.total")}</dt><dd className="m-sn">{hours1(d.data.total_minutes)}{t(lang, "m.unit.h")}</dd>
        </dl>
        <div className="m-field">
          <span className="m-lab">{t(lang, "m.tasks.recent")}</span>
          {recent.length === 0 ? <p className="m-note">{t(lang, "m.tasks.none")}</p> : <div className="m-grp">{recent.map((s) => (
            <div key={s.id} className="m-row">
              <span className="m-time wide">{mdOf(jstDateOf(s.started_at))} {fmtHm(s.started_at)}</span>
              <span className="m-col"><span className="m-t2">{s.summary_effective}</span></span>
              <span className="m-side">{t(lang, "m.min", { n: Math.round(s.minutes_effective) })}</span>
            </div>
          ))}</div>}
        </div>
        <div className="m-field">
          <span className="m-lab">{t(lang, "m.tasks.deliverables")}</span>
          {outs.length === 0 ? <p className="m-note">{t(lang, "m.tasks.none")}</p> : <ul className="m-list">{outs.map((x) => <li key={x} className="m-wrap">{x}</li>)}</ul>}
        </div>
        <p className="m-note">{t(lang, "m.readonly")}</p>
      </>}
    </Sheet>
  );
}
