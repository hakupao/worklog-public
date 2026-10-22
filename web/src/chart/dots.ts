import { PITCH } from "../led/lattice";
import { MIN } from "../predict/time";

// The run-chart grammar shared by 此刻 (today) and 时间线 (the week): 1 dot = 5 minutes by default; 此刻 stretches its
// axis to the width and passes its own minutes per dot (now/chart.ts geometry).
export const STEP_MIN = 5;

/** Per dot of `stepMin` minutes (default 5) from `from`: the active share of that dot (can exceed 1 when sessions overlap). */
export function coverage(intervals: [number, number][], from: number, ndot: number, stepMin = STEP_MIN): Float32Array {
  const step = stepMin * MIN, a = new Float32Array(ndot), to = from + ndot * step;
  for (const [x0, y0] of intervals) {
    const x = Math.max(x0, from), y = Math.min(y0, to);
    if (y <= x) continue;
    for (let i = Math.floor((x - from) / step); i < Math.ceil((y - from) / step); i++) {
      const s0 = from + i * step;
      a[i] += (Math.min(y, s0 + step) - Math.max(x, s0)) / step;
    }
  }
  return a;
}

/** The canvas's offset on the page-wide lattice of `u` (spec §4.1: every dot snaps to the same grid): PITCH in 里;
 *  OMOTE_UNIT for the shared run charts' 表 drawing, which keeps the old 3px grid. */
export function latticeOffset(el: Element, u: number): { offX: number; offY: number } {
  const r = el.getBoundingClientRect(), m = (v: number) => ((v % u) + u) % u;
  return { offX: m(-(r.left + window.scrollX)), offY: m(-(r.top + window.scrollY)) };
}
