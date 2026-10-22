import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useDeleteNote, usePatchNote } from "../../api/queries";
import type { Note, Task } from "../../api/types";
import { InlineEdit } from "../../components/InlineEdit";
import { TaskSelect } from "../../components/TaskSelect";
import { toast } from "../../components/Toast";
import { minutesToHoursInput, parseHoursInput } from "../../lib/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { mdOf, weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { PolishMark } from "../../ui/PolishMark";
import { machineLabel } from "../../ui/machine";
import { lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { elapsed, taskCode } from "../now/format";
import { linkedTask } from "./rows";
import { reportWriteError } from "./SessionDrawer";

/** A 补记 in the drawer (the old NoteRow's edits): its text, its minutes (清除 = no duration), its 案件, delete. */
export function NoteDrawer({ n, tasks, onClose }: { n: Note; tasks: Record<string, Task>; onClose: () => void }) {
  const { lang } = useV2();
  const patch = usePatchNote(), del = useDeleteNote();
  const [picking, setPicking] = useState(false), [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null), pickBtn = useRef<HTMLButtonElement>(null), delBtn = useRef<HTMLButtonElement>(null), cancelBtn = useRef<HTMLButtonElement>(null);
  const was = useRef({ picking: false, confirming: false });
  // same focus rules as the session drawer: onto the picker / 取消, back to the button that opened it
  useEffect(() => {
    if (picking) box.current?.querySelector("select")?.focus(); else if (was.current.picking) pickBtn.current?.focus();
    if (confirming) cancelBtn.current?.focus(); else if (was.current.confirming) delBtn.current?.focus();
    was.current = { picking, confirming };
  }, [picking, confirming]);
  const k = linkedTask(n, tasks), date = n.ts.slice(0, 10);
  const save = (p: { text?: string; minutes?: number | null; task_id?: string | null }) =>
    patch.mutateAsync({ id: n.id, updatedAt: n.updated_at, patch: p }).then(() => {});
  const relink = async (v: string | null) => {
    setPicking(false);
    if (v === k) return;
    try { await save({ task_id: v }); } catch (err) { reportWriteError(lang, err); }
  };
  const remove = async () => {
    try {
      await del.mutateAsync({ id: n.id, updatedAt: n.updated_at });
      onClose();
      toast.info(t(lang, "tl.n.deleted"));
    } catch (err) { setConfirming(false); reportWriteError(lang, err); }
  };
  return (
    <div className="dw" style={{ "--lc": lineColor(k) } as CSSProperties}>
      <div className="dw-h">
        {k && <TaskBadge id={k} height={BADGE_H.drawer} />}
        <span className="code">{taskCode(k)}</span>
        <span className="id">{t(lang, "tl.row.note")} · {n.id}</span>
        <span className="grow" />
        <button type="button" className="ib lg2-fill" aria-label={t(lang, "common.close")} onClick={onClose}>×</button>
      </div>
      <div className="dw-b">
        <h2 className="dw-title">{t(lang, "tl.row.note")}</h2>
        <div className="dw-when"><b>{t(lang, "tl.p.when", { d: mdOf(date), w: t(lang, `tl.dow.${weekdayOfDate(date)}` as StrKey), t: n.ts.slice(11, 16) })}</b> · {machineLabel(n.machine)}</div>
        <InlineEdit ariaLabel={t(lang, "tl.n.text")} className="prose" multiline value={n.text}
          onSave={async (d) => { if (d.trim() === "") { toast.info(t(lang, "tl.n.empty")); return; } await save({ text: d.trim() }); }}
          display={<span>{n.text}</span>} />
        <PolishMark meta={n._polish?.text} entity="note" entityId={n.id} field="text" />
        <div className="fields">
          <span className="k">{t(lang, "tl.n.minutes")}</span>
          <InlineEdit ariaLabel={t(lang, "tl.n.minutes")} className="hours-edit num" value={n.minutes !== null ? minutesToHoursInput(n.minutes) : ""} placeholder="h"
            parse={parseHoursInput}
            onSave={async (d) => { const p = parseHoursInput(d); if (p.ok) await save({ minutes: p.minutes }); }}
            restore={n.minutes !== null ? { label: t(lang, "tl.n.clear"), onRestore: () => save({ minutes: null }) } : undefined}
            display={n.minutes !== null ? elapsed(n.minutes * 60_000) : t(lang, "tl.n.add")} />
          <span className="k">{t(lang, "tl.p.task")}</span>
          <div ref={box} className="opts">
            {k ? <span className="cur"><TaskBadge id={k} height={BADGE_H.chip} /><span>{tasks[k].title}</span></span> : <span className="mute">{t(lang, "tl.unlinked")}</span>}
            {picking
              ? <TaskSelect value={k} onChange={(v) => void relink(v)} onExit={() => setPicking(false)} />
              : <button ref={pickBtn} type="button" className="fb lg2-fill" onClick={() => setPicking(true)}>{t(lang, k ? "tl.p.change" : "tl.p.pick")}</button>}
          </div>
        </div>
        <div className="acts" onKeyDown={(e) => { if (confirming && e.key === "Escape") { e.stopPropagation(); setConfirming(false); } }}>
          {confirming
            ? <>
                <span className="mute">{t(lang, "tl.n.confirm")}</span>
                <button type="button" className="fb lg2-fill warn" disabled={del.isPending} onClick={() => void remove()}>{t(lang, "tl.n.delete")}</button>
                <button ref={cancelBtn} type="button" className="fb lg2-fill" disabled={del.isPending} onClick={() => setConfirming(false)}>{t(lang, "tl.dir.cancel")}</button>
              </>
            : <button ref={delBtn} type="button" className="fb lg2-fill warn" onClick={() => setConfirming(true)}>{t(lang, "tl.n.delete")}</button>}
        </div>
      </div>
    </div>
  );
}
