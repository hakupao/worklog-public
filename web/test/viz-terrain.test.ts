import { describe, expect, it } from "vitest";
import type { StatsSession, StatsSessions } from "../src/api/types";
import {
  contourAt, CONTOUR_LEVELS, contourHeight, deriveTerrain, drawContourOmote, drawContourUra, drawTerrainOmote, drawTerrainUra,
  levelOf, NB, peaksOf, placeLabels, TERRAIN_HEIGHT, terrainAt, terrainOf, turn, VIEW0, zAt, type Terrain,
} from "../src/pages/stats/viz/terrain";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { perDay, prepare, segments } from "../src/pages/stats/viz/wall";
import { daysOf } from "../src/pages/stats/viz/day";
import { rec, type Call } from "./canvas-rec";
import { jst, VIZ } from "./viz-fixture";

const base = (d: StatsSessions) => { const p = prepare(d); return { segs: segments(p), days: perDay(p) }; };
const viz = base(VIZ);

/** Reference Gaussian pass (written out independently of the module): weights e^(−i²/2σ²) for |i| ≤ ⌈3σ⌉,
 *  normalised, indices clamped to the ends. */
function gauss(xs: number[], s: number): number[] {
  const r = Math.ceil(3 * s), w: number[] = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * s * s)));
  const tot = w.reduce((a, b) => a + b, 0);
  return xs.map((_, k) => w.reduce((m, wi, n) => m + (wi / tot) * xs[Math.min(xs.length - 1, Math.max(0, k + n - r))], 0));
}
const nonzero = (row: ArrayLike<number>) => Array.from(row).flatMap((v, b) => (v ? [[b, v]] : []));

/** A session of `n` parallel copies over [a, b) JST on `date`. */
let seq = 0;
const block = (date: string, a: string, b: string, n: number): StatsSession[] => Array.from({ length: n }, () => {
  const id = `S${seq++}`, s = new Date(jst(`${date}T${a}`)).toISOString(), e = new Date(jst(`${date}T${b}`)).toISOString();
  return {
    id, machine: "macmini", agent: "claude-code", task_id: null, started_at: s, ended_at: e, active_minutes: 0, turns: 0, files: 0,
    intervals: [[s, e]], approx: false, tokens: null, subagent_tokens: null, cost_usd: null, cost_partial: false, summary: "",
  };
});
/** Ten days 9/21–9/30 (a lone busy day smooths to under ×2 along the days, so each block spans two days): ×4 on
 *  9/22–9/23 10:00–13:00; ×3 on 9/25–9/26 at the same hours (three days on: inside the first's ±4-day window, lower);
 *  ×3 on 9/28–9/29 14:00–17:00 (16 bins later: a summit of its own); a lone hour on 9/30. */
const RIDGE: StatsSessions = {
  range: { from: "2026-09-21", to: "2026-09-30" }, day_start: "05:00", plans: [],
  sessions: [...["2026-09-22", "2026-09-23"].flatMap((d) => block(d, "10:00", "13:00", 4)),
    ...["2026-09-25", "2026-09-26"].flatMap((d) => block(d, "10:00", "13:00", 3)),
    ...["2026-09-28", "2026-09-29"].flatMap((d) => block(d, "14:00", "17:00", 3)), ...block("2026-09-30", "09:00", "10:00", 1)],
};

