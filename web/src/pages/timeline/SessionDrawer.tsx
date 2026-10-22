import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ConflictError, UnauthorizedError } from "../../api/client";
import { useHideSessions, usePatchSession, type HideSessionsAuthError, type HideSessionsResult } from "../../api/queries";
import type { Session, Task } from "../../api/types";
import { TaskSelect } from "../../components/TaskSelect";
import { toast } from "../../components/Toast";
import { InlineEdit } from "../../components/InlineEdit";
import { compactCount, dirName, minutesToHoursInput, parseHoursInput } from "../../lib/format";
import { sumTokens } from "../../lib/tokens";
import { fmtMoney } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { hmOf, jstDate, mdOf, weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { PolishMark } from "../../ui/PolishMark";
import { machineLabel } from "../../ui/machine";
import { lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { elapsed, taskCode } from "../now/format";
import { linkedTask, suggestTasks } from "./rows";
import { reportWriteError } from "../writeError";
export { reportWriteError };

const hm = (m: number) => elapsed(m * 60_000);
/** The session drawer's content (prototype page-timeline.html:440-480): what it was, its 案件 (link, change,
 *  unlink, or a new 案件), and its facts. `day` is the day it was opened from (its share of a cross-day session). */
export function SessionDrawer({ s, day, tasks, pool, live, onClose, dir, onDir, sameDir }: {
  s: Session; day: string | null; tasks: Record<string, Task>; pool: Session[]; live: boolean; onClose: () => void;
  /** 只看此目录: the page's filter and its setter. */
  dir: string | null; onDir: (cwd: string | null) => void;
  /** This week's not-hidden sessions in s's directory (null when s is not one of the week's sessions). */
  sameDir: Session[] | null;
}) {
  const { lang } = useV2();
  const k = linkedTask(s, tasks), task = k ? tasks[k] : undefined;
  const a = Date.parse(s.started_at), b = Date.parse(s.ended_at), date = day ?? jstDate(a);
  // the day's share only when opened from a day; from the cross-week list it is the whole session (R8)
  const mins = day ? s.minutes_on_day ?? s.minutes_effective : s.minutes_effective;
  const tok = sumTokens([s]);
  return (
    <div className="dw" style={{ "--lc": lineColor(k) } as CSSProperties}>
      <div className="dw-h">
        {k && <TaskBadge id={k} height={BADGE_H.drawer} />}
        <span className="code">{taskCode(k)}</span>
        <span className="id">{s.id}</span>
        {live && <span className="live">● {t(lang, "tl.row.live")}</span>}
        {s.hidden === 1 && <span className="hidtag">{t(lang, "tl.row.hidden")}</span>}
        <span className="grow" />
        <button type="button" className="ib lg2-fill" aria-label={t(lang, "common.close")} onClick={onClose}>×</button>
      </div>
      <div className="dw-b">
        {task
          ? <h2 className="dw-title">{task.title}</h2>
          : <h2 className="dw-title warn">{t(lang, "tl.p.unTitle")}</h2>}
        <div className="dw-when">
          <b>{t(lang, "tl.p.when", { d: mdOf(date), w: t(lang, `tl.dow.${weekdayOfDate(date)}` as StrKey), t: `${hmOf(a)}–${hmOf(b)}` })}</b> · {machineLabel(s.machine)} · {t(lang, "tl.p.min", { n: mins })}
        </div>
        <LinkBox s={s} k={k} tasks={tasks} pool={pool} mins={mins} />
        <div className="fields">
          <span className="k">{t(lang, "tl.p.iv")}</span>
          <span className="ivs">
            {(s.active_intervals?.length ? s.active_intervals : [[s.started_at, s.ended_at] as [string, string]]).map(([x, y]) => (
              <span key={x} className="iv">{hmOf(Date.parse(x))}–{hmOf(Date.parse(y))}</span>
            ))}
          </span>
          <span className="k">{t(lang, "tl.p.mach")}</span><span>{s.machine} · {s.agent}</span>
          <span className="k">{t(lang, "tl.p.dir")}</span><span className="mono" title={s.cwd}>{s.cwd || "--"}</span>
          {s.cwd && <><span /><DirBox cwd={s.cwd} active={dir === s.cwd} onDir={onDir} sameDir={sameDir} /></>}
          <span className="k">{t(lang, "tl.p.turns")}</span><span className="num">{s.turns}</span>
          <span className="k">{t(lang, "tl.p.cost")}</span>
          <span className="num">{s.tokens?.cost_usd != null ? `${fmtMoney(s.tokens.cost_usd, lang)}${s.tokens.cost_partial ? "*" : ""}` : "--"}</span>
          {tok.tokens > 0 && <>
            <span className="k">{t(lang, "tl.p.tokens")}</span>
            <span className="num">{t(lang, "tl.p.tok", { n: compactCount(tok.tokens) })}{tok.subagentTokens > 0 ? ` · ${t(lang, "tl.p.subagent", { p: Math.round((tok.subagentTokens / tok.tokens) * 100) })}` : ""}</span>
          </>}
          <span className="k">{t(lang, "tl.p.hours")}</span>
          <HoursEdit s={s} mins={mins} />
        </div>
        <h3>{t(lang, "tl.p.sum")}<span className="grow" /></h3>
        <SummaryEdit s={s} />
        <div className="acts">
          <HideButton s={s} onHidden={onClose} />
        </div>
      </div>
    </div>
  );
}

/** 本日工时: the whole session's minutes_override, shown as this day's share when it crosses midnight
 *  (the old SessionCard's rules: 0 is a real value, ↺ restores the collected minutes). */
function HoursEdit({ s, mins }: { s: Session; mins: number }) {
  const { lang } = useV2();
  const patch = usePatchSession();
  const save = (m: number | null) => patch.mutateAsync({ id: s.id, updatedAt: s.updated_at, patch: { minutes_override: m } }).then(() => {});
  return (
    <InlineEdit ariaLabel={t(lang, "tl.p.hours")} className="hours-edit num" value={minutesToHoursInput(s.minutes_effective)} placeholder="h"
      parse={parseHoursInput}
      onSave={async (d) => { const p = parseHoursInput(d); if (p.ok) await save(p.minutes); }}
      restore={s.minutes_override !== null ? { label: t(lang, "tl.p.restoreHours"), onRestore: () => save(null) } : undefined}
      display={<>
        {hm(mins)}
        {mins !== s.minutes_effective && <span className="mute"> {t(lang, "tl.p.whole", { h: hm(s.minutes_effective) })}</span>}
        {s.minutes_override !== null && <span className="mark"> ✎</span>}
      </>} />
  );
}

/** 摘要: an emptied box is not "back to automatic" — that is only ↺ (old contract 2). */
function SummaryEdit({ s }: { s: Session }) {
  const { lang } = useV2();
  const patch = usePatchSession();
  const save = (v: string | null) => patch.mutateAsync({ id: s.id, updatedAt: s.updated_at, patch: { summary_edited: v } }).then(() => {});
  return (
    <>
    <InlineEdit ariaLabel={t(lang, "tl.p.sum")} className="prose" multiline value={s.summary_effective}
      onSave={async (d) => { if (d.trim() === "") { toast.info(t(lang, "tl.p.sumEmpty")); return; } await save(d.trim()); }}
      restore={s.summary_edited !== null ? { label: t(lang, "tl.p.restoreSum"), onRestore: () => save(null) } : undefined}
      display={<>
        <span>{s.summary_effective || "--"}</span>
        {s.summary_edited !== null && <span className="mark"> ✎ {t(lang, "tl.p.edited")}</span>}
        {s.summary_source === "fallback" && s.summary_edited === null && <span className="mark warn"> {t(lang, "tl.p.fallback")}</span>}
      </>} />
    <PolishMark meta={s._polish?.summary} entity="session" entityId={s.id} field="summary" />
    </>
  );
}

/** 隐藏 closes the drawer (the row leaves the list) and offers 撤销 for ten seconds; 恢复显示 for a hidden one. */
function HideButton({ s, onHidden }: { s: Session; onHidden: () => void }) {
  const { lang } = useV2();
  const patch = usePatchSession();
  const busy = useRef(false);                 // a second click while the first is in flight is ignored (old F4)
  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (s.hidden) { await patch.mutateAsync({ id: s.id, updatedAt: s.updated_at, patch: { hidden: false } }); return; }
      const row = await patch.mutateAsync({ id: s.id, updatedAt: s.updated_at, patch: { hidden: true } });
      onHidden();
      toast.info(t(lang, "tl.p.hiddenDone"), {
        label: t(lang, "tl.p.undo"),
        // the hide's own answer carries the fresh updated_at; the row from before would 409 against it
        onClick: () => { void patch.mutateAsync({ id: row.id, updatedAt: row.updated_at, patch: { hidden: false } }).catch((e) => toast.error(t(lang, e instanceof ConflictError ? "tl.p.conflict" : "tl.p.undoFailed"))); },
      }, 10_000);
    } catch (err) { reportWriteError(lang, err); } finally { busy.current = false; }
  };
  return <button type="button" className="fb lg2-fill" onClick={() => void run()}>{t(lang, s.hidden ? "tl.p.unhide" : "tl.p.hide")}</button>;
}

