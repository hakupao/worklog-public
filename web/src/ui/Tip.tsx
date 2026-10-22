import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { applyGlass } from "./glass";

export interface TipState { x: number; y: number; body: ReactNode }
const W = 372, GAP = 18, EST_H = 150;

/** The one glass tooltip (spec §4.3). It stays mounted: applyGlass caches a filter per element, so a
 *  tooltip remounted on every hover would leak one each time. Content is visual; the same text is in
 *  the page for screen readers (.v2-sr). */
export function Tip({ tip }: { tip: TipState | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<TipState | null>(null);
  if (tip) last.current = tip;
  const shown = tip ?? last.current; // while fading out, keep the last position and content
  useEffect(() => { if (tip && ref.current) applyGlass(ref.current); }, [tip]);
  let left = 0, top = 0;
  if (shown) {
    left = shown.x + GAP + W + 8 > window.innerWidth ? shown.x - W - GAP : shown.x + GAP;
    top = shown.y + GAP + EST_H > window.innerHeight - 90 ? shown.y - EST_H - 14 : shown.y + GAP;
  }
  return createPortal(
    <div ref={ref} className={`tip lg2${tip ? " on" : ""}`} role="tooltip" data-edge="10" aria-hidden={tip ? undefined : true}
      style={{ left: `${Math.round(left)}px`, top: `${Math.round(Math.max(8, top))}px` }}>
      {shown?.body}
    </div>,
    document.body,
  );
}
