import { describe, expect, it } from "vitest";
import type { StatsSession, StatsSessions } from "../src/api/types";
import { axisOf, densityAt, densityHeight, deriveDensity, drawDensityOmote, drawDensityUra, jitter } from "../src/pages/stats/viz/density";
import { PITCH } from "../src/led/lattice";
import { prepare } from "../src/pages/stats/viz/wall";
import { inkOf, lineColor } from "../src/ui/palette";
import { rec } from "./canvas-rec";
import { fakeSil } from "./fake-sil";
import { jst, VIZ } from "./viz-fixture";

const font = () => "400 11px sans";
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const iso = (t: string) => new Date(jst(t)).toISOString();
/** A session of `min` minutes from 9/21 `at` (JST), all of it active. */
const s = (id: string, task: string | null, at: string, min: number, turns: number, files = 0): StatsSession => ({
  ...VIZ.sessions[1], id, task_id: task, agent: "claude-code", turns, files, active_minutes: min,
  intervals: [[iso(`2026-09-21T${at}`), new Date(jst(`2026-09-21T${at}`) + min * 60_000).toISOString()]],
});
const range = (sessions: StatsSession[]): StatsSessions => ({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-21" }, sessions });

describe("deriveDensity (lab s8)", () => {
  it("the fixture: only T1 qualifies (A 5/h, C 4/h, F 4/h → median 4); T2 has two sessions, unlinked D is left out", () => {
    const rows = deriveDensity(prepare(VIZ));
    expect(rows.map((r) => r.task)).toEqual(["T1"]);
    const [r] = rows;
    expect(r.dots.map((d) => [d.s.id, d.tph, d.fph])).toEqual([["A", 5, 1], ["C", 4, 0], ["F", 4, 0]]);
    expect([r.med, r.fmed, r.wall, r.turns, r.files, r.sessions]).toEqual([4, 0, 210, 16, 2, 3]);
  });

  it("a session the range cuts counts its turns and files in the window's share (F2): E's 120 min, cut to 60 by a range ending 9/21, keeps its rate", () => {
    const p = prepare({ ...VIZ, range: { from: "2026-09-21", to: "2026-09-21" }, sessions: [...VIZ.sessions, s("G", "T2", "13:00", 60, 6)] });
    // T2 (window order): B 6 turns / 2h = 3, G 6 / 1h = 6, E 8 turns × 60/120 = 4 in the window / 1h = 4 (files 3 × ½ / 1h = 1.5)
    const row = deriveDensity(p).find((r) => r.task === "T2")!;
    expect(row.dots.map((d) => [d.s.id, d.tph, d.fph])).toEqual([["B", 3, 0.5], ["G", 6, 0], ["E", 4, 1.5]]);
    expect(row.med).toBe(4);
  });

  it("the window's share: 10 h, 200 turns, 6 min of it in the range — 2 turns in 6 min = 20/h, not 2000/h; no active minutes: the wall clock; never more than the whole session", () => {
    const ten = { ...s("L", "K", "00:00", 600, 200, 50), intervals: [[iso("2026-09-20T19:06"), iso("2026-09-21T05:06")]] as [string, string][] };
    const p = prepare(range([ten, { ...s("z", "K", "07:00", 60, 6), active_minutes: 0 }, { ...s("o", "K", "09:00", 60, 6, 3), active_minutes: 30 }]));
    expect(deriveDensity(p)[0].dots.map((d) => [d.s.id, d.tph, d.fph])).toEqual([["L", 20, 5], ["z", 6, 0], ["o", 6, 3]]);
  });

  it("filter: ≥ 3 sessions of ≥ 5 min and ≥ 120 min over all the task's sessions; rows by median, fastest first", () => {
    const rows = deriveDensity(prepare(range([
      s("k1", "K", "06:00", 40, 2), s("k2", "K", "07:00", 40, 2), s("k3", "K", "08:00", 40, 2),           // 120 min: in, 3/h
      s("m1", "M", "06:00", 40, 2), s("m2", "M", "07:00", 40, 2), s("m3", "M", "08:00", 39, 2),           // 119: out
      s("n1", "N", "06:00", 100, 10), s("n2", "N", "08:00", 100, 10), s("n3", "N", "10:00", 4, 1),       // 2 of ≥ 5: out
      s("q1", "Q", "06:00", 60, 12), s("q2", "Q", "07:00", 60, 6), s("q3", "Q", "08:00", 5, 1), s("q4", "Q", "09:00", 4, 9), // q4 < 5 left out of the dots
      s("u1", null, "06:00", 60, 1), s("u2", null, "07:00", 60, 1), s("u3", null, "08:00", 60, 1),
    ])));
    expect(rows.map((r) => [r.task, r.med, r.dots.length, r.sessions])).toEqual([["Q", 12, 3, 4], ["K", 3, 3, 3]]);
    expect(deriveDensity(prepare(range([])))).toEqual([]);
  });

  it("axis: log 0.5–200/h, clamped; jitter −3…3 by id", () => {
    expect([axisOf(0.1), axisOf(0.5), axisOf(200), axisOf(1e4)]).toEqual([0, 0, 1, 1]);
    expect(axisOf(10)).toBeCloseTo(Math.log(20) / Math.log(400));
    for (const id of ["A", "B", "S00e2bcc2", "x"]) expect(Math.abs(jitter(id))).toBeLessThanOrEqual(3);
  });
});

describe("drawDensity", () => {
  it("表: one dot per session in the task's ink, the median tick, the code and median · files/h; a hovered other task drops to .3 of itself (R5)", () => {
    const rows = deriveDensity(prepare(VIZ)), r = rec();
    const g = drawDensityOmote(r.ctx, rows, null, { w: 600, h: densityHeight(rows.length) }, font);
    const dots = r.calls.filter((c) => c.op === "fill");
    expect(dots).toHaveLength(3);
    expect(dots.every((c) => c.fill === inkOf(lineColor("T1")) && c.alpha === 0.55)).toBe(true);
    expect(r.calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["1/h", "3/h", "10/h", "30/h", "100/h", "T1", "4 · 0"]);
    expect(densityAt(g, g.y0 + g.rh / 2)).toBe(0);
    expect(densityAt(g, g.y0 + g.rh + 1)).toBeNull();
    expect(densityAt(g, g.y0 - 1)).toBeNull();
    const h = rec();
    drawDensityOmote(h.ctx, rows, "T9", { w: 600, h: densityHeight(rows.length) }, font);
    expect(h.calls.filter((c) => c.op === "fill").map((c) => c.alpha)).toEqual([0.55 * 0.3, 0.55 * 0.3, 0.55 * 0.3]);   // R5: .3 of the undimmed .55, as 里
  });

  it("里: dots in the task's line colour, the median tick warm white", () => {
    const rows = deriveDensity(prepare(VIZ)), r = rec();
    drawDensityUra(r.ctx, rows, null, { w: 600, h: densityHeight(rows.length), offX: 0, offY: 0 }, "zh", noGlyph);
    const lit = r.calls.filter((c) => c.op === "fill" && c.fill.startsWith("#"));
    expect(lit.filter((c) => c.fill === "#fff4e2")).toHaveLength(9);
    expect(lit.some((c) => c.fill === lineColor("T1"))).toBe(true);
  });
});

describe("density gutter (shots 7b: the codes were cut at the left edge)", () => {
  it("里: a task code as wide as the real pixel font draws it (34 dots for 0901-02) stays on the canvas", () => {
    const wide = () => ({ w: 34, h: 8, on: new Uint8Array(34 * 8).fill(1) });
    const rows = deriveDensity(prepare(VIZ)), r = rec();
    drawDensityUra(r.ctx, rows, null, { w: 600, h: densityHeight(rows.length), offX: 0, offY: 0 }, "zh", wide);
    const xs = r.calls.filter((c) => c.op === "arc" || c.op === "drawImage").map((c) => Number(c.args[c.op === "arc" ? 0 : 1]));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  });
});

describe("B3b archetype B — density label silhouettes", () => {
  const rows = deriveDensity(prepare(VIZ)), g = { w: 600, h: densityHeight(rows.length) };
  const texts = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
  it("表: the silhouette replaces the code (24 px, ink of the badge colour); no sil = today", () => {
    const r = rec();
    drawDensityOmote(r.ctx, rows, null, g, font, fakeSil());
    expect(texts(r)).not.toContain("T1");
    const f = r.calls.find((c) => c.op === "fill" && (c.args[0] as { d?: string })?.d === "MT1")!;
    expect(f.fill).toBe(inkOf("#3366ff"));
    const i = r.calls.findIndex((c) => c === f);
    const tr = r.calls.slice(0, i).reverse().find((c) => c.op === "translate")!, sc = r.calls.slice(0, i).reverse().find((c) => c.op === "scale")!;
    expect(tr.args).toEqual([42 * 3 - 8 - 24, (2 + 5) * 3 - 12]);   // GL*u - 8 - 24, yc - 12 (yc = row 0 centre)
    expect(sc.args[0]).toBeCloseTo(24 / 256);
    const today = rec();
    drawDensityOmote(today.ctx, rows, null, g, font);
    expect(texts(today)).toContain("T1");
    const nul = rec();
    drawDensityOmote(nul.ctx, rows, null, g, font, null);
    expect(nul.calls).toEqual(today.calls);
  });
  it("里: 9×9 dots in the label column instead of the code; dots() null → the code", () => {
    const geo = { ...g, offX: 0, offY: 0 };
    const withSil = rec();
    drawDensityUra(withSil.ctx, rows, null, geo, "zh", noGlyph, fakeSil());
    const inCol = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "arc" && Number(c.args[0]) < 42 * PITCH).length;
    const lit = withSil.calls.filter((c, i) => c.op === "fill" && c.fill === lineColor("T1") && Number(withSil.calls[i - 1]?.args[0]) < 42 * PITCH && withSil.calls[i - 1].op === "arc");
    expect(lit).toHaveLength(63);
    const i0 = 42 - 4 - 9;
    expect(Math.min(...withSil.calls.filter((c) => c.op === "arc" && Number(c.args[0]) < 42 * PITCH).map((c) => Number(c.args[0])))).toBeCloseTo((i0 + 1) * PITCH + PITCH / 2);
    const none = rec(), base = rec();
    drawDensityUra(none.ctx, rows, null, geo, "zh", noGlyph, fakeSil(null));
    drawDensityUra(base.ctx, rows, null, geo, "zh", noGlyph);
    expect(none.calls).toEqual(base.calls);
    expect(inCol(withSil)).toBeGreaterThan(inCol(base));
  });
  it("里 with a real code font: the silhouette replaces the code's dots", () => {
    const wide = () => ({ w: 5, h: 8, on: new Uint8Array(40).fill(1) });
    const a = rec(), b = rec();
    drawDensityUra(a.ctx, rows, null, { ...g, offX: 0, offY: 0 }, "zh", wide);
    drawDensityUra(b.ctx, rows, null, { ...g, offX: 0, offY: 0 }, "zh", wide, fakeSil());
    const col = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "arc" && Number(c.args[0]) < 42 * PITCH).length;
    expect(col(a)).toBe(40);
    expect(col(b)).toBe(63);
  });
});
