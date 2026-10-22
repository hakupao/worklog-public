import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ApiError, ConflictError, isLinkedError } from "../../api/client";
import { useDeleteTask, useDeliverableVerdict, usePatchSession, usePatchTask, useRequesters, useTask } from "../../api/queries";
import type { AutoDeliverable, Note, Session, TaskDetail, TaskPatch, TaskStatus } from "../../api/types";
import { InlineEdit } from "../../components/InlineEdit";
import { toast } from "../../components/Toast";
import { compactCount, minutesToHoursInput } from "../../lib/format";
import { jstDateOf, weekOfDate } from "../../lib/jst";
import { isComposingEvent } from "../../lib/ime";
import { joinRequesters, splitRequesters } from "../../lib/requesters";
import { HOURS_TO_MINUTES, parseTaskHours, relativeToCwd } from "../../lib/taskDetail";
import { sumTokens } from "../../lib/tokens";
import { fmtMoney } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t, tn } from "../../i18n/t";
import { hmOf, mdOf, weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { PolishMark } from "../../ui/PolishMark";
import { Mod } from "../../ui/Mod";
import { machineLabel } from "../../ui/machine";
import { lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { elapsed, taskCode } from "../now/format";
import { reportWriteError } from "../timeline/SessionDrawer";
import { DayStrip } from "./DayStrip";
import type { TaskRow } from "./layout";

const h1 = (m: number) => (m / 60).toFixed(1);
const LAMP: Record<TaskStatus, string> = { open: "live", hold: "amber", done: "dim" };
/** The prototype's transitions: the likely next step first (pri). */
const NEXT: Record<TaskStatus, [TaskStatus, StrKey, boolean][]> = {
  open: [["done", "tk.d.toDone", true], ["hold", "tk.d.toHold", false]],
  hold: [["open", "tk.d.toOpen", true], ["done", "tk.d.toDone", false]],
  done: [["open", "tk.d.toOpen", true], ["hold", "tk.d.toHold", false]],
};
const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404;
/** Focus went with a control that unmounted (it sits on the page or on the drawer itself, an ancestor of `el`). */
const focusLost = (el: Element | null) => { const a = document.activeElement; return !a || (!!el && a.contains(el)); };

/** The 案件 drawer's content (prototype page-tasks.html renderDrawer): every field of the old TaskDrawer,
 *  edited in place. `row` is the list's row for this task (this week's per-day minutes); `days` the week's days. */
export function TaskDrawer({ id, row, days, live, onClose }: {
  id: string; row: TaskRow | undefined; days: string[];
  /** Sessions 运行中 by the 此刻 rule (the week layout's). */
  live: string[]; onClose: () => void;
}) {
  const { lang } = useV2();
  // After a delete the drawer is still mounted for a moment (closing only changes the hash), and the delete's own
  // invalidation would rebuild the removed ["task", id] query: a guaranteed 404 flashing 案件不存在. An empty id is
  // useTask's disabled case; the last detail stays on screen for those frames (the old drawer's deletedRef).
  const deleted = useRef(false), last = useRef<TaskDetail | undefined>(undefined);
  const q = useTask(deleted.current ? "" : id);
  if (q.data) last.current = q.data;
  const detail = q.data ?? (deleted.current ? last.current : undefined);
  const lc = lineColor(id);
  return (
    <div className="dw" style={{ "--lc": lc } as CSSProperties}>
      <div className="dw-h">
        <TaskBadge id={id} height={BADGE_H.drawer} /><span className="code">{taskCode(id)}</span>
        <span className="id">{id}</span>
        <span className="grow" />
        <button type="button" className="ib lg2-fill" aria-label={t(lang, "common.close")} onClick={onClose}>×</button>
      </div>
      <div className="dw-b">
        {detail
          ? <Body d={detail} row={row} days={days} live={live} onDeleted={() => { deleted.current = true; }} onClose={onClose} />
          : q.isError
          ? (isNotFound(q.error)
              ? <p className="mute" role="status">{t(lang, "tk.d.notFound")}</p>
              : <p className="mute" role="alert">{t(lang, "tk.d.loadFailed")} <button type="button" className="fb lg2-fill" onClick={() => void q.refetch()}>{t(lang, "tl.retry")}</button></p>)
          : <p className="mute" role="status">{t(lang, "tk.d.loading")}</p>}
      </div>
    </div>
  );
}

function Body({ d, row, days, live, onDeleted, onClose }: {
  d: TaskDetail; row: TaskRow | undefined; days: string[]; live: string[]; onDeleted: () => void; onClose: () => void;
}) {
  const { lang } = useV2();
  const k = d.task;
  const patch = usePatchTask();
  const save = (p: TaskPatch) => patch.mutateAsync({ id: k.id, updatedAt: k.updated_at, patch: p }).then(() => {});
  // Hidden sessions are 不计入 for hours, and so for tokens and cost too (the old drawer's rule).
  const tok = sumTokens(d.sessions.filter((s) => s.hidden !== 1));
  const per = row?.perDay ?? days.map(() => 0), mx = Math.max(0, ...per);
  return (
    <>
      <InlineEdit ariaLabel={t(lang, "tk.d.title")} className="dw-title" value={k.title}
        onSave={async (v) => { if (v.trim() === "") { toast.info(t(lang, "tk.d.titleEmpty")); return; } await save({ title: v.trim() }); }}
        display={<span>{k.title}</span>} />
      <PolishMark meta={k._polish?.title} entity="task" entityId={k.id} field="title" />
      <div className="fields">
        <span className="k">{t(lang, "tk.d.req")}</span><Requesters requester={k.requester} save={save} />
        <span className="k">{t(lang, "tk.d.proj")}</span>
        <InlineEdit ariaLabel={t(lang, "tk.d.proj")} value={k.project} onSave={(v) => save({ project: v.trim() })} display={<span>{k.project || "--"}</span>} />
        <span className="k">{t(lang, "tk.d.recv")}</span>
        <InlineEdit ariaLabel={t(lang, "tk.d.recv")} className="num" type="date" value={k.received_at} onSave={(v) => save({ received_at: v })} />
        <span className="k">{t(lang, "tk.d.done")}</span><span className="num">{k.done_at ?? "--"}</span>
        <span className="k">{t(lang, "tk.d.status")}</span><Status status={k.status} save={save} />
        <span className="k">{t(lang, "tk.d.manual")}</span>
        <InlineEdit ariaLabel={t(lang, "tk.d.manual")} className="hours-edit num" placeholder="h" parse={parseTaskHours}
          value={k.hours_manual !== null ? minutesToHoursInput(k.hours_manual * HOURS_TO_MINUTES) : ""}
          onSave={async (v) => { const p = parseTaskHours(v); if (p.ok) await save({ hours_manual: p.minutes / HOURS_TO_MINUTES }); }}
          restore={k.hours_manual !== null ? { label: t(lang, "tk.d.restoreHours"), onRestore: () => save({ hours_manual: null }) } : undefined}
          display={k.hours_manual !== null ? <>{h1(k.hours_manual * HOURS_TO_MINUTES)}h <span className="mark">✎</span></> : <span className="mute">{t(lang, "tk.d.auto")}</span>} />
      </div>
      <div className="sum">
        <span className="big">{h1(d.total_minutes)}<small>h {t(lang, "tk.d.total")}</small></span>
        <span className="sit">{t(lang, "tk.d.week", { h: row ? `${h1(row.week)}h` : "--" })} · {tn(lang, "tk.u.sess", d.sessions.length)}</span>
        <Mod id="tasks.cost" className="sit">
          {tok.collected === 0 && tok.notCollected > 0
            ? t(lang, "tk.d.tokNone")
            : tok.collected > 0 && <>
                {t(lang, "tk.d.cost", { c: tok.cost === null ? "--" : `${fmtMoney(tok.cost, lang)}${tok.partial ? "*" : ""}` })}
                {tok.tokens > 0 && ` · ${t(lang, "tk.d.tok", { n: compactCount(tok.tokens) })}`}
                {tok.notCollected > 0 && ` · ${t(lang, "tk.d.tokMissing", { n: tn(lang, "tk.u.sess", tok.notCollected) })}`}
              </>}
        </Mod>
      </div>
      <div className="wk" aria-hidden="true">
        {days.map((day, i) => (
          <span key={day} className="d">
            <DayStrip vals={[per[i]]} max={mx} color={lineColor(k.id)} opt={{ colW: 9, gap: 0, rows: 14 }} height={45} />
            <b>{per[i] ? h1(per[i]) : "–"}</b>
            <span>{mdOf(day)} {t(lang, `tl.dow.${weekdayOfDate(day)}` as StrKey)}</span>
          </span>
        ))}
      </div>
      <h3>{t(lang, "tk.d.think")}<span className="grow" /></h3>
      <InlineEdit ariaLabel={t(lang, "tk.d.think")} className="prose" multiline value={k.thinking} onSave={(v) => save({ thinking: v })}
        display={k.thinking ? <span>{k.thinking}</span> : <span className="mute">{t(lang, "tk.d.thinkEmpty")}</span>} />
      <PolishMark meta={k._polish?.thinking} entity="task" entityId={k.id} field="thinking" />
      <Deliverables d={d} save={save} />
      <Sessions sessions={d.sessions} live={live} />
      <Notes notes={d.notes} />
      <Danger d={d} onDeleted={onDeleted} onClose={onClose} />
    </>
  );
}

/** 成果物: the hand-picked ones (add one / × one, stored in task.deliverables) and the automatic ones the server
 *  derives from the linked sessions (files they wrote, Artifacts they published; server deliverables/derive.ts):
 *  × takes one out, ＋ on the 已排除 list puts it back. Every hand-picked write rebuilds the whole array from what
 *  this render sees, so one at a time: a second while the first is in flight is ignored. */
function Deliverables({ d, save }: { d: TaskDetail; save: (p: TaskPatch) => Promise<void> }) {
  const { lang } = useV2();
  const list = d.task.deliverables;
  const [draft, setDraft] = useState("");
  const [all, setAll] = useState(false);
  const busy = useRef(false);
  const verdict = useDeliverableVerdict();
  const write = async (next: string[], after?: () => void, failed?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    try { await save({ deliverables: next }); after?.(); } catch (err) { failed?.(); reportWriteError(lang, err); } finally { busy.current = false; }
  };
  // × unmounts the focused button: hand focus to the next ×, else the previous one, else the add box
  const ul = useRef<HTMLUListElement>(null), box = useRef<HTMLInputElement>(null), gone = useRef<number | null>(null);
  const auto = d.auto_deliverables ?? [];
  const shown = auto.filter((a) => a.verdict !== "out"), excluded = auto.filter((a) => a.verdict === "out");
  const sig = [...list, ...shown.map((a) => a.key)].join("\n");
  useEffect(() => {
    const i = gone.current;
    if (i === null) return;
    gone.current = null;
    if (!focusLost(box.current)) return;
    const xs = ul.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    (xs[i] ?? xs[i - 1] ?? box.current)?.focus();
  }, [sig]);
  // One write at a time across both kinds: the focus hand-off below reads one `gone` index.
  const remove = (i: number) => {
    if (busy.current || verdict.isPending) return;
    gone.current = i;
    void write(list.filter((_, j) => j !== i), undefined, () => { gone.current = null; });
  };
  // ＋ on the last 已排除 one empties that list: fold it and hand focus to the add box.
  const judge = (a: AutoDeliverable, v: "in" | "out", at?: number) => {
    if (busy.current || verdict.isPending) return;
    if (at !== undefined) gone.current = at;
    verdict.mutate({ key: a.key, kind: a.kind, verdict: v }, {
      onSuccess: () => { if (v === "in" && excluded.length === 1) { setAll(false); box.current?.focus(); } },
      onError: (err) => { gone.current = null; reportWriteError(lang, err); },
    });
  };
  const cwdOf = new Map(d.sessions.map((x) => [x.id, x.cwd]));
  const label = (a: AutoDeliverable) => a.kind === "artifact" ? (a.title ?? a.key) : relativeToCwd(a.key, cwdOf.get(a.sessions[0]) ?? "");
  const tag = (a: AutoDeliverable) => t(lang, a.verdict === "pending" ? "tk.d.src.pending" : a.kind === "artifact" && a.source === "rule"
    ? "tk.d.src.artifact" : `tk.d.src.${a.source ?? "rule"}` as StrKey);
  const autoRow = (a: AutoDeliverable, i: number | undefined, v: "in" | "out") => {
    const p = label(a);
    return (
      <li key={a.key} className={a.verdict === "pending" ? "pend" : undefined}>
        {a.kind === "artifact"
          ? <span className="ttl">{/^https?:\/\//.test(a.key) ? <a href={a.key} target="_blank" rel="noreferrer" title={a.key}>{p}</a> : p}</span>
          : <span title={a.key}><bdi dir="ltr">{p}</bdi></span>}
        <span className="src" title={a.reason || undefined}>{tag(a)}</span>
        <button type="button" className="fb lg2-fill" aria-label={t(lang, v === "out" ? "tk.d.autoOut" : "tk.d.autoIn", { p })}
          onClick={() => judge(a, v, i)}>{v === "out" ? "×" : "＋"}</button>
      </li>
    );
  };
  return (
    <>
      {/* The count is what the 週報 and the dashboard count: hand-picked + in; pending rows are listed, tagged, not counted. */}
      <h3>{t(lang, "tk.d.deliv")} <span className="n">{list.length + shown.filter((a) => a.verdict === "in").length}</span><span className="grow" /></h3>
      {list.length + shown.length === 0
        ? <p className="mute">{t(lang, "tk.d.delivNone")}</p>
        : <ul ref={ul} className="files">
            {list.map((f, i) => (
              <li key={`${f}-${i}`}><span title={f}><bdi dir="ltr">{f}</bdi></span>
                <button type="button" className="fb lg2-fill" aria-label={t(lang, "tk.d.rmDeliv", { p: f })} onClick={() => remove(i)}>×</button>
              </li>
            ))}
            {shown.map((a, i) => autoRow(a, list.length + i, "out"))}
          </ul>}
      <input ref={box} className="add wide" aria-label={t(lang, "tk.d.newDelivLabel")} placeholder={t(lang, "tk.d.newDeliv")} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || isComposingEvent(e, false)) return;
          e.preventDefault();
          const v = draft.trim();
          if (v) void write([...list, v], () => setDraft(""));
        }} />
      {excluded.length > 0 && (all
        ? <><ul className="files">{excluded.map((a) => autoRow(a, undefined, "in"))}</ul>
            <button type="button" className="fb lg2-fill" aria-expanded="true" onClick={() => setAll(false)}>{t(lang, "tk.d.less")}</button></>
        : <button type="button" className="fb lg2-fill" aria-expanded="false" onClick={() => setAll(true)}>{t(lang, "tk.d.excl", { n: excluded.length })}</button>)}
    </>
  );
}

