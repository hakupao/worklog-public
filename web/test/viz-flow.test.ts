import { describe, expect, it } from "vitest";
import { deriveGraph, graphOption } from "../src/pages/stats/viz/graph";
import { axisKeys, deriveParallel, parallelOption } from "../src/pages/stats/viz/parallel";
import { deriveSankey, sankeyOption, UNLINKED_NODE, sankeyHeight } from "../src/pages/stats/viz/sankey";
import { prepare, segments, splitBy } from "../src/pages/stats/viz/wall";
import { inkOf, lineColor } from "../src/ui/palette";
import { tv } from "../src/pages/stats/viz/strings";
import { VIZ } from "./viz-fixture";
import { glyphDataUrl, type TaskSil } from "../src/ui/taskGlyph";
import { fakeSil } from "./fake-sil";

const prep = prepare(VIZ), segs = segments(prep);
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, v) => a + v, 0);
const name = (k: string) => (k ? `#${k}` : "unlinked");

describe("deriveSankey — machine → agent → task, wall clock split by task first, then by (machine, agent) inside a task", () => {
  // per segment: tasks first, then the task's pairs. 10:30–11:00 (A T1 mac|cc, B T2 mac|codex, C T1 win|cc): T1 15 → 7.5 + 7.5,
  // T2 15. Flows: mac|cc|T1 112.5 (A 60+15+7.5, F 30), win|cc|T1 22.5 (C 7.5+15), mac|codex|T2 75 (B 15+15+15+30),
  // mac|cc|"" 120 (D), mac|cc|T2 120 (E) — 450 in all
  const f = deriveSankey(prep, segs);
  it("each layer sums to the range's wall clock", () => {
    expect(f.total).toBe(450);
    expect(sum(f.machines)).toBe(450);
    expect(sum(f.agents)).toBe(450);
    expect(sum(f.tasks)).toBe(450);
  });
  it("machines, agents, tasks; edges largest first", () => {
    expect([...f.machines]).toEqual([["macmini", 427.5], ["win11", 22.5]]);
    expect([...f.agents]).toEqual([["claude-code", 375], ["codex", 75]]);
    expect([...f.tasks]).toEqual([["T2", 195], ["T1", 135], ["", 120]]);
    expect(f.ma).toEqual([{ m: "macmini", a: "claude-code", v: 352.5 }, { m: "macmini", a: "codex", v: 75 }, { m: "win11", a: "claude-code", v: 22.5 }]);
    expect(f.at).toEqual([{ a: "claude-code", t: "T1", v: 135 }, { a: "claude-code", t: "", v: 120 }, { a: "claude-code", t: "T2", v: 120 }, { a: "codex", t: "T2", v: 75 }]);
  });
  it("the task layer is exactly the by-task splitBy (T1 135 / T2 195 / unlinked 120)", () => {
    expect(new Map(f.tasks)).toEqual(splitBy(segs, prep, (s) => s.task_id ?? ""));
    expect(f.tasks.get("T1")).toBe(135);
    expect(f.tasks.get("T2")).toBe(195);
    expect(f.tasks.get("")).toBe(120);
  });
  it("an empty range: no flow", () => {
    const e = prepare({ ...VIZ, sessions: [] });
    expect(deriveSankey(e, segments(e)).total).toBe(0);
  });
});

