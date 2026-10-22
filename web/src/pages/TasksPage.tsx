import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import type { TaskStatus } from "../api/types";
import { toast } from "../components/Toast";
import { TaskForm } from "../components/TaskForm";
import type { StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import { mdOf } from "../predict/time";
import { useV2 } from "../ui/context";
import { Drawer } from "../ui/Drawer";
import { Led, type LedSeg } from "../ui/Led";
import { C, lineColor } from "../ui/palette";
import { BADGE_H, TaskBadge } from "../ui/TaskBadge";
import { useWorld } from "../world/store";
import { taskCode } from "./now/format";
import { DayStrip } from "./tasks/DayStrip";
import type { TaskRow, TasksLayout } from "./tasks/layout";
import { ALL_STATUSES, useTk, type TkPatch, type TkState } from "./tasks/state";
import { TaskDrawer } from "./tasks/TaskDrawer";
import { useTasksData, type TasksData } from "./tasks/useTasksData";

const hours = (m: number | null) => (m === null ? "--" : (m / 60).toFixed(1));
const HEADS = ["tk.h.st", "tk.h.code", "tk.h.recv", "tk.h.title", "tk.h.req", "tk.h.week", "tk.h.wh", "tk.h.tot", "tk.h.last"] as const;
const LAMP: Record<TaskStatus, string> = { open: "live", hold: "amber", done: "dim" };

/** 案件 (spec §3.1): the 案件 board — status filter, one row per task with this week's 每日 strip, 本周,
 *  累计 and 最近 — and the glass drawer for the open one. */
export function TasksPage() {
  const { lang } = useV2();
  const [st, set] = useTk();
  const data = useTasksData();
  const [creating, setCreating] = useState(false);
  const newBtn = useRef<HTMLButtonElement>(null), wasCreating = useRef(false), created = useRef(false);
  // the create dialog closing by 取消 / Esc leaves focus on body: give it back to ＋ 新建案件. A created task
  // opens the drawer, which owns focus then. A plain effect: React restores focus at the end of the commit.
  useEffect(() => {
    const closed = wasCreating.current && !creating;
    wasCreating.current = creating;
    if (!closed) return;
    const made = created.current;
    created.current = false;
    const a = document.activeElement;
    if (!made && (!a || a === document.body)) newBtn.current?.focus();
  }, [creating]);
  const L = data.layout;
  return (
    <div className="tk">
      <section className="tk-list" tabIndex={-1} aria-label={t(lang, "nav.tasks")}>
        <TopLine st={st} data={data} set={set} onNew={() => setCreating(true)} newRef={newBtn} />
        {!L
          ? <div className="tk-wait">
              <Led ui tier={2} fit text={t(lang, data.error ? "now.error" : "now.loading")} />
              {data.error !== null && <button type="button" className="key dim" onClick={data.refetch}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>}
            </div>
          : <Rows L={L} st={st} set={set} />}
      </section>
      <Drawer open={st.open !== null} onClose={() => set({ open: null })} label={t(lang, "tk.d.label", { c: st.open ? taskCode(st.open) : "" })}
        fallback={() => document.querySelector<HTMLElement>(".tk-list")}
        returnTo={() => (st.open ? document.querySelector<HTMLElement>(`.trow[data-id="${CSS.escape(st.open)}"]`) : null)}>
        {st.open && <TaskDrawer key={st.open} id={st.open} row={L?.rows.find((r) => r.task.id === st.open)} days={L?.days ?? []} live={data.week?.running ?? []} onClose={() => set({ open: null })} />}
      </Drawer>
      {creating && (
        <TaskForm
          onCreated={(task) => { created.current = true; setCreating(false); toast.info(t(lang, "tk.created", { c: taskCode(task.id) })); set({ open: task.id }); }}
          onCancel={() => setCreating(false)} />
      )}
    </div>
  );
}

function TopLine({ st, data, set, onNew, newRef }: { st: TkState; data: TasksData; set: (p: TkPatch) => void; onNew: () => void; newRef: RefObject<HTMLButtonElement | null> }) {
  const { lang } = useV2();
  const L = data.layout, days = L?.days ?? [];
  const toggle = (s: TaskStatus) => {
    const next = st.statuses.includes(s) ? st.statuses.filter((x) => x !== s) : [...st.statuses, s];
    if (next.length) set({ statuses: next });      // at least one stays on: an empty filter means nothing
  };
  const all = st.statuses.length === ALL_STATUSES.length;
  return (
    <div className="sec">
      <Led ui size={12} tier={1} fit text={L ? t(lang, "tk.title", { n: L.rows.length }) : t(lang, "nav.tasks")} />
      <div className="keys" role="group" aria-label={t(lang, "tk.filter")}>
        {ALL_STATUSES.map((s) => {
          const on = st.statuses.includes(s);
          return (
            <button key={s} type="button" className={`key ${on ? "on" : "off"}`} aria-pressed={on} onClick={() => toggle(s)}>
              <span className="bx" />
              <Led ui tier={1} fit text={`${t(lang, `tk.st.${s}` as StrKey)}${L ? ` ${L.counts[s]}` : ""}`} />
            </button>
          );
        })}
        <span className="vk" />
        <button type="button" className={`key ${all ? "on" : "off"}`} aria-pressed={all} onClick={() => set({ statuses: ALL_STATUSES })}>
          <Led ui tier={1} fit text={t(lang, "tk.all")} />
        </button>
      </div>
      <span className="grow" />
      {days.length > 0 && <Led ui tier={2} fit text={t(lang, "tk.sub", { a: mdOf(days[0]), b: mdOf(days[days.length - 1]) })} />}
      {data.totalsError !== null && <Led ui tier={2} fit color={C.RED} text={t(lang, "tk.totalsFailed")} />}
      <button ref={newRef} type="button" className="key pri" onClick={onNew}><Led ui tier={1} fit text={t(lang, "tk.new")} /></button>
    </div>
  );
}

function Rows({ L, st, set }: { L: TasksLayout; st: TkState; set: (p: TkPatch) => void }) {
  const { lang } = useV2();
  const shown = L.rows.filter((r) => st.statuses.includes(r.task.status));
  const weekMin = shown.reduce((n, r) => n + r.week, 0);
  // the strips share one scale, over the rows shown: a filtered-out task's big day must not flatten the rest
  const dayMax = Math.max(0, ...shown.flatMap((r) => r.perDay));
  return (
    <>
      <div className="heads" aria-hidden="true">
        {HEADS.map((k, i) => <span key={k} className={i >= 6 ? "r" : undefined}><Led ui tier={3} fit text={t(lang, k)} /></span>)}
      </div>
      <div role="list" className="rows">
        {shown.length === 0
          ? <div role="listitem" className="trow empty"><Led ui tier={3} fit text={t(lang, L.rows.length ? "tk.empty" : "tk.none")} /></div>
          : shown.map((r) => <Row key={r.task.id} r={r} L={L} dayMax={dayMax} sel={st.open === r.task.id} onOpen={() => set({ open: r.task.id })} />)}
      </div>
      <div className="foot">
        <Led ui tier={2} fit text={t(lang, "tk.foot.l", { n: shown.length, all: L.rows.length, h: (weekMin / 60).toFixed(1) })} />
        <span className="grow" />
        <Led ui tier={3} fit text={t(lang, "tk.foot.r")} />
      </div>
    </>
  );
}

function Row({ r, L, dayMax, sel, onOpen }: { r: TaskRow; L: TasksLayout; dayMax: number; sel: boolean; onOpen: () => void }) {
  const { lang } = useV2(), world = useWorld();
  const k = r.task.id, lc = lineColor(k), done = r.task.status === "done";
  const last: LedSeg[] = r.running ? [{ t: t(lang, "tl.row.live"), kind: "live" }]
    : r.last === null ? [{ t: "--", kind: "dim" }]
    : r.last === L.today ? [{ t: t(lang, "tl.today"), color: C.GREEN }] : [{ t: mdOf(r.last) }];
  const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } };
  return (
    <div role="listitem" tabIndex={0} className={`trow${done ? " done" : ""}${sel ? " sel" : ""}`} data-id={k} data-task={k}
      style={{ "--lc": lc } as CSSProperties} aria-label={t(lang, "tk.row", { c: taskCode(k), t: r.task.title })} onClick={onOpen} onKeyDown={key}>
      <span className="st"><span className={`lamp ${LAMP[r.task.status]}`} /><Led ui tier={1} fit text={t(lang, `tk.st.${r.task.status}` as StrKey)} /></span>
      <TaskBadge id={k} height={BADGE_H.row} />
      <Led tier={2} fit text={mdOf(r.task.received_at)} />
      <span className="nm"><Led tier={1} clip className="fill" task={k} text={r.task.title} /></span>
      <span className="nm"><Led tier={2} clip className="fill" text={[{ t: r.task.requester, glyph: "ja" }]} /></span>
      <DayStrip vals={r.perDay} max={dayMax} color={done ? (world === "omote" ? "#c4cbd4" : "#6d6150") : lc} />
      <span className="r"><Led tier={1} fit text={hours(r.week)} /></span>
      <span className="r"><Led tier={2} fit text={hours(r.total)} /></span>
      <span className="r"><Led tier={1} fit text={last} /></span>
    </div>
  );
}
