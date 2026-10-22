// 24 小时分布 (`hours24`): wall clock per JST clock hour over the range, as an ECharts polar bar (lab e5).
import { hours } from "../../../lib/format";
import type { Lang, World } from "../../../prefs/types";
import { clockHour, HOUR_MS } from "./day";
import { busiest, fillOf, glow, lab, tipHtml, type EChartsOptionLike } from "./echarts-theme";
import { tv } from "./strings";
import type { Seg } from "./wall";

/** Minutes with at least one session open, per JST clock hour 0–23 (segments cut at whole hours; JST is a whole-hour
 *  offset, so UTC hour boundaries are JST ones). Sums to the union of `segs`. */
export function deriveHours24(segs: readonly Seg[]): number[] {
  const out = new Array<number>(24).fill(0);
  for (const s of segs) {
    for (let a = s.a; a < s.b;) {
      const e = Math.min(s.b, (Math.floor(a / HOUR_MS) + 1) * HOUR_MS);
      out[clockHour(a)] += (e - a) / 60_000;
      a = e;
    }
  }
  return out;
}

export const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** Polar bar, 0:00 at the top, clockwise; the busiest hour lit. Values in hours (one decimal). */
export function hours24Option(world: World, mins: readonly number[], lang: Lang): EChartsOptionLike {
  const best = busiest(mins);
  return {
    tooltip: { formatter: (p: { dataIndex: number }) => tipHtml(tv(lang, "hours24.tip", { a: hh(p.dataIndex), b: hh(p.dataIndex + 1) }), tv(lang, "wall", { v: hours(mins[p.dataIndex]) })) },
    polar: { radius: ["16%", "86%"] },
    angleAxis: { type: "category", data: mins.map((_, h) => String(h)), startAngle: 90, axisLabel: { ...lab(world), interval: 2 }, axisLine: { show: false } },
    radiusAxis: { axisLabel: { show: false }, axisLine: { show: false }, splitLine: { show: true } },
    series: [{
      type: "bar", coordinateSystem: "polar", barCategoryGap: "12%",
      data: mins.map((m, h) => ({
        value: Math.round(m / 6) / 10,
        itemStyle: h === best ? { color: fillOf(world, "#fff6e8"), ...glow(world, "#ffe2b8", 18) } : { color: fillOf(world, "#ffad3a") },
      })),
    }],
  };
}
