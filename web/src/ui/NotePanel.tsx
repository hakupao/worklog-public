import { useEffect, useRef } from "react";
import { NoteForm } from "../components/NoteForm";
import { trapTabFocus } from "../lib/focusTrap";
import { isComposingEvent } from "../lib/ime";
import { currentWeek, todayJst, weekOfDate } from "../lib/jst";
import { t } from "../i18n/t";
import { useV2 } from "./context";
import { applyGlass } from "./glass";

/** The dock's 补记: the existing note form on a glass panel (glass is allowed on floating layers, spec §4.3). */
/** `date`: the day to prefill (a page's selected day); null = today. */
export function NotePanel({ date = null, onClose }: { date?: string | null; onClose: () => void }) {
  const { lang } = useV2();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    applyGlass(el);
    (el.querySelector("input,textarea,select,button") as HTMLElement | null)?.focus();
  }, []);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={t(lang, "nav.note")} className="v2-note lg2" data-edge="12" tabIndex={-1}
      onKeyDown={(e) => {
        if (isComposingEvent(e, false)) return;     // Esc that cancels an IME composition is not "close"
        if (e.key === "Escape") { e.stopPropagation(); onClose(); } else trapTabFocus(e, ref.current);
      }}>
      <NoteForm initialDate={date ?? todayJst()} week={date ? weekOfDate(date) : currentWeek()} directoryFilterActive={false} onClose={onClose} />
      <button type="button" className="dk" onClick={onClose}>{t(lang, "common.close")}</button>
    </div>
  );
}