describe("deriveTerrain — 15-minute bins from 05:00, smoothed", () => {
  it("raw: each bin's average concurrency (Σ share × sessions open), E's 04:00–06:00 split at 05:00", () => {
    const t = deriveTerrain(viz.segs, viz.days);
    expect(NB).toBe(96);
    expect(t.dates).toEqual(["2026-09-21", "2026-09-22"]);
    // 9/21: A 09–11 → bins 16–23, B 10–12 → 20–27, C 10:30–11:30 → 22–25, D 23:30–01:30 → 74–81, E 04–05 → 92–95
    expect(nonzero(t.raw[0])).toEqual([
      ...[16, 17, 18, 19].map((b) => [b, 1]), [20, 2], [21, 2], [22, 3], [23, 3], [24, 2], [25, 2], [26, 1], [27, 1],
      ...[74, 75, 76, 77, 78, 79, 80, 81].map((b) => [b, 1]), ...[92, 93, 94, 95].map((b) => [b, 1]),
    ]);
    // 9/22: E 05–06 → 0–3, F 13:00–13:30 → 32–33
    expect(nonzero(t.raw[1])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1], [32, 1], [33, 1]]);
  });

  it("smoothing: σ 1.4 bins along the hours first, then σ .9 along the days (normalised, ends clamped)", () => {
    const t = deriveTerrain(viz.segs, viz.days);
    const h = t.raw.map((r) => gauss(Array.from(r), 1.4));
    for (let b = 0; b < NB; b++) {
      const col = gauss([h[0][b], h[1][b]], 0.9);
      expect(t.z[0][b]).toBeCloseTo(col[0], 9);
      expect(t.z[1][b]).toBeCloseTo(col[1], 9);
    }
    // one day: the day pass is the identity (every weight clamps onto the same row)
    const one = base({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-21" } }), t1 = deriveTerrain(one.segs, one.days);
    const h1 = gauss(Array.from(t1.raw[0]), 1.4);
    for (let b = 0; b < NB; b++) expect(t1.z[0][b]).toBeCloseTo(h1[b], 9);
  });

  it("the heights read lower than the true peak: ×3 for 30 minutes smooths below the summit floor (no peaks)", () => {
    const t = deriveTerrain(viz.segs, viz.days);
    let mx = 0, at = { d: -1, b: -1 };
    t.z.forEach((r, d) => r.forEach((v, b) => { if (v > mx) { mx = v; at = { d, b }; } }));
    expect(t.zmax).toBe(mx);
    expect(t.top).toEqual(at);
    expect(t.zmax).toBeLessThan(2);
    expect(t.zmax).toBeGreaterThan(1);
    expect(t.peaks).toEqual([]);
  });

  it("peaks: z ≥ 2 and highest within ±4 days × ±8 bins (ties: the earliest), highest first, at most six", () => {
    const r = base(RIDGE), t = deriveTerrain(r.segs, r.days);
    expect(t.peaks).toHaveLength(2);
    expect(["2026-09-22", "2026-09-23"]).toContain(t.dates[t.peaks[0].d]);
    expect(["2026-09-28", "2026-09-29"]).toContain(t.dates[t.peaks[1].d]);
    expect(t.peaks[0].z).toBeGreaterThan(t.peaks[1].z);
    expect(t.peaks[0].z).toBeLessThan(4);                       // smoothed below the raw ×4
    expect([25, 26]).toContain(t.peaks[0].b);                   // 10:00–13:00 = bins 20–31, centred between 25 and 26
    expect([41, 42]).toContain(t.peaks[1].b);                   // 14:00–17:00 = bins 36–47
    for (const p of t.peaks) expect(p.z).toBe(t.z[p.d][p.b]);
    expect(t.top).toEqual({ d: t.peaks[0].d, b: t.peaks[0].b });
    // a plateau: equal heights side by side yield one summit, the earliest
    const flat: Terrain = { ...t, z: t.z.map((r) => r.map(() => 0)) };
    flat.z[3][10] = 2.5; flat.z[3][11] = 2.5;
    expect(peaksOf(flat.z)).toEqual([{ d: 3, b: 10, z: 2.5 }]);
    // seven separate summits: the six highest
    const many = t.z.map((r) => r.map(() => 0));
    [[0, 5, 2.1], [0, 40, 2.2], [0, 80, 2.3], [9, 5, 2.4], [9, 40, 2.5], [9, 80, 2.6], [5, 60, 2.05]].forEach(([d, b, z]) => { many[d][b] = z; });
    expect(peaksOf(many).map((p) => p.z)).toEqual([2.6, 2.5, 2.4, 2.3, 2.2, 2.1]);
  });

  it("terrainOf: memoised per days array — the two views share one grid", () => {
    const a = terrainOf(viz.segs, viz.days);
    expect(terrainOf(viz.segs, viz.days)).toBe(a);
    const again = base(VIZ);
    expect(terrainOf(again.segs, again.days)).not.toBe(a);
    expect(terrainOf(again.segs, again.days).z).toEqual(a.z);
  });

  it("zAt: bilinear between bins and days, clamped at the edges", () => {
    const t = deriveTerrain(viz.segs, viz.days);
    expect(zAt(t, 0, 22)).toBe(t.z[0][22]);
    expect(zAt(t, 0, 22.5)).toBeCloseTo((t.z[0][22] + t.z[0][23]) / 2, 12);
    expect(zAt(t, 0.25, 22)).toBeCloseTo(0.75 * t.z[0][22] + 0.25 * t.z[1][22], 12);
    expect(zAt(t, -3, -9)).toBe(t.z[0][0]);
    expect(zAt(t, 7, 400)).toBe(t.z[1][NB - 1]);
  });
});

