import type { KeyboardEvent } from "react";
import { useState } from "react";
import { useTasks } from "../api/queries";
import { TaskForm } from "./TaskForm";

// Sentinels for the native <select>'s own string-typed value — never leak past this component.
// `onChange` always receives the real domain value: a task id, or `null` for 未关联.
const UNASSIGNED_VALUE = "";
const NEW_TASK_VALUE = "__new__";

export interface TaskSelectProps {
  value: string | null;
  onChange: (taskId: string | null) => void;
  /** F5: called whenever the component is done WITHOUT a real change to send — Esc, blurring the
   *  select (unless focus moved into the "＋ 新建案件…" dialog), re-picking the value that was
   *  already selected, or cancelling that dialog. The caller (SessionCard) owns what "done" means
   *  (leaving task-editing mode) and where focus goes back to. */
  onExit?: () => void;
  /** Prefilled 项目 for the "＋ 新建案件…" dialog (the session's directory name). */
  defaultProject?: string;
  disabled?: boolean;
  /** Text of the `value === null` option; defaults to 未关联. */
  emptyLabel?: string;
  /** Tasks not to offer (already linked where the picker adds one more: the v2 计划 drawer's chips). */
  exclude?: string[];
}

/** The 案件 dropdown reused wherever a session or note is (re)assigned to a task. Options are the
 *  open/hold tasks plus whichever task is currently linked (even if it has since been completed —
 *  otherwise picking it back up would be impossible from here), "未关联", and a "＋ 新建案件…"
 *  entry that opens a minimal creation dialog and links the session to the task it creates. */
export function TaskSelect({ value, onChange, onExit, defaultProject, disabled, emptyLabel = "未关联", exclude = [] }: TaskSelectProps) {
  const tasksQuery = useTasks();
  const [dialogOpen, setDialogOpen] = useState(false);

  const tasks = tasksQuery.data ?? [];
  const selectable = tasks
    .filter((t) => (t.status === "open" || t.status === "hold" || t.id === value) && !exclude.includes(t.id))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)); // id descending

  function openCreateDialog() {
    setDialogOpen(true);
  }

  /** F5: cancelling the dialog leaves task-editing mode entirely, not just the dialog — there is
   *  nothing left to do with a bare select once its reason for opening (creating a task) is gone. */
  function cancelDialog() {
    setDialogOpen(false);
    onExit?.();
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === NEW_TASK_VALUE) {
      openCreateDialog();
      return;
    }
    const nextValue = v === UNASSIGNED_VALUE ? null : v;
    if (nextValue === value) {
      // F5: re-picking the already-selected value — a native <select> normally fires no change
      // event for this, but some browsers do (e.g. landing back on the original option after
      // arrow-key navigation), so this path IS reachable. Nothing to send; just leave.
      onExit?.();
      return;
    }
    onChange(nextValue);
  }

  function handleSelectKeyDown(e: KeyboardEvent<HTMLSelectElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      // Final review B-C2 (generalized): this Esc is consumed here (leave task-editing mode) —
      // it must not also reach a host container with its own Escape handling, e.g. NoteForm's
      // container, which would otherwise treat it as "cancel the whole form".
      e.stopPropagation();
      onExit?.();
    }
  }

  function handleSelectBlur() {
    // Losing focus because "＋ 新建案件…" opened the dialog is not "leaving" — the dialog is how
    // this component finishes its job. Any other blur means the user clicked or tabbed away.
    if (dialogOpen) return;
    onExit?.();
  }

  return (
    <>
      <select
        aria-label="案件"
        className="task-select"
        value={value ?? UNASSIGNED_VALUE}
        onChange={handleSelectChange}
        onKeyDown={handleSelectKeyDown}
        onBlur={handleSelectBlur}
        disabled={disabled}
      >
        <option value={UNASSIGNED_VALUE}>{emptyLabel}</option>
        {selectable.map((t) => (
          <option key={t.id} value={t.id}>{`${t.id} ${t.title}`}</option>
        ))}
        <option value={NEW_TASK_VALUE}>＋ 新建案件…</option>
      </select>

      {dialogOpen && (
        <TaskForm
          defaultProject={defaultProject}
          onCreated={(task) => {
            setDialogOpen(false);
            onChange(task.id); // SessionCard's handleTaskChange itself leaves task-editing mode.
          }}
          onCancel={cancelDialog}
        />
      )}
    </>
  );
}