describe("sankeyOption — lab e3", () => {
  const f = deriveSankey(prep, segs);
  it("labels that would overlap (the thin task nodes at the bottom, shots 7b) are hidden, not stacked", () => {
    expect((sankeyOption("ura", f, name) as any).series[0].labelLayout).toEqual({ hideOverlap: true });
  });
  it("the task nodes stand a label's height apart (P2: 0929-01 / 0901-03 at the bottom touched), the chart taller to match", () => {
    const s = (sankeyOption("ura", f, name) as any).series[0];
    expect(s.nodeGap).toBeGreaterThanOrEqual(s.label.fontSize + 1);
    expect(sankeyHeight(14)).toBe(14 * (s.nodeGap + 12) + 40);
    expect(sankeyHeight(2)).toBe(240);
  });
  it("里: unique node names, task nodes carry `task` and line colours (unlinked grey); agent → task links in the task's colour", () => {
    const o = sankeyOption("ura", f, name) as any, s = o.series[0];
    expect(s.type).toBe("sankey");
    expect(s.data.map((n: { name: string }) => n.name)).toEqual(["m:macmini", "m:win11", "a:claude-code", "a:codex", "t:T2", "t:T1", UNLINKED_NODE]);
    expect(s.data.slice(4).map((n: { task: unknown }) => n.task)).toEqual(["T2", "T1", null]);
    expect(s.data.slice(0, 4).every((n: object) => !("task" in n))).toBe(true);
    expect(s.data[5].itemStyle.color).toBe(lineColor("T1"));
    expect(s.data[6].itemStyle.color).toBe(lineColor(null));
    expect(s.links.map((l: { source: string; target: string; value: number }) => `${l.source}>${l.target} ${l.value}`)).toEqual([
      "m:macmini>a:claude-code 352.5", "m:macmini>a:codex 75", "m:win11>a:claude-code 22.5",
      "a:claude-code>t:T1 135", "a:claude-code>" + UNLINKED_NODE + " 120", "a:claude-code>t:T2 120", "a:codex>t:T2 75"]);
    expect(s.links[3].lineStyle.color).toBe(lineColor("T1"));
    expect(s.links[3].task).toBe("T1");
    expect(s).toMatchObject({ nodeWidth: 6, nodeGap: 13, draggable: true, emphasis: { focus: "adjacency" }, lineStyle: { opacity: 0.22, curveness: 0.5 } });
    expect(s.label.formatter({ name: "t:T1" })).toBe("#T1");
    expect(s.label.formatter({ name: UNLINKED_NODE })).toBe("unlinked");
    expect(s.label.formatter({ name: "a:codex" })).toBe("Codex");
    expect(s.label.formatter({ name: "m:win11" })).toBe("win11");
  });
  it("表: ink nodes, task colours deepened, links at .3", () => {
    const s = (sankeyOption("omote", f, name) as any).series[0];
    expect(s.data[0].itemStyle.color).toBe("#0f1c2e");
    expect(s.data[5].itemStyle.color).toBe(inkOf(lineColor("T1")));
    expect(s.links[3].lineStyle.color).toBe(inkOf(lineColor("T1")));
    expect(s.lineStyle.opacity).toBe(0.3);
  });
  it("a hover elsewhere dims what is not adjacent to .3 of its own opacity in both worlds (D1: ECharts' default blur is .1)", () => {
    for (const w of ["ura", "omote"] as const) {
      const s = (sankeyOption(w, f, name) as any).series[0];
      expect(s.blur.lineStyle.opacity).toBeCloseTo(s.lineStyle.opacity * 0.3, 9);
      expect(s.blur.itemStyle.opacity).toBe(0.3);
      expect(s.blur.label.opacity).toBe(0.3);
    }
  });
});

describe("deriveGraph — tasks open at the same time", () => {
  const g = deriveGraph(prep, segs);
  it("nodes: the linked tasks by id with their split wall clock (unlinked left out)", () => {
    expect(g.nodes).toEqual([{ task: "T1", wall: 135 }, { task: "T2", wall: 195 }]);
  });
  it("edges: per segment each distinct pair of task keys gets the segment's length — T1 + T2 10:00–11:30 = 90", () => {
    expect(g.edges).toEqual([{ a: "T1", b: "T2", min: 90 }]);
  });
  it("a session of the same task alongside (A + C, both T1) is no pair; three tasks at once make three pairs", () => {
    const d = { ...VIZ, sessions: [...VIZ.sessions, { ...VIZ.sessions[3], id: "G", task_id: "T3", intervals: [["2026-09-21T01:15:00Z", "2026-09-21T01:45:00Z"]] as [string, string][] }] };
    const p = prepare(d), r = deriveGraph(p, segments(p));
    // G = 10:15–10:45 JST: T1+T2 still 90; T1+T3 30, T2+T3 30
    expect(r.edges).toEqual([{ a: "T1", b: "T2", min: 90 }, { a: "T1", b: "T3", min: 30 }, { a: "T2", b: "T3", min: 30 }]);
  });
});