/** 依頼元 as chips (add one / ✕ one), saved back as the one "、"-joined string. Each write rebuilds the whole
 *  list, so a second one while the first is in flight is ignored (it would undo the first); the last one has no ✕. */
function Requesters({ requester, save }: { requester: string; save: (p: TaskPatch) => Promise<void> }) {
  const { lang } = useV2();
  const [draft, setDraft] = useState("");
  const busy = useRef(false), listId = useId();
  const sug = useRequesters();
  const names = splitRequesters(requester);
  const write = async (next: string[], after?: () => void, failed?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    try { await save({ requester: joinRequesters(next) }); after?.(); } catch (err) { failed?.(); reportWriteError(lang, err); } finally { busy.current = false; }
  };
  // × unmounts the focused button: hand focus to the next ×, else the previous one, else the add box
  const chips = useRef<HTMLSpanElement>(null), box = useRef<HTMLInputElement>(null), gone = useRef<number | null>(null);
  useEffect(() => {
    const i = gone.current;
    if (i === null) return;
    gone.current = null;
    if (!focusLost(box.current)) return;
    const xs = chips.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    (xs[i] ?? xs[i - 1] ?? box.current)?.focus();
  }, [requester]);
  const remove = (i: number) => {
    if (busy.current) return;
    gone.current = i;
    void write(names.filter((_, j) => j !== i), undefined, () => { gone.current = null; });
  };
  const add = () => {
    const next = splitRequesters(joinRequesters([...names, draft]));
    if (next.length === names.length) { setDraft(""); return; }
    void write(next, () => setDraft(""));
  };
  return (
    <span ref={chips} className="chips" lang="ja">
      {names.map((n, i) => (
        <span key={n} className="chip lg2-fill">{n}
          {names.length > 1 && <button type="button" aria-label={t(lang, "tk.d.rmReq", { n })} onClick={() => remove(i)}>×</button>}
        </span>
      ))}
      <input ref={box} className="add" aria-label={t(lang, "tk.d.addReqLabel")} placeholder={t(lang, "tk.d.addReq")} list={listId} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !isComposingEvent(e, false)) { e.preventDefault(); add(); } }} />
      <datalist id={listId}>{(sug.data ?? []).map((r) => <option key={r} value={r} />)}</datalist>
    </span>
  );
}

