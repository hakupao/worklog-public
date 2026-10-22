import type { FormEvent, KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { ValidationError } from "../api/client";
import { useCreateTask, useRequesters } from "../api/queries";
import type { Task, TaskCreate } from "../api/types";
import { toast } from "./Toast";
import { trapTabFocus } from "../lib/focusTrap";
import { todayJst } from "../lib/jst";

const GENERIC_CREATE_FAILURE = "创建案件失败";

export interface TaskFormProps {
  /** Prefilled 项目 — the session's directory name when opened from TaskSelect, absent for the
   *  page-level "＋ 新建案件" entry point. */
  defaultProject?: string;
  /** Prefilled 案件名 — e.g. the plan item being converted into a 案件. */
  defaultTitle?: string;
  onCreated: (task: Task) => void;
  onCancel: () => void;
}

/** The ONE create-task form/dialog in the app (contract item 2), reused both by TasksPage's
 *  "＋ 新建案件" and by TaskSelect's inline "＋ 新建案件…" — previously two copies of the same
 *  three fields; this adds 受領日/考え方 and is now the single source of truth for both callers.
 *  Always a modal dialog: backdrop + `role="dialog"`, Esc cancels, Tab is trapped inside it. */
export function TaskForm({ defaultProject, defaultTitle, onCreated, onCancel }: TaskFormProps) {
  const requestersQuery = useRequesters();
  const createTask = useCreateTask();
  const [requester, setRequester] = useState("");
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [project, setProject] = useState(defaultProject ?? "");
  const [receivedAt, setReceivedAt] = useState(todayJst());
  const [thinking, setThinking] = useState("");
  const [requesterError, setRequesterError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const requesterListId = useId();
  const titleId = useId();

  function handleBackdropKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Escape") {
      e.preventDefault();
      // Task 8 fix round 1: this dialog can be opened from inside another form-like container
      // (NoteForm) that has its own Escape handling. An Escape here is scoped to closing THIS
      // dialog only — stop it from bubbling and being treated as "cancel the host" too.
      e.stopPropagation();
      onCancel();
      return;
    }
    trapTabFocus(e, formRef.current);
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setRequesterError(null);
    setTitleError(null);

    const trimmedRequester = requester.trim();
    const trimmedTitle = title.trim();
    let hasError = false;
    if (!trimmedRequester) {
      setRequesterError("请输入依頼元");
      hasError = true;
    }
    if (!trimmedTitle) {
      setTitleError("请输入案件名");
      hasError = true;
    }
    if (hasError) return;

    // The body carries only the fields that have a value, plus received_at (always sent — the
    // date input always holds a value, defaulting to todayJst()). project/thinking are omitted
    // entirely rather than sent as "", matching the API's TaskCreate shape.
    const body: TaskCreate = { requester: trimmedRequester, title: trimmedTitle, received_at: receivedAt };
    const trimmedProject = project.trim();
    if (trimmedProject) body.project = trimmedProject;
    const trimmedThinking = thinking.trim();
    if (trimmedThinking) body.thinking = trimmedThinking;

    setSubmitting(true);
    try {
      const created = await createTask.mutateAsync(body);
      onCreated(created);
    } catch (err) {
      if (err instanceof ValidationError) {
        const issue = err.issues[0];
        if (issue?.path === "requester") setRequesterError(issue.message);
        else if (issue?.path === "title") setTitleError(issue.message);
        else toast.error(issue?.message ?? GENERIC_CREATE_FAILURE);
      } else {
        toast.error(GENERIC_CREATE_FAILURE);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" onKeyDown={handleBackdropKeyDown}>
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog task-form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <h2 id={titleId} className="dialog__title">
          新建案件
        </h2>

        <label className="dialog__field">
          依頼元
          <input
            list={requesterListId}
            value={requester}
            onChange={(e) => setRequester(e.target.value)}
            autoFocus
            required
            disabled={submitting}
          />
        </label>
        <datalist id={requesterListId}>
          {(requestersQuery.data ?? []).map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        {requesterError && (
          <span role="alert" className="dialog__error is-error">
            {requesterError}
          </span>
        )}

        <label className="dialog__field">
          案件名
          <input value={title} onChange={(e) => setTitle(e.target.value)} required disabled={submitting} />
        </label>
        {titleError && (
          <span role="alert" className="dialog__error is-error">
            {titleError}
          </span>
        )}

        <label className="dialog__field">
          项目
          <input value={project} onChange={(e) => setProject(e.target.value)} disabled={submitting} />
        </label>

        <label className="dialog__field">
          受領日
          <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} disabled={submitting} />
        </label>

        <label className="dialog__field">
          考え方
          <textarea value={thinking} onChange={(e) => setThinking(e.target.value)} rows={2} disabled={submitting} />
        </label>

        <div className="dialog__actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            取消
          </button>
          <button type="submit" disabled={submitting}>
            创建
          </button>
        </div>
      </form>
    </div>
  );
}