describe("graphOption — lab e11, seeded on a circle", () => {
  const g = deriveGraph(prep, segs);
  it("nodes in id order on a circle (radius 200), size 8 + 34√(share of the largest), `task` on each; force per lab, no layout animation", () => {
    const s = (graphOption("ura", g, name) as any).series[0];
    expect(s.data.map((n: { name: string; task: string }) => [n.name, n.task])).toEqual([["T1", "T1"], ["T2", "T2"]]);
    expect(s.data[0].x).toBe(200);
    expect(s.data[0].y).toBe(0);
    expect(s.data[1].x).toBe(-200);
    expect(Math.abs(s.data[1].y)).toBeLessThan(1e-9);
    expect(s.data[1].symbolSize).toBe(42);
    expect(s.data[0].symbolSize).toBeCloseTo(8 + 34 * Math.sqrt(135 / 195), 9);
    expect(s.links).toEqual([expect.objectContaining({ source: "T1", target: "T2", value: 90 })]);
    expect(s).toMatchObject({ layout: "force", draggable: true, force: { repulsion: 700, edgeLength: [90, 240], gravity: 0.05, layoutAnimation: false }, emphasis: { focus: "adjacency" } });
    expect(s.label.formatter({ name: "T1" })).toBe("#T1");
  });
  it("a hover elsewhere dims what is not adjacent to .3 of its own opacity (D1: ECharts' default blur is .1); each link by its own weight", () => {
    const d = { ...VIZ, sessions: [...VIZ.sessions, { ...VIZ.sessions[3], id: "G", task_id: "T3", intervals: [["2026-09-21T01:15:00Z", "2026-09-21T01:45:00Z"]] as [string, string][] }] };
    const p = prepare(d), g3 = deriveGraph(p, segments(p));
    for (const w of ["ura", "omote"] as const) {
      const s = (graphOption(w, g3, name) as any).series[0];
      expect(s.links).toHaveLength(3);
      for (const l of s.links) expect(l.blur.lineStyle.opacity).toBeCloseTo(l.lineStyle.opacity * 0.3, 9);
      expect(s.links[0].blur.lineStyle.opacity).not.toBeCloseTo(s.links[1].blur.lineStyle.opacity, 3);
      expect(s.blur.itemStyle.opacity).toBe(0.3);
      expect(s.blur.label.opacity).toBe(0.3);
    }
  });
  it("a node's tip shows a title with markup in it as text (F1: the tip box renders HTML)", () => {
    const o = graphOption("ura", g, (k) => `<i>${k}</i>`, () => "修正 <b>List<String></b> & 'x'") as any;
    const html = o.tooltip.formatter({ name: "T1", value: 90, data: {} });
    expect(html).toContain("修正 &lt;b&gt;List&lt;String&gt;&lt;/b&gt; &amp; &#39;x&#39;");
    expect(html).toContain("&lt;i&gt;T1&lt;/i&gt;");
    expect(html).not.toContain("<b>");
    expect(o.tooltip.formatter({ dataType: "edge", name: "", value: 90, data: { source: "T1", target: "T2" } })).toContain("&lt;i&gt;T1&lt;/i&gt; + &lt;i&gt;T2&lt;/i&gt;");
  });
  it("the same input gives the same option (no random seed)", () => {
    expect(JSON.stringify(graphOption("ura", g, name))).toBe(JSON.stringify(graphOption("ura", g, name)));
  });
});

describe("deriveParallel — one row per session", () => {
  const rows = deriveParallel(prep);
  it("start (hours after its 5:00 day began), window minutes, turns, files, tokens, cost (null unpriced / not collected)", () => {
    expect(rows.map((r) => [r.s.id, r.start, r.min, r.turns, r.files, r.tok, r.cost])).toEqual([
      ["A", 4, 120, 10, 2, 108000, 3],
      ["B", 5, 120, 6, 1, 26000, null],
      ["C", 5.5, 60, 4, 0, 12000, 0.5],
      ["D", 18.5, 120, 12, 5, 215000, 6],
      ["E", 23, 120, 8, 3, 54000, 2],
      ["F", 8, 30, 2, 0, null, null],
    ]);
  });
});

