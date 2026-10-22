import { useCanvas } from "../../chart/useCanvas";
import type { World } from "../../prefs/types";
import { C } from "../../ui/palette";
import { useWorld } from "../../world/store";
import { drawDayBarUra } from "../report/bar";
import { drawBarOmote } from "./bar";

/** The bar's colour: a task's line colour as given; none → amber (里) / ink (表). 里's warm highlight (C.WARM, the
 *  busiest row) is a pale peach on 表's paper: there it is the 表 accent teal. */
export const barColor = (world: World, color: string | undefined): string =>
  world === "omote" ? (color === C.WARM ? "#0e7c86" : color ?? "#0f1c2e") : color ?? C.AMBER;

/** A row's share of the list's largest, redrawn on data, world and size; aria-hidden — the figure is beside it.
 *  `color`: a task's line colour; without one the bar is amber (里) / ink (表). */
export function ListBar({ frac, color, rows = 3 }: { frac: number; color?: string; rows?: number }) {
  const world = useWorld();
  const ref = useCanvas((x, w, h, offX, offY) => {
    if (world === "omote") drawBarOmote(x, frac, barColor(world, color), { w, h }, rows);
    else drawDayBarUra(x, frac, barColor(world, color), { w, h, offX, offY }, rows);
  }, [frac, color, rows, world]);
  return <canvas ref={ref} className="db" aria-hidden="true" />;
}
