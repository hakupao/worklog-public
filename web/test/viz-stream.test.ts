import { describe, expect, it } from "vitest";
import { deriveStream, drawStreamOmote, drawStreamUra, STREAM_HEIGHT, streamAt, streamStack, type Stream } from "../src/pages/stats/viz/stream";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { perDay, prepare } from "../src/pages/stats/viz/wall";
import { inkOf, lineColor, mix } from "../src/ui/palette";
import { rec } from "./canvas-rec";
import { fakeSil } from "./fake-sil";
import { VIZ } from "./viz-fixture";

const streamOf = (from = VIZ.range.from, to = VIZ.range.to) => {
  const prep = prepare({ ...VIZ, range: { from, to } });
  return deriveStream(prep, perDay(prep));
};
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });

describe("deriveStream — weekly wall clock per task, split evenly (U17)", () => {
  it("the fixture: one week W39 (cut: only Mon / Tue in range); T1 135, T2 195, unlinked 120 — sums to the week's wall clock 450", () => {
    const st = streamOf();
    expect(st.weeks.map((w) => [w.label, w.mon, w.cut, w.union])).toEqual([["W39", "2026-09-21", true, 450]]);
    expect(Object.fromEntries(st.weeks[0].by)).toEqual({ T1: 135, T2: 195, "": 120 });
    expect(Object.fromEntries(st.totals)).toEqual({ T1: 135, T2: 195, "": 120 });
    expect(st.max).toBe(450);
  });

  it("weeks are the Monday weeks of the 5:00 days: E's 04:00–05:00 on 9/22 belongs to Monday's day; a week the range cuts is marked", () => {
    const st = streamOf("2026-09-16", "2026-09-29");
    expect(st.weeks.map((w) => [w.label, w.cut, w.union])).toEqual([["W38", true, 60], ["W39", false, 450], ["W40", true, 0]]);
    expect(Object.fromEntries(st.weeks[0].by)).toEqual({ T3: 60 });
    expect(st.weeks[2].by.size).toBe(0);
  });

  it("order (lab s3): by centre of mass in time, each to the lighter side; top reversed then bottom", () => {
    // totals T2 195, T1 135, "" 120, T3 60; T3 sits in W38 (index 0), the rest in W39 → T3, T2, T1, "";
    // T3 top (60) · T2 bottom (195) · T1 top (195) · "" top (315 vs 195 — ties go top) → ["", T1, T3] reversed + [T2]
    expect(streamOf("2026-09-16", "2026-09-29").order).toEqual(["", "T1", "T3", "T2"]);
    // one week: all centres equal, so by total: T2 top, T1 bottom, "" bottom
    expect(streamOf().order).toEqual(["T2", "T1", ""]);
  });

  it("streamStack: stacked about the centre line in order; smoothstep between weeks", () => {
    const st = streamOf("2026-09-16", "2026-09-29");
    expect(streamStack(st, 1)).toEqual([
      { key: "", v: 120, y0: -225, y1: -105 }, { key: "T1", v: 135, y0: -105, y1: 30 },
      { key: "T3", v: 0, y0: 30, y1: 30 }, { key: "T2", v: 195, y0: 30, y1: 225 },
    ]);
    const mid = streamStack(st, 0.5);                                  // halfway W38 → W39: smoothstep(.5) = .5
    expect(mid.find((b) => b.key === "T3")!.v).toBe(30);
    expect(mid.find((b) => b.key === "T2")!.v).toBe(97.5);
    expect(streamStack(st, -0.4).find((b) => b.key === "T3")!.v).toBe(60);   // clamped at the ends
  });

  it("nothing in range: no weeks' minutes, empty order", () => {
    const st = streamOf("2026-10-05", "2026-10-06");
    expect(st.order).toEqual([]);
    expect(st.max).toBe(0);
  });
});