describe("parallelOption — lab e10", () => {
  const rows = deriveParallel(prep);
  it("one axis list: axisKeys names the option's axes, cost last and only with cost", () => {
    expect(axisKeys(true)).toEqual(["par.start", "par.min", "par.turns", "par.files", "par.tok", "par.cost"]);
    expect(axisKeys(false)).toEqual(axisKeys(true).slice(0, 5));
    for (const c of [true, false]) expect((parallelOption("ura", rows, c, name, "en") as any).parallelAxis.map((x: { name: string }) => x.name)).toEqual(axisKeys(c).map((k) => tv("en", k)));
  });
  it("six axes with cost: start linear 0–24, the rest log(1 + v); labels read real values; one series per task, items carry `task`", () => {
    const o = parallelOption("ura", rows, true, name, "zh") as any;
    expect(o.parallelAxis.map((a: { dim: number }) => a.dim)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(o.parallelAxis[0]).toMatchObject({ min: 0, max: 24 });
    expect(o.parallelAxis[0].axisLabel.formatter(4)).toBe("09:00");
    expect(o.parallelAxis[1].axisLabel.formatter(Math.log1p(120))).toBe("2h");
    expect(o.parallelAxis[2].axisLabel.formatter(Math.log1p(10))).toBe("10");
    expect(o.parallelAxis[4].axisLabel.formatter(Math.log1p(108000))).toBe("108K");
    expect(o.parallelAxis[5].axisLabel.formatter(Math.log1p(6))).toBe("$6");
    expect(o.series.map((s: { name: string }) => s.name)).toEqual(["unlinked", "#T1", "#T2"]);
    const t1 = o.series[1];
    expect(t1.data.map((d: { task: string; sid: string }) => [d.task, d.sid])).toEqual([["T1", "A"], ["T1", "C"], ["T1", "F"]]);
    expect(t1.data[0].value).toEqual([4, Math.log1p(120), Math.log1p(10), Math.log1p(2), Math.log1p(108000), Math.log1p(3)]);
    // F: tokens not collected, cost null → empty values (ECharts skips them: the line ends at files)
    expect(t1.data[2].value.slice(4)).toEqual([null, null]);
    expect(o.series[0].data[0].task).toBeNull();
    expect(t1.lineStyle).toMatchObject({ color: lineColor("T1"), width: 1, opacity: 0.35, shadowBlur: 4 });
    expect(t1).toMatchObject({ inactiveOpacity: 0.03, activeOpacity: 1 });
    expect(o.parallel.parallelAxisDefault.areaSelectStyle.borderColor).toBe("#ffad3a");
  });
  it("every log axis is pinned to its data's largest value (ECharts' own extent left 20h sessions above the axes, shots 7b)", () => {
    const o = parallelOption("ura", rows, true, name, "zh") as any;
    o.parallelAxis.slice(1).forEach((a: { dim: number; min: number; max: number }) => {
      const vals = o.series.flatMap((s: { data: { value: (number | null)[] }[] }) => s.data.map((d) => d.value[a.dim])).filter((v: number | null) => v !== null);
      expect(a.min).toBe(0);
      expect(a.max).toBe(Math.max(...vals));
    });
  });
  it("log axes: ticks at quarters of the pinned top (P2: the token axis's 1.5B top ran into its 485M tick)", () => {
    const o = parallelOption("ura", rows, true, name, "zh") as any;
    expect(o.parallelAxis[0].interval).toBeUndefined();
    o.parallelAxis.slice(1).forEach((a: { max: number; interval: number }) => expect(a.interval).toBe(a.max / 4));
  });
  it("the tip's tokens in the page's language (顺带: was a hard-coded \"token\"); a hover elsewhere dims the other series (focus series, .3)", () => {
    const o = parallelOption("ura", rows, true, name, "en") as any;
    expect(o.tooltip.formatter({ data: { sid: "A" } })).toContain("108K tokens");
    expect(o.series[1].emphasis.focus).toBe("series");
    expect(o.series[1].blur.lineStyle.opacity).toBeCloseTo(0.35 * 0.3, 9);
    expect((parallelOption("omote", rows, true, name, "en") as any).series[1].blur.lineStyle.opacity).toBeCloseTo(0.3 * 0.3, 9);
  });
  it("B: unpriced → null on the cost axis", () => {
    const o = parallelOption("ura", rows, true, name, "zh") as any;
    expect(o.series[2].data[0].sid).toBe("B");
    expect(o.series[2].data[0].value[5]).toBeNull();
  });
  it("cost hidden (表): five axes, five values, no amount in any label", () => {
    const o = parallelOption("omote", rows, false, name, "zh") as any;
    expect(o.parallelAxis).toHaveLength(5);
    expect(o.series.every((s: { data: { value: unknown[] }[] }) => s.data.every((d) => d.value.length === 5))).toBe(true);
    expect(JSON.stringify(o.parallelAxis)).not.toContain("$");
    expect(o.series[1].lineStyle).toMatchObject({ color: inkOf(lineColor("T1")), opacity: 0.3 });
    expect(o.series[1].lineStyle.shadowBlur).toBeUndefined();
    expect(o.parallel.parallelAxisDefault.areaSelectStyle.borderColor).toBe("#0e7c86");
  });
});

describe("tooltips carry the task's S badge image (B3b e1)", () => {
  const IMG = '<img class="tbimg" src="data:image/png;base64,AA" width="51" height="16" alt="">';
  const img = (id: string) => (id ? "data:image/png;base64,AA" : null);
  const none = () => null;
  const f = deriveSankey(prep, segs), g = deriveGraph(prep, segs), rows = deriveParallel(prep);
  const sank = (fn?: ((id: string) => string | null) | null) => (sankeyOption("ura", f, name, fn) as any).tooltip.formatter;
  const grph = (fn?: ((id: string) => string | null) | null) => (graphOption("ura", g, name, () => "ttl", fn) as any).tooltip.formatter;
  const par = (fn?: ((id: string) => string | null) | null) => (parallelOption("ura", rows, true, name, "zh", fn) as any).tooltip.formatter;
  const sid = (task: boolean) => ({ data: { sid: rows.find((r) => !!r.s.task_id === task)!.s.id } });
  const node = (n: string) => ({ name: n, value: 90, data: {} });
  const edge = (source: string, target: string) => ({ dataType: "edge", name: "", value: 90, data: { source, target } });
  const H = (h: string, m: string, s = "") => `<div class="h">${h}</div><div class="m">${m}</div>${s ? `<div class="s">${s}</div>` : ""}`;

  it("no img fn, or one that returns null, gives today's html (no broken <img>)", () => {
    for (const fn of [undefined, null, none]) {
      expect(sank(fn)(node("t:T1"))).toBe(H("#T1", "1.5h"));
      expect(sank(fn)(node("t:"))).toBe(H("unlinked", "1.5h"));
      expect(sank(fn)(edge("a:claude-code", "t:T1"))).toBe(H("Claude Code → #T1", "1.5h"));
      expect(sank(fn)(edge("m:macmini", "a:codex"))).toBe(H("macmini → Codex", "1.5h"));
      expect(grph(fn)(node("T1"))).toBe(H("#T1", "1.5h", "ttl"));
      expect(grph(fn)(edge("T1", "T2"))).toBe(H("#T1 + #T2", "1.5h"));
      expect(par(fn)(sid(true))).toBe(H("#T1", "09:00 · 2h", "10 轮 · 2 个文件 · 108K token · $3"));
      expect(par(fn)(sid(false))).toBe(H("unlinked", "23:30 · 2h", "12 轮 · 5 个文件 · 215K token · $6"));
    }
  });
  it("sankey: a task node leads with the image; the agent → task edge puts it after the arrow; other nodes and edges none", () => {
    expect(sank(img)(node("t:T1"))).toBe(H(`${IMG}#T1`, "1.5h"));
    expect(sank(img)(edge("a:claude-code", "t:T1"))).toBe(H(`Claude Code → ${IMG}#T1`, "1.5h"));
    expect(sank(img)(edge("m:macmini", "a:codex"))).toBe(H("macmini → Codex", "1.5h"));
    expect(sank(img)(node("a:codex"))).not.toContain("<img");
  });
  it("sankey: the unlinked node and its edge stay as today", () => {
    expect(sank(img)(node("t:"))).toBe(H("unlinked", "1.5h"));
    expect(sank(img)(edge("a:claude-code", "t:"))).toBe(H("Claude Code → unlinked", "1.5h"));
  });
  it("graph: a node leads with its image; an edge shows both, a then b", () => {
    expect(grph(img)(node("T1"))).toBe(H(`${IMG}#T1`, "1.5h", "ttl"));
    expect(grph(img)(edge("T1", "T2"))).toBe(H(`${IMG}#T1 + ${IMG}#T2`, "1.5h"));
  });
  it("graph: the image function is asked per task", () => {
    const asked: string[] = [];
    grph((id) => { asked.push(id); return null; })(edge("T1", "T2"));
    expect(asked).toEqual(["T1", "T2"]);
  });
  it("parallel: the session's task leads with its image; an unlinked session none", () => {
    expect(par(img)(sid(true))).toBe(H(`${IMG}#T1`, "09:00 · 2h", "10 轮 · 2 个文件 · 108K token · $3"));
    expect(par(img)(sid(false))).toBe(H("unlinked", "23:30 · 2h", "12 轮 · 5 个文件 · 215K token · $6"));
  });
  it("the image url is escaped in the attribute", () => {
    expect(sank(() => 'x"><b>')(node("t:T1"))).toContain('src="x&quot;&gt;&lt;b&gt;"');
  });
});

describe("task labels carry the 14 px silhouette (B3b f2)", () => {
  const f = deriveSankey(prep, segs), g = deriveGraph(prep, segs);
  const sl = (sil?: TaskSil | null) => (sankeyOption("ura", f, name, null, sil) as any).series[0].label;
  const gl = (sil?: TaskSil | null) => (graphOption("ura", g, name, undefined, null, sil) as any).series[0].label;
  const ids = [...f.tasks.keys()].filter(Boolean);
  it("sankey: a task node's label is {g<i>|}{c|code}, its rich style the 14 px image; unlinked / machine / agent unchanged", () => {
    const l = sl(fakeSil());
    const k = `g${ids.indexOf("T1")}`;
    expect(l.formatter({ name: "t:T1" })).toBe(`{${k}|}{c|#T1}`);
    expect(l.rich[k]).toEqual({ width: 14, height: 14, backgroundColor: { image: glyphDataUrl(fakeSil().of("T1"), 28) } });
    expect(l.rich.c).toEqual({ padding: [0, 0, 0, 4] });
    expect(l.formatter({ name: UNLINKED_NODE })).toBe("unlinked");
    expect(l.formatter({ name: "m:macmini" })).toBe("macmini");
    expect(l.formatter({ name: "a:codex" })).toBe("Codex");
  });
  it("sankey without sil: no rich, today's labels", () => {
    for (const s of [undefined, null]) {
      const l = sl(s);
      expect("rich" in l).toBe(false);
      expect(l.formatter({ name: "t:T1" })).toBe("#T1");
      expect(l.formatter({ name: UNLINKED_NODE })).toBe("unlinked");
    }
  });
  it("graph: the same {g<i>|}{c|code}; without sil no rich", () => {
    const l = gl(fakeSil());
    const k = `g${g.nodes.findIndex((n) => n.task === "T1")}`;
    expect(l.formatter({ name: "T1" })).toBe(`{${k}|}{c|#T1}`);
    expect(l.rich[k].backgroundColor.image).toBe(glyphDataUrl(fakeSil().of("T1"), 28));
    expect("rich" in gl(null)).toBe(false);
    expect(gl(null).formatter({ name: "T1" })).toBe("#T1");
  });
  it("tooltips keep plain names with sil", () => {
    expect((sankeyOption("ura", f, name, null, fakeSil()) as any).tooltip.formatter({ name: "t:T1", value: 90, data: {} })).not.toContain("{g");
  });
});
