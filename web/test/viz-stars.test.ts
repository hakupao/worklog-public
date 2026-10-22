import { describe, expect, it } from "vitest";
import { deriveStars, drawStarsOmote, drawStarsUra, drawTwinkleUra, starAt, STARS_HEIGHT } from "../src/pages/stats/viz/stars";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { prepare } from "../src/pages/stats/viz/wall";
import { C, inkOf, lineColor } from "../src/ui/palette";
import { rec } from "./canvas-rec";
import { jst, VIZ } from "./viz-fixture";

const prep = (from = VIZ.range.from, to = VIZ.range.to) => prepare({ ...VIZ, range: { from, to } });
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const font = () => "11px sans";
const LOG = Math.log(1440);

describe("deriveStars (lab s4)", () => {
  it("one star per session in the window, biggest token count first; radius .6 + 6.2·(tok / max)^.45, none collected = .6", () => {
    const st = deriveStars(prep());
    expect(st.stars.map((s) => s.s.id)).toEqual(["D", "A", "E", "B", "C", "F"]);
    expect(st.maxTok).toBe(215000);
    expect(st.stars[0].r).toBeCloseTo(6.8);
    expect(st.stars[1].r).toBeCloseTo(0.6 + 6.2 * (108000 / 215000) ** 0.45);
    expect(st.stars[5]).toMatchObject({ tok: 0, r: 0.6 });
    expect(st.stars.map((s) => s.ph)).toEqual([0, 2.399, 4.798, 7.197 % 6.283, 9.596 % 6.283, 11.995 % 6.283].map((v) => expect.closeTo(v, 9)));
  });

  it("x = the first instant across the window; y = log(window minutes) over log(24h), 1 minute at least", () => {
    const st = deriveStars(prep()), a = st.stars.find((s) => s.s.id === "A")!, f = st.stars.find((s) => s.s.id === "F")!;
    expect(a.x).toBeCloseTo(4 / 48);                                       // 9/21 09:00 in [9/21 05:00, 9/23 05:00)
    expect(a.y).toBeCloseTo(Math.log(120) / LOG);
    expect(f.y).toBeCloseTo(Math.log(30) / LOG);
    const cut = deriveStars(prep("2026-09-22", "2026-09-22")).stars.find((s) => s.s.id === "E")!;
    expect(cut.x).toBe(0);                                                 // clipped at 9/22 05:00: 60 window minutes
    expect(cut.y).toBeCloseTo(Math.log(60) / LOG);
  });

  it("the longest (window minutes, earliest on a tie) and the costliest priced session", () => {
    const st = deriveStars(prep());
    expect(st.longest!.id).toBe("A");
    expect(st.costliest!.id).toBe("D");
    expect(deriveStars(prep("2026-10-05", "2026-10-06"))).toEqual({ stars: [], maxTok: 0, longest: null, costliest: null });
  });
});

