import { useSyncExternalStore } from "react";

// A dependency-free module-level toast store (no provider needed): any module, including
// non-component code, can call `toast.error(...)` / `toast.info(...)`; mount a single
// <ToastHost/> near the root to render whatever is queued.

type ToastKind = "error" | "info";
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

const AUTO_DISMISS_MS = 5000;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, action?: ToastAction, durationMs: number = AUTO_DISMISS_MS): void {
  const id = nextId++;
  items = [...items, { id, kind, message, action }];
  emit();
  setTimeout(() => dismiss(id), durationMs);
}

/** Test-only: drop whatever toasts a test left up (they otherwise outlive it for their 5 s and leak into the next). */
export function __resetToastsForTests(): void {
  items = [];
  emit();
}

export const toast = {
  // `durationMs` lets an actionable toast (e.g. an undo) stay up longer than the default 5s —
  // long enough to actually read and act on, not just notice.
  error: (message: string, action?: ToastAction, durationMs?: number) => push("error", message, action, durationMs),
  info: (message: string, action?: ToastAction, durationMs?: number) => push("info", message, action, durationMs),
};

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): ToastItem[] {
  return items;
}

export function ToastHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <div className="toast-host">
      {current.map((t) => (
        <div key={t.id} role="status" className={`toast toast--${t.kind}`}>
          <span className="toast__message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast__close" aria-label="关闭" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
