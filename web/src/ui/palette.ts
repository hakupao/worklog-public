import { LINE_PALETTE } from "./palette-data";
import { taskBadgeOf } from "./taskBadges";

export const C = { AMBER: "#ffad3a", WARM: "#ffe2b8", DIM: "#9c6f33", GREEN: "#7dff9e", RED: "#ff4a35" } as const;
/** Glow per luminance tier L0..L3 (spec §4.2); brightness itself is the canvas opacity in v2.css. */
export const TIER_GLOW = [1, 0.32, 0.15, 0] as const;
/** Task line colours (prototype hall.js:19-20); the data lives in palette-data.ts so taskBadges.ts can read it without a cycle. */
export { LINE_PALETTE } from "./palette-data";
/** A task's line colour (spec §3): the stored badge colour when the page has seen it, else a stable hash of the id. */
export function lineColor(taskId: string | null): string {
  if (!taskId) return "#9aa0a8";
  const c = taskBadgeOf(taskId)?.color;
  return c != null ? LINE_PALETTE[c] : hashLineColor(taskId);
}
/** The registry-blind colour: a stable hash of the id. */
export function hashLineColor(taskId: string): string {
  let h = 0;
  for (const ch of taskId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LINE_PALETTE[h % LINE_PALETTE.length];
}

/** A line colour deepened for 表's paper: mixed 28% toward the ink #0f1c2e (lab page-stats-lab.js `inkc`). `c` is
 *  #rrggbb. */
export function inkOf(c: string): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(ch(c, i) + (ch("#0f1c2e", i) - ch(c, i)) * 0.28).toString(16).padStart(2, "0")).join("");
}

/** `c` moved toward `t` by `a` (both #rrggbb) — B3 tier-3 bright edges and capsules. */
export function mix(c: string, t: string, a: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(ch(c, i) + (ch(t, i) - ch(c, i)) * a).toString(16).padStart(2, "0")).join("");
}