describe("drawStream", () => {
  it("表: one filled band per task in its line colour inked; a hovered task keeps .88, the others .3 of that (R5: both worlds dim to .3); week labels, a cut one dim", () => {
    const st = streamOf("2026-09-16", "2026-09-29"), r = rec();
    const font = () => "11px sans";
    const g = drawStreamOmote(r.ctx, st, "T1", { w: 600, h: STREAM_HEIGHT }, font);
    const fills = r.calls.filter((c) => c.op === "fill");
    expect(fills.map((c) => [c.fill, c.alpha])).toEqual([
      [inkOf(lineColor(null)), 0.88 * 0.3], [inkOf(lineColor("T1")), 0.88], [inkOf(lineColor("T3")), 0.88 * 0.3], [inkOf(lineColor("T2")), 0.88 * 0.3],
    ]);
    const labels = r.calls.filter((c) => c.op === "fillText");
    expect(labels.filter((c) => /^W\d+$/.test(String(c.args[0]))).map((c) => [c.args[0], c.alpha])).toEqual([["W38", 0.45], ["W39", 1], ["W40", 0.45]]);
    // the hit test: the middle of W39 at the centre line is T1 (−105 … 30 minutes about the centre)
    expect(streamAt(g, st, (g.x0 + g.x1) / 2, g.cy)).toEqual({ w: 1, key: "T1" });
    expect(streamAt(g, st, (g.x0 + g.x1) / 2, 2)).toBeNull();                 // above the stack
    expect(streamAt(g, st, g.x0 - 5, g.cy)).toBeNull();
  });

  it("表: a band is drawn only where it has thickness (tapering to one zero column at each end) — no outline left along a zero-thick stretch", () => {
    const st = streamOf("2026-09-16", "2026-09-29"), r = rec();
    const g = drawStreamOmote(r.ctx, st, null, { w: 600, h: STREAM_HEIGHT }, () => "11px sans");
    // each path: lineTo points along the top edge, then back along the bottom edge
    const paths: { x: number; y: number }[][] = [], closed = new Set<{ x: number; y: number }[]>();
    for (const c of r.calls) {
      if (c.op === "beginPath") paths.push([]);
      else if (c.op === "closePath") closed.add(paths.at(-1)!);
      else if (c.op === "lineTo") paths.at(-1)!.push({ x: c.args[0] as number, y: c.args[1] as number });
    }
    const polys = paths.filter((p) => p.length && closed.has(p));            // the bands, not the c3 edge strokes
    expect(polys.length).toBe(4);                                         // one run per band here
    for (const p of polys) {
      const n = p.length / 2, top = p.slice(0, n), bot = p.slice(n).reverse();
      const thick = top.map((q, j) => bot[j].y - q.y);
      expect(thick.slice(1, -1).every((t) => t > 0)).toBe(true);           // inside the run: thickness everywhere
    }
    // T3 is in W38 only: its band ends one column after it thins out, short of the right end
    const t3 = polys[r.calls.filter((c) => c.op === "fill").findIndex((c) => c.fill === inkOf(lineColor("T3")))];
    expect(Math.max(...t3.map((q) => q.x))).toBeLessThan(g.x1 - 100);
  });

  it("里: band dots in the task's line colour (dimmed to .3 under another task's hover), knockout codes; the unlinked band grey", () => {
    const st = streamOf(), r = rec();
    drawStreamUra(r.ctx, st, "T2", { w: 600, h: STREAM_HEIGHT, offX: 0, offY: 0 }, "zh", noGlyph);
    const lits = r.calls.filter((c) => c.op === "fill" || c.op === "drawImage");
    expect(lits.some((c) => c.fill === lineColor("T2") && c.alpha > 0.8)).toBe(true);
    expect(lits.some((c) => c.fill === lineColor(null))).toBe(true);
    expect(lits.filter((c) => c.fill === lineColor("T1")).every((c) => c.alpha <= 0.3 * 0.88 + 1e-9)).toBe(true);
  });
});


