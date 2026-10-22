import { useEffect, useState } from "react";
import { reducedMotion } from "../../led/motion";

/** The 今日安排 rows' rhythm (prototype page-plan.html:392, user ruling U4): every 8 s each row flips between its
 *  item and its second line. Not while the tab is hidden, never with 减少动态效果, and `on` = false (a drawer is
 *  open) stops it and puts every row back on its item. Returns the flip count; 0 = show the item. */
export const FLIP_MS = 8000;
export const FLIP_STAGGER_MS = 90;

export function useFlip(on: boolean): number {
  const [n, setN] = useState(0);
  // 减少动态效果 switched while the page is open takes effect at once, not at the next drawer (preflight R13)
  const [reduce, setReduce] = useState(reducedMotion);
  useEffect(() => {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!mq || typeof mq.addEventListener !== "function") return;
    const h = () => setReduce(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  useEffect(() => {
    if (!on || reduce) { setN(0); return; }
    const id = setInterval(() => { if (!document.hidden) setN((x) => x + 1); }, FLIP_MS);
    return () => clearInterval(id);
  }, [on, reduce]);
  return n;
}

/** One row's side of the flip: odd = the second line, after its own stagger (rows flip top to bottom). */
export function useRowFlip(n: number, index: number): boolean {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    if (n === 0) { setAlt(false); return; }
    const id = setTimeout(() => setAlt(n % 2 === 1), index * FLIP_STAGGER_MS);
    return () => clearTimeout(id);
  }, [n, index]);
  return alt;
}
