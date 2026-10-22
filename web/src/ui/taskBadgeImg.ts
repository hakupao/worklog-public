import { useEffect, useState } from "react";
import type { World } from "../prefs/types";
import { BADGE_H } from "./TaskBadge";

/** ECharts tooltips are HTML strings built synchronously: warm() makes each task's S badge image once (bitmap when a
 *  canvas exists, else the SVG url), img() returns it or null (the tip then shows the code alone, constraint 8). */
export interface TaskBadgeImg { warm(ids: readonly string[], world: World): Promise<void>; img(id: string, world: World): string | null }

let loading: Promise<TaskBadgeImg> | undefined;
export function loadTaskBadgeImg(): Promise<TaskBadgeImg> {
  return (loading ??= import("../badge/cache").then((m): TaskBadgeImg => {
    const urls = new Map<string, string>(), key = (id: string, w: World) => `${w}|${id}`;
    const dpr = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    return {
      async warm(ids, world) {
        await Promise.all(ids.filter((id) => id && !urls.has(key(id, world))).map(async (id) => {
          const bmp = m.canRaster() ? await m.badgeBitmapUrl({ id }, "S", world, BADGE_H.tip, dpr) : null;
          urls.set(key(id, world), bmp ?? m.badgeSvgUrl({ id }, "S", world));
        }));
      },
      img: (id, world) => urls.get(key(id, world)) ?? null,
    };
  }).catch((e) => { loading = undefined; throw e; }));
}

let ready: TaskBadgeImg | null = null;
/** The loaded accessor's image for a tooltip, read at hover time (null until the load and `warm()` are done). The chart's
 *  option signature ignores functions, so a formatter must not close over the hook's state: it reads this instead. */
export const tipBadgeUrl = (id: string, world: World): string | null => ready?.img(id, world) ?? null;

export function useTaskBadgeImg(): TaskBadgeImg | null {
  const [b, setB] = useState<TaskBadgeImg | null>(ready);
  useEffect(() => {
    if (ready) { setB(ready); return; }
    let live = true;
    loadTaskBadgeImg().then((x) => { ready = x; if (live) setB(x); }, () => {});
    return () => { live = false; };
  }, []);
  return b;
}
