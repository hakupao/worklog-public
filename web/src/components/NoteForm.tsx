import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { useCreateNote } from "../api/queries";
import { ValidationError } from "../api/client";
import { isComposingEvent } from "../lib/ime";
import { parseHoursInput } from "../lib/format";
import { dayLabel, todayJst, weekOfDate } from "../lib/jst";
import { isMobileHash, mHref } from "../m/route";
import { TaskSelect } from "./TaskSelect";
import { toast } from "./Toast";

const GENERIC_SAVE_FAILURE = "保存失败";
const FUTURE_DATE_MESSAGE = "日期不能晚于明天，请检查是不是打错了";
const DAY_MS = 86_400_000;

/** Parses a plain "YYYY-MM-DD" string into a UTC-midnight timestamp for day-difference arithmetic
 *  ONLY — never a time-zone conversion (the string already denotes a Tokyo calendar day, exactly
 *  like jst.ts's own helpers). NaN for anything malformed. */
function toUtcMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export interface NoteFormProps {
  /** Prefilled date: the day this form was opened from (a DayGroup's "＋ 补记"), or `todayJst()`
   *  for the page-level "＋ 手动添加记录" entry point. */
  initialDate: string;
  /** The week currently on screen. A created note whose date falls outside it gets a "已添加到
   *  <date>" toast with a 前往 action instead of silently vanishing from view. */
  week: string;
  /** Task 7's "只看此目录" filter. While active, DayGroup hides every note, so a note created
   *  during that filter needs its own toast — it will not actually appear. */
  directoryFilterActive: boolean;
  onClose: () => void;
}

/** The compact, inline "补记" (manual note) creation form — task 8. Always rendered inline (never
 *  a modal): once inside a DayGroup, prefilled with that day's date; once at the top of
 *  TimelinePage, prefilled with today. */
