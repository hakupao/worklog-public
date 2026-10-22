import { STATS_VIEW_NEEDS } from "../../prefs/statsViews";
import { STATS_VIEWS, type StatsView } from "../../prefs/types";

/** What the page needs to know about a view before drawing it (brief assumption 5). `needs`: the 表 module that
 *  hides it on top of the user's own on / off; `echarts`: drawn by the lazy ECharts chunk; `cumulative`: a
 *  sub-project 7 block on /api/dashboard's summed minutes, marked 累计 beside its name (U18). */
export interface ViewMeta { needs?: "stats.cost" | "stats.review"; echarts?: boolean; cumulative?: boolean }

/** The sub-project 7 blocks: views drawn from the dashboard, rendered by StatsPage (not in the lazy views chunk). */
export const SUB7_VIEWS = ["time", "share", "rhythm", "ai", "review"] as const;
export type Sub7View = (typeof SUB7_VIEWS)[number];
export const isSub7 = (id: StatsView): id is Sub7View => (SUB7_VIEWS as readonly string[]).includes(id);

const ECHARTS = new Set<StatsView>(["hours24", "weekday", "sankey", "graph", "parallel"]);
const CUMULATIVE = new Set<StatsView>(["time", "share", "rhythm", "ai"]);

export const VIEW_META = Object.fromEntries(STATS_VIEWS.map((id): [StatsView, ViewMeta] => {
  const needs = STATS_VIEW_NEEDS[id];
  return [id, { ...(needs ? { needs } : {}), ...(ECHARTS.has(id) ? { echarts: true } : {}), ...(CUMULATIVE.has(id) ? { cumulative: true } : {}) }];
})) as Record<StatsView, ViewMeta>;
