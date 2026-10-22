import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { useMachines } from "../../api/queries";
import type { GridCell } from "../../api/types";
import { toast } from "../../components/Toast";
import { autoText } from "./ReportCell";
import { makeCalendar } from "../../cal/calendar";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { buildSnapshot } from "../../predict/snapshot";
import { hmOf, mdOf, weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { machineLabel } from "../../ui/machine";
import { lineColor } from "../../ui/palette";
import { overridePolishId, PolishMark } from "../../ui/PolishMark";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { taskCode } from "../now/format";
import { useMinute } from "../now/useNowData";
import { findCell, type Matrix, type MxCell, type MxEntry, type MxSource } from "./matrix";
import type { RpCell } from "./state";
import type { CellRef, ReportWrite } from "./write";

const autoMin = (c: GridCell) => Number(autoText(c)) || 0;
const shown = (c: GridCell) => (c.value === null ? "" : String(c.value));
const MINUTES = /^\d+$/;

/** A field of the drawer: an entry's minutes or its 作業内容. */
type Kind = "minutes" | "text";
interface Field { id: string; kind: Kind; ref: CellRef; cell: GridCell }
const fieldId = (rowKey: string, column: string) => `${rowKey}\u0000${column}`;

/** What a typed draft writes: the draft as the cell's value, "" on a number = back to automatic, null = not a number. */
function toValue(kind: Kind, draft: string): string | "" | null {
  const v = draft.trim();
  if (kind === "text") return draft;
  if (v === "") return "";
  return MINUTES.test(v) ? String(Number(v)) : null;
}

/** The 日別作業 cell editor (brief assumption 4, prototype page-report.html openCell()). Drafts are kept until
 *  保存 or a close: every way of closing (✕, Esc, the scrim, the address moving on) saves what was typed — the
 *  drawer unmounts then, so the save runs in the unmount cleanup (React fires no blur on unmount) — and only 取消
 *  drops it. Nothing saves on blur, so a click on a button never races a blur (Safari). The writes go through the
 *  page's queue, each decided on the cache when its turn comes. `m` is the matrix of the address's week, or null
 *  while that is not on screen yet. */
export function CellDrawer({ week, at, m, write, onClose }: {
  week: string; at: RpCell; m: Matrix | null; write: ReportWrite; onClose: () => void;
}) {
  const { lang } = useV2();
  const c = m && !m.pending ? findCell(m, at.taskId, at.date) : null;
  const title = c ? m!.rows.find((r) => r.taskId === at.taskId)?.title ?? null : null;
  return (
    <div className="dw rp-dw" style={{ "--lc": lineColor(at.taskId) } as CSSProperties}>
      <div className="dw-h">
        {at.taskId && <TaskBadge id={at.taskId} height={BADGE_H.drawer} />}
        <span className="tcode">{taskCode(at.taskId)}</span>
        <span className="dt">{t(lang, "rp.e.date", { d: mdOf(at.date), w: t(lang, `tl.dow.${weekdayOfDate(at.date)}` as StrKey) })}</span>
        <span className="grow" />
        <button type="button" className="ib lg2-fill" aria-label={t(lang, "common.close")} onClick={onClose}>✕</button>
      </div>
      <div className="dw-b">
        {c && m
          ? <Body week={week} c={c} m={m} title={title} write={write} onClose={onClose} />
          : !m || m.pending
          ? <p className="mute" role="status">{t(lang, "now.loading")}</p>
          : <p className="mute" role="status">{t(lang, "rp.e.noCell")}</p>}
      </div>
    </div>
  );
}

function Body({ week, c, m, title, write, onClose }: {
  week: string; c: MxCell; m: Matrix; title: string | null; write: ReportWrite; onClose: () => void;
}) {
  const { lang } = useV2();
  const ref = (e: MxEntry, column: "minutes" | "text" | "date" | "task"): CellRef => ({ week, sheet: "days", row_key: e.rowKey, column, date: c.date });
  const fields = (e: MxEntry): Field[] => [
    { id: fieldId(e.rowKey, "minutes"), kind: "minutes", ref: ref(e, "minutes"), cell: e.minutesCell },
    { id: fieldId(e.rowKey, "text"), kind: "text", ref: ref(e, "text"), cell: e.textCell },
  ];
  const all = c.entries.flatMap(fields);
  /** preflight R2: the row's edited 日付 / 案件 — not editable here, only shown and restorable. */
  const moved = (e: MxEntry): Field[] => ([["date", e.dateCell], ["task", e.taskCell]] as const)
    .filter(([, cell]) => cell.overridden)
    .map(([column, cell]) => ({ id: fieldId(e.rowKey, column), kind: "text", ref: ref(e, column), cell }));

  // drafts live in a ref (the unmount cleanup reads them); a bump re-renders on typing
  const drafts = useRef(new Map<string, string>()), discard = useRef(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const value = (f: Field) => drafts.current.get(f.id) ?? shown(f.cell);
  const type = (f: Field, v: string) => {
    drafts.current.set(f.id, v);
    if (bad.has(f.id)) setBad((s) => { const n = new Set(s); n.delete(f.id); return n; });
    bump();
  };

  /** Queue every typed field's write, in the drawer's order. "close": the drawer is going, an invalid field is
   *  dropped (said by a toast); "save": an invalid field stops everything and is marked. A draft typed on an entry
   *  that has since left this cell (a re-read moved it) has nothing to write to: dropped, said by the same toast. */
  const commit = (how: "save" | "close"): boolean => {
    const typed = all.filter((f) => drafts.current.has(f.id));
    const lost = drafts.current.size > typed.length;
    const vals = typed.map((f) => [f, toValue(f.kind, drafts.current.get(f.id)!)] as const);
    const invalid = vals.filter(([, v]) => v === null).map(([f]) => f.id);
    if (how === "save" && invalid.length) { setBad(new Set(invalid)); return false; }
    if (invalid.length || lost) toast.error(t(lang, "rp.e.dropped"));
    drafts.current.clear();
    for (const [f, v] of vals) {
      if (v === null) continue;
      void (v === "" && f.kind !== "text" ? write.restore(f.ref) : write.save(f.ref, v));
    }
    return true;
  };
  const last = useRef(commit);
  last.current = commit;
  useEffect(() => () => { if (!discard.current) last.current("close"); }, []);

  const restore = (fs: Field[]) => {
    for (const f of fs) drafts.current.delete(f.id);
    setBad((s) => { const n = new Set(s); for (const f of fs) n.delete(f.id); return n; });
    bump();
    for (const f of fs) if (f.cell.overridden) void write.restore(f.ref);
  };
  const buttons = (
    <div className="btns">
      <button type="button" className="fb lg2-fill pri" onClick={() => { if (commit("save")) onClose(); }}>{t(lang, "rp.e.save")}</button>
      <button type="button" className="fb lg2-fill" onClick={() => { discard.current = true; drafts.current.clear(); onClose(); }}>{t(lang, "rp.e.cancel")}</button>
    </div>
  );
  const ed = { value, type, bad };

  return (
    <>
      {title !== null
        ? <h2 className="dw-title">{title}</h2>
        : <h2 className="dw-title">{t(lang, "rp.d.un")}</h2>}
      <div className="dw-sub">{t(lang, "rp.sh.days")}</div>
      {!c.entries.length
        ? <p className="mute">{t(lang, "rp.e.nothing")}</p>
        : <>
            {c.entries.map((e, i) => (
              <Entry key={`${e.rowKey}|${i}`} e={e} c={c} m={m} fs={fields(e)} mv={moved(e)} ed={ed} onRestore={restore} />
            ))}
            {buttons}
          </>}
      <Sources c={c} />
    </>
  );
}

interface Ed { value: (f: Field) => string; type: (f: Field, v: string) => void; bad: Set<string> }
const Ov = () => { const { lang } = useV2(); return <span className="ovtag">✎ {t(lang, "rp.e.ov")}</span>; };

/** An edited 日付 / 案件 (preflight R2): what it was computed as → what it was changed to, and a 恢复日付 / 案件 that
 *  deletes those edits through the page's queue, one per entry. */
function Moved({ fs, onRestore }: { fs: Field[]; onRestore: (fs: Field[]) => void }) {
  const { lang } = useV2();
  if (!fs.length) return null;
  return (
    <div className="moved">
      <b>{t(lang, "rp.e.moved")}</b>
      {fs.map((f) => (
        <div key={f.id} className="mv"><b>{t(lang, f.ref.column === "date" ? "rp.e.col.date" : "rp.e.col.task")}</b><span className="v">{autoText(f.cell)} → {shown(f.cell)}</span></div>
      ))}
      {/* named for what it restores: beside the 工数 / 作業内容 恢复自动值, two same-named buttons would undo different columns */}
      <div className="btns"><button type="button" className="fb lg2-fill" onClick={() => onRestore(fs)}>{t(lang, "rp.e.restoreMoved")}</button></div>
    </div>
  );
}

/** U2: one block per xlsx row — what it was, its 作業内容 and minutes, its own 恢复自动值. */
function Entry({ e, c, m, fs: [mf, tf], mv, ed, onRestore }: {
  e: MxEntry; c: MxCell; m: Matrix; fs: Field[]; mv: Field[]; ed: Ed; onRestore: (fs: Field[]) => void;
}) {
  const { lang } = useV2();
  const s = e.source;
  const head = s?.kind === "session" ? `${hmOf(Date.parse(s.session.started_at))}–${hmOf(Date.parse(s.session.ended_at))}` : s?.kind === "note" ? t(lang, "rp.e.note") : "—";
  const machine = s ? machineLabel(s.kind === "session" ? s.session.machine : s.note.machine) : null;
  // the server keys a session's row by its id alone, so a session over midnight is two rows with one override
  const other = m.rows.flatMap((r) => r.cells).filter((x) => x.date !== c.date && x.sourceRowKeys.includes(e.rowKey)).map((x) => mdOf(x.date));
  const label = `${head}${machine ? ` ${machine}` : ""}`;
  return (
    <div className="ent">
      <div className="ss">
        <span className="tm">{head}</span>
        <span className="mc">{machine ? `${machine} · ` : ""}{t(lang, "tl.p.min", { n: autoMin(mf.cell) })}</span>
        {e.overridden && <span className="sm"><Ov /></span>}
      </div>
      {other.length > 0 && <p className="xday">{t(lang, "rp.e.xday", { d: other.join(" / ") })}</p>}
      <div className="pm-w">
        <textarea className="ed" spellCheck={false} aria-label={`${t(lang, "rp.e.text")} ${label}`} value={ed.value(tf)} onChange={(x) => ed.type(tf, x.target.value)} />
        <PolishMark meta={tf.cell.polish} entity="report_override" field="value"
          entityId={overridePolishId(tf.ref.week, tf.ref.sheet, tf.ref.row_key, tf.ref.column)} />
      </div>
      {tf.cell.overridden && <div className="auto"><b>{t(lang, "rp.e.autoText")}</b>{autoText(tf.cell)}</div>}
      <div className="hrs">
        <input className="inp" inputMode="numeric" aria-label={`${t(lang, "rp.e.minutes")} ${label}`} placeholder={String(autoMin(mf.cell))}
          aria-invalid={ed.bad.has(mf.id) || undefined} value={ed.value(mf)} onChange={(x) => ed.type(mf, x.target.value)} />
        <span className="mute">{t(lang, "rp.e.minutes")}</span>
        {mf.cell.overridden && <span className="mute">{t(lang, "rp.e.autoText")} {autoText(mf.cell)}</span>}
        <span className="grow" />
        {(mf.cell.overridden || tf.cell.overridden) && <button type="button" className="fb lg2-fill" onClick={() => onRestore([mf, tf])}>{t(lang, "rp.e.restore")}</button>}
      </div>
      {ed.bad.has(mf.id) && <p className="err" role="alert">{t(lang, "rp.e.badMin")}</p>}
      <Moved fs={mv} onRestore={onRestore} />
    </div>
  );
}

/** 来源: the timeline's sessions and notes behind this cell, with whether a session is running now (the 此刻 rule). */
function Sources({ c }: { c: MxCell }) {
  const { lang, prefs } = useV2();
  const machines = useMachines().data;
  const now = useMinute().getTime();
  const running = useMemo(() => {
    if (!Array.isArray(machines)) return new Set<string>();
    const sessions = c.sources.flatMap((s) => (s.kind === "session" ? [s.session] : []));
    const snap = buildSnapshot({ now, machines, sessions, tasks: [], planItems: [], dayPlan: null, downloads: [] }, prefs.predict.runningMin, makeCalendar(prefs.cal).isOff);
    return new Set(snap.running.map((r) => r.session.id));
  }, [machines, c.sources, now, prefs.predict.runningMin, prefs.cal]);
  return (
    <>
      <h3>{t(lang, "rp.e.src")} <span className="n">{c.sources.length}</span><span className="grow" /></h3>
      <p className="mute hint">{t(lang, "rp.e.srcHint")}</p>
      {c.sources.map((s) => <Source key={`${s.kind}:${s.id}`} s={s} live={s.kind === "session" && running.has(s.id)} />)}
    </>
  );
}

function Source({ s, live }: { s: MxSource; live: boolean }) {
  const { lang } = useV2();
  const min = s.minutes ? t(lang, "tl.p.min", { n: s.minutes }) : "—";
  if (s.kind === "note") {
    return (
      <div className="ss">
        <span className="tm">{t(lang, "rp.e.note")}</span>
        <span className="mc">{machineLabel(s.note.machine)} · {min}</span>
        <span className="sm">{s.note.text}</span>
      </div>
    );
  }
  const x = s.session;
  return (
    <div className="ss">
      <span className="tm">{hmOf(Date.parse(x.started_at))}–{hmOf(Date.parse(x.ended_at))}</span>
      <span className="mc">{machineLabel(x.machine)} · {min}{live && <> · <span className="live">{t(lang, "rp.e.live")}</span></>}</span>
      <span className="sm">{x.summary_effective}</span>
    </div>
  );
}
