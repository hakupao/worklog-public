import { useEffect, type CSSProperties, type KeyboardEvent } from "react";
import type { Note, Session, Task } from "../../api/types";
import { jstDateOf } from "../../lib/jst";
import { fmtMoney } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { hmOf, mdOf, weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led, type LedSeg } from "../../ui/Led";
import { machineLabel } from "../../ui/machine";
import { Mod } from "../../ui/Mod";
import { openNote } from "../../ui/note";
import { C, lineColor } from "../../ui/palette";
import { useTip } from "../../ui/TipHost";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { elapsed, taskCode } from "../now/format";
import { dayRows, linkedTask, unlinkedNotes, unlinkedRows, type TlRow } from "./rows";
import { SessionTip } from "./SessionTip";
import type { TlPatch, TlState } from "./state";
import type { TimelineData } from "./useTimelineData";
import type { WeekLayout } from "./week";

const hm = (m: number) => elapsed(m * 60_000);
const HEADS: StrKey[] = ["tl.h.time", "tl.h.code", "tl.h.title", "tl.h.mach", "tl.h.min", "tl.h.turns"];

/** The chosen day's sessions and notes as board rows (prototype page-timeline.html:375-420), or with the
 *  未关联 filter on, every unlinked session across weeks. A row opens the drawer. */
export function DayList({ L, st, day, data, set }: { L: WeekLayout; st: TlState; day: string | null; data: TimelineData; set: (p: TlPatch) => void }) {
  const { lang } = useV2();
  const band = L.bands.find((b) => b.date === day) ?? null;
  const rows: TlRow[] = st.unlinked
    ? [...unlinkedRows(data.unlinked ?? [], st.dir, jstDateOf), ...unlinkedNotes(L.bands, data.tasks, st.dir)]
    : band ? dayRows(band, st.dir) : [];
  const unFailed = st.unlinked && data.unlinkedError !== null;
  const live = new Set(L.running);
  const title = st.unlinked
    ? t(lang, "tl.d.unTitle")
    : day ? t(lang, "tl.d.title", { d: mdOf(day), w: t(lang, `tl.dow.${weekdayOfDate(day)}` as StrKey) }) : "";
  const nS = rows.filter((r) => r.kind === "s").length, nN = rows.length - nS;
  const sub = st.unlinked
    ? t(lang, "tl.d.unSub", { n: nS, m: nN, h: hm((data.unlinked ?? []).filter((s) => !st.dir || s.cwd === st.dir).reduce((n, s) => n + s.minutes_effective, 0)) })
    : t(lang, "tl.d.sub", { n: nS, m: nN, w: ((band?.wall ?? 0) / 60).toFixed(1), h: ((band?.minutes ?? 0) / 60).toFixed(1) });
  const openKey = st.open ? `${st.open.kind}:${st.open.id}` : null;
  return (
    <section className="tl-day" aria-label={title} tabIndex={-1}>
      <div className="sec">
        <Led ui size={12} tier={1} fit text={title} />
        <Led ui tier={2} fit text={sub} />
        <span className="grow" />
        {!st.unlinked && day && (
          <button type="button" className="key pri" onClick={() => openNote(day)}><Led ui tier={1} fit text={t(lang, "tl.addNote")} /></button>
        )}
      </div>
      <div className="heads" aria-hidden="true">
        {HEADS.map((k, i) => <span key={k} className={i >= 4 ? "r" : undefined}><Led ui tier={3} fit text={t(lang, k)} /></span>)}
        <span className="r"><Mod id="timeline.cost"><Led ui tier={3} fit text={t(lang, "tl.h.cost")} /></Mod></span>
        <span />
      </div>
      <div role="list" className="rows">
        {unFailed
          ? <div className="srow empty" role="alert">
              <Led ui tier={2} fit text={t(lang, "tl.d.unError")} />
              <button type="button" className="key dim" onClick={data.refetchUnlinked}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>
            </div>
          : rows.length === 0
          ? <div className="srow empty"><Led ui tier={3} fit text={t(lang, st.unlinked ? "tl.d.unEmpty" : "tl.d.empty")} /></div>
          : rows.map((r) => r.kind === "s"
            ? <SessionRow key={r.key} s={r.s} date={r.date} withDate={st.unlinked} live={live.has(r.s.id)} tasks={data.tasks} sel={openKey === r.key}
                onOpen={() => set({ open: { kind: "s", id: r.s.id } })} />
            : <NoteRow key={r.key} n={r.n} withDate={st.unlinked} tasks={data.tasks} sel={openKey === r.key} onOpen={() => set({ open: { kind: "n", id: r.n.id } })} />)}
      </div>
      <div className="foot">
        <Led ui tier={3} fit text={t(lang, "tl.foot.l")} />
        <span className="grow" />
        <Led ui tier={3} fit text={t(lang, "tl.foot.r")} />
      </div>
    </section>
  );
}

