import { useMemo, type ComponentType, type ReactNode } from "react";
import type { StatsSessions, Task } from "../../api/types";
import { resolveViews } from "../../prefs/statsViews";
import type { StatsView } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { isModuleHidden } from "../../world/modules";
import { useWorld } from "../../world/store";
import { isSub7, VIEW_META, type Sub7View } from "./registry";
import { taskMap, vizBase, VizCtx, type Viz } from "./useViz";
import { ViewFrame } from "./ViewFrame";
import { Calendar } from "./views/Calendar";
import { Compute } from "./views/Compute";
import { Contour } from "./views/Contour";
import { Density } from "./views/Density";
import { Dial } from "./views/Dial";
import { Fingerprint } from "./views/Fingerprint";
import { Graph } from "./views/Graph";
import { Headlines } from "./views/Headlines";
import { Hours24 } from "./views/Hours24";
import { Parallel } from "./views/Parallel";
import { Plans } from "./views/Plans";
import { River } from "./views/River";
import { Sankey } from "./views/Sankey";
import { Stars } from "./views/Stars";
import { Stream } from "./views/Stream";
import { Sunburst } from "./views/Sunburst";
import { Terrain } from "./views/Terrain";
import { Waterfall } from "./views/Waterfall";
import { Weekday } from "./views/Weekday";

/** A new view: it renders its own ViewFrame (its key figure and summary come from its derivation). */
export type ViewProps = { id: StatsView; num: string };
/** Every new view's component by id (the sub-project 7 blocks are StatsPage's); the type makes a view without one
 *  a compile error. */
export const VIEW_COMPONENTS: Record<Exclude<StatsView, Sub7View>, ComponentType<ViewProps>> = {
  headlines: Headlines, waterfall: Waterfall, river: River, dial: Dial, stream: Stream, stars: Stars, fingerprint: Fingerprint,
  hours24: Hours24, weekday: Weekday, calendar: Calendar, terrain: Terrain, contour: Contour,
  compute: Compute, density: Density, sunburst: Sunburst, sankey: Sankey, graph: Graph, parallel: Parallel, plans: Plans,
};

export interface ViewsProps {
  /** The sub-project 7 blocks' bodies, drawn from the dashboard by StatsPage (a wait / failure line until it has
   *  loaded). */
  blocks: Record<Sub7View, () => ReactNode>;
  /** Whether the dashboard is in (the blocks' bodies are theirs, not the wait line). */
  blocksReady: boolean;
  /** The range's sessions and the task table (useStatsSessions); the new views wait for both (A5: titles, not ids
   *  first), the table only until its request settles — failed, they go by ids. */
  sessions: StatsSessions | undefined;
  tasks: Task[] | undefined;
  tasksIn: boolean;
  /** A new view's body until its data arrives (a wait / failure line). */
  pending: () => ReactNode;
}

/** The 统计 page's view area (spec §3, U20; the lazy chunk): the views in the user's order (resolveViews), each
 *  full width — the ones turned off and the ones a 表 module hides (needs) left out, the rest numbered as they stand;
 *  a view whose data has not arrived keeps its place and number with a wait line (R4), so no number moves. The sessions are cut and swept once here and handed
 *  down through useViz. */
export default function Views({ blocks, blocksReady, sessions, tasks, tasksIn, pending }: ViewsProps) {
  const { prefs } = useV2(), world = useWorld();
  const base = useMemo(() => (sessions ? vizBase(sessions) : null), [sessions]);
  const byId = useMemo(() => taskMap(tasks), [tasks]);
  const cost = !isModuleHidden("stats.cost", prefs.omote.hide, world);
  const viz = useMemo<Viz | null>(() => (base ? { ...base, tasks: byId, cost } : null), [base, byId, cost]);
  const shown = resolveViews(prefs.stats).filter(({ id, on }) => {
    const needs = VIEW_META[id].needs;
    return on && !(needs && isModuleHidden(needs, prefs.omote.hide, world));
  });
  return (
    <VizCtx.Provider value={viz}>
      {shown.map(({ id }, i) => {
        const num = String(i + 1).padStart(2, "0");
        if (isSub7(id)) return <ViewFrame key={id} id={id} num={num} ready={blocksReady}>{blocks[id]()}</ViewFrame>;
        // a new view replaces this wait frame whole when its data is in (a different component under the same key:
        // the frame mounts afresh and opens with its entrance) — ViewFrame's `ready` is the blocks' path only (A2)
        if (!viz || !tasksIn) return <ViewFrame key={id} id={id} num={num} ready={false}>{pending()}</ViewFrame>;
        const V = VIEW_COMPONENTS[id];
        return <V key={id} id={id} num={num} />;
      })}
    </VizCtx.Provider>
  );
}