describe("B3b archetype B — stream in-band silhouettes", () => {
  const st = streamOf(), geo = { w: 600, h: STREAM_HEIGHT };
  const wide = () => ({ w: 5, h: 8, on: new Uint8Array(40).fill(1) });
  const knock = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "fill" && c.fill === "rgba(255,236,214,0.03)").length;
  it("里: a task band ≥ 11 dots knocks out its 9×9 silhouette (63 cells) instead of the code; the unlinked band keeps its code", () => {
    const base = rec(), a = rec();
    drawStreamUra(base.ctx, st, null, { ...geo, offX: 0, offY: 0 }, "zh", wide);
    drawStreamUra(a.ctx, st, null, { ...geo, offX: 0, offY: 0 }, "zh", wide, fakeSil());
    const bands = knock(base) / 40;
    expect(Number.isInteger(bands) && bands >= 2).toBe(true);
    expect(knock(a)).toBe(63 * (bands - 1) + 40);          // every band but "" swaps 40 code cells for 63
  });
  it("里: dots() null → today's drawing", () => {
    const base = rec(), b = rec();
    drawStreamUra(base.ctx, st, null, { ...geo, offX: 0, offY: 0 }, "zh", wide);
    drawStreamUra(b.ctx, st, null, { ...geo, offX: 0, offY: 0 }, "zh", wide, fakeSil(null));
    expect(b.calls).toEqual(base.calls);
  });
  it("表: a 12 px white silhouette replaces the code of a band ≥ 14 px; the unlinked band keeps `--`; no sil = today", () => {
    const font = () => "11px sans", base = rec(), a = rec(), nul = rec();
    drawStreamOmote(base.ctx, st, null, geo, font);
    drawStreamOmote(a.ctx, st, null, geo, font, fakeSil());
    drawStreamOmote(nul.ctx, st, null, geo, font, null);
    expect(nul.calls).toEqual(base.calls);
    const codes = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "fillText" && !/^W\d+$/.test(String(c.args[0]))).map((c) => c.args[0]);
    expect(codes(base)).toContain("--");
    expect(codes(a)).toEqual(["--"]);
    const gl = a.calls.filter((c) => c.op === "fill" && (c.args[0] as { d?: string })?.d);
    expect(gl.length).toBe(codes(base).length - 1);
    expect(gl.every((c) => c.fill === "#ffffff")).toBe(true);
    const sc = a.calls.filter((c) => c.op === "scale").map((c) => Number(c.args[0]));
    expect(sc.every((v) => Math.abs(v - 12 / 256) < 1e-9)).toBe(true);
  });
});

