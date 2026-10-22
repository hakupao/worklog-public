import { useRef, type TouchEvent } from "react";
import { swipeOf } from "../format";

/** Left / right swipes on a page body; ignored when they start in a text field or an open
 *  sheet (a swipe there must not change the page's date underneath it). */
export function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const p = e.touches[0];
      start.current = (e.target as Element).closest("input,textarea,.m-sheet,.m-scrim") || !p ? null : { x: p.clientX, y: p.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current, p = e.changedTouches[0];
      start.current = null;
      if (!s || !p) return;
      const dir = swipeOf(p.clientX - s.x, p.clientY - s.y);
      if (dir !== 0) onSwipe(dir);
    },
  };
}
