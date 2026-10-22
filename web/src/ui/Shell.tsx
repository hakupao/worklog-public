import { useEffect, useRef, type ReactNode } from "react";
import { enter } from "../ink/fx";
import type { StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import type { V2Page } from "../route";
import { useWorld } from "../world/store";
import { toggleWorld } from "../world/transitions";
import { useV2 } from "./context";
import { Dock, dropHashOverride } from "./Dock";
import { installGlassPointer, refreshGlass } from "./glass";
import { Header } from "./Header";
import { getHoverTask, setHoverTask, subscribeHover } from "./hover";
import { closeNote, openNote, useNotePanel } from "./note";
import { NotePanel } from "./NotePanel";

/** True while the user types into a field: page shortcuts (W, Q, the 1–4 of 情境模拟) must not fire. */
export const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

export function Shell({ page, titleKey, children }: { page: V2Page; titleKey: StrKey; children: ReactNode }) {
  const { lang } = useV2(), world = useWorld();
  const hall = useRef<HTMLDivElement>(null);
  const note = useNotePanel();

  useEffect(() => { document.title = `worklog · ${t(lang, titleKey)}`; }, [lang, titleKey]);

  // W / Q
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === "w" || e.key === "W") { dropHashOverride("world"); void toggleWorld(document.getElementById("wBtn")); }
      else if (e.key === "q" || e.key === "Q") hall.current?.classList.toggle("squint");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // linked focus: hovering a task lifts it everywhere on the page, the rest drops a tier. The hovered task
  // lives in ui/hover.ts so canvases that draw tasks (the run chart) can both set and follow it.
  useEffect(() => {
    const h = hall.current!;
    const paint = () => {
      const k = getHoverTask();
      h.classList.toggle("fx", !!k);
      h.querySelectorAll(".hl").forEach((e) => e.classList.remove("hl"));
      if (k) h.querySelectorAll(`[data-task="${CSS.escape(k)}"]`).forEach((e) => e.classList.add("hl"));
    };
    const off = subscribeHover(paint);
    const over = (e: PointerEvent) => setHoverTask(((e.target as Element).closest?.("[data-task]") as HTMLElement | null)?.dataset.task ?? null);
    const out = () => setHoverTask(null);
    h.addEventListener("pointerover", over);
    h.addEventListener("pointerleave", out);
    return () => { off(); h.removeEventListener("pointerover", over); h.removeEventListener("pointerleave", out); setHoverTask(null); };
  }, []);

  // page entrance: clear the leave() fade, then (in 表) bring the ink in
  useEffect(() => {
    const h = hall.current!;
    if (typeof h.getAnimations === "function") h.getAnimations().forEach((a) => a.cancel());
    // LED twins enter themselves once their text exists (<Led>); here only the page's own charts
    if (world === "omote") enter([...h.querySelectorAll("canvas:not([data-tier])")]);
    // only on page change: a world switch has its own transition
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const off = installGlassPointer();
    const id = requestAnimationFrame(refreshGlass);
    return () => { off(); cancelAnimationFrame(id); };
  }, []);

  return (
    <>
      <div ref={hall} className="v2-hall">
        <Header titleKey={titleKey} />
        <main className="v2-page">{children}</main>
      </div>
      <Dock page={page} onNote={() => openNote()} />
      {note && <NotePanel key={note.date ?? "today"} date={note.date} onClose={closeNote} />}
    </>
  );
}
