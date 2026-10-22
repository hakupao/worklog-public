import { useLayoutEffect, useRef, type RefObject } from "react";
import { surface } from "./canvas";
import { latticeOffset } from "./dots";
import { PITCH } from "../led/lattice";
import { useTaskBadgesVersion } from "../ui/taskBadges";

/** Redraws a canvas whenever `draw` changes or the canvas is resized; `draw` gets the sized context and geometry.
 *  `own`: a ref the caller made (to observe the same canvas), else one made here. */
export function useCanvas(draw: (x: CanvasRenderingContext2D, w: number, h: number, offX: number, offY: number, el: HTMLCanvasElement) => void, deps: unknown[],
  own?: RefObject<HTMLCanvasElement | null>) {
  const bv = useTaskBadgesVersion();   // line colours come from the badge registry: redraw when it changes
  const mine = useRef<HTMLCanvasElement>(null), ref = own ?? mine;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = "";
    const run = () => { const s = surface(el); if (!s) return; size = `${s.w}x${s.h}`; const { offX, offY } = latticeOffset(el, PITCH); draw(s.ctx, s.w, s.h, offX, offY, el); };
    run();
    if (typeof ResizeObserver !== "function") return;
    // an observer reports the box once on observe: that is the size just drawn, so only a new size redraws
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (`${r.width}x${r.height}` !== size) run(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [...deps, bv]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
