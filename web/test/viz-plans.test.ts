import { describe, expect, it } from "vitest";
import { derivePlans, drawPlansOmote, drawPlansUra, plansAt, plansHeight } from "../src/pages/stats/viz/plans";
import { PITCH } from "../src/led/lattice";
import { prepare } from "../src/pages/stats/viz/wall";
import { daysOf } from "../src/pages/stats/viz/day";
import { mdOf } from "../src/predict/time";
import type { StatsPlan } from "../src/api/types";
import { C } from "../src/ui/palette";
import { inkOf, lineColor } from "../src/ui/palette";
import { rec } from "./canvas-rec";
import { fakeSil } from "./fake-sil";
import { VIZ } from "./viz-fixture";

const font = () => "400 11px sans";
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const P = VIZ.plans;

describe("derivePlans (lab s9, many-to-many)", () => {
  it("rows = the tasks the items name (first seen first), columns = the plan dates; a two-task item sits in both rows", () => {
    const pl = derivePlans(prepare(VIZ), P);
    expect(pl.dates).toEqual(["2026-09-21", "2026-09-22"]);
    expect(pl.rows.map((r) => r.task)).toEqual(["T1", "T2", "T3"]);
    expect(pl.rows.map((r) => r.cells.map((c) => c.items.map((i) => i.text)))).toEqual([
      [["T1 を仕上げる"], ["T1 の確認", "T1 の追加"]],
      [["T2 と T3 を調べる"], []],
      [["T2 と T3 を調べる"], []],
    ]);
  });

  it("a cell's bar = the task's wall clock that 5:00 day, split evenly (U17); an item's wall clock = Σ its tasks'; the scale ≥ 60", () => {
    const pl = derivePlans(prepare(VIZ), P);
    expect(pl.rows.map((r) => r.cells.map((c) => c.wall))).toEqual([[105, 30], [135, 60], [0, 0]]);
    expect(pl.rows.map((r) => r.cells.map((c) => c.itemWall))).toEqual([[[105], [30, 30]], [[135], []], [[135], []]]);
    expect(pl.max).toBe(135);
    expect(derivePlans(prepare(VIZ), [{ ...P[0], task_ids: ["T3"] }]).max).toBe(60);
  });

  it("head figures: items, AI done / judged, manual done, agreement where both judged; an item without a task counts but has no row", () => {
    const pl = derivePlans(prepare(VIZ), P);
    expect([pl.items, pl.aiDone, pl.judged, pl.manDone, pl.agree, pl.both]).toEqual([4, 1, 3, 2, 1, 2]);
    const loose = derivePlans(prepare(VIZ), [...P,
      { date: "2026-09-22", text: "雑務", task_ids: [], ai_status: "done", manual_status: "done" },
      { date: "2026-09-22", text: "未判定", task_ids: [], ai_status: null, manual_status: null }]);   // neither judged: not an agreement
    expect(loose.rows).toHaveLength(3);
    expect([loose.items, loose.aiDone, loose.judged, loose.manDone, loose.agree, loose.both]).toEqual([6, 2, 4, 3, 2, 3]);
    expect(derivePlans(prepare(VIZ), [])).toMatchObject({ dates: [], rows: [], items: 0, max: 60 });
  });
});

