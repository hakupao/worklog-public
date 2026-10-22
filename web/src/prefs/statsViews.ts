import { STATS_VIEWS, type Prefs, type StatsView } from "./types";

/** Views a front-world module hides on top of the user's own on / off (spec §6; brief assumption 7). */
export const STATS_VIEW_NEEDS: Partial<Record<StatsView, "stats.cost" | "stats.review">> = {
  compute: "stats.cost", ai: "stats.cost", review: "stats.review",
};

const KNOWN = new Set<string>(STATS_VIEWS);

/** The 统计页 view list as the user arranged it (U20): unknown ids dropped, duplicates removed, missing ids
 *  appended in default order (so a view added later shows up on its own); no `stats` = all on, default order.
 *  Called wherever the list is used — a server response does not go through normalizePrefs. */
export function resolveViews(stats: Prefs["stats"] | undefined): { id: StatsView; on: boolean }[] {
  const seen = new Set<StatsView>();
  for (const id of stats?.order ?? []) if (KNOWN.has(id)) seen.add(id as StatsView);
  for (const id of STATS_VIEWS) seen.add(id);
  const off = new Set(stats?.off ?? []);
  return [...seen].map((id) => ({ id, on: !off.has(id) }));
}
