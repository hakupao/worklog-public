import type { Session } from "../../api/types";
import { jstDateOf } from "../../lib/jst";
import { fmtHm } from "../../i18n/format";
import { t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { machineLabel } from "../../ui/machine";
import { mHref } from "../route";
import { Sheet } from "../ui/Sheet";

const AGENT: Record<Session["agent"], string> = { "claude-code": "Claude Code", codex: "Codex" };

/** A session, read-only (spec M3): when, how long, where, what. */
export function SessionSheet({ s, title, dayMinutes, onClose }: { s: Session; title: string; dayMinutes?: number; onClose: () => void }) {
  const { lang } = useV2();
  return (
    <Sheet title={title} onClose={onClose}>
      <dl className="m-kv">
        <dt>{t(lang, "m.sess.time")}</dt><dd className="m-sn">{mdOf(jstDateOf(s.started_at))} {fmtHm(s.started_at)}–{fmtHm(s.ended_at)}</dd>
        <dt>{t(lang, "m.sess.minutes")}</dt><dd className="m-sn">{
          dayMinutes !== undefined && Math.round(dayMinutes) !== Math.round(s.minutes_effective)
            ? t(lang, "m.sess.minutesSplit", { d: Math.round(dayMinutes), t: Math.round(s.minutes_effective) })
            : t(lang, "m.min", { n: Math.round(s.minutes_effective) })}</dd>
        <dt>{t(lang, "m.sess.machine")}</dt><dd>{machineLabel(s.machine)} · {AGENT[s.agent] ?? s.agent}</dd>
        {s.task_id && <><dt>{t(lang, "m.sess.task")}</dt><dd><a className="m-link" href={mHref("tasks", s.task_id)}>{title}</a></dd></>}
        <dt>{t(lang, "m.sess.summary")}</dt><dd className="m-wrap">{s.summary_effective}</dd>
      </dl>
      <p className="m-note">{t(lang, "m.readonly")}</p>
    </Sheet>
  );
}
