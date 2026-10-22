import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { reducedMotion } from "../motion";

/** A bottom sheet: mounted = open. Closes on [×], the scrim, Esc (not while an IME composes) and a downward drag past
 *  90px; locks the page scroll while open and gives focus back to whatever opened it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { lang } = useV2();
  const id = useId();
  const [leaving, setLeaving] = useState(false);
  const [dy, setDy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const y0 = useRef<number | null>(null);
  const closed = useRef(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (closed.current) return;
    const finish = () => { if (!closed.current) { closed.current = true; onCloseRef.current(); } };
    if (reducedMotion()) { finish(); return; }
    setLeaving(true);
    window.setTimeout(finish, 220);
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const body = document.body, before = body.style.overflow;
    body.style.overflow = "hidden";
    closeBtn.current?.focus({ preventScroll: true });
    return () => { body.style.overflow = before; opener?.focus?.({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    // keyCode 229: Safari fires the confirming keydown after compositionend has cleared isComposing (see lib/ime.ts).
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  useEffect(() => {
    // Tab stays inside the sheet (aria-modal): wrap from the last focusable to the first and back.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || !box.current.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !box.current.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".m-close")) return;
    y0.current = e.clientY; setDragging(true);
    (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => { if (y0.current !== null) setDy(Math.max(0, e.clientY - y0.current)); };
  const up = (e: React.PointerEvent) => {
    if (y0.current === null) return;
    const d = Math.max(0, e.clientY - y0.current);
    y0.current = null; setDragging(false);
    if (d > 90) close(); else setDy(0);
  };

  return (
    <>
      <div className={`m-scrim${leaving ? " out" : ""}`} onClick={close} />
      <div ref={box} className={`m-sheet${leaving ? " out" : ""}${dragging ? " drag" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}>
        <div className="m-grabzone" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="m-grab" />
          <header>
            <h3 id={id}>{title}</h3>
            <button ref={closeBtn} type="button" className="m-close" aria-label={t(lang, "common.close")} onClick={close}>[×]</button>
          </header>
        </div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </>
  );
}