describe("drawPlans", () => {
  it("表: per item two lamps (done filled, partial half, none / not judged rings), a bar per planned cell in the task's ink; plansAt", () => {
    const pl = derivePlans(prepare(VIZ), P), r = rec();
    const g = drawPlansOmote(r.ctx, pl, null, { w: 600, h: plansHeight(pl.rows.length) }, font);
    expect(r.calls.filter((c) => c.op === "fillText").map((c) => c.args[0])).toEqual(["9/21", "9/22", "T1", "T2", "T3"]);
    // lamps: T1 9/21 done/done, T1 9/22 null/done + none/null, T2 9/21 partial/none, T3 9/21 partial/none → 10 rings
    expect(r.calls.filter((c) => c.op === "stroke")).toHaveLength(10);
    const bars = r.calls.filter((c) => c.op === "fillRect" && c.fill.startsWith("#"));
    expect(bars.map((c) => [c.fill, Math.round(Number(c.args[2]))])).toEqual([
      [inkOf(lineColor("T1")), Math.round((105 / 135) * 33 * 3)], [inkOf(lineColor("T1")), Math.round((30 / 135) * 33 * 3)],
      [inkOf(lineColor("T2")), 33 * 3], [inkOf(lineColor("T3")), 0],
    ]);
    expect(plansAt(g, g.x0 + g.cw * 1.5, g.y0 + g.rh * 0.5)).toEqual({ r: 0, c: 1 });
    expect(plansAt(g, g.x0 + g.cw * 0.5, g.y0 + g.rh * 2.5)).toEqual({ r: 2, c: 0 });
    expect(plansAt(g, g.x0 - 1, g.y0)).toBeNull();
    expect(plansAt(g, g.x0, g.y0 + g.rh * 3)).toBeNull();
    const h = rec();
    drawPlansOmote(h.ctx, pl, "T2", { w: 600, h: plansHeight(pl.rows.length) }, font);
    expect(h.calls.filter((c) => c.op === "fillText" && /^T\d$/.test(String(c.args[0]))).map((c) => c.alpha)).toEqual([0.3, 1, 0.3]);   // R5: .3 in both worlds
  });

  it("里: a done lamp is 16 lit dots, partial 8; the bar lit in proportion", () => {
    const pl = derivePlans(prepare(VIZ), [P[0]]), r = rec();
    drawPlansUra(r.ctx, pl, null, { w: 600, h: plansHeight(1), offX: 0, offY: 0 }, "zh", noGlyph);
    const lit = r.calls.filter((c) => c.op === "fill" && c.fill.startsWith("#"));
    // done + done lamps 32, bar 105 / 105 of 33 × 2 rows
    expect(lit).toHaveLength(32 + 66);
    const half = rec();
    drawPlansUra(half.ctx, derivePlans(prepare(VIZ), [{ ...P[0], ai_status: "partial", manual_status: null }]), null, { w: 600, h: plansHeight(1), offX: 0, offY: 0 }, "zh", noGlyph);
    expect(half.calls.filter((c) => c.op === "fill" && c.fill.startsWith("#"))).toHaveLength(8 + 66);
  });
});

describe("plans gutter (shots 7b: the codes were cut at the left edge)", () => {
  it("里: a task code as wide as the real pixel font draws it (34 dots for 0901-02) stays on the canvas", () => {
    const wide = () => ({ w: 34, h: 8, on: new Uint8Array(34 * 8).fill(1) });
    const pl = derivePlans(prepare(VIZ), P), r = rec();
    drawPlansUra(r.ctx, pl, null, { w: 600, h: plansHeight(pl.rows.length), offX: 0, offY: 0 }, "zh", wide);
    const xs = r.calls.filter((c) => c.op === "arc" || c.op === "drawImage").map((c) => Number(c.args[c.op === "arc" ? 0 : 1]));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  });
});

