import { useCanvas } from "../../chart/useCanvas";
import { useWorld } from "../../world/store";
import { drawStripOmote, drawStripUra, stripWidth, type StripOpt } from "./strip";

/** One row's 每日 strip (or the drawer's 本周 bars): redrawn on data, world and size; aria-hidden — the
 *  numbers are in the row's own cells. The canvas is one lattice step wider than the dots, so the page
 *  lattice offset never clips the last column. */
export function DayStrip({ vals, max, color, opt, height = 36 }: {
  vals: number[]; max: number; color: string; opt?: StripOpt; height?: number;
}) {
  const world = useWorld();
  const sig = vals.join(",");
  const ref = useCanvas((x, w, h, offX, offY) => {
    if (world === "omote") drawStripOmote(x, vals, max, color, { w, h }, opt);
    else drawStripUra(x, vals, max, color, { w, h, offX, offY }, opt);
  }, [sig, max, color, world, opt?.colW, opt?.gap, opt?.rows]);
  return <canvas ref={ref} className="strip" aria-hidden="true" style={{ width: `${stripWidth(vals.length, opt) + 3}px`, height: `${height}px` }} />;
}
