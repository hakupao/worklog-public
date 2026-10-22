import { useEffect, useRef, type CSSProperties } from "react";
import type { TaskRef } from "../../api/types";
import { TaskSelect } from "../../components/TaskSelect";
import { isComposingEvent } from "../../lib/ime";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { taskCode } from "../now/format";

/** One change to an item's 案件: the caller applies it to the list as it is when its write runs (review C: a list
 *  computed here, at render, would undo a queued change before it — two quick × would re-link the first). */
export type TaskDelta = { add: string } | { remove: string };
/** Apply a delta to the current ids (an add that is already there, a remove that is already gone: no change). */
export const applyDelta = (ids: string[], d: TaskDelta) =>
  "add" in d ? (ids.includes(d.add) ? ids : [...ids, d.add]) : ids.filter((k) => k !== d.remove);

/** An item's 案件 (user ruling U3): v2 chips — line code, name, × — and the old picker without the ones already
 *  linked (＋ 新建案件… still creates one and links it). Each click is one `TaskDelta`. */
export function Chips({ tasks, onChange, onEscape }: {
  tasks: TaskRef[]; onChange: (d: TaskDelta) => Promise<unknown>;
  /** Esc on the picker: TaskSelect stops it from reaching the drawer, so the drawer's close comes in here (preflight R11). */
  onEscape: () => void;
}) {
  const { lang } = useV2();
  const ids = tasks.map((x) => x.id);
  // × unmounts the focused button: hand focus to the next ×, else the previous one, else the picker
  const box = useRef<HTMLSpanElement>(null), gone = useRef<number | null>(null);
  const sig = ids.join(",");
  useEffect(() => {
    const i = gone.current;
    if (i === null) return;
    gone.current = null;
    const a = document.activeElement;
    if (a && a !== document.body && box.current?.contains(a)) return;
    const xs = box.current?.querySelectorAll<HTMLElement>("button") ?? [];
    (xs[i] ?? xs[i - 1] ?? box.current?.querySelector<HTMLElement>("select"))?.focus();
  }, [sig]);
  return (
    <span ref={box} className="chips"
      onKeyDownCapture={(e) => { if (e.key === "Escape" && (e.target as HTMLElement).tagName === "SELECT" && !isComposingEvent(e, false)) onEscape(); }}>
      {tasks.length === 0 && <span className="mute">{t(lang, "pl.d.noTasks")}</span>}
      {tasks.map((x, i) => (
        <span key={x.id} className={`chip tchip lg2-fill${x.status === "done" ? " done" : ""}`} style={{ "--lc": lineColor(x.id) } as CSSProperties}>
          <TaskBadge id={x.id} height={BADGE_H.chip} /><span>{x.title}</span>
          <button type="button" aria-label={t(lang, "pl.d.rmTask", { c: taskCode(x.id) })}
            onClick={() => { gone.current = i; void onChange({ remove: x.id }); }}>×</button>
        </span>
      ))}
      <TaskSelect value={null} emptyLabel={t(lang, "pl.d.addTask")} exclude={ids}
        onChange={(id) => { if (id && !ids.includes(id)) void onChange({ add: id }); }} />
    </span>
  );
}
