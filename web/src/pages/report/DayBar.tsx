import { useCanvas } from "../../chart/useCanvas";
import { C } from "../../ui/palette";
import { useWorld } from "../../world/store";
import { drawDayBarOmote, drawDayBarUra } from "./bar";

/** One day's bar — under the 日別作業 合計 row (2 dot rows) or on a 稼働 row (3, prototype buildHours()) — redrawn
 *  on data, world and size; aria-hidden — the figure is beside or above it. */
export function DayBar({ frac, rows = 2 }: { frac: number; rows?: number }) {
  const world = useWorld();
  const ref = useCanvas((x, w, h, offX, offY) => {
    if (world === "omote") drawDayBarOmote(x, frac, { w, h }, rows);
    else drawDayBarUra(x, frac, C.AMBER, { w, h, offX, offY }, rows);
  }, [frac, rows, world]);
  return <canvas ref={ref} className="db" aria-hidden="true" />;
}