describe("turn — the relief's view (drag / arrow keys)", () => {
  it("shear −1.2…1.6, height .3…2.2; unchanged → the same object", () => {
    expect(VIEW0).toEqual({ sh: 0.34, hk: 1 });
    expect(turn(VIEW0, 0.1, 0)).toEqual({ sh: 0.44, hk: 1 });
    expect(turn(VIEW0, 0, -0.1)).toEqual({ sh: 0.34, hk: 0.9 });
    expect(turn(VIEW0, 9, 9)).toEqual({ sh: 1.6, hk: 2.2 });
    expect(turn(VIEW0, -9, -9)).toEqual({ sh: -1.2, hk: 0.3 });
    const top = turn(VIEW0, 9, 9);
    expect(turn(top, 1, 1)).toBe(top);
  });
});

const said = (out: string[]) => (s: string) => { out.push(s); return { w: 0, h: 8, on: new Uint8Array(0) }; };
/** Lit dots as [x, y, alpha] (no sprites in jsdom: each lit dot is an arc of radius 1.2 + a fill; off dots are arcs
 *  of radius .9). */
const lit = (calls: Call[]) => calls.flatMap((c, k) => (c.op === "arc" && c.args[2] !== 0.9 ? [[c.args[0] as number, c.args[1] as number, calls[k + 1].alpha]] : []));

/** Two days: the back one flat, the front one a hump over the middle. */
function hump(): Terrain {
  const z = [new Array(NB).fill(0), Array.from({ length: NB }, (_, b) => (b >= 40 && b < 56 ? 3 : 0))];
  return { dates: ["2026-09-21", "2026-09-22"], raw: z, z, zmax: 3, top: { d: 1, b: 40 }, peaks: [{ d: 1, b: 40, z: 3 }] };
}

