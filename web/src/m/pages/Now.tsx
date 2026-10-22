import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useDashboard, useMachineRuns, useTimeline } from "../../api/queries";
import type { MachineRuns, Session } from "../../api/types";
import { currentWeek, todayJst } from "../../lib/jst";
import { fmtHm } from "../../i18n/format";
import { t } from "../../i18n/t";
import { useNowData } from "../../pages/now/useNowData";
import { buildSnapshot } from "../../predict/snapshot";
import { useV2 } from "../../ui/context";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { machineLabel } from "../../ui/machine";
import { dayTitle, hmClock, hours1, isSyncStale, splitAt } from "../format";
import { mHref, type MRoute } from "../route";
import { DotBar, DotNum, DotSpark, DotUptime } from "../ui/dots";
import { Spinner } from "../ui/Spinner";
import { ErrorState, Loading } from "../ui/State";
import { PlanRow } from "./PlanRow";
import { usePlanActions } from "./planActions";
import { SessionSheet } from "./SessionSheet";
import { rangeDates, topTasks } from "./statsRange";

/** A run row's last run as epoch ms, or null when the row is missing, malformed, or never ran (old collector). */
function runAt(r: MachineRuns | undefined): number | null {
  if (!r || !Array.isArray(r.hours) || typeof r.last_run_at !== "string") return null;
  const at = Date.parse(r.last_run_at);
  return Number.isFinite(at) ? at : null;
}

