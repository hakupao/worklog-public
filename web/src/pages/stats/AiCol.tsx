import { useEffect, type CSSProperties } from "react";
import type { Dashboard } from "../../api/types";
import { compactCount, hours } from "../../lib/format";
import { jstDateOf, weekOfDate } from "../../lib/jst";
import { fmtMoney, fmtUsd0 } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C, lineColor } from "../../ui/palette";
import { useTip } from "../../ui/TipHost";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { ListBar } from "./ListBar";
import { None, Partial, Sub } from "./parts";
import { aiOf, taskCostRows, type AiView, type TaskCostRow } from "./sections";
import { taskHref } from "./TimeCol";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const AGENT: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };
/** A session on the timeline, its drawer open (TaskDrawer / DayDrawer's link). */
export const sessionHref = (id: string, startedAt: string) => {
  const day = jstDateOf(startedAt);
  return `#/v2/timeline/${weekOfDate(day)}?day=${day}&s=${encodeURIComponent(id)}`;
};

/** AI 使用效率 (the `ai` view, its frame carries the title; all of it module stats.cost): the three ratios, tokens by model, the two
 *  agents, the tasks by cost, the costliest sessions. */
export function AiCol({ d }: { d: Dashboard }) {
  const { lang } = useV2();
  const a = aiOf(d), costs = taskCostRows(d);
  const kv = (key: StrKey, v: string) => (
    <div className="st-kv"><Led ui tier={2} fit color={C.DIM} text={t(lang, key)} /><Led size={12} tier={1} fit text={v} /></div>
  );
  return (
    <div className="st-ai">
      {a === null ? <None text={t(lang, "st.empty")} /> : (
        <>
          <div className="st-kvl">
            {kv("st.a.sub", pct(a.sub))}
            {kv("st.a.cache", pct(a.cache))}
            {kv("st.a.cph", a.cph === null ? "—" : `≈${fmtMoney(a.cph, lang)}/h`)}
          </div>
          {a.uncollected > 0 && <div className="st-note"><span className="nm"><Led ui tier={3} clip className="fill" color="#6f5530" text={t(lang, "st.a.uncol", { n: a.uncollected })} /></span></div>}
          <Sub text={t(lang, "st.a.model")} />
          {a.models.length ? <Models rows={a.models} /> : <None text={t(lang, "st.empty")} />}
          <Sub text={t(lang, "st.a.agent")} />
          {a.agents.length ? (
            <div className="st-list st-agt">
              {a.agents.map((g) => (
                <div key={g.agent} className="st-r">
                  <span className="nm"><Led ui tier={1} clip className="fill" color={C.WARM} text={AGENT[g.agent] ?? g.agent} /></span>
                  <span className="nm"><Led ui tier={2} clip className="fill" color={C.DIM} text={t(lang, "st.a.ag", { n: g.sessions, h: hours(g.minutes) })} /></span>
                  <span className="r">
                    {g.cost === null
                      ? <Led ui tier={2} fit color={C.DIM} text={t(lang, "st.a.unpriced")} />
                      : <Led tier={1} fit text={fmtUsd0(g.cost, lang)} />}
                    {g.cost !== null && g.partial && <Partial />}
                  </span>
                </div>
              ))}
            </div>
          ) : <None text={t(lang, "st.empty")} />}
          <Sub text={t(lang, "st.a.task")} />
          {costs?.length ? <TaskCosts rows={costs} /> : <None text={t(lang, "st.empty")} />}
          <Sub text={t(lang, "st.a.top")} />
          {a.top.length ? (
            <div className="st-list st-tops">
              {a.top.map((s) => (
                <a key={s.id} className="st-r" href={sessionHref(s.id, s.startedAt)}>
                  <Led ui tier={2} fit color={C.DIM} text={mdOf(jstDateOf(s.startedAt))} />
                  <span className="nm"><Led tier={1} clip className="fill" text={s.summary || "—"} /></span>
                  <span className="r"><Led tier={2} fit color={C.DIM} text={compactCount(s.tokens)} /></span>
                  <span className="r"><Led tier={1} fit text={fmtUsd0(s.cost, lang)} /></span>
                </a>
              ))}
            </div>
          ) : <None text={t(lang, "st.empty")} />}
        </>
      )}
    </div>
  );
}

/** Code, title, a bar in the task's line colour by its share of the costliest, the cost in whole dollars. */
function TaskCosts({ rows }: { rows: TaskCostRow[] }) {
  const { lang } = useV2();
  const max = Math.max(0, ...rows.map((r) => r.usd));
  return (
    <div className="st-list st-tc">
      {rows.map((r) => {
        const lc = lineColor(r.taskId);
        return (
          <a key={r.taskId} className="st-r" href={taskHref(r.taskId)} data-task={r.taskId} style={{ "--lc": lc } as CSSProperties}>
            <TaskBadge id={r.taskId} height={BADGE_H.row} />
            <span className="nm"><Led tier={1} clip className="fill" task={r.taskId} text={r.title} /></span>
            <ListBar frac={max > 0 ? r.usd / max : 0} color={lc} />
            <span className="r">
              <Led tier={1} fit text={fmtUsd0(r.usd, lang)} />
              {r.partial && <Partial />}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function Models({ rows }: { rows: AiView["models"] }) {
  const max = Math.max(0, ...rows.map((m) => m.total));
  return <div className="st-list st-mdl">{rows.map((m) => <ModelRow key={m.model} m={m} frac={max > 0 ? m.total / max : 0} />)}</div>;
}

/** A model's tokens; the tip splits them into input / output / cache read / cache write. */
function ModelRow({ m, frac }: { m: AiView["models"][number]; frac: number }) {
  const { lang } = useV2(), setTip = useTip();
  const split = t(lang, "st.a.split", { i: compactCount(m.input), o: compactCount(m.output), r: compactCount(m.cacheRead), w: compactCount(m.cacheWrite) });
  useEffect(() => { setTip(null); }, [`${m.total}|${split}`, setTip]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = <><div className="h">{m.model}</div><div className="m">{t(lang, "st.a.tok", { n: compactCount(m.total) })}</div><div className="s">{split}</div></>;
  return (
    <div className="st-r" onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, body })} onPointerLeave={() => setTip(null)}>
      <span className="nm"><Led tier={1} clip className="fill" text={m.model} /></span>
      <ListBar frac={frac} />
      <span className="r"><Led tier={1} fit text={compactCount(m.total)} /></span>
      <span className="v2-sr">{split}</span>
    </div>
  );
}
