import { createContext, useContext, useEffect, useState, type CSSProperties } from "react";
import { motion } from "../../led/motion";

/** When the view's first draw began (performance.now()), for 里's reveal; null = draw the end state (表, reduced
 *  motion, outside a frame). Provided by ViewFrame. */
export const RevealCtx = createContext<number | null>(null);

const REVEAL_MS = 900;
const at = (start: number) => {
  const k = Math.min(1, Math.max(0, ((performance.now() - start) * motion.speed) / REVEAL_MS));
  return 1 - (1 - k) ** 3;
};

/** 里's entrance for a view's canvases (brief assumption 5): `p` from 0 to 1 over 900ms / motion.speed, already
 *  eased out. A hand-drawn canvas does not redraw with it (useFade). 1 at once without a reveal (see RevealCtx); a
 *  later range or world change draws the end state, since the frame's start stays in the past. */
export function useReveal(): number {
  const start = useContext(RevealCtx);
  const [p, setP] = useState(() => (start === null ? 1 : at(start)));
  const [from, setFrom] = useState(start);
  if (from !== start) { setFrom(start); setP(start === null ? 1 : at(start)); }   // a new reveal (ViewFrame, R4): from its start
  useEffect(() => {
    if (start === null) return;
    let id = 0;
    const tick = () => { const v = at(start); setP(v); if (v < 1) id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [start]);
  return start === null ? 1 : p;
}

/** 里's entrance for a hand-drawn canvas (controller decision after Task 6): the canvas draws its end state once and
 *  this style fades the element in with useReveal's `p` — opacity plus a slight brightening — so no frame of the
 *  entrance redraws it. Undefined once in (and at once in 表 / reduced motion). */
export function useFade(): CSSProperties | undefined {
  const p = useReveal();
  return p >= 1 ? undefined : { opacity: p, filter: `brightness(${(0.6 + 0.4 * p).toFixed(3)})` };
}