/** The badge and the transitions out of it; done_at is never sent (the server fills it). A second click while
 *  the first is in flight is ignored. */
function Status({ status, save }: { status: TaskStatus; save: (p: TaskPatch) => Promise<void> }) {
  const { lang } = useV2();
  const busy = useRef(false), row = useRef<HTMLSpanElement>(null), moved = useRef(false);
  // the buttons are keyed by their target status: the clicked one unmounts, so focus goes to the new first one
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (focusLost(row.current)) row.current?.querySelector("button")?.focus();
  }, [status]);
  const go = async (s: TaskStatus) => {
    if (busy.current) return;
    busy.current = true;
    moved.current = true;
    try { await save({ status: s }); } catch (err) { moved.current = false; reportWriteError(lang, err); } finally { busy.current = false; }
  };
  return (
    <span ref={row} className="st-row">
      <span className="badge"><span className={`lamp ${LAMP[status]}`} />{t(lang, `tk.st.${status}` as StrKey)}</span>
      {NEXT[status].map(([s, key, pri]) => (
        <button key={s} type="button" className={`fb lg2-fill${pri ? " pri" : ""}`} onClick={() => void go(s)}>{t(lang, key)}</button>
      ))}
    </span>
  );
}

const hm = (m: number) => elapsed(m * 60_000);

