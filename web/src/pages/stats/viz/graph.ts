// 并行关系网 (`graph`, lab e11 on 7b's terms): the linked tasks as nodes of an ECharts force graph — size ∝ √ of
// their wall clock split evenly (splitBy, U17) — joined where they were open at the same time: for each segment,
// each distinct pair of task keys among its open sessions gets the segment's length. Unlinked time is left out.
// The force layout starts from a circle in task-id order (no random start), so the same data lands the same way.
import { hours } from "../../../lib/format";
import type { World } from "../../../prefs/types";
import { lineColor } from "../../../ui/palette";
import { esc, fillOf, glow, lab, richTaskLabels, tipHtml, tipImg, type EChartsOptionLike, type TipImgFn } from "./echarts-theme";
import type { TaskSil } from "../../../ui/taskGlyph";
import { splitBy, type Prepared, type Seg } from "./wall";

export interface GraphNode { task: string; wall: number }
/** `a` < `b`; `min` = minutes both were open. */
export interface GraphEdge { a: string; b: string; min: number }
export interface ParGraph { nodes: GraphNode[]; edges: GraphEdge[] }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function deriveGraph(prep: Prepared, segs: Seg[]): ParGraph {
  const by = splitBy(segs, prep, (s) => s.task_id ?? "");
  const nodes = [...by].filter(([k, v]) => k !== "" && v > 0).map(([task, wall]) => ({ task, wall })).sort((x, y) => cmp(x.task, y.task));
  const pairs = new Map<string, number>();
  for (const s of segs) {
    const ks = [...new Set(s.ids.map((id) => prep.byId.get(id)?.task_id ?? ""))].filter(Boolean).sort(cmp);
    if (ks.length < 2) continue;
    const len = (s.b - s.a) / 60_000;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const k = ks[i] + "\u0000" + ks[j];
      pairs.set(k, (pairs.get(k) ?? 0) + len);
    }
  }
  const edges = [...pairs].map(([k, min]) => { const [a, b] = k.split("\u0000"); return { a, b, min }; })
    .sort((x, y) => y.min - x.min || cmp(x.a, y.a) || cmp(x.b, y.b));
  return { nodes, edges };
}

/** The force graph (minutes as values; the tooltip reads hours). `taskName(k)` labels a node, `title(k)` adds a line
 *  to its tooltip. */
export function graphOption(world: World, g: ParGraph, taskName: (k: string) => string, title?: (k: string) => string, img: TipImgFn | null = null, sil: TaskSil | null = null): EChartsOptionLike {
  const rl = richTaskLabels(g.nodes.map((x) => x.task), sil, taskName);
  const om = world === "omote", n = g.nodes.length;
  const mxN = Math.max(0, ...g.nodes.map((x) => x.wall)), mxE = Math.max(0, ...g.edges.map((e) => e.min));
  const data = g.nodes.map((x, i) => {
    const c = lineColor(x.task), a = (i / n) * 2 * Math.PI;
    return {
      name: x.task, task: x.task, value: x.wall, x: Math.cos(a) * 200, y: Math.sin(a) * 200,
      symbolSize: 8 + 34 * Math.sqrt(mxN ? x.wall / mxN : 0),
      itemStyle: { color: fillOf(world, c), ...glow(world, c, 18), borderColor: om ? "#f4f5f7" : "rgba(255,255,255,.6)", borderWidth: om ? 1.5 : 0.5 },
    };
  });
  const links = g.edges.map((e) => {
    const opacity = 0.15 + (0.6 * e.min) / mxE;
    // not adjacent to the hovered task: .3 of the link's own opacity (ECharts' default blur is .1)
    return { source: e.a, target: e.b, value: e.min, lineStyle: { width: 0.5 + (5 * e.min) / mxE, opacity }, blur: { lineStyle: { opacity: opacity * 0.3 } } };
  });
  const lead = (k: string) => tipImg(img?.(k) ?? null);
  return {
    tooltip: {
      formatter: (p: { dataType?: string; name: string; value: number; data: { source?: string; target?: string } }) => (p.dataType === "edge"
        ? tipHtml("", hours(p.value), undefined, `${lead(p.data.source!)}${esc(taskName(p.data.source!))}${esc(" + ")}${lead(p.data.target!)}${esc(taskName(p.data.target!))}`)
        : tipHtml(taskName(p.name), hours(p.value), title?.(p.name), lead(p.name))),
    },
    series: [{
      type: "graph", layout: "force", data, links, roam: "move", zoom: 0.72, draggable: true,
      force: { repulsion: 700, edgeLength: [90, 240], gravity: 0.05, layoutAnimation: false },
      label: { show: true, position: "bottom", ...lab(world), color: om ? "#0f1c2e" : "#ffe2b8", formatter: (p: { name: string }) => rl.text(p.name), ...(rl.rich ? { rich: rl.rich } : {}) },
      lineStyle: { color: om ? "#5b6573" : "#ffad3a", curveness: 0.12 },
      emphasis: { focus: "adjacency", lineStyle: { opacity: 0.9 } },
      blur: { itemStyle: { opacity: 0.3 }, label: { opacity: 0.3 } },
    }],
  };
}
