import type { KeyboardEvent } from "react";

export const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** A small manual Tab trap, no library: Tab from the last focusable element inside `container`
 *  wraps to the first, Shift+Tab from the first wraps to the last. Call from a keydown handler
 *  covering the whole trapped region (e.g. the backdrop of a modal dialog). Shared by every
 *  modal-like overlay in the app — first extracted from TaskSelect's "＋ 新建案件…" dialog so
 *  TaskForm and TaskDrawer reuse it instead of copying it. */
export function trapTabFocus(e: KeyboardEvent<HTMLElement>, container: HTMLElement | null): void {
  if (e.key !== "Tab" || !container) return;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
