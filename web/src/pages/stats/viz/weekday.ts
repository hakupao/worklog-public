// 星期均值 (`weekday`): average wall clock per weekday, as an ECharts pictorial dot bar (lab e6).
import { hours } from "../../../lib/format";
import type { Lang, World } from "../../../prefs/types";
import { weekdayOf } from "./day";
import { busiest, glow, lab, tipHtml, type EChartsOptionLike } from "./echarts-theme";
import { tv } from "./strings";
import type { DayAgg } from "./wall";

/** Per weekday (0 = Monday … 6 = Sunday): `n` = that weekday's 5:00 days in the range, idle ones included (perDay
 *  emits every day); `avg` = their wall-clock minutes ÷ n, null for a weekday the range does not reach. */
export interface WeekdayAvg { avg: (number | null)[]; n: number[] }

export function deriveWeekday(days: readonly DayAgg[]): WeekdayAvg {
  const sum = new Array<number>(7).fill(0), n = new Array<number>(7).fill(0);
  for (const d of days) { const w = weekdayOf(d.date); sum[w] += d.union; n[w] += 1; }
  return { avg: sum.map((s, w) => (n[w] ? s / n[w] : null)), n };
}

/** Two pictorial bars per weekday: a silent dim track to the scale's end and the clipped value bar; weekends at .6,
 *  the busiest weekday lit. 里 5×5 dots, 表 4×12 ink rects. Values in hours (one decimal). */
export function weekdayOption(world: World, w: WeekdayAvg, names: readonly string[], lang: Lang): EChartsOptionLike {
  const om = world === "omote", vals = w.avg.map((m) => (m === null ? 0 : Math.round(m / 6) / 10));
  const best = busiest(w.avg), mx = Math.ceil(Math.max(0, ...vals) + 1);
  const sym = om ? "rect" : "circle", size = om ? [4, 12] : [5, 5], margin = om ? 1.5 : 1.2;
  return {
    tooltip: {
      trigger: "axis", axisPointer: { type: "none" },
      formatter: (ps: { dataIndex: number }[]) => {
        const i = ps[0].dataIndex, m = w.avg[i];
        return tipHtml(names[i], m === null ? "—" : tv(lang, "weekday.perDay", { v: hours(m) }), tv(lang, "weekday.days", { n: w.n[i] }));
      },
    },
    grid: { left: 64, right: 44, top: 10, bottom: 20 },
    xAxis: { type: "value", max: mx, splitLine: { show: false }, axisLabel: { show: false }, axisLine: { show: false } },
    yAxis: { type: "category", data: [...names], inverse: true, axisLine: { show: false }, axisLabel: { ...lab(world), color: om ? "#5b6573" : "rgba(255,173,58,.6)" } },
    series: [
      { type: "pictorialBar", data: vals.map(() => mx), symbol: sym, symbolRepeat: true, symbolSize: size, symbolMargin: margin,
        itemStyle: { color: om ? "#e3e7ec" : "rgba(255,236,214,.09)" }, z: 1, silent: true },
      { type: "pictorialBar", symbol: sym, symbolRepeat: true, symbolSize: size, symbolMargin: margin, symbolClip: true, z: 2,
        label: { show: true, position: "right", ...lab(world), color: om ? "#0f1c2e" : "#ffc46a", formatter: (p: { value: number }) => `${p.value}h` },
        data: vals.map((value, i) => ({
          value,
          itemStyle: {
            color: om ? (i === best ? "#0b1626" : "#0f1c2e") : (i === best ? "#ffe2b8" : "#ffad3a"),
            ...(i === best ? glow(world, "#ffe2b8", 10) : glow(world, "#ffad3a", 5)),
            opacity: i >= 5 ? 0.6 : 1,
          },
        })) },
    ],
  };
}