describe("B3b archetype C (G3 c3) — stream bright edge (表) and capsule start (里)", () => {
  type W = { label: string; mon: string; cut: boolean; union: number; by: Map<string, number> };
  /** A hand-built stream: `vals[key]` = minutes per week. */
  const mk = (vals: Record<string, number[]>, max: number): Stream => {
    const keys = Object.keys(vals), n = vals[keys[0]].length;
    const weeks: W[] = Array.from({ length: n }, (_, i) => ({ label: `W${i + 1}`, mon: "2026-09-21", cut: false, union: max, by: new Map(keys.map((k) => [k, vals[k][i]])) }));
    return { weeks, order: keys, totals: new Map(keys.map((k) => [k, vals[k].reduce((a, v) => a + v, 0)])), max };
  };
  const edge = (k: string) => mix(inkOf(lineColor(k || null)), "#ffffff", 0.55);
  const capCol = (k: string) => mix(lineColor(k), "#ffffff", 0.45);
  const font = () => "11px sans";
  // 里 at the dots a 600px 表 canvas holds: 200 wide, the same rows high (heights are set in 表 units; the lattice is PITCH)
  const W = 200 * PITCH, H = (STREAM_HEIGHT / OMOTE_UNIT) * PITCH;

  it("表: a band ≥ 6 px thick gets one 1.75 px stroke in the mixed ink inside save / clip / restore; a < 6 px band and the unlinked band get none", () => {
    const st = mk({ A: [100], B: [1], "": [50] }, 151), r = rec();      // k = 300 / 151 px per minute → B ≈ 2 px
    drawStreamOmote(r.ctx, st, null, { w: 600, h: STREAM_HEIGHT }, font);
    const strokes = (k: string) => r.calls.map((c, i) => ({ c, i })).filter(({ c }) => c.op === "stroke" && c.stroke === edge(k));
    const a = strokes("A");
    expect(a).toHaveLength(1);
    expect(a[0].c.lw).toBe(1.75);
    const before = r.calls.slice(0, a[0].i).map((c) => c.op), clipAt = before.lastIndexOf("clip");
    expect(before[clipAt - 1]).toBe("save");
    expect(r.calls[a[0].i + 1].op).toBe("restore");
    expect(strokes("B")).toHaveLength(0);
    expect(strokes("")).toHaveLength(0);
    expect(r.calls.filter((c) => c.op === "stroke" && c.lw === 1.75)).toHaveLength(1);
  });

  it("表: the edge follows the band's top, inset by the outline; dims to .3 under another task's hover", () => {
    const st = mk({ A: [100] }, 100), r = rec();
    drawStreamOmote(r.ctx, st, "Z", { w: 600, h: STREAM_HEIGHT }, font);
    const s = r.calls.find((c) => c.op === "stroke" && c.lw === 1.75)!;
    expect(s.alpha).toBe(0.3);
    const lines = r.calls.slice(r.calls.findIndex((c) => c === s) - 80, r.calls.findIndex((c) => c === s)).filter((c) => c.op === "lineTo");
    const k = 300 / 100, cy = 52 * 3;
    expect(lines.every((c) => Math.abs(Number(c.args[1]) - (cy - 50 * k + 0.4 + 0.875)) < 1e-6)).toBe(true);
  });

  const dotsOf = (r: ReturnType<typeof rec>, col: string) => r.calls.flatMap((c, i) => c.op === "fill" && c.fill === col && r.calls[i - 1]?.op === "arc"
    ? [{ i: Math.round((Number(r.calls[i - 1].args[0]) - PITCH / 2) / PITCH), j: Math.round((Number(r.calls[i - 1].args[1]) - PITCH / 2) / PITCH), a: c.alpha }] : []);

  it("里: a 3-dot capsule at the band's first ≥ 4-dot column — middle column full height, outer columns one dot shorter each end; \"\" none", () => {
    const st = mk({ A: [60, 60], "": [30, 30] }, 90), r = rec();
    drawStreamUra(r.ctx, st, null, { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    const d = dotsOf(r, capCol("A"));
    const cols = [...new Set(d.map((x) => x.i))].sort((a, b) => a - b);
    expect(cols).toEqual([4, 5, 6]);                                    // GL + 0 … GL + 2
    const rows = (c: number) => d.filter((x) => x.i === c).map((x) => x.j).sort((a, b) => a - b);
    const mid = rows(5), lo = rows(4), hi = rows(6);
    expect(mid.length).toBeGreaterThanOrEqual(4);
    expect(mid[mid.length - 1] - mid[0] + 1).toBe(mid.length);          // contiguous, full band height
    for (const o of [lo, hi]) { expect(o).toEqual(mid.slice(1, -1)); }
    expect(d.every((x) => x.a === 1)).toBe(true);
    expect(dotsOf(r, mix(lineColor(null), "#ffffff", 0.45))).toHaveLength(0);
  });

  it("里: the capsule skips the in-band knockout cells (a band thickest in week 0 keeps its silhouette's 63 off cells)", () => {
    const st = mk({ A: [200, 50, 50], B: [30, 30, 30] }, 280), r = rec();
    const g = { w: W, h: H, offX: 0, offY: 0 };
    drawStreamUra(r.ctx, st, null, g, "zh", noGlyph, fakeSil());
    // A's 9x9 silhouette = 63 cells, none re-lit by the capsule
    const lit = dotsOf(r, capCol("A")), ko = new Set(r.calls.flatMap((c, i) => c.op === "fill" && c.fill === "rgba(255,236,214,0.03)" && r.calls[i - 1]?.op === "arc"
      ? [`${Math.round((Number(r.calls[i - 1].args[0]) - PITCH / 2) / PITCH)},${Math.round((Number(r.calls[i - 1].args[1]) - PITCH / 2) / PITCH)}`] : []));
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.filter((x) => ko.has(`${x.i},${x.j}`))).toHaveLength(0);
    expect(ko.size).toBeGreaterThanOrEqual(63);
  });

  it("里: mid-chart band starts count — a band that drops below 4 dots and rises again gets a capsule at each rise (two humps, two capsules)", () => {
    const st = mk({ A: [60, 0, 60], B: [30, 30, 30] }, 90), r = rec();
    drawStreamUra(r.ctx, st, null, { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    const d = dotsOf(r, capCol("A")), cs = [...new Set(d.map((x) => x.i))].sort((a, b) => a - b);
    expect(cs.length).toBe(6);
    expect(cs.slice(0, 3)).toEqual([4, 5, 6]);
    expect(cs[3]).toBeGreaterThan(40);                                  // the second hump rises past the dip
    expect(cs.slice(3)).toEqual([cs[3], cs[3] + 1, cs[3] + 2]);
    // that column is the first one back at ≥ 4 dots: the stack there, in dots, from the public stack
    const cn = 200 - 8, sc = 100 / 90, v = (q: number) => streamStack(st, ((q + 0.5) / cn) * 3 - 0.5)[0].v * sc;
    expect(v(cs[3] - 5)).toBeLessThan(4);
    expect(v(cs[3] - 4)).toBeGreaterThanOrEqual(4);
  });

  it("里: a band that is never 4 dots thick gets no capsule", () => {
    const st = mk({ A: [1], B: [200] }, 201), r = rec();
    drawStreamUra(r.ctx, st, null, { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    expect(dotsOf(r, capCol("A"))).toHaveLength(0);
  });
});