describe("plans with many dates (C2: from 36 dates at 1200px no lamp was drawn; past 89 the columns ran off the canvas)", () => {
  /** One T1 item a day on `n` dates from 6/1, AI done (no session: the bars stay dark, every lit dot is a lamp). */
  const many = (n: number, it: Partial<StatsPlan> = {}): StatsPlan[] => daysOf("2026-06-01", "2026-12-31").slice(0, n)
    .map((date) => ({ date, text: "x", task_ids: ["T1"], ai_status: "done", manual_status: null, ...it }));
  // 里 at 400 dots, the dot count 1200px of 表 holds (the canvas is sized in 表 units; the lattice is PITCH)
  const W = 400 * PITCH;
  const ura = (plans: StatsPlan[], w = W) => {
    const r = rec(), pl = derivePlans(prepare(VIZ), plans);
    const g = drawPlansUra(r.ctx, pl, null, { w, h: plansHeight(pl.rows.length), offX: 0, offY: 0 }, "zh", noGlyph);
    return { r, g, pl, lit: r.calls.filter((c) => c.op === "fill" && c.fill.startsWith("#")), xs: r.calls.filter((c) => c.op === "arc").map((c) => Number(c.args[0])) };
  };
  it("里, 40 dates at 1200px: one merged lamp per item (16 dots for done), every date shown, nothing past the right edge", () => {
    const { g, lit, xs } = ura(many(40));
    expect(g).toMatchObject({ c0: 0, nc: 40, merged: true });
    expect(lit).toHaveLength(40 * 16);
    expect(Math.max(...xs)).toBeLessThan(W);
  });
  it("里, 100 dates at 1200px: only the latest that fit (59), from the 42nd; lamps drawn; plansAt names the drawn date", () => {
    const { g, lit, xs, pl } = ura(many(100));
    expect(g).toMatchObject({ c0: 41, nc: 59, merged: true });
    expect(lit).toHaveLength(59 * 16);
    expect(Math.max(...xs)).toBeLessThan(W);
    expect(plansAt(g, g.x0 + g.cw * 0.5, g.y0 + 1)).toEqual({ r: 0, c: 41 });
    expect(pl.dates[plansAt(g, g.x0 + g.cw * 58.5, g.y0 + 1)!.c]).toBe(pl.dates[99]);
    expect(plansAt(g, g.x0 + g.cw * 59.5, g.y0 + 1)).toBeNull();
  });
  it("里, the merged lamp: the manual verdict when there is one (warm), else the AI's (amber)", () => {
    const man = ura(many(40, { ai_status: "done", manual_status: "none" })).lit, ai = ura(many(40, { ai_status: "partial", manual_status: null })).lit;
    expect(man).toHaveLength(0);                                          // manual "not done" wins over AI "done"
    expect(ai).toHaveLength(40 * 8);
    expect(new Set(ai.map((c) => c.fill))).toEqual(new Set([C.AMBER]));
    expect(new Set(ura(many(40, { manual_status: "done" })).lit.map((c) => c.fill))).toEqual(new Set([C.WARM]));
  });
  it("里: a pair per item while a column holds two lamps (35 dates at 1200px)", () => {
    const { g, lit } = ura(many(35));
    expect(g).toMatchObject({ c0: 0, nc: 35, merged: false });
    expect(lit).toHaveLength(35 * 16);                                    // AI done 16 + manual not judged 0
  });
  it("date labels (seen in the browser with 100 dates: 7/277/306/2 ran together, the last one cut at the edge): apart, inside the canvas, in both worlds", () => {
    const wide = (s: string) => ({ w: s.length * 4, h: 1, on: new Uint8Array(s.length * 4).fill(1) });
    for (const n of [40, 59, 100]) {
      const r = rec(), pl = derivePlans(prepare(VIZ), many(n));
      drawPlansUra(r.ctx, pl, null, { w: W, h: plansHeight(1), offX: 0, offY: 0 }, "zh", wide);
      const xs = [...new Set(r.calls.filter((c) => c.op === "arc" && c.args[1] === PITCH * 1.5 && c.args[2] !== PITCH * 0.3).map((c) => (Number(c.args[0]) - PITCH / 2) / PITCH))].sort((p, q) => p - q);
      const starts = xs.flatMap((x, i) => (i === 0 || x !== xs[i - 1] + 1 ? [i] : []));
      const runs = starts.map((k, i) => (starts[i + 1] ?? xs.length) - k);
      expect(runs.length).toBeGreaterThan(3);
      expect(Math.max(...runs), `${n}`).toBeLessThanOrEqual(20);              // each run one label (4 dots a character): no two touch
      expect(Math.max(...xs)).toBeLessThan(400);
      const o = rec();
      drawPlansOmote(o.ctx, pl, null, { w: 1200, h: plansHeight(1) }, font);
      const t = o.calls.filter((c) => c.op === "fillText" && /^\d+\/\d+$/.test(String(c.args[0]))).map((c) => [Number(c.args[1]), String(c.args[0]).length * 6]);
      t.forEach(([x, w], i) => { expect(x + w).toBeLessThanOrEqual(1200); if (i) expect(t[i - 1][0] + t[i - 1][1]).toBeLessThan(x); });
    }
    // the last label at the right edge, over a run of widths: never past it
    for (let w = 1000; w <= 1300; w += 3) {
      const r = rec(), o = rec(), pl = derivePlans(prepare(VIZ), many(100));
      drawPlansUra(r.ctx, pl, null, { w: (w / 3) * PITCH, h: plansHeight(1), offX: 0, offY: 0 }, "zh", wide);   // w / 3 dots
      drawPlansOmote(o.ctx, pl, null, { w, h: plansHeight(1) }, font);
      const xs = r.calls.filter((c) => c.op === "arc" && c.args[1] === PITCH * 1.5).map((c) => Number(c.args[0]));
      expect(Math.max(...xs), `${w}`).toBeLessThan(Math.floor(w / 3) * PITCH);
      for (const c of o.calls.filter((c) => c.op === "fillText" && /^\d+\/\d+$/.test(String(c.args[0])))) expect(Number(c.args[1]) + String(c.args[0]).length * 6, `${w}`).toBeLessThanOrEqual(w);
    }
  });
  it("表, 40 and 100 dates at 1200px: one ring per shown item, all inside the canvas; the first label is the first shown date", () => {
    for (const [n, shown] of [[40, 40], [100, 59]]) {
      const r = rec(), pl = derivePlans(prepare(VIZ), many(n));
      const g = drawPlansOmote(r.ctx, pl, null, { w: 1200, h: plansHeight(1) }, font);
      expect(g).toMatchObject({ c0: n - shown, nc: shown, merged: true });
      expect(r.calls.filter((c) => c.op === "stroke")).toHaveLength(shown);
      expect(Math.max(...r.calls.filter((c) => c.op === "arc").map((c) => Number(c.args[0]) + 4.5))).toBeLessThanOrEqual(1200);
      expect(r.calls.find((c) => c.op === "fillText")!.args[0]).toBe(mdOf(pl.dates[n - shown]));
      expect(plansAt(g, g.x0 + 1, g.y0 + 1)).toEqual({ r: 0, c: n - shown });
    }
  });
});


