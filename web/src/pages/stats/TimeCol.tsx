import { useEffect, type CSSProperties } from "react";
import type { Dashboard } from "../../api/types";
import { hours } from "../../lib/format";
import { fmtUsd0 } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { UNLINKED_HREF } from "../../predict/rules";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C, lineColor } from "../../ui/palette";
import { useTip } from "../../ui/TipHost";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { isModuleHidden } from "../../world/modules";
import { useWorld } from "../../world/store";
import { ListBar } from "./ListBar";
import { None, Partial, Sub } from "./parts";
import { ledgerRows, unlinkedOf, weekRows, type LedgerRow, type WeekRow } from "./sections";

export const taskHref = (id: string) => `#/v2/tasks/${encodeURIComponent(id)}`;
/** The server's 未关联 key (server/src/dashboard/stats.ts UNLINKED) in the page's language; other keys are data. */
export const keyName = (lang: Lang, key: string) => (key === "未关联" ? t(lang, "st.unlinked") : key);
const md = (date: string) => date.slice(5);

/** 时间花在哪 (the `time` view; its frame carries the title): the task ledger, the unlinked note, then 每周. */
export function TimeCol({ d }: { d: Dashboard }) {
  const { lang } = useV2();
  const ledger = ledgerRows(d), weeks = weekRows(d), un = unlinkedOf(d);
  return (
    <div className="st-time">
      {/* each part on its own: a broken 每周 leaves the ledger standing, and the other way round */}
      <Sub text={t(lang, "st.t.task")} />
      {ledger?.length ? <Ledger rows={ledger} /> : <None text={t(lang, "st.empty")} />}
      {un && (
        <div className="st-un">
          <span className="nm"><Led ui tier={2} clip className="fill" color={C.DIM} text={unText(lang, un)} /></span>
          {un.sessions > 0 && <a className="key dim" href={UNLINKED_HREF}><Led ui tier={1} fit color={C.WARM} text={t(lang, "st.hint.k.unlinked")} /></a>}
        </div>
      )}
      <Sub text={t(lang, "st.t.weekly")} />
      {weeks?.length ? <Weekly rows={weeks} /> : <None text={t(lang, "st.empty")} />}
    </div>
  );
}

/** The unlinked note, worded by case as on the old page: sessions (the key beside it links them), notes too (picked
 *  in the note itself on the timeline), or notes only. */
function unText(lang: Lang, un: { total: number; sessions: number; notes: number }): string {
  const v = { h: hours(un.total), s: hours(un.sessions), n: hours(un.notes) };
  if (un.sessions <= 0) return t(lang, "st.un.n", v);
  return t(lang, un.notes > 0 ? "st.un" : "st.un.s", v);
}

/** Code, title, hours with a bar in the task's line colour; cost and $/h (whole dollars; $/h over the minutes of the
 *  sessions with token data, which the cost comes from — notes have none) are module stats.cost —
 *  hidden in 表 they are not rendered at all and the row drops their columns. */
function Ledger({ rows }: { rows: LedgerRow[] }) {
  const { lang, prefs } = useV2(), world = useWorld();
  const cost = !isModuleHidden("stats.cost", prefs.omote.hide, world);
  const max = Math.max(0, ...rows.map((r) => r.minutes));
  const head = (key: StrKey) => <span className="r"><Led ui tier={3} fit color="#6f5530" text={t(lang, key)} /></span>;
  return (
    <div className={`st-list st-led${cost ? "" : " nocost"}`}>
      <div className="st-r head" aria-hidden="true"><span /><span /><span />{head("st.c.h")}{cost && <>{head("st.c.cost")}{head("st.c.cph")}</>}</div>
      {rows.map((r) => {
        const lc = lineColor(r.taskId);
        return (
          <a key={r.taskId} className="st-r" href={taskHref(r.taskId)} data-task={r.taskId} style={{ "--lc": lc } as CSSProperties}>
            <TaskBadge id={r.taskId} height={BADGE_H.row} />
            <span className="nm"><Led tier={1} clip className="fill" task={r.taskId} text={r.title} /></span>
            <ListBar frac={max > 0 ? r.minutes / max : 0} color={lc} />
            <span className="r"><Led tier={1} fit text={hours(r.minutes)} /></span>
            {cost && (
              <>
                <span className="r">
                  <Led tier={1} fit text={r.cost ? fmtUsd0(r.cost.usd, lang) : "—"} />
                  {r.cost?.partial && <Partial />}
                </span>
                <span className="r">
                  <Led tier={2} fit color={C.DIM} text={r.cost && r.cost.minutes > 0 ? fmtUsd0(r.cost.usd / (r.cost.minutes / 60), lang) : "—"} />
                  {r.cost?.partial && r.cost.minutes > 0 && <Partial />}
                </span>
              </>
            )}
          </a>
        );
      })}
    </div>
  );
}

/** One amber total bar per week (U7: no project colours — those belong to tasks); the tip lists the projects. */
function Weekly({ rows }: { rows: WeekRow[] }) {
  const max = Math.max(0, ...rows.map((r) => r.minutes));
  return <div className="st-list st-wk">{rows.map((w, i) => <WeekLine key={`${w.week}-${i}`} w={w} frac={max > 0 ? w.minutes / max : 0} />)}</div>;
}

function WeekLine({ w, frac }: { w: WeekRow; frac: number }) {
  const { lang } = useV2(), setTip = useTip();
  const projects = w.projects.map((p) => `${keyName(lang, p.key)} ${hours(p.minutes)}`).join(" · ");
  const dates = `${md(w.from)}–${md(w.to)}`;
  // a refetch that changes this week under a still mouse: drop the tip with the old numbers
  useEffect(() => { setTip(null); }, [`${w.minutes}|${dates}|${projects}`, setTip]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = (
    <>
      <div className="h">{`${w.week} · ${dates}${w.partial ? ` · ${t(lang, "st.w.part")}` : ""}`}</div>
      <div className="m">{hours(w.minutes)}</div>
      {projects && <div className="s">{projects}</div>}
    </>
  );
  return (
    <div className="st-r" data-part={w.partial ? "" : undefined}
      onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, body })} onPointerLeave={() => setTip(null)}>
      <Led tier={1} fit text={w.week.slice(5)} />
      <Led ui tier={w.partial ? 2 : 3} fit color={C.DIM} text={dates} />
      <ListBar frac={frac} rows={4} />
      <span className="r"><Led tier={1} fit text={hours(w.minutes)} /></span>
      {projects && <span className="v2-sr">{projects}</span>}
    </div>
  );
}
