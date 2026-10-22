import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE_SELECTOR, trapTabFocus } from "../lib/focusTrap";
import { isComposingEvent } from "../lib/ime";
import { applyGlass } from "./glass";

/** The glass side drawer (spec §4.3: glass only on floating layers; prototype page-timeline.html:60-75).
 *  It stays mounted and only slides in and out: applyGlass caches one SVG filter per element, so a drawer
 *  remounted per open would leak one each time (the NotePanel lesson). Sub-project 4's 案件 drawer reuses it.
 *  Esc and the scrim close it; Tab stays inside; on close focus returns to `returnTo()` as it was at open time
 *  (or to what had focus before). */
export function Drawer({ open, onClose, label, returnTo, fallback, children }: {
  open: boolean; onClose: () => void; label: string; returnTo?: () => HTMLElement | null;
  /** Where focus goes when the row it came from is gone (hidden, deleted): a stable container of the page. */
  fallback?: () => HTMLElement | null; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null), before = useRef<HTMLElement | null>(null), target = useRef<HTMLElement | null>(null);
  const back = useRef(returnTo), closeRef = useRef(onClose), fall = useRef(fallback);
  back.current = returnTo;
  fall.current = fallback;
  closeRef.current = onClose;
  // A passive effect, not a layout one: React restores the pre-commit focus (the panel) at the end of the
  // commit, which would undo a focus return made in a layout cleanup.
  useEffect(() => {
    if (!open) return;
    const el = ref.current!, active = document.activeElement;
    // where focus goes back to: what had it before — never the panel itself (a re-open while it has focus)
    // (<body> is not a place to return to: focusing it does nothing, so focus would stay on the closed panel)
    if (!(active instanceof HTMLElement && el.contains(active))) before.current = active instanceof HTMLElement && active !== document.body ? active : null;
    // asked now, while the caller still knows what was opened (by close time its state has moved on)
    target.current = back.current?.() ?? null;
    // focus now, not in the next frame: a close that lands before that frame would otherwise get its
    // returned focus stolen back by the panel
    el.focus({ preventScroll: true });
    const id = requestAnimationFrame(() => applyGlass(el));
    return () => {
      cancelAnimationFrame(id);
      const to = target.current?.isConnected ? target.current : before.current?.isConnected ? before.current : fall.current?.() ?? null;
      if (to?.isConnected) to.focus({ preventScroll: true });
    };
  }, [open]);
  // Focus can fall out of the panel to <body> (a control it was on is removed). Esc and Tab must still work
  // then: Esc closes, Tab goes back into the panel instead of to the page behind the scrim.
  useEffect(() => {
    if (!open) return;
    const el = ref.current!;
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement;
      // only when focus has fallen to <body>: focus inside the panel is its own handler's, and focus in another
      // floating layer (the dock's 补记 panel) is that layer's
      if (a && a !== document.body) return;
      if (e.key === "Escape" && !e.isComposing) closeRef.current();
      else if (e.key === "Tab") { e.preventDefault(); el.focus({ preventScroll: true }); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // the size changes with the content: refresh the refraction map when it does
  useEffect(() => {
    const el = ref.current;
    if (!open || !el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => applyGlass(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  return createPortal(
    <>
      <div className={`v2-scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className={`v2-drawer lg2${open ? " on" : ""}`} data-edge="14" data-blur="18" role="dialog" aria-modal="true"
        aria-label={label} aria-hidden={open ? undefined : true} tabIndex={-1} inert={!open}
        onKeyDown={(e) => {
          if (isComposingEvent(e, false)) return;            // an Esc that cancels an IME composition is not "close"
          if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
          // The panel itself has focus right after opening, and it is not in the trap's list (tabindex -1):
          // Shift+Tab from it would walk back to the page behind the scrim. Send it to the last / first control.
          if (e.key === "Tab" && document.activeElement === ref.current) {
            const els = ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
            e.preventDefault();                                  // nothing to go to: stay on the panel, never behind it
            if (els.length) (e.shiftKey ? els[els.length - 1] : els[0]).focus();
            return;
          }
          trapTabFocus(e, ref.current);
        }}>
        {open && children}
      </aside>
    </>,
    document.body,
  );
}