describe("drawStars", () => {
  it("表: filled discs, Codex hollow (stroked); a hovered task's stars .75 and joined in time order, the others .3", () => {
    const st = deriveStars(prep()), r = rec();
    drawStarsOmote(r.ctx, st, prep(), "T1", true, { w: 600, h: STARS_HEIGHT }, font);
    const fills = r.calls.filter((c) => c.op === "fill" && c.fill === inkOf(lineColor("T1")));
    expect(fills.map((c) => c.alpha)).toEqual([0.75, 0.75, 0.75]);         // A, C, F
    const b = r.calls.filter((c) => c.op === "stroke" && c.alpha === 0.3);
    expect(b.length).toBeGreaterThanOrEqual(1);                            // B (Codex, T2) hollow and dimmed
    expect(r.calls.filter((c) => c.op === "fill" && c.fill === inkOf(lineColor("T2"))).map((c) => c.alpha)).toEqual([0.3]);   // E
    expect(r.calls.filter((c) => c.op === "lineTo").length).toBeGreaterThanOrEqual(3);       // the constellation A → C → F
  });

  it("the labels: the costliest's amount only where amounts may show; the longest's minutes always", () => {
    const st = deriveStars(prep());
    const on = rec(), off = rec();
    drawStarsOmote(on.ctx, st, prep(), null, true, { w: 600, h: STARS_HEIGHT }, font);
    drawStarsOmote(off.ctx, st, prep(), null, false, { w: 600, h: STARS_HEIGHT }, font);
    const texts = (calls: typeof on.calls) => calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));
    expect(texts(on.calls)).toContain("$6.00");
    expect(texts(on.calls)).toContain("2h00m");
    expect(texts(off.calls).some((s) => s.includes("$"))).toBe(false);
    expect(texts(off.calls)).toContain("2h00m");
  });

  it("labels stay inside the canvas: a whole-day star at the top-left edge, a costly one at the right edge", () => {
    const iso = (t: string) => new Date(jst(t)).toISOString();
    const p = prepare({ ...VIZ, sessions: [
      { ...VIZ.sessions[0], id: "Z", intervals: [[iso("2026-09-21T05:00"), iso("2026-09-22T05:00")]] },        // 24h: y = 1, x = 0
      { ...VIZ.sessions[0], id: "Q", cost_usd: 99, intervals: [[iso("2026-09-23T04:40"), iso("2026-09-23T05:00")]] },   // x ≈ 1
    ] });
    const st = deriveStars(p);
    const o = rec();
    drawStarsOmote(o.ctx, st, p, null, true, { w: 600, h: STARS_HEIGHT }, font);
    const labs = o.calls.filter((c) => c.op === "fillText" && ["$99.00", "24h00m"].includes(String(c.args[0])));
    expect(labs).toHaveLength(2);
    for (const c of labs) {
      const [t, lx, ly] = c.args as [string, number, number], half = t.length * 3;     // canvas-rec: 6px a character
      expect(lx - half).toBeGreaterThanOrEqual(0);
      expect(lx + half).toBeLessThanOrEqual(600);
      expect(ly - 11).toBeGreaterThanOrEqual(0);
    }
    const u = rec(), wide = () => ({ w: 40, h: 8, on: new Uint8Array(320).fill(1) });
    drawStarsUra(u.ctx, st, p, null, true, { w: 600, h: STARS_HEIGHT, offX: 0, offY: 0 }, "zh", wide);
    const dots = u.calls.flatMap((c, k) => (c.op === "arc" && u.calls[k + 1]?.fill === C.WARM ? [c.args as number[]] : []));   // the labels' dots
    expect(dots.length).toBe(2 * 320);
    expect(Math.min(...dots.map((d) => d[1]))).toBeGreaterThan(0);
    expect(Math.min(...dots.map((d) => d[0]))).toBeGreaterThan(0);
    expect(Math.max(...dots.map((d) => d[0]))).toBeLessThan(600);
  });

  it("starAt: the nearest star within 10px of its rim; none further", () => {
    const st = deriveStars(prep()), r = rec();
    const g = drawStarsOmote(r.ctx, st, prep(), null, true, { w: 600, h: STARS_HEIGHT }, font);
    const d = g.pts[0];
    expect(st.stars[starAt(g, d.px + 2, d.py)!].s.id).toBe("D");
    expect(starAt(g, 590, 5)).toBeNull();
  });

  it("里: the static layer lights every star; the twinkle overlay brightens only bigger stars' cores and clears just itself", () => {
    // 里 at the dots a 600px 表 canvas holds (heights are set in 表 units; the lattice is PITCH)
    const st = deriveStars(prep()), r = rec(), W = 200 * PITCH, H = (STARS_HEIGHT / OMOTE_UNIT) * PITCH;
    const g = drawStarsUra(r.ctx, st, prep(), null, true, { w: W, h: H, offX: 0, offY: 0 }, "zh", noGlyph);
    expect(r.calls.some((c) => c.op === "fill" && c.fill === lineColor(null))).toBe(true);                 // D, unlinked grey
    const o = rec();
    // D's phase is 0: sin(now / 900) = 1 at now = 900·π/2
    drawTwinkleUra(o.ctx, g, 900 * Math.PI / 2, W, H);
    expect(o.calls[0].op).toBe("clearRect");
    const lits = o.calls.filter((c) => c.op === "fill");
    expect(lits.length).toBeGreaterThan(0);
    // only cores: every twinkling dot lies within .55 r (+ a dot) of a star's centre
    const arcs = o.calls.filter((c) => c.op === "arc").map((c) => [c.args[0] as number, c.args[1] as number]);
    for (const [ax, ay] of arcs) expect(g.pts.some((q) => Math.hypot(ax / PITCH - 0.5 - q.cx, ay / PITCH - 0.5 - q.cy) < q.r * 0.55 + 1)).toBe(true);
    expect(lits.length).toBeLessThan(r.calls.filter((c) => c.op === "fill").length / 4);
    const quiet = rec();
    drawTwinkleUra(quiet.ctx, g, -900 * Math.PI / 2, W, H);   // D at its trough
    expect(quiet.calls.filter((c) => c.op === "fill").length).toBeLessThan(lits.length);
  });
});