/** 关联: suggestions for an unlinked session (same directory), the full picker (TaskSelect: any open task,
 *  未关联, or ＋ 新建案件…), and 解除关联 for a linked one. Every change is one PATCH of task_id. */
function LinkBox({ s, k, tasks, pool, mins }: { s: Session; k: string | null; tasks: Record<string, Task>; pool: Session[]; mins: number }) {
  const { lang } = useV2();
  const patch = usePatchSession();
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLDivElement>(null), pickBtn = useRef<HTMLButtonElement>(null), wasPicking = useRef(false), busy = useRef(false);
  // The picker replaces its button: focus goes onto it (so Esc / blur — TaskSelect's onExit — work at once)
  // and back to the button however it is left (the old SessionCard's F5).
  useEffect(() => {
    if (picking) { wasPicking.current = true; box.current?.querySelector("select")?.focus(); }
    else if (wasPicking.current) { wasPicking.current = false; pickBtn.current?.focus(); }
  }, [picking]);
  const sug = k ? [] : suggestTasks(s, pool, tasks);
  const link = async (taskId: string | null) => {
    setPicking(false);
    if (taskId === k || busy.current) return;             // a double click must not send a second PATCH (and 409)
    busy.current = true;
    try {
      await patch.mutateAsync({ id: s.id, updatedAt: s.updated_at, patch: { task_id: taskId } });
      toast.info(taskId ? t(lang, "tl.p.linked", { c: taskCode(taskId) }) : t(lang, "tl.p.unlinked"));
    } catch (err) { reportWriteError(lang, err); } finally {
      busy.current = false;
      // the suggestion or 解除关联 that was clicked is gone now: keep focus in the drawer
      if (!box.current?.contains(document.activeElement)) pickBtn.current?.focus();
    }
  };
  return (
    <div ref={box} className={`link${k ? "" : " warn"}`}>
      <div className="lk">{t(lang, "tl.p.task")}<span className="grow" />
        {k && <span className="mute">{t(lang, s.link_method === "manual" ? "tl.p.manual" : "tl.p.auto")}</span>}
      </div>
      {k
        ? <a className="cur" href={`#/v2/tasks/${encodeURIComponent(k)}`} aria-label={t(lang, "tk.row", { c: taskCode(k), t: tasks[k].title })}>
            <TaskBadge id={k} height={BADGE_H.chip} /><span>{tasks[k].title}</span></a>
        : <p className="hint">{t(lang, sug.length ? "tl.p.unHintSug" : "tl.p.unHint", { m: mins, dir: dirName(s.cwd) })}</p>}
      {sug.length > 0 && (
        <div className="opts">
          {sug.map((id) => (
            <button key={id} type="button" className="opt lg2-fill sug" style={{ "--lc": lineColor(id) } as CSSProperties} aria-label={t(lang, "tk.row", { c: taskCode(id), t: tasks[id].title })} onClick={() => void link(id)}>
              <i /><TaskBadge id={id} height={BADGE_H.chip} /><span>{tasks[id].title}</span><em>{t(lang, "tl.p.sug")}</em>
            </button>
          ))}
        </div>
      )}
      <div className="opts acts-row">
        {picking
          ? <TaskSelect value={k} onChange={(v) => void link(v)} onExit={() => setPicking(false)} defaultProject={dirName(s.cwd)} />
          : <button ref={pickBtn} type="button" className="fb lg2-fill" onClick={() => setPicking(true)}>{t(lang, k ? "tl.p.change" : "tl.p.pick")}</button>}
        {k && !picking && <button type="button" className="fb lg2-fill" onClick={() => void link(null)}>{t(lang, "tl.p.unlink")}</button>}
      </div>
    </div>
  );
}

