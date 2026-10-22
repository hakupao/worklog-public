import { buildHints } from "./hints";
import type { Range } from "./range";
import { aiStats, outputStats, overview, requesterStats, rhythmStats, timeStats } from "./stats";
import type { DashInput, Dashboard } from "./types";

export function buildDashboard(i: DashInput, range: Range, prev: Range, now: Date): Dashboard {
  const rhythm = rhythmStats(i, range);
  return {
    range, prev_range: prev,
    overview: overview(i, range), overview_prev: overview(i, prev),
    time: timeStats(i, range), ai: aiStats(i, range), rhythm, output: outputStats(i, range),
    hints: buildHints(i, range, rhythm, now),
    requesters: requesterStats(i, range),
  };
}
