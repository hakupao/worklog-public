// 会话平行坐标 (`parallel`, lab e10): one line per session across six axes — start (hours after its 5:00 day began,
// linear 0–24), then window minutes, turns, files, tokens and cost on log(1 + v) value axes whose labels read the
// real values back (a log axis cannot take the zeros turns / files often are). Dragging along an axis brushes it
// (ECharts' own axis area select). With stats.cost hidden (表) the cost axis is removed. An unknown value (tokens
// not collected, cost unpriced) is left empty: ECharts drops that vertex, so the line ends at (or bridges past) the
// axis it has no value on.
import { compactCount, hours } from "../../../lib/format";
import type { Lang, World } from "../../../prefs/types";
import { inkOf, lineColor } from "../../../ui/palette";
import { usdShort } from "./compute";
import { hourOf5 } from "./day";
import { clock5 } from "./fmt";
import { tokensOf } from "./headlines";
import { lab, tipHtml, tipImg, type EChartsOptionLike, type TipImgFn } from "./echarts-theme";
import { tv, type VStrKey } from "./strings";
import type { Prepared, PSession } from "./wall";

export interface ParRow { s: PSession; start: number; min: number; turns: number; files: number; tok: number | null; cost: number | null }

/** The window's sessions in order; `min` = window minutes (wall), `start` = hourOf5 of the first window instant. */
export function deriveParallel(prep: Prepared): ParRow[] {
  return prep.sessions.map((s) => ({ s, start: hourOf5(s.t0), min: s.wall, turns: s.turns, files: s.files, tok: tokensOf(s), cost: s.cost_usd }));
}

const lg = (v: number | null) => (v === null ? null : Math.log1p(v));
const ex = (v: number) => Math.expm1(v);
const mins = (m: number) => (m < 60 ? `${Math.round(m)}m` : hours(m));
const AXES: [VStrKey, (r: ParRow) => number | null, (v: number) => string][] = [
  ["par.start", (r) => r.start, clock5],
  ["par.min", (r) => lg(r.min), (v) => mins(ex(v))],
  ["par.turns", (r) => lg(r.turns), (v) => String(Math.round(ex(v)))],
  ["par.files", (r) => lg(r.files), (v) => String(Math.round(ex(v)))],
  ["par.tok", (r) => lg(r.tok), (v) => compactCount(ex(v))],
  ["par.cost", (r) => lg(r.cost), (v) => usdShort(ex(v))],
];

/** The axes' name keys in order; the last (cost) goes with stats.cost. */
export const axisKeys = (cost: boolean): VStrKey[] => (cost ? AXES : AXES.slice(0, 5)).map(([k]) => k);

/** One series per task key ("" = unlinked first), items `{value, task, sid}`. `cost` false drops the cost axis. */
export function parallelOption(world: World, rows: readonly ParRow[], cost: boolean, taskName: (k: string) => string, lang: Lang, img: TipImgFn | null = null): EChartsOptionLike {
  const om = world === "omote", axes = cost ? AXES : AXES.slice(0, 5);
  const groups = new Map<string, ParRow[]>();
  for (const r of rows) { const k = r.s.task_id ?? ""; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const bySid = new Map(rows.map((r) => [r.s.id, r]));
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: { data?: { sid?: string } }) => {
        const r = p.data?.sid ? bySid.get(p.data.sid) : undefined;
        if (!r) return "";
        const parts = [tv(lang, "par.turns.v", { n: r.turns }), tv(lang, "par.files.v", { n: r.files }), r.tok === null ? null : tv(lang, "sess.tok", { k: compactCount(r.tok) }),
          cost && r.cost !== null ? usdShort(r.cost) : null].filter(Boolean).join(" · ");
        return tipHtml(taskName(r.s.task_id ?? ""), `${clock5(r.start)} · ${mins(r.min)}`, parts, r.s.task_id ? tipImg(img?.(r.s.task_id) ?? null) : "");
      },
    },
    parallel: {
      left: 50, right: 60, top: 40, bottom: 26,
      parallelAxisDefault: {
        nameTextStyle: { ...lab(world), color: om ? "#0f1c2e" : "#ffc46a", fontSize: 12 },
        axisLabel: { ...lab(world), color: om ? "#5b6573" : "rgba(255,173,58,.45)" },
        axisLine: { lineStyle: { color: om ? "rgba(15,28,46,.4)" : "rgba(255,226,184,.35)" } }, splitLine: { show: false },
        areaSelectStyle: { color: om ? "rgba(14,124,134,.15)" : "rgba(255,173,58,.18)", borderColor: om ? "#0e7c86" : "#ffad3a" },
      },
    },
    // the log axes end at their data's largest value: left to ECharts, their extent stopped short of the longest
    // sessions, whose lines then ran above the axes; their ticks at quarters of it, so the top label has room (P2)
    parallelAxis: axes.map(([key, v, f], dim) => {
      const max = dim === 0 ? 24 : Math.max(0, ...rows.map(v).filter((x): x is number => x !== null)) || 1;
      return { dim, name: tv(lang, key), min: 0, max, ...(dim === 0 ? {} : { interval: max / 4 }), axisLabel: { formatter: f } };
    }),
    series: [...groups].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, rs]) => {
      const c = om ? inkOf(lineColor(k || null)) : lineColor(k || null);
      return {
        name: taskName(k), type: "parallel", smooth: false, inactiveOpacity: 0.03, activeOpacity: 1,
        data: rs.map((r) => ({ value: axes.map(([, v]) => v(r)), task: k || null, sid: r.s.id })),
        lineStyle: { color: c, width: 1, opacity: om ? 0.3 : 0.35, ...(om ? {} : { shadowBlur: 4, shadowColor: c }) },
        // a task hovered here or anywhere on the page (EChart's highlight) lifts its lines; the other series drop to .3
        emphasis: { focus: "series", lineStyle: { width: 2, opacity: 1 } },
        blur: { lineStyle: { opacity: (om ? 0.3 : 0.35) * 0.3 } },
      };
    }),
  };
}
