import type { KeyboardEvent } from "react";

/** True when a keydown is part of an IME composing a character — an Enter/Escape that confirms
 *  or cancels the composition, not a real submit/cancel. `composing` is the caller's own
 *  compositionstart/compositionend-tracked ref value: `isComposing` alone is not enough because
 *  Safari fires the confirming keydown for Enter AFTER `compositionend` has already cleared it,
 *  which is what the trailing `keyCode === 229` check catches instead. Shared by every field that
 *  needs this (InlineEdit; NoteForm's text field — task 8) so the exact same three-way check is
 *  never duplicated. */
export function isComposingEvent(e: KeyboardEvent, composing: boolean): boolean {
  return composing || e.nativeEvent.isComposing === true || e.keyCode === 229;
}