/** The old DirectoryMenu's two actions, in the drawer: 只看此目录 (the page's filter) and hiding this week's
 *  not-hidden sessions in the directory — one PATCH each, in order (useHideSessions), after a confirm step. */
function DirBox({ cwd, active, onDir, sameDir }: { cwd: string; active: boolean; onDir: (cwd: string | null) => void; sameDir: Session[] | null }) {
  const { lang } = useV2();
  const hide = useHideSessions();
  const [step, setStep] = useState<"idle" | "confirm" | { done: number; total: number }>("idle");
  const alive = useRef(true), cancelBtn = useRef<HTMLButtonElement>(null), first = useRef<HTMLButtonElement>(null), prev = useRef(step);
  useEffect(() => () => { alive.current = false; }, []);
  // the confirm step takes focus on 取消 (the old dialog's); leaving it gives focus back to the row of buttons
  useEffect(() => {
    if (step === "confirm") cancelBtn.current?.focus();
    else if (step === "idle" && prev.current !== "idle") first.current?.focus();
    prev.current = step;
  }, [step]);
  const n = sameDir?.length ?? 0;
  const run = async () => {
    const items = (sameDir ?? []).map((x) => ({ id: x.id, updatedAt: x.updated_at }));
    setStep({ done: 0, total: items.length });
    try {
      const r = await hide.mutateAsync({ items, onProgress: (done, total) => { if (alive.current) setStep({ done, total }); } });
      const msg = hideResultText(lang, r);
      if (r.conflicted.length || r.errored.length) toast.error(msg); else toast.info(msg);
    } catch (err) {
      // a 401 stops the batch: the app's "login expired" banner is the real signal; say only how far it got
      if (err instanceof UnauthorizedError) {
        const n = (err as HideSessionsAuthError).hiddenBeforeExpiry ?? 0;
        toast.info(n > 0 ? t(lang, "tl.dir.expired", { n }) : t(lang, "tl.dir.expired0"));
      }
      else toast.error(t(lang, "tl.dir.failed"));
    } finally { if (alive.current) setStep("idle"); }
  };
  if (typeof step === "object") return <span className="opts" role="status">{t(lang, "tl.dir.progress", { a: step.done, b: step.total })}</span>;
  if (step === "confirm") return (
    <span className="opts" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setStep("idle"); } }}>
      <span className="mute">{t(lang, "tl.dir.confirm", { n })}</span>
      <button type="button" className="fb lg2-fill pri" onClick={() => void run()}>{t(lang, "tl.dir.do")}</button>
      <button ref={cancelBtn} type="button" className="fb lg2-fill" onClick={() => setStep("idle")}>{t(lang, "tl.dir.cancel")}</button>
    </span>
  );
  return (
    <span className="opts">
      <button ref={first} type="button" className="fb lg2-fill" aria-pressed={active} onClick={() => onDir(active ? null : cwd)}>{t(lang, active ? "tl.dir.off" : "tl.dir.only")}</button>
      {sameDir && <button type="button" className="fb lg2-fill warn" disabled={n === 0} onClick={() => setStep("confirm")}>{t(lang, "tl.dir.hideAll", { n })}</button>}
    </span>
  );
}

/** The batch's outcome in words: conflicts and other failures are told apart (a 500 is not "changed elsewhere"). */
export function hideResultText(lang: Lang, r: HideSessionsResult): string {
  const parts: string[] = [];
  if (r.conflicted.length) parts.push(t(lang, "tl.dir.conflicted", { n: r.conflicted.length }));
  if (r.errored.length) parts.push(t(lang, "tl.dir.errored", { n: r.errored.length }));
  if (!parts.length) return t(lang, "tl.dir.done", { n: r.hidden.length });
  const detail = parts.join(t(lang, "tl.dir.sep"));
  return r.hidden.length ? t(lang, "tl.dir.partial", { n: r.hidden.length, d: detail }) : t(lang, "tl.dir.none", { d: detail });
}