const enterOpens = (open: () => void) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };

function SessionRow({ s, date, withDate, live, tasks, sel, onOpen }: {
  s: Session; date: string | null; withDate: boolean; live: boolean; tasks: Record<string, Task>; sel: boolean; onOpen: () => void;
}) {
  const { lang } = useV2(), setTip = useTip();
  // the same row with new data after a refetch (minutes, summary, 运行中): drop the tip that shows the old
  useEffect(() => { setTip(null); }, [`${s.id}@${s.updated_at}@${s.minutes_on_day}|${live}`, setTip]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = linkedTask(s, tasks), task = k ? tasks[k] : undefined, lc = lineColor(k);
  const a = Date.parse(s.started_at), b = Date.parse(s.ended_at);
  // the cross-week list needs the date; it fits the column in place of the end time
  const time = withDate && date ? `${mdOf(date)} ${hmOf(a)}` : `${hmOf(a)}–${hmOf(b)}`;
  const title: LedSeg[] = task
    ? [{ t: task.title }, { t: `  ${s.summary_effective}`, color: C.DIM }]
    : [{ t: `${t(lang, "tl.unlinked")}  ` }, { t: s.summary_effective, color: C.DIM }];
  const end: LedSeg[] = s.hidden ? [{ t: t(lang, "tl.row.hidden"), kind: "dim" }]
    : !k ? [{ t: t(lang, "tl.row.link") }]
    : live ? [{ t: t(lang, "tl.row.live"), kind: "live" }] : [{ t: "" }];
  const cost = s.tokens?.cost_usd ?? null;
  return (
    <div role="listitem" tabIndex={0} className={`srow${sel ? " sel" : ""}${s.hidden ? " hid" : ""}${k ? "" : " un"}`} data-task={k ?? undefined} data-id={s.id}
      style={{ "--lc": lc } as CSSProperties} aria-label={`${time} ${task?.title ?? t(lang, "tl.unlinked")}`}
      onClick={onOpen} onKeyDown={enterOpens(onOpen)}
      onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: <SessionTip s={s} date={date ?? jstDateOf(s.started_at)} tasks={tasks} lang={lang} live={live} /> })}
      onPointerLeave={() => setTip(null)}>
      <Led tier={1} fit text={time} />
      {k ? <TaskBadge id={k} height={BADGE_H.row} /> : <Led tier={1} fit color={lc} text={[{ t: taskCode(null), kind: "dim" }]} />}
      <span className="nm"><Led ui tier={1} clip className="fill" task={k ?? undefined} text={title} /></span>
      <Led tier={2} fit text={machineLabel(s.machine)} />
      <span className="r"><Led tier={1} fit color={C.GREEN} text={hm(s.minutes_on_day ?? s.minutes_effective)} /></span>
      <span className="r"><Led tier={2} fit text={String(s.turns)} /></span>
      <span className="r"><Mod id="timeline.cost"><Led tier={2} fit text={cost === null ? "--" : fmtMoney(cost, lang)} /></Mod></span>
      <span className="end"><Led ui tier={1} fit text={end} /></span>
    </div>
  );
}

function NoteRow({ n, withDate, tasks, sel, onOpen }: { n: Note; withDate: boolean; tasks: Record<string, Task>; sel: boolean; onOpen: () => void }) {
  const { lang } = useV2();
  const k = linkedTask(n, tasks), lc = lineColor(k);
  return (
    <div role="listitem" tabIndex={0} className={`srow note${sel ? " sel" : ""}`} data-task={k ?? undefined} data-id={`n:${n.id}`}
      style={{ "--lc": lc } as CSSProperties} aria-label={`${t(lang, "tl.row.note")} ${n.text}`} onClick={onOpen} onKeyDown={enterOpens(onOpen)}>
      <Led ui tier={2} fit text={`${t(lang, "tl.row.note")} ${withDate ? `${mdOf(n.ts.slice(0, 10))} ` : ""}${n.ts.slice(11, 16)}`} />
      {k ? <TaskBadge id={k} height={BADGE_H.row} /> : <Led tier={1} fit color={lc} text={[{ t: taskCode(null), kind: "dim" }]} />}
      <span className="nm"><Led tier={1} clip className="fill" task={k ?? undefined} text={n.text} /></span>
      <Led tier={2} fit text={machineLabel(n.machine)} />
      <span className="r"><Led tier={1} fit color={C.GREEN} text={n.minutes === null ? "--" : hm(n.minutes)} /></span>
      <span className="r" />
      <span className="r" />
      <span className="end" />
    </div>
  );
}
