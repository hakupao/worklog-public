import type { CSSProperties, ReactNode } from "react";
import type { Dashboard } from "../../api/types";
import { compactCount, hours } from "../../lib/format";
import { fmtUsd0 } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C, lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { isModuleHidden } from "../../world/modules";
import { useWorld } from "../../world/store";
import { ListBar } from "./ListBar";
import { Head, None, Partial, Sub } from "./parts";
import { outputOf, requesterRows } from "./sections";
import { keyName, taskHref } from "./TimeCol";

/** The `share` view (依頼元与产出, its frame carries the title): 按依頼元, then 产出 — each still its own region. */
export function ShareCol({ d }: { d: Dashboard }) {
  return <><Requesters d={d} /><Output d={d} /></>;
}

/** One table for the old page's two donuts: per requester its time (bar + hours), its share of 总工时 (the time
 *  donut's legend), tokens and cost, same order. Cost (whole dollars) is module stats.cost — hidden in 表 it is not
 *  rendered and the row drops its column. */
function Requesters({ d }: { d: Dashboard }) {
  const { lang, prefs } = useV2(), world = useWorld();
  const cost = !isModuleHidden("stats.cost", prefs.omote.hide, world);
  const rows = requesterRows(d);
  const max = Math.max(0, ...(rows ?? []).map((r) => r.minutes)), total = d.overview.minutes;
  const head = (key: StrKey, cls = "") => <span className={cls}><Led ui tier={3} fit color="#6f5530" text={t(lang, key)} /></span>;
  return (
    <section className="st-share" aria-label={t(lang, "st.share")}>
      <Head text={t(lang, "st.share")} />
      {rows === null || rows.length === 0 ? <None text={t(lang, "st.empty")} /> : (
        <>
          <div className={`st-list st-req${cost ? "" : " nocost"}`}>
            <div className="st-r head" aria-hidden="true">
              {head("st.c.req")}{head("st.c.time")}<span />{head("st.c.share", "r")}{head("st.c.tok", "r")}{cost && head("st.c.cost", "r")}
            </div>
            {rows.map((r, i) => {
              const un = r.requester === "未关联";
              return (
                <div key={`${r.requester}-${i}`} className="st-r">
                  <span className="nm">{un
                    ? <Led ui tier={1} clip className="fill" color={C.DIM} text={keyName(lang, r.requester)} />
                    : <Led tier={1} clip className="fill" text={[{ t: r.requester, glyph: "ja" }]} />}</span>
                  <ListBar frac={max > 0 ? r.minutes / max : 0} />
                  <span className="r"><Led tier={1} fit text={hours(r.minutes)} /></span>
                  <span className="r"><Led tier={2} fit color={C.DIM} text={total > 0 ? `${Math.round((r.minutes / total) * 100)}%` : "—"} /></span>
                  <span className="r"><Led tier={2} fit color={C.DIM} text={compactCount(r.tokens)} /></span>
                  {cost && (
                    <span className="r">
                      <Led tier={1} fit text={fmtUsd0(r.cost_usd, lang)} />
                      {r.cost_partial && <Partial />}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="st-note"><span className="nm"><Led ui tier={3} clip className="fill" color="#6f5530" text={t(lang, "st.share.note")} /></span></div>
        </>
      )}
    </section>
  );
}

/** A task row in 产出: code, title, then the row's own figures; links to the v2 task. `hover`: the row's title
 *  attribute (a done task's received → done dates, which the column does not have room for). */
function TaskRow({ id, title, hover, children }: { id: string; title: string; hover?: string; children: ReactNode }) {
  const lc = lineColor(id);
  return (
    <a className="st-r" href={taskHref(id)} title={hover} data-task={id} style={{ "--lc": lc } as CSSProperties}>
      <TaskBadge id={id} height={BADGE_H.row} />
      <span className="nm"><Led tier={1} clip className="fill" task={id} text={title} /></span>
      {children}
    </a>
  );
}

/** 完了案件 / 平均交付周期 / 成果物, the done tasks, the estimate gaps. Empty lists are a dim line each. */
function Output({ d }: { d: Dashboard }) {
  const { lang } = useV2();
  const o = outputOf(d);
  const kv = (key: StrKey, v: string, unit?: string) => (
    <div className="st-kv">
      <Led ui tier={2} fit color={C.DIM} text={t(lang, key)} />
      <Led size={12} tier={1} fit text={v} />
      {unit && <Led ui tier={2} fit color={C.DIM} text={unit} />}
    </div>
  );
  return (
    <section className="st-out" aria-label={t(lang, "st.out")}>
      <Head text={t(lang, "st.out")} />
      {o === null ? <None text={t(lang, "st.empty")} /> : (
        <>
          <div className="st-kvl">
            {kv("st.o.done", String(o.done.length))}
            {o.avgLead === null ? kv("st.o.lead", "—") : kv("st.o.lead", String(o.avgLead), t(lang, "st.u.days"))}
            {kv("st.o.deliv", String(o.deliverables))}
          </div>
          <Sub text={t(lang, "st.o.list")} />
          {o.done.length ? (
            <div className="st-list st-done">
              {o.done.map((r) => (
                <TaskRow key={r.taskId} id={r.taskId} title={r.title} hover={`${r.received || "--"} → ${r.done || "--"}`}>
                  <span className="r"><Led ui tier={1} fit text={t(lang, "st.o.days", { n: r.leadDays })} /></span>
                  <span className="r"><Led ui tier={2} fit color={C.DIM} text={t(lang, "st.o.dlv", { n: r.deliverables })} /></span>
                </TaskRow>
              ))}
            </div>
          ) : (
            <None text={t(lang, "st.o.none")} />
          )}
          <Sub text={t(lang, "st.o.gap")} />
          {o.gaps.length ? (
            <div className="st-list st-gap">
              {o.gaps.map((g) => (
                <TaskRow key={g.taskId} id={g.taskId} title={g.title}>
                  <span className="r"><Led tier={1} fit text={`${g.manual}h / ${g.actual}h`} /></span>
                </TaskRow>
              ))}
            </div>
          ) : <None text={t(lang, "st.o.nogap")} />}
        </>
      )}
    </section>
  );
}
