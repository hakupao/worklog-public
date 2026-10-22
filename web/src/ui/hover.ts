import { useSyncExternalStore } from "react";

// The task hovered anywhere on the page (spec §4.2 linked focus). Shell writes it from pointerover on any
// [data-task] element and paints .hl / .fx from it; a canvas that draws tasks (the run chart) writes it
// from its own hit-testing and reads it to lift the same task.
let cur: string | null = null;
const subs = new Set<() => void>();
export const getHoverTask = () => cur;
export function setHoverTask(k: string | null): void {
  if (k === cur) return;
  cur = k;
  subs.forEach((f) => f());
}
export function subscribeHover(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export const useHoverTask = () => useSyncExternalStore(subscribeHover, getHoverTask, () => null);
export function __resetHoverForTests(): void { cur = null; }