describe("drawTerrainUra / Omote — the relief", () => {
  // 里 at the dots a 表 canvas of 600 / 1200px holds, the same rows high (heights are set in 表 units; the lattice is PITCH)
  const GU = { w: 200 * PITCH, h: (TERRAIN_HEIGHT / OMOTE_UNIT) * PITCH, offX: 0, offY: 0 };
  it("里: hidden lines — the front row is drawn first and a column's farther rows only show above its horizon", () => {
    const { ctx, calls } = rec(), t = hump();
    const g = drawTerrainUra(ctx, t, VIEW0, GU, "zh", said([]));
    // back row (d 0) on its base line (flat: alpha .1 + .08 · .74): visible beside the hump, hidden behind it — the
    // front row's dim fill under the hump (alpha ≥ .05 + .22) crosses that line but is not the back row
    const yBack = Math.round(g.base[0]) * PITCH + PITCH / 2;
    const backXs = lit(calls).filter(([, y, a]) => y === yBack && a < 0.2).map(([x]) => (x - PITCH / 2) / PITCH);
    const hx0 = g.x0[1] + (40 / (NB - 1)) * g.w[1], hx1 = g.x0[1] + (55 / (NB - 1)) * g.w[1];
    expect(backXs.some((i) => i < hx0 - 2)).toBe(true);
    expect(backXs.some((i) => i > hx0 + 1 && i < hx1 - 1)).toBe(false);
    // projection: the far row narrower (.74) and set right by the shear; the near row full width
    expect(g.w[0] / g.w[1]).toBeCloseTo(0.74, 6);
    expect(g.base[1]).toBeGreaterThan(g.base[0]);
  });

  it("the top three summits get their dates, the hour band its clock labels; a one-summit land one date", () => {
    const out: string[] = [], t = hump();
    t.peaks = [{ d: 1, b: 40, z: 3 }, { d: 1, b: 60, z: 2.8 }, { d: 0, b: 20, z: 2.5 }, { d: 0, b: 80, z: 2.2 }];
    drawTerrainUra(rec().ctx, t, VIEW0, GU, "zh", said(out));
    expect(out.filter((s) => s.includes("/"))).toEqual(["9/22", "9/22", "9/21"]);   // the three highest (no row labels: too few days)
    expect(out.filter((s) => /^\d\d$/.test(s))).toEqual(["06", "09", "12", "15", "18", "21", "00", "03"]);
  });

  it("the shear moves the far row; the height factor scales the hump", () => {
    const t = hump(), at = (v: typeof VIEW0) => drawTerrainUra(rec().ctx, t, v, GU, "zh", said([]));
    const a = at(VIEW0), b = at(turn(VIEW0, 0.5, 0));
    expect(b.x0[0] - a.x0[0]).toBeCloseTo(0.5, 6);      // (ND − 1 − d) · Δsh for the far row
    expect(b.x0[1]).toBeCloseTo(a.x0[1], 6);
    expect(at(turn(VIEW0, 0, 1)).hS).toBeCloseTo(2 * a.hS, 6);
  });

  it("里, sheared fully left over three months: the far rows start at column 0 — no dot left of the canvas", () => {
    const nd = 92, z = Array.from({ length: nd }, () => Array.from({ length: NB }, (_, b) => (b > 30 && b < 60 ? 1 : 0)));
    const t: Terrain = { dates: daysOf("2026-07-08", "2026-10-07"), raw: z, z, zmax: 1, top: { d: 0, b: 31 }, peaks: [] };
    const v = turn(VIEW0, -9, 0), { ctx, calls } = rec();
    const g = drawTerrainUra(ctx, t, v, GU, "zh", said([]));
    expect(g.x0[0]).toBeLessThan(0);                    // the far row's left end is off the canvas
    const xs = lit(calls).map(([x]) => x);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThan(0);
  });

  it("里, coarse (P1, while dragging): every other row from the front, every other column, no dim fill under the ridges", () => {
    const nd = 92, z = Array.from({ length: nd }, () => Array.from({ length: NB }, (_, b) => (b > 30 && b < 60 ? 1 : 0)));
    const t: Terrain = { dates: daysOf("2026-07-08", "2026-10-07"), raw: z, z, zmax: 1, top: { d: 0, b: 31 }, peaks: [] };
    const draw = (coarse: boolean) => {
      const { ctx, calls } = rec();
      const g = drawTerrainUra(ctx, t, VIEW0, GU, "zh", said([]), coarse);
      const cols = new Map<number, number>();
      for (const [x] of lit(calls)) { const i = (x - PITCH / 2) / PITCH; cols.set(i, (cols.get(i) ?? 0) + 1); }
      return { g, n: lit(calls).length, cols };
    };
    const full = draw(false), lo = draw(true);
    expect(lo.g).toEqual(full.g);                                          // the same projection (hit tests unchanged)
    expect([...full.cols.values()].some((k) => k > nd)).toBe(true);        // full: the fill under the ridge
    expect([...lo.cols.keys()].every((i) => i % 2 === 0)).toBe(true);      // every other column
    expect(Math.max(...lo.cols.values())).toBeLessThanOrEqual(nd / 2);    // at most one dot per drawn row
    expect(lo.n).toBeLessThan(full.n / 5);
  });

  it("terrainAt: the row whose drawn face holds the point (a dot's slack), the hour along it; null off the land", () => {
    const t = hump(), g = drawTerrainUra(rec().ctx, t, VIEW0, GU, "zh", said([]));
    const px = (d: number, f: number) => (g.x0[d] + f * g.w[d]) * g.u, py = (d: number) => g.base[d] * g.u;
    const a = terrainAt(g, t, px(1, 0.5), py(1) - 2)!, b = terrainAt(g, t, px(0, 0.25), py(0) - 2)!;
    expect([a.d, a.h, a.bf]).toEqual([1, 12, 47.5]);
    expect(b.d).toBe(0);
    expect(b.h).toBeCloseTo(6, 9);
    expect(b.bf).toBeCloseTo(23.75, 9);
    expect(terrainAt(g, t, px(1, 0) - 6, py(1))).toBeNull();
    expect(terrainAt(g, t, px(0, 0.25), py(0) - 12)).toBeNull();           // the air above a flat row
  });

  it("terrainAt (C1): the hump's top is the front row's, though the back row's base line lies nearer the pointer", () => {
    const t = hump(), g = drawTerrainUra(rec().ctx, t, VIEW0, GU, "zh", said([]));
    const f = 47.5 / (NB - 1), top = g.base[1] - 3 * g.hS;                  // the front row is the nearest: scale 1
    expect(Math.abs(g.base[0] - top)).toBeLessThan(Math.abs(g.base[1] - top));
    const hit = terrainAt(g, t, (g.x0[1] + f * g.w[1]) * g.u, (top + 0.5) * g.u)!;
    expect(hit.d).toBe(1);
    expect(hit.bf).toBeCloseTo(47.5, 9);
  });

  it("terrainAt (C1): three months, the labelled summit on a near row — its date in both worlds, also on its slope", () => {
    // 92 days like 近 3 个月 (7/8–10/7): a low swell everywhere, the summit (×6) on 9/30 (day 84) at 14:00
    const dates = daysOf("2026-07-08", "2026-10-07"), nd = dates.length, pd = 84, pb = 36;
    const z = dates.map((_, d) => Array.from({ length: NB }, (__, b) => 0.4 * Math.exp(-((b - 30) ** 2) / 300) + 6 * Math.exp(-((d - pd) ** 2) / 2 - ((b - pb) ** 2) / 40)));
    const t: Terrain = { dates, raw: z, z, zmax: 6.0, top: { d: pd, b: pb }, peaks: [{ d: pd, b: pb, z: z[pd][pb] }] };
    for (const g of [drawTerrainUra(rec().ctx, t, VIEW0, { ...GU, w: 400 * PITCH }, "zh", said([])),
      drawTerrainOmote(rec().ctx, t, VIEW0, { w: 1200, h: TERRAIN_HEIGHT }, () => "11px x")]) {
      const sc = g.w[pd] / g.w[nd - 1], fx = (b: number) => g.x0[pd] + (b / (NB - 1)) * g.w[pd];
      const sy = (b: number) => g.base[pd] - z[pd][b] * g.hS * sc;
      for (const [i, j] of [[fx(pb), sy(pb) + 0.5], [fx(pb - 3), sy(pb - 3) + 0.5]]) {
        const hit = terrainAt(g, t, i * g.u, j * g.u)!;   // g.u: PITCH in 里, 3 in 表
        expect(hit, `${i},${j}`).not.toBeNull();
        expect(t.dates[hit.d]).toBe("2026-09-30");
      }
      // below the summit the next row's own hill stands in front: that day, as drawn
      expect(t.dates[terrainAt(g, t, fx(pb) * g.u, ((sy(pb) + g.base[pd]) / 2) * g.u)!.d]).toBe("2026-10-01");
    }
  });

  it("表: one paper polygon per day, far to near; summits' dates in ink", () => {
    const { ctx, calls } = rec(), t = hump();
    drawTerrainOmote(ctx, t, VIEW0, { w: 600, h: TERRAIN_HEIGHT }, () => "11px x");
    expect(calls.filter((c) => c.op === "closePath")).toHaveLength(2);
    expect(calls.filter((c) => c.op === "fill").every((c) => c.fill === "#f4f5f7")).toBe(true);
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toContain("9/22");
  });
});

