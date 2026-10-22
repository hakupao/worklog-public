// 流向 (`sankey`, lab e3 on 7b's terms): machine → agent → task as an ECharts sankey. The flows are wall clock, split
// in two steps per segment: its length first goes evenly to the distinct tasks open in it (U17, so the task layer is
// exactly splitBy by task), then each task's share goes evenly to that task's distinct (machine, agent) pairs open in
// the segment. The machine and agent layers sum from those flows; every layer adds up to the range's wall clock.
import { hours } from "../../../lib/format";
import type { World } from "../../../prefs/types";
import { inkOf, lineColor } from "../../../ui/palette";
import { esc, glow, lab, richTaskLabels, tipHtml, tipImg, type EChartsOptionLike, type TipImgFn } from "./echarts-theme";
import type { TaskSil } from "../../../ui/taskGlyph";
import type { Prepared, Seg } from "./wall";

export interface SankeyFlow {
  total: number;
  /** Layer totals, largest first (task "" = unlinked). */
  machines: Map<string, number>; agents: Map<string, number>; tasks: Map<string, number>;
  /** Edges, largest first. */
  ma: { m: string; a: string; v: number }[];
  at: { a: string; t: string; v: number }[];
}

const SEP = "\u0000";
const desc = (m: Map<string, number>) => new Map([...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const edges = <T extends { v: number }>(m: Map<string, number>, mk: (a: string, b: string, v: number) => T, key: (e: T) => string) =>
  [...m].map(([k, v]) => { const [a, b] = k.split(SEP); return mk(a, b, v); }).sort((x, y) => y.v - x.v || (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));

export function deriveSankey(prep: Prepared, segs: Seg[]): SankeyFlow {
  const by = new Map<string, number>();
  for (const g of segs) {
    const pairs = new Map<string, Set<string>>(); // task → its distinct machine|agent pairs open in the segment
    for (const id of g.ids) {
      const s = prep.byId.get(id)!, t = s.task_id ?? "";
      (pairs.get(t) ?? pairs.set(t, new Set()).get(t)!).add(s.machine + SEP + s.agent);
    }
    const share = (g.b - g.a) / 60_000 / pairs.size;
    for (const [t, ma] of pairs) for (const k of ma) add(by, k + SEP + t, share / ma.size);
  }
  const machines = new Map<string, number>(), agents = new Map<string, number>(), tasks = new Map<string, number>();
  const ma = new Map<string, number>(), at = new Map<string, number>();
  let total = 0;
  for (const [k, v] of by) {
    const [m, a, t] = k.split(SEP);
    total += v;
    add(machines, m, v); add(agents, a, v); add(tasks, t, v);
    add(ma, m + SEP + a, v); add(at, a + SEP + t, v);
  }
  return {
    total, machines: desc(machines), agents: desc(agents), tasks: desc(tasks),
    ma: edges(ma, (m, a, v) => ({ m, a, v }), (e) => e.m + SEP + e.a),
    at: edges(at, (a, t, v) => ({ a, t, v }), (e) => e.a + SEP + e.t),
  };
}

/** Node names are unique across the layers (ECharts merges equal names): `m:`, `a:`, `t:` + key. */
export const UNLINKED_NODE = "t:";
export const agentName = (a: string) => (a === "claude-code" ? "Claude Code" : a === "codex" ? "Codex" : a);
const tColor = (world: World, t: string) => (world === "omote" ? inkOf(lineColor(t || null)) : lineColor(t || null));

/** The gap between nodes (px): a label's height (12) and one more, so the thinnest task nodes' labels do not touch (P2). */
const GAP = 13;
/** The chart's height for `n` task nodes: 12px a node beside its gap, at least 240. */
export const sankeyHeight = (n: number) => Math.max(240, n * (GAP + 12) + 40);

/** The sankey (minutes as values; the tooltip reads hours). `taskName(k)` labels a task node ("" = unlinked). */
export function sankeyOption(world: World, f: SankeyFlow, taskName: (k: string) => string, img: TipImgFn | null = null, sil: TaskSil | null = null): EChartsOptionLike {
  const rl = richTaskLabels([...f.tasks.keys()], sil, taskName);
  const om = world === "omote";
  const node = (name: string, color: string, extra: object = {}) => ({ name, ...extra, itemStyle: { color, borderWidth: 0, ...glow(world, color, 8) } });
  const label = (name: string) => {
    const k = name.slice(2);
    return name.startsWith("m:") ? k : name.startsWith("a:") ? agentName(k) : taskName(k);
  };
  const data = [
    ...[...f.machines.keys()].map((m) => node(`m:${m}`, om ? "#0f1c2e" : "#ffe2b8")),
    ...[...f.agents.keys()].map((a) => node(`a:${a}`, om ? "#5b6573" : a === "codex" ? "#bfe6ff" : "#ffad3a")),
    ...[...f.tasks.keys()].map((t) => node(`t:${t}`, tColor(world, t), { task: t || null })),
  ];
  const links = [
    ...f.ma.map((e) => ({ source: `m:${e.m}`, target: `a:${e.a}`, value: e.v })),
    ...f.at.map((e) => ({ source: `a:${e.a}`, target: `t:${e.t}`, value: e.v, task: e.t || null, lineStyle: { color: tColor(world, e.t) } })),
  ];
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: { dataType?: string; name: string; value: number; data: { source?: string; target?: string } }) => {
        const v = hours(p.value);
        const lead = (n: string) => (n.startsWith("t:") && n.length > 2 ? tipImg(img?.(n.slice(2)) ?? null) : "");
        // an edge into a task: the image goes after the arrow, so it does not read as the agent's badge
        return p.dataType === "edge"
          ? tipHtml("", v, undefined, `${esc(`${label(p.data.source!)} → `)}${lead(p.data.target!)}${esc(label(p.data.target!))}`)
          : tipHtml(label(p.name), v, undefined, lead(p.name));
      },
    },
    series: [{
      type: "sankey", data, links, left: 8, right: 90, top: 10, bottom: 10, nodeWidth: 6, nodeGap: GAP, draggable: true,
      label: { ...lab(world), color: om ? "#0f1c2e" : "#ffe2b8", formatter: (p: { name: string }) => (p.name.startsWith("t:") ? rl.text(p.name.slice(2)) : label(p.name)), ...(rl.rich ? { rich: rl.rich } : {}) },
      // the thinnest task nodes sit a few px apart: their labels would print over each other
      labelLayout: { hideOverlap: true },
      lineStyle: { color: "source", opacity: om ? 0.3 : 0.22, curveness: 0.5 },
      emphasis: { focus: "adjacency", lineStyle: { opacity: om ? 0.6 : 0.55 } },
      // what is not adjacent drops to .3 of its own opacity like every other view (ECharts' default blur is .1)
      blur: { itemStyle: { opacity: 0.3 }, lineStyle: { opacity: (om ? 0.3 : 0.22) * 0.3 }, label: { opacity: 0.3 } },
    }],
  };
}