/** 关联会话 by start day, newest day first, each with 解除关联 and 隐藏 / 恢复显示 (prototype sessionsHtml). A day's
 *  hours count only the not-hidden ones. A row's time opens it on the timeline. */
function Sessions({ sessions, live }: { sessions: Session[]; live: string[] }) {
  const { lang } = useV2();
  // 解除关联 takes the row (and its focused button) away: focus the same day's next row, else that day, else the heading
  const head = useRef<HTMLHeadingElement>(null), gone = useRef<{ id: string; day: string; next: string[] } | null>(null);
  const sig = sessions.map((s) => s.id).join(",");
  useEffect(() => {
    const g = gone.current;
    if (!g || sig.split(",").includes(g.id)) return;
    gone.current = null;
    const root = head.current?.parentElement;
    if (!root || !focusLost(head.current)) return;
    const q = (sel: string) => root.querySelector<HTMLElement>(sel);
    const next = g.next.map((id) => q(`.ss[data-id="${CSS.escape(id)}"] a.tm`)).find((e) => e !== null);
    (next ?? q(`.day[data-day="${g.day}"]`) ?? head.current)?.focus();
  }, [sig]);
  const days = new Map<string, Session[]>();
  for (const s of [...sessions].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))) {
    const d = jstDateOf(s.started_at);
    days.set(d, [...(days.get(d) ?? []), s]);
  }
  return (
    <>
      <h3 ref={head} tabIndex={-1}>{t(lang, "tk.d.sess")} <span className="n">{sessions.length}</span><span className="grow" /></h3>
      {sessions.length === 0 && <p className="mute">{t(lang, "tk.d.none")}</p>}
      {[...days].reverse().map(([day, ss]) => (
        <div key={day} className="day" data-day={day} tabIndex={-1}>
          <div className="dl"><b>{mdOf(day)}</b><span>{t(lang, `tl.dow.${weekdayOfDate(day)}` as StrKey)}</span>
            <span>{h1(ss.filter((s) => !s.hidden).reduce((n, s) => n + s.minutes_effective, 0))}h</span></div>
          {ss.map((s, j) => <SessionLine key={s.id} s={s} day={day} live={live.includes(s.id)}
            onUnlink={(on) => { gone.current = on ? { id: s.id, day, next: ss.slice(j + 1).map((x) => x.id) } : null; }} />)}
        </div>
      ))}
    </>
  );
}

