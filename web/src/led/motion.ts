import { DEFAULT_PREFS } from "../prefs/defaults";
import type { InkFx, LedFx, Prefs, Trigger } from "../prefs/types";

/** The live motion settings every board and ink element reads at the moment it animates. Filled
 *  from prefs by V2App; `origin` is where the last language / world switch was clicked (ripple). */
export const motion = {
  fx: { ...DEFAULT_PREFS.fx } as Record<Trigger, LedFx>,
  ofx: { ...DEFAULT_PREFS.ofx } as Record<Trigger, InkFx>,
  speed: 1,
  origin: null as { x: number; y: number } | null,
};

export function setMotion(p: Pick<Prefs, "fx" | "ofx" | "speed">): void {
  motion.fx = { ...p.fx }; motion.ofx = { ...p.ofx }; motion.speed = p.speed;
}

/** Read on every call, so turning the OS setting on mid-session takes effect at the next change. */
export function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function __resetMotionForTests(): void {
  motion.fx = { ...DEFAULT_PREFS.fx }; motion.ofx = { ...DEFAULT_PREFS.ofx }; motion.speed = 1; motion.origin = null;
}
