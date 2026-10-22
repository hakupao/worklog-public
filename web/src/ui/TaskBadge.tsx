import { createContext, lazy, Suspense, useContext, type CSSProperties } from "react";
import { RATIO } from "../badge/geom";            // geom.ts imports nothing: safe to load with every page
import { taskCode } from "./taskCode";
import type { World } from "../prefs/types";

// The badge engine + objects.gen.ts (239 KB) load on the first badge, never with a page chunk (B2 constraint 3).
const Badge = lazy(() => import("../badge/Badge").then((m) => ({ default: m.Badge })));

/** Pinned heights (spec §2.3 levels: ≤ 24 S, ≤ 48 M, else L). Rows are S; drawer headers L. */
export const BADGE_H = { row: 22, tip: 16, chip: 16, drawer: 56, mRow: 18, mSheet: 56 } as const;
/** The material for badges below; undefined = the v2 world store. The phone shell maps its theme onto it. */
export const BadgeWorld = createContext<World | undefined>(undefined);

/** A task's badge in place of its code (B2). The box keeps the footprint while the engine loads; the code is the
 *  image's name and the box's hover title (decision 1). */
export function TaskBadge({ id, height, dim, className, title }: { id: string; height: number; dim?: boolean; className?: string; title?: string | null }) {
  const world = useContext(BadgeWorld);
  const box: CSSProperties = { width: Math.round(height * RATIO), height };
  return (
    <span className={`tbadge${dim ? " dim" : ""}${className ? ` ${className}` : ""}`} data-task={id} title={title === null ? undefined : title ?? taskCode(id)} style={box}>
      <Suspense fallback={null}><Badge spec={{ id }} height={height} alt={taskCode(id)} world={world} /></Suspense>
    </span>
  );
}

/** Several tasks in one cell (plan rows): the first `max` badges, then +k; the title lists every code (on the group only,
 *  so an inner badge's own title does not shadow it). `dim` = a tier-2 row: badges and +k at the dim opacity. */
export function TaskBadges({ ids, height, max = 1, dim }: { ids: string[]; height: number; max?: number; dim?: boolean }) {
  if (!ids.length) return null;
  const more = ids.length - max;
  return (
    <span className={`tbadges${dim ? " dim" : ""}`} title={ids.map(taskCode).join(" ")}>
      {ids.slice(0, max).map((k) => <TaskBadge key={k} id={k} height={height} dim={dim} title={ids.length > 1 ? null : undefined} />)}
      {more > 0 && <span className="tb-more">+{more}</span>}
    </span>
  );
}