function SessionLine({ s, day, live, onUnlink }: {
  s: Session; day: string; live: boolean;
  /** true as 解除关联 starts (the list then knows where focus goes when this row leaves), false if it failed */
  onUnlink: (on: boolean) => void;
}) {
  const { lang } = useV2();
  const patch = usePatchSession();
  const busy = useRef(false);
  const tm = `${hmOf(Date.parse(s.started_at))}–${hmOf(Date.parse(s.ended_at))}`;
  // one write at a time per line: a double click must not send a second PATCH (and 409 on its own token)
  const run = async (p: { task_id: null } | { hidden: boolean }, done: (row: Session | null) => void, failed?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    try { const row = await patch.mutateAsync({ id: s.id, updatedAt: s.updated_at, patch: p }); done(row); }
    catch (err) { failed?.(); reportWriteError(lang, err); } finally { busy.current = false; }
  };
  const unlink = () => {
    if (!busy.current) onUnlink(true);
    return run({ task_id: null }, () => toast.info(t(lang, "tl.p.unlinked")), () => onUnlink(false));
  };
  const hide = () => run({ hidden: !s.hidden }, (row) => {
    if (s.hidden || !row) return;
    toast.info(t(lang, "tl.p.hiddenDone"), {
      label: t(lang, "tl.p.undo"),
      // the hide's own answer carries the fresh updated_at; the row from before would 409 against it
      onClick: () => { void patch.mutateAsync({ id: row.id, updatedAt: row.updated_at, patch: { hidden: false } }).catch((e) => toast.error(t(lang, e instanceof ConflictError ? "tl.p.conflict" : "tl.p.undoFailed"))); },
    }, 10_000);
  });
  return (
    <div className={`ss${s.hidden ? " hid" : ""}`} data-id={s.id}>
      <a className="tm" href={`#/v2/timeline/${weekOfDate(day)}?day=${day}&s=${encodeURIComponent(s.id)}${s.hidden ? "&hidden=1" : ""}`} aria-label={t(lang, "tk.d.inTl", { t: `${mdOf(day)} ${tm}` })}>{tm}</a>
      <span className="mc">{machineLabel(s.machine)} · {t(lang, "tl.p.min", { n: s.minutes_effective })}
        {live && <> · <span className="live">{t(lang, "tl.row.live")}</span></>}
        {s.hidden === 1 && <> · {t(lang, "tk.d.excluded")}</>}
      </span>
      <span className="ac">
        <button type="button" className="fb lg2-fill" onClick={() => void unlink()}>{t(lang, "tl.p.unlink")}</button>
        <button type="button" className="fb lg2-fill" onClick={() => void hide()}>{t(lang, s.hidden ? "tl.p.unhide" : "tk.d.hide")}</button>
      </span>
      <span className="sm">{s.summary_effective || "--"}</span>
    </div>
  );
}

