export interface Animated { frame(ts: number): boolean }

// One requestAnimationFrame for every board on the page; a board is in the loop only while it animates.
const live = new Set<Animated>();
let raf = 0;
function loop(ts: number) {
  raf = 0;
  for (const a of [...live]) if (!a.frame(ts)) live.delete(a);
  if (live.size) raf = requestAnimationFrame(loop);
}
export function kick(a: Animated) { live.add(a); if (!raf && typeof requestAnimationFrame === "function") raf = requestAnimationFrame(loop); }
export function unkick(a: Animated) { live.delete(a); }
export function isLive(a: Animated) { return live.has(a); }
export function __resetLoopForTests() { live.clear(); raf = 0; }