describe("B3b archetype B — plans label silhouettes", () => {
  const pl = derivePlans(prepare(VIZ), P), g = { w: 600, h: plansHeight(pl.rows.length) };
  const texts = (r: ReturnType<typeof rec>) => r.calls.filter((c) => c.op === "fillText").map((c) => c.args[0]);
  it("表: 18 px silhouettes (ink of the badge colour) replace the task codes, right-aligned at the code's edge; no sil = today", () => {
    const r = rec();
    drawPlansOmote(r.ctx, pl, null, g, font, fakeSil());
    expect(texts(r)).toEqual(["9/21", "9/22"]);
    const fills = r.calls.filter((c) => c.op === "fill" && (c.args[0] as { d?: string })?.d);
    expect(fills.map((c) => [(c.args[0] as { d: string }).d, c.fill])).toEqual(["MT1", "MT2", "MT3"].map((d) => [d, inkOf("#3366ff")]));
    const tr = r.calls.filter((c) => c.op === "translate");
    expect(tr.map((c) => c.args)).toEqual([0, 1, 2].map((i) => [42 * 3 - 8 - 18, (12 + i * 11) * 3 + 1]));
    const today = rec(), nul = rec();
    drawPlansOmote(today.ctx, pl, null, g, font);
    drawPlansOmote(nul.ctx, pl, null, g, font, null);
    expect(texts(today)).toContain("T1");
    expect(nul.calls).toEqual(today.calls);
  });
  it("表: the hovered task's silhouettes keep the row dim (.3 for the others)", () => {
    const r = rec();
    drawPlansOmote(r.ctx, pl, "T2", g, font, fakeSil());
    expect(r.calls.filter((c) => c.op === "fill" && (c.args[0] as { d?: string })?.d).map((c) => c.alpha)).toEqual([0.3, 1, 0.3]);
  });
  it("里: 9×9 dots right-aligned in the label column instead of the code; dots() null → the code", () => {
    const geo = { ...g, offX: 0, offY: 0 }, a = rec(), b = rec(), base = rec();
    drawPlansUra(a.ctx, pl, null, geo, "zh", noGlyph, fakeSil());
    const col = a.calls.filter((c) => c.op === "arc" && Number(c.args[0]) < 42 * PITCH);
    expect(col).toHaveLength(63 * 3);
    expect(Math.min(...col.map((c) => Number(c.args[0])))).toBeCloseTo((42 - 3 - 9 + 1) * PITCH + PITCH / 2);
    expect(Math.max(...col.map((c) => Number(c.args[0])))).toBeCloseTo((42 - 3 - 9 + 7) * PITCH + PITCH / 2);
    expect(Math.min(...col.map((c) => Number(c.args[1])))).toBeCloseTo((12 + 1) * PITCH + PITCH / 2);   // rows start at j0 + 1
    drawPlansUra(b.ctx, pl, null, geo, "zh", noGlyph, fakeSil(null));
    drawPlansUra(base.ctx, pl, null, geo, "zh", noGlyph);
    expect(b.calls).toEqual(base.calls);
  });
});
