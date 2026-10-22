import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ConflictError, ValidationError } from "../api/client";
import { isComposingEvent } from "../lib/ime";
import { toast } from "./Toast";

const CONFLICT_MESSAGE = "这条记录已在别处被修改，已刷新为最新内容，请确认后再保存";
const GENERIC_SAVE_FAILURE = "保存失败";
/** Shown at rest for an empty value: an empty span has no width, so an unset field (a 案件 created
 *  without 项目, say) would otherwise leave nothing to click and could never be filled in. */
const EMPTY_HINT = "点击填写";

export type InlineEditParseResult = { ok: true } | { ok: false; reason: string };

export interface InlineEditRestore {
  label: string;
  onRestore: () => Promise<void>;
}

export interface InlineEditProps {
  /** The editable seed text: what the field shows and starts from once clicked into edit mode. */
  value: string;
  /** What is shown when not editing; defaults to `value`. Lets the caller add marks/badges. */
  display?: ReactNode;
  onSave: (draft: string) => Promise<void>;
  multiline?: boolean;
  /** Local validation before any network call. Returning `{ ok: false }` blocks the save and
   *  shows `reason` beside the field; it never knows about the field's own domain (hours, etc). */
  parse?: (text: string) => InlineEditParseResult;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** The editing-mode `<input>`'s type; ignored when `multiline`. Defaults to "text". "date"
   *  renders a native date picker — used for a task's 受領日 (task 9), whose value is always a
   *  plain "YYYY-MM-DD" string sent to the API as-is. */
  type?: "text" | "date";
  /** An explicit "restore automatic value" action, shown only while editing. Distinct from saving
   *  an empty/unchanged draft — the caller decides when this is offered (e.g. only when a human
   *  edit already exists to restore from). */
  restore?: InlineEditRestore;
  /** The at-rest accessible name in full (the label, the value and an edit hint), for a caller in another UI
   *  language; defaults to `${ariaLabel}：${value}（点击编辑）`. */
  restAriaLabel?: string;
}

/** A click-to-edit field shared by every inline edit in the timeline (summary, hours today; note
 *  text and task fields in later tasks). Owns draft state, keyboard handling (Enter saves,
 *  Shift+Enter newlines in a multiline field, Esc cancels), IME safety, blur-to-save, the
 *  saving/disabled busy state, and how a rejected save is displayed. Everything about what a
 *  "valid" or "changed" value MEANS for a given field is external: `parse` for local validation,
 *  and the caller's own `onSave`/`restore.onRestore` for what actually gets sent over the wire. */
