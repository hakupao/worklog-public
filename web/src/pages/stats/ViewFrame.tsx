import { useEffect, useRef, useState, type ReactNode } from "react";
import { enter } from "../../ink/fx";
import { reducedMotion } from "../../led/motion";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { StatsView } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C } from "../../ui/palette";
import { getWorld } from "../../world/store";
import { VIEW_META } from "./registry";
import { RevealCtx } from "./useReveal";

/** First draw: null = not yet; `start` = 里's reveal clock (useReveal), null when the end state is drawn at once. */
type Open = { start: number | null } | null;
const opening = (): Open => ({ start: getWorld() === "ura" && !reducedMotion() ? performance.now() : null });

/** One view's band on the board (spec §3, brief assumption 5): the number in the current order, the name (累计 for
 *  a dashboard block), the line on what it reveals, the key figure on the right; `summary` is for screen readers.
 *  The body is drawn only once the band comes within 600px of the viewport, and kept after (at once where there is
 *  no IntersectionObserver). On that first draw 表 brings the view's canvases in (as Shell does for a page) and 里
 *  starts the reveal its charts read through useReveal. `ready` false: the body is a wait line (R4) — the entrance
 *  waits for the real body, and starts when it comes. */
export function ViewFrame({ id, num, meta, summary, ready = true, children }: {
  id: StatsView; num: string; meta?: string; summary?: string; ready?: boolean; children: ReactNode;
}) {
  const { lang } = useV2();
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<Open>(() => (typeof IntersectionObserver === "undefined" ? opening() : null));
  useEffect(() => {
    if (open) return;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      setOpen(opening());
    }, { rootMargin: "600px 0px" });
    io.observe(ref.current!);
    return () => io.disconnect();
  }, [open]);
  // opened on a wait line: when the body comes, 里's reveal starts over from then
  const waited = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!ready) waited.current = true;
    else if (waited.current) { waited.current = false; setOpen(opening()); }
  }, [open, ready]);
  const entered = useRef(false);
  useEffect(() => {
    if (!open || !ready || entered.current) return;
    entered.current = true;
    if (getWorld() === "omote" && !reducedMotion()) enter([...ref.current!.querySelectorAll("canvas:not([data-tier])")]);
  }, [open, ready]);
  const name = t(lang, `sv.${id}.name` as StrKey);
  return (
    <section ref={ref} className="sv" aria-label={name} data-view={id}>
      <div className="sv-h">
        <span className="no"><Led ui tier={2} fit color={C.DIM} text={num} /></span>
        <div className="tt">
          <div className="nm">
            <Led ui size={12} tier={1} fit color={C.WARM} text={name} />
            {VIEW_META[id].cumulative && <Led ui tier={3} fit color={C.DIM} text={t(lang, "sv.cumulative")} />}
          </div>
          <div className="nm"><Led ui tier={3} clip className="fill" color="#6f5530" text={t(lang, `sv.${id}.desc` as StrKey)} /></div>
        </div>
        {meta !== undefined && <span className="mt"><Led ui tier={1} fit text={meta} /></span>}
      </div>
      {summary !== undefined && <p className="v2-sr">{summary}</p>}
      <div className={`sv-b${open ? "" : " wait"}`}>
        {open && <RevealCtx.Provider value={open.start}>{children}</RevealCtx.Provider>}
      </div>
    </section>
  );
}

/** A view with too little data in the range to say anything (one day, an empty range): one dim line. */
export function Thin() {
  const { lang } = useV2();
  return <div className="sv-thin"><Led ui tier={2} clip className="fill" color={C.DIM} text={t(lang, "sv.thin")} /></div>;
}