describe("contour — the same land from above", () => {
  /** 里 at the dots a 表 canvas of w × h px holds (heights are set in 表 units; the lattice is PITCH). */
  const cu = (w: number, h: number) => ({ w: (w / OMOTE_UNIT) * PITCH, h: (h / OMOTE_UNIT) * PITCH, offX: 0, offY: 0 });
  it("levels .2 .5 1 1.5 … 5", () => {
    expect(CONTOUR_LEVELS).toEqual([0.2, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    expect([0, 0.19, 0.2, 0.7, 1, 2.49, 5, 9].map(levelOf)).toEqual([0, 0, 1, 2, 3, 5, 11, 11]);
  });

  it("里: a dot where the level changes to the right or below; inside a level a faint tint; six summits labelled ×z date", () => {
    const out: string[] = [], { ctx, calls } = rec(), t = hump();
    t.peaks = [2.9, 2.8, 2.7, 2.6, 2.5, 2.4].map((z, n) => ({ d: n % 2, b: 10 + n * 12, z }));
    const g = drawContourUra(ctx, t, cu(600, contourHeight(2)), "zh", said(out));
    expect([...new Set(out.filter((s) => s.startsWith("×")))]).toEqual(["×2.9 9/21", "×2.8 9/22", "×2.7 9/21", "×2.6 9/22", "×2.5 9/21", "×2.4 9/22"]);
    expect(lit(calls).length).toBeGreaterThan(0);
    expect(contourHeight(92)).toBe((13 + 92 * 3 + 4) * 3);
    expect(contourAt(g, g.x0 + g.w * 0.5, g.y0 + g.rh * 1.5)).toEqual({ d: 1, h: 12, bf: 47.5 });
    expect(contourAt(g, g.x0 - 3, g.y0)).toBeNull();
    expect(contourAt(g, g.x0, g.y0 + g.rh * 2)).toBeNull();
  });

  it("placeLabels: highest first, each at its first candidate inside the area that overlaps nothing placed; none fits → null", () => {
    const area = { x: 0, y: 0, w: 100, h: 40 }, box = (x: number, y: number) => ({ x, y, w: 30, h: 10 });
    const cands = (k: number) => [box(10 + k * 5, 10), box(10 + k * 5 - 35, 10), box(10 + k * 5, 25), box(10 + k * 5 - 35, 25)];
    expect(placeLabels(3, cands, area, [])).toEqual([box(10, 10), box(15, 25), null]);
    expect(placeLabels(1, cands, area, [box(0, 5)])).toEqual([box(10, 25)]);   // an obstacle (an hour label) taken as placed
    expect(placeLabels(1, () => [box(90, 0)], area, [])).toEqual([null]);         // off the area's right edge
  });

  it("peak labels never overlap (P2: 9/14 and 9/15 ran into each other) and sit on a cleared plate", () => {
    const t = hump();
    t.peaks = [{ d: 1, b: 40, z: 3 }, { d: 1, b: 42, z: 2.9 }, { d: 0, b: 44, z: 2.8 }];
    const H = contourHeight(2) + 60;
    const o = rec();
    drawContourOmote(o.ctx, t, { w: 600, h: H }, () => "11px x");                    // the recorder measures 6px a character
    const labs = o.calls.filter((c) => c.op === "fillText" && String(c.args[0]).startsWith("×")).map((c) => ({ x: c.args[1] as number, y: (c.args[2] as number) - 11, w: String(c.args[0]).length * 6, h: 13 }));
    expect(labs).toHaveLength(3);
    labs.forEach((a, i) => labs.slice(i + 1).forEach((b) => expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false)));
    expect(o.calls.filter((c) => c.op === "clearRect")).toHaveLength(1 + 3);
    const u = rec();
    drawContourUra(u.ctx, t, cu(600, H), "zh", (s) => ({ w: s.length * 5, h: 8, on: new Uint8Array(0) }));
    expect(u.calls.filter((c) => c.op === "clearRect")).toHaveLength(1 + 3);
  });

  it("peak labels keep clear of the other summits' marks and the date column (C4)", () => {
    const flat = (n: number): Terrain => {
      const dates = daysOf("2026-09-01", "2026-09-30").slice(0, n), z = dates.map(() => new Array(NB).fill(0));
      return { dates, raw: z, z, zmax: 1, top: { d: 0, b: 0 }, peaks: [] };
    };
    const plates = (calls: Call[]) => calls.filter((c) => c.op === "clearRect").slice(1).map((c) => c.args.map(Number));
    const over = ([x, y, w, h]: number[], b: { x: number; y: number; w: number; h: number }) => x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h;
    // 里: the lower summit's first place (above right) would clear the higher one's dot at (101, 40)
    const t = flat(20);
    t.peaks = [{ d: 9, b: 42, z: 3 }, { d: 12, b: 36, z: 2.5 }];
    const u = rec(), w20 = () => ({ w: 20, h: 8, on: new Uint8Array(0) });
    drawContourUra(u.ctx, t, cu(600, contourHeight(20)), "zh", w20);
    expect(plates(u.calls)).toHaveLength(2);
    for (const p of plates(u.calls)) for (const [i, j] of [[101, 40], [91, 49]]) expect(over(p, { x: i * PITCH + PITCH / 2, y: j * PITCH + PITCH / 2, w: 0.01, h: 0.01 })).toBe(false);
    // 里, a narrow canvas: a summit at the right end has only the left places, inside the date column → no label
    const n = flat(20);
    n.peaks = [{ d: 10, b: 95, z: 3 }];
    const nu = rec();
    drawContourUra(nu.ctx, n, cu(180, contourHeight(20)), "zh", () => ({ w: 30, h: 8, on: new Uint8Array(0) }));
    expect(plates(nu.calls).filter((p) => p[0] < 30 * PITCH)).toEqual([]);
    // 表: the same two summits as triangles (90 + b/95·480, 39 + 9d), and the date column left of 90px
    const o = rec();
    t.peaks = [{ d: 9, b: 50, z: 3 }, { d: 11, b: 46, z: 2.5 }];
    drawContourOmote(o.ctx, t, { w: 600, h: contourHeight(20) }, () => "11px x");
    expect(plates(o.calls)).toHaveLength(2);
    for (const p of plates(o.calls)) for (const pk of t.peaks) {
      const px = 90 + (pk.b / 95) * 480, py = 39 + 9 * pk.d;
      expect(over(p, { x: px - 3, y: py - 3, w: 6, h: 5 })).toBe(false);
    }
    const no = rec();
    n.peaks = [{ d: 10, b: 60, z: 3 }];
    drawContourOmote(no.ctx, n, { w: 180, h: contourHeight(20) }, () => "11px x");
    expect(plates(no.calls).filter((p) => p[0] < 90)).toEqual([]);
  });

  it("表: ink ticks on level changes; summits as triangles with ×z date", () => {
    const { ctx, calls } = rec(), t = hump();
    drawContourOmote(ctx, t, { w: 600, h: contourHeight(2) }, () => "11px x");
    expect(calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toContain("×3.0 9/22");
    expect(calls.some((c) => c.op === "fillRect" && c.fill === "rgba(15,28,46,.75)")).toBe(true);
  });
});