function Notes({ notes }: { notes: Note[] }) {
  const { lang } = useV2();
  return (
    <>
      <h3>{t(lang, "tk.d.notes")} <span className="n">{notes.length}</span><span className="grow" /></h3>
      {notes.length === 0
        ? <p className="mute">{t(lang, "tk.d.none")}</p>
        : notes.map((n) => (
            <div key={n.id} className="note">
              <span className="dd">{mdOf(n.ts.slice(0, 10))}</span>
              <span>{n.text}</span>
              <span className="hh">{n.minutes !== null ? hm(n.minutes) : ""}</span>
            </div>
          ))}
    </>
  );
}

/** 删除案件: refused while anything is linked (the server refuses too, and its counts win when this copy was
 *  stale — it also knows the plan items this detail does not carry). One confirm step in place; Esc backs out. */
function Danger({ d, onDeleted, onClose }: { d: TaskDetail; onDeleted: () => void; onClose: () => void }) {
  const { lang } = useV2();
  const del = useDeleteTask();
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const cancel = useRef<HTMLButtonElement>(null), trigger = useRef<HTMLButtonElement>(null), prev = useRef(step);
  useEffect(() => {
    if (step === "confirm") cancel.current?.focus();
    else if (step === "idle" && prev.current !== "idle") trigger.current?.focus();
    prev.current = step;
  }, [step]);
  const s = d.sessions.length, n = d.notes.length, code = taskCode(d.task.id);
  const run = async () => {
    setStep("busy");
    try {
      // flagged from the mutation's own success callback: it runs in the same batch that re-renders the drawer,
      // the await continuation one microtask later — one render too late to stop the 404 refetch
      await del.mutateAsync({ id: d.task.id, updatedAt: d.task.updated_at }, { onSuccess: onDeleted });
      toast.info(t(lang, "tk.d.deleted", { c: code }));
      onClose();
    } catch (err) {
      setStep("idle");
      if (isLinkedError(err)) {
        const b = err.body;
        const su = tn(lang, "tk.u.sess", b.sessions), nu = tn(lang, "tk.u.note", b.notes);
        toast.error(b.plans ? t(lang, "tk.d.linkedPlans", { s: su, n: nu, p: tn(lang, "tk.u.plan", b.plans) }) : t(lang, "tk.d.linked", { s: su, n: nu }));
      } else toast.error(t(lang, err instanceof ConflictError ? "tk.d.delConflict" : "tk.d.delFailed"));
    }
  };
  return (
    <div className="danger">
      <h3>{t(lang, "tk.d.danger")}<span className="grow" /></h3>
      {step === "idle"
        ? <>
            <button ref={trigger} type="button" className="fb lg2-fill warn" disabled={s + n > 0} onClick={() => setStep("confirm")}>{t(lang, "tk.d.delete")}</button>
            {s + n > 0 && <p className="mute">{t(lang, "tk.d.linked", { s: tn(lang, "tk.u.sess", s), n: tn(lang, "tk.u.note", n) })}</p>}
          </>
        : <span className="opts" role="alertdialog" aria-label={t(lang, "tk.d.delConfirm", { c: code })}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (step === "confirm") setStep("idle"); } }}>
            <span className="mute">{t(lang, "tk.d.delConfirm", { c: code })}</span>
            <button type="button" className="fb lg2-fill pri warn" disabled={step === "busy"} onClick={() => void run()}>{t(lang, "tk.d.delDo")}</button>
            <button ref={cancel} type="button" className="fb lg2-fill" disabled={step === "busy"} onClick={() => setStep("idle")}>{t(lang, "tk.d.delCancel")}</button>
          </span>}
    </div>
  );
}