export function NoteForm({ initialDate, week, directoryFilterActive, onClose }: NoteFormProps) {
  const createNote = useCreateNote();
  const [date, setDate] = useState(initialDate);
  const [text, setText] = useState("");
  const [hoursText, setHoursText] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const composingRef = useRef(false);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  // Final review B-I3: before the `<form>` -> `<div role="group">` refactor (see below), a native
  // form submitted on Enter from ANY field; that regressed silently for 日期/用时, which had no
  // handler of their own. This one is generic (IME-guarded Enter -> submit, nothing text-specific)
  // and is shared by all three fields rather than copied.
  function handleEnterKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter") {
      if (isComposingEvent(e, composingRef.current)) return; // an IME confirming its composition, not a real Enter
      e.preventDefault();
      void submit();
    }
  }

  function handleContainerKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Escape") return;
    if (isComposingEvent(e, composingRef.current)) return; // clearing an IME reading, not "cancel the form"
    // Fix round 1 (LOST INPUT): TaskSelect's "＋新建案件…" dialog is a plain child of this
    // container (not a portal), so an Escape it handles still bubbles up here as a React
    // synthetic event even though the dialog's own handler now stops native propagation. A
    // dialog's Escape is scoped to closing ONLY that dialog — never cascade it into discarding
    // this whole form's typed date/text/hours. Belt-and-suspenders alongside TaskForm.tsx's own
    // stopPropagation: this holds even if some future sub-dialog forgets to call it.
    if ((e.target as HTMLElement | null)?.closest('[role="dialog"]')) return;
    e.preventDefault();
    // Final review B-C2 (generalized): this Esc is consumed here (closing the form) — it must not
    // also reach any ancestor Esc handler this form happens to be nested inside.
    e.stopPropagation();
    onClose();
  }

  async function submit(): Promise<void> {
    if (submitting) return;
    setTextError(null);
    setDateError(null);
    setHoursError(null);

    const trimmed = text.trim();
    let hasError = false;
    if (trimmed === "") {
      setTextError("请输入内容");
      hasError = true;
    }

    // A typo guard, not a hard cutoff at today: tomorrow is allowed (time-zone skew between the
    // browser and the server), anything further ahead almost certainly means a mistyped date.
    const todayMs = toUtcMs(todayJst());
    const dateMs = toUtcMs(date);
    if (!Number.isFinite(dateMs) || (dateMs - todayMs) / DAY_MS > 1) {
      setDateError(FUTURE_DATE_MESSAGE);
      hasError = true;
    }

    let minutes: number | undefined;
    if (hoursText.trim() !== "") {
      const parsed = parseHoursInput(hoursText);
      if (!parsed.ok) {
        setHoursError(parsed.reason);
        hasError = true;
      } else {
        minutes = parsed.minutes;
      }
    }

    if (hasError) return;

    setSubmitting(true);
    try {
      // date is always sent, exactly as the <input type="date"> yields it ("YYYY-MM-DD") — never
      // routed through `new Date(...)`, which is how a note would land on the wrong day in
      // another time zone. minutes is OMITTED (not sent as undefined-via-key) when the duration
      // box was left empty; 0 is a real value and is sent as-is. task_id is null, never "".
      // The created row itself is not read here — it arrives via the invalidated timeline
      // refetch (useCreateNote's onSettled), same as every other write hook in this app.
      await createNote.mutateAsync({
        text: trimmed,
        date,
        task_id: taskId,
        ...(minutes !== undefined ? { minutes } : {}),
      });
      onClose();
      if (weekOfDate(date) !== week) {
        toast.info(`已添加到 ${dayLabel(date)}`, {
          label: "前往",
          onClick: () => {
            // the phone shell's timeline takes the day itself; the desktop one, its week
            window.location.hash = isMobileHash(window.location.hash) ? mHref("tl", date) : `#/v2/timeline/${weekOfDate(date)}`;
          },
        });
      } else if (directoryFilterActive) {
        toast.info("已添加（筛选中不显示补记）");
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        setTextError(err.issues[0]?.message ?? GENERIC_SAVE_FAILURE);
      } else {
        toast.error(GENERIC_SAVE_FAILURE);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // A plain <div>, not a <form>: TaskSelect's "＋新建案件…" dialog (TaskForm.tsx) is itself a
    // <form>, and this component is used inside a day's session list — nesting a <form> inside a
    // <form> is invalid HTML and React warns on it. Enter-to-submit is already hand-rolled on the
    // text field (IME-safe, see handleTextKeyDown) and the submit button below has its own
    // onClick, so no native form-submission semantics were actually relied upon.
    <div role="group" className="note-form" aria-label="补记" onKeyDown={handleContainerKeyDown}>
      <div className="note-form__field">
        <label htmlFor="note-form-date" className="note-form__label">
          日期
        </label>
        <input
          id="note-form-date"
          type="date"
          aria-label="日期"
          className={`note-form__date${dateError ? " is-error" : ""}`}
          value={date}
          disabled={submitting}
          onChange={(e) => setDate(e.target.value)}
          onKeyDown={handleEnterKeyDown}
        />
      </div>

      <div className="note-form__field note-form__field--text">
        <input
          ref={textInputRef}
          type="text"
          aria-label="内容"
          placeholder="补记内容"
          autoFocus
          className={`note-form__text${textError ? " is-error" : ""}`}
          value={text}
          disabled={submitting}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleEnterKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
        />
      </div>

      <div className="note-form__field">
        <input
          type="text"
          aria-label="用时"
          placeholder="用时（小时，可留空）"
          className={`note-form__hours${hoursError ? " is-error" : ""}`}
          value={hoursText}
          disabled={submitting}
          onChange={(e) => setHoursText(e.target.value)}
          onKeyDown={handleEnterKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
        />
      </div>

      <TaskSelect value={taskId} onChange={setTaskId} disabled={submitting} />

      <div className="note-form__actions">
        <button type="button" onClick={() => void submit()} disabled={submitting}>
          添加
        </button>
        <button type="button" onClick={onClose} disabled={submitting}>
          取消
        </button>
      </div>

      {textError && (
        <span role="alert" className="note-form__error">
          {textError}
        </span>
      )}
      {dateError && (
        <span role="alert" className="note-form__error">
          {dateError}
        </span>
      )}
      {hoursError && (
        <span role="alert" className="note-form__error">
          {hoursError}
        </span>
      )}
    </div>
  );
}