export function InlineEdit({
  value,
  display,
  onSave,
  multiline,
  parse,
  ariaLabel,
  placeholder,
  disabled,
  className,
  restore,
  type = "text",
  restAriaLabel,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const composingRef = useRef(false);
  // Set right before a click on the restore button steals focus from the field, so the blur that
  // click causes is treated as "not a save" rather than a blur-save.
  const suppressBlurRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // A rejected save/restore keeps editing but the field was `disabled` while saving, which blurs
  // it in a real browser (a phone's keyboard closes) — set so the effect below refocuses it once
  // `disabled` clears, rather than trying to focus it while it is still disabled (a no-op).
  const refocusAfterRejectRef = useRef(false);
  // Leaving edit mode unmounts the field, which drops focus to <body> — a keyboard user loses
  // their place in the page. Same shape SessionCard uses for its task label: the resting span
  // does not exist yet when the edit ends, so a ref flag defers the focus() to the effect below.
  // Only set for an exit the user asked for by keyboard or by the restore button; a blur-save is
  // deliberately excluded, since focus has already moved somewhere the user chose.
  const displayRef = useRef<HTMLSpanElement | null>(null);
  const returnFocusRef = useRef(false);

  useEffect(() => {
    if (!editing || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [editing]);

  useEffect(() => {
    if (saving || !editing || !refocusAfterRejectRef.current) return;
    refocusAfterRejectRef.current = false;
    inputRef.current?.focus();
  }, [saving, editing]);

  useEffect(() => {
    if (editing || !returnFocusRef.current) return;
    returnFocusRef.current = false;
    // Only reclaim focus that the unmounted field DROPPED (removing the focused element leaves
    // <body> active). If something else already holds it — another cell being edited in the same
    // table, a dialog that opened — that is where the user is, and pulling focus away would be
    // worse than the lost place this is fixing.
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    displayRef.current?.focus();
  }, [editing]);

  function startEditing() {
    if (disabled) return;
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    returnFocusRef.current = true;
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  /** Runs `action`, sharing the saving state and rejection handling between a normal save and a
   *  restore: keep editing with whatever the box holds unless `action` actually succeeds. */
  async function runMutation(action: () => Promise<void>): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await action();
      setEditing(false);
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(err.issues[0]?.message ?? GENERIC_SAVE_FAILURE);
      } else if (err instanceof ConflictError) {
        toast.error(CONFLICT_MESSAGE);
      } else {
        toast.error(GENERIC_SAVE_FAILURE);
      }
      // The field stays open with the draft in it, so the pending "put focus back on the display"
      // is void — the refocus above is what should happen instead.
      returnFocusRef.current = false;
      refocusAfterRejectRef.current = true;
    } finally {
      setSaving(false);
    }
  }

  /** `returnFocus` is true only when the user ended the edit from the field itself (Enter), so a
   *  blur-save — where focus has already landed on whatever was clicked — never yanks it back. */
  function attemptSave(returnFocus: boolean): void {
    if (saving) return;
    if (draft === value) {
      returnFocusRef.current = returnFocus;
      setEditing(false);
      setError(null);
      return;
    }
    if (parse) {
      const result = parse(draft);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
    }
    returnFocusRef.current = returnFocus;
    void runMutation(() => onSave(draft));
  }

  function handleRestoreClick(): void {
    if (saving || !restore) return;
    // The restore button is itself removed when editing ends, so focus has nowhere to land
    // either — send it back to the display like a save does.
    returnFocusRef.current = true;
    void runMutation(() => restore.onRestore());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): void {
    if (e.key === "Escape") {
      // An Esc that is clearing an IME's in-progress composition (the normal way to fix a
      // mistyped reading) is not a request to cancel the whole edit — let the IME handle it
      // and leave the draft untouched. Same isComposingEvent check Enter uses below, so this
      // is correct for Safari's compositionend-before-keydown ordering too.
      if (isComposingEvent(e, composingRef.current)) return;
      e.preventDefault();
      // Final review B-C2: an Esc this field consumes (cancelling its own edit) must never also
      // be seen by a modal host wrapping it (e.g. TaskDrawer's backdrop, which closes on any
      // Escape that reaches it) — otherwise cancelling one inline field also kicks the user out
      // of the whole drawer.
      e.stopPropagation();
      cancel();
      return;
    }
    if (e.key === "Enter") {
      if (isComposingEvent(e, composingRef.current)) return; // an IME confirming its composition, not a real Enter
      if (multiline && e.shiftKey) return; // newline, not a save
      e.preventDefault();
      attemptSave(true);
    }
  }

  function handleBlur(): void {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      return;
    }
    if (saving) return;
    attemptSave(false);
  }

  if (!editing) {
    // `aria-label` on a `role="button"` element REPLACES its content in the accessible name
    // computation — a bare `ariaLabel` ("摘要") would make a screen reader announce only
    // "摘要, button" for every card, never the actual summary. Folding the value into the label
    // itself is what makes the content reachable at all here; the editing-mode field below keeps
    // the bare `ariaLabel` instead, which is correct there (a focused textbox's value is already
    // read separately from its label).
    return (
      <span
        ref={displayRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={restAriaLabel ?? `${ariaLabel}：${value}（点击编辑）`}
        aria-disabled={disabled || undefined}
        className={[className, multiline ? "inline-edit__text--multiline" : ""].filter(Boolean).join(" ") || undefined}
        onClick={startEditing}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            startEditing();
          }
        }}
      >
        {display ?? (value === "" ? <span className="inline-edit__empty">{placeholder ?? EMPTY_HINT}</span> : value)}
      </span>
    );
  }

  const sharedFieldProps = {
    "aria-label": ariaLabel,
    className: `inline-edit__field${error ? " is-error" : ""}`,
    value: draft,
    placeholder,
    disabled: saving || disabled,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => setDraft(e.target.value),
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
    },
  };

  return (
    <span className={`inline-edit${saving ? " is-busy" : ""}`}>
      {multiline ? (
        <textarea ref={(el) => { inputRef.current = el; }} rows={2} {...sharedFieldProps} />
      ) : (
        <input ref={(el) => { inputRef.current = el; }} type={type} {...sharedFieldProps} />
      )}
      {restore && (
        <button
          type="button"
          className="inline-edit__restore"
          disabled={saving}
          onMouseDown={() => {
            suppressBlurRef.current = true;
          }}
          onClick={handleRestoreClick}
        >
          {restore.label}
        </button>
      )}
      {error && (
        <span role="alert" className="inline-edit__error is-error">
          {error}
        </span>
      )}
    </span>
  );
}