/** 此刻 (spec §5): what runs, today's two figures, today's plan, unlinked count and collection state. */
export function Now(_: { route: MRoute }) {
  const { prefs, lang } = useV2();
  const qc = useQueryClient();
  const { input, error } = useNowData();
  const tl = useTimeline(currentWeek(), false);              // same cache key as useNowData's: no extra request
  const snap = useMemo(() => (input ? buildSnapshot(input, prefs.predict.runningMin) : null), [input, prefs.predict.runningMin]);
  const [open, setOpen] = useState<Session | null>(null);
  const runs = useMachineRuns();
  const wk = rangeDates("week", snap?.date ?? todayJst());
  const dash = useDashboard(wk.from, wk.to);
  // the date of the plan actually shown: just after 0:00 it is still yesterday's (kept while today's loads)
  const act = usePlanActions(snap?.dayPlan?.date ?? todayJst());
  if (error && !snap) return <ErrorState onRetry={() => void qc.refetchQueries({ type: "active" })} />;
  if (!input || !snap) return <Loading rows={6} />;

  const today = snap.date;
  const day = tl.data?.days.find((d) => d.date === today);
  const byId = new Map(input.sessions.map((s) => [s.id, s]));
  const titleOf = (taskId: string | null) => (taskId ? snap.tasks[taskId]?.title ?? taskId : t(lang, "m.unlinked"));
  const items = [...(snap.dayPlan?.items ?? [])].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  const done = items.filter((i) => i.final_status === "done").length;
  const unlinked = (day?.sessions ?? []).filter((s) => s.task_id === null).length;
  // 本周案件 and 采集 are optional: a failed or odd-shaped answer hides the one group, never the page
  const weekDays = (tl.data?.days ?? []).map((d) => d.wall_minutes ?? d.minutes);
  const weekTotal = weekDays.reduce((s, v) => s + v, 0);
  const byTask: unknown = (dash.data as { time?: { by_task?: unknown } } | undefined)?.time?.by_task;
  const rows = Array.isArray(byTask) ? byTask.filter((x): x is { task_id?: string | null; title: string; minutes: number } => !!x && typeof x.title === "string" && Number.isFinite(x.minutes)) : [];
  const top = topTasks(rows.map((x) => ({ title: x.title, minutes: x.minutes })), 5, "").filter((x) => x.title);
  // two 案件 with the same title would share the first one's badge — acceptable for a top-5 list
  const idOf = new Map(rows.map((x) => [x.title, x.task_id ?? null]));
  const topMax = Math.max(1, ...top.map((x) => x.minutes));
  const runOf = new Map((Array.isArray(runs.data) ? runs.data : []).filter((r) => !!r && typeof r.name === "string").map((r) => [r.name, r]));
  const lastSync = Math.max(0, ...snap.machines.map((m) => Math.max(runAt(runOf.get(m.name)) ?? 0, m.lastSeen ?? 0)));

  return (
    <div className="m-stack">
      <h2 className="m-cap"><span>{dayTitle(today, today, lang)}</span>
        {lastSync > 0 && <span>{splitAt(lang, "m.now.syncAt")}<span className="m-sn">{fmtHm(new Date(lastSync).toISOString())}</span><span className="m-cur" aria-hidden="true">▌</span></span>}</h2>
      <section className="m-grp">
        <div className="m-big">
          <div><span className="m-lab">{t(lang, "m.now.wall")}</span><DotNum text={hmClock(day ? day.wall_minutes ?? day.minutes : 0)} /></div>
          <div><span className="m-lab">{t(lang, "m.now.sum")}</span><DotNum text={hmClock(day?.minutes ?? 0)} /></div>
        </div>
        <div className="m-spark"><DotSpark values={weekDays} /><span>{splitAt(lang, "m.now.week")}<span className="m-sn">{hours1(weekTotal)}{t(lang, "m.unit.h")}</span></span></div>
      </section>

      <h2 className="m-cap"><span>{t(lang, "m.now.running")}</span><span className="m-sn">{snap.running.length}</span></h2>
      <section className="m-grp">
        {snap.running.length === 0 && <p className="m-row m-note">{t(lang, "m.now.noneRunning")}</p>}
        {snap.running.map(({ session: x }) => (
          <button key={x.id} type="button" className="m-row" onClick={() => { const s = byId.get(x.id); if (s) setOpen(s); }}>
            <Spinner />
            {x.taskId && <TaskBadge id={x.taskId} height={BADGE_H.mRow} />}
            <span className="m-col"><span className="m-t1">{titleOf(x.taskId)}</span><span className="m-t2">{x.summary}</span></span>
            <span className="m-side">{t(lang, "m.min", { n: Math.round(x.minutes) })}<br />{machineLabel(x.machine)}</span>
          </button>
        ))}
      </section>

      <h2 className="m-cap"><span>{t(lang, "m.now.plan")} · <span className="m-sn">{done}/{items.length}</span></span><a href={mHref("plan")}>{t(lang, "m.now.planAll")}</a></h2>
      <section className="m-grp">
        {items.length === 0 ? <p className="m-row m-note">{t(lang, "m.now.planNone")}</p> : <>
          {items.map((it) => <PlanRow key={it.id} item={it} onToggle={() => { navigator.vibrate?.(10); void act.toggle(it.id); }} />)}
          <div className="m-spark"><DotBar value={done} max={items.length} n={20} cell={9} /><span className="m-sn">{Math.round((done / items.length) * 100)}%</span></div>
        </>}
      </section>

      {top.length > 0 && <>
        <h2 className="m-cap"><span>{t(lang, "m.now.weekTasks")}</span><span className="m-sn">{hours1(weekTotal)}{t(lang, "m.unit.h")}</span></h2>
        <section className="m-grp">
          {top.map((x, i) => (
            <div key={`${x.title}-${i}`} className="m-rk"><span>{idOf.get(x.title) && <TaskBadge id={idOf.get(x.title)!} height={BADGE_H.mRow} />}{x.title}</span><span className="m-side">{hours1(x.minutes)}{t(lang, "m.unit.h")}</span><DotBar value={x.minutes} max={topMax} /></div>
          ))}
        </section>
      </>}

      <h2 className="m-cap"><span>{t(lang, "m.now.feed")}</span><span>{t(lang, "m.now.feedLegend")}</span></h2>
      <section className="m-grp">
        {snap.machines.map((m) => {
          const r = runOf.get(m.name), at = runAt(r);
          return (
            <div key={m.name} className="m-up">
              <b>{machineLabel(m.name)}</b>
              {r && at !== null ? <><DotUptime hours={r.hours} /><span className={`m-side${isSyncStale(at, snap.now) ? " m-warn" : ""}`}>{fmtHm(new Date(at).toISOString())}</span></>
                : <span className="m-col m-t2">{t(lang, "m.now.feedOld")}</span>}
            </div>
          );
        })}
      </section>

      <h2 className="m-cap"><span>{t(lang, "m.now.today")}</span></h2>
      <section className="m-grp">
        <a className="m-row" href={mHref("tl", null, { un: "1" })}><span className="m-col m-t1">{t(lang, "m.now.unlinked")}</span><span className="m-side">{t(lang, "m.now.count", { n: unlinked })}</span></a>
      </section>
      {open && <SessionSheet s={open} title={titleOf(open.task_id)} onClose={() => setOpen(null)} />}
    </div>
  );
}
