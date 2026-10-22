import { describe, expect, it } from "vitest";
import type { StatsSessions } from "../src/api/types";
import { computeAt, computeHeight, countsOf, fitCompute, deriveCompute, drawComputeOmote, drawComputeUra, familyOf, unitFor, usdShort } from "../src/pages/stats/viz/compute";
import { OMOTE_UNIT, PITCH } from "../src/led/lattice";
import { perDay, prepare, segments } from "../src/pages/stats/viz/wall";
import { rec } from "./canvas-rec";
import { jst, VIZ } from "./viz-fixture";

const of = (d: StatsSessions) => { const p = prepare(d); return deriveCompute(p, segments(p), perDay(p)); };
const cOf = (from = VIZ.range.from, to = VIZ.range.to) => of({ ...VIZ, range: { from, to } });
const font = () => "400 11px sans";
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
/** 里 at the same dot count as a 表 canvas of `px` (heights are set in 表 units, the lattice is PITCH). */
const dotsPx = (px: number) => Math.floor(px / OMOTE_UNIT) * PITCH;
const kinds = (cache_read: number, cache_write = 0, input = 0, output = 0) => ({ cache_read, cache_write, input, output });

describe("deriveCompute (lab s7)", () => {
  it("the fixture: one week W39 — tokens by kind, known cost $11.50 partial (B unpriced, F not collected), $/h over the week's wall clock 7.5h", () => {
    const c = cOf();
    expect(c.weeks).toHaveLength(1);
    const w = c.weeks[0];
    expect([w.label, w.cut, w.union]).toEqual(["W39", true, 450]);
    expect(w.kinds).toEqual(kinds(380000, 18000, 9500, 7500));
    expect([w.tok, w.cost, w.partial]).toEqual([415000, 11.5, true]);
    expect(w.perHour).toBeCloseTo(11.5 / 7.5);
    expect([c.tok, c.cost, c.partial, c.wall, c.sub]).toEqual([415000, 11.5, true, 450, 1000]);
    expect(c.perHour).toBeCloseTo(11.5 / 7.5);
  });

  it("1 dot = the smallest 1-2-5 unit that fits the busiest week in 16 × 24 dots: 2000 for the fixture (1000 needs 416)", () => {
    const c = cOf();
    expect(c.unit).toBe(2000);
    expect(c.weeks[0].counts).toEqual([190, 9, 5, 4]);
    expect(c.rows).toBe(13);
    expect(countsOf(kinds(380000, 18000, 9500, 7500), 1000).reduce((a, b) => a + b)).toBe(416);
    expect(unitFor([kinds(384)])).toBe(1);
    expect(unitFor([kinds(385)])).toBe(2);
    expect(unitFor([kinds(0, 0, 0, 1)])).toBe(1);
    expect(countsOf(kinds(1, 0, 0, 0), 5000)).toEqual([1, 0, 0, 0]);   // any tokens: at least one dot
  });

  it("machine / agent: wall clock split evenly where they overlap (U17), cost over whole sessions; families by model name; subagent", () => {
    const c = cOf();
    expect(c.machines).toEqual([{ key: "macmini", wall: 420, cost: 11 }, { key: "win11", wall: 30, cost: 0.5 }]);
    expect(c.agents).toEqual([{ key: "claude-code", wall: 375, cost: 11.5 }, { key: "codex", wall: 75, cost: 0 }]);
    expect(c.families).toEqual([["Opus", 377000], ["GPT", 26000], ["Sonnet", 12000]]);
    expect(["claude-fable-5", "claude-opus-5[1m]", "claude-sonnet-4", "claude-haiku-4-5", "gpt-5-codex", "o3"].map(familyOf))
      .toEqual(["Fable", "Opus", "Sonnet", "Haiku", "GPT", "other"]);
  });

  it("a session counts whole to the week of its first instant in the window; a week without wall clock has no $/h; weeks are calendar's", () => {
    const span: StatsSessions = {
      ...VIZ, range: { from: "2026-09-16", to: "2026-09-29" },
      sessions: [...VIZ.sessions, {
        ...VIZ.sessions[1], id: "Y", agent: "claude-code", cost_usd: 4, cost_partial: false, tokens: { "claude-opus-5": kinds(1000) }, subagent_tokens: null,
        // Sunday 9/27 23:00 – Monday 9/28 06:00 JST: mostly W40, but starts in W39
        intervals: [[new Date(jst("2026-09-27T23:00")).toISOString(), new Date(jst("2026-09-28T06:00")).toISOString()]],
      }],
    };
    const c = of(span);
    expect(c.weeks.map((w) => [w.label, w.tok, w.cost, w.union])).toEqual([["W38", 1200, 0.1, 60], ["W39", 416000, 15.5, 450 + 360], ["W40", 0, 0, 60]]);
    expect(c.weeks[0].partial).toBe(false);
    expect(c.weeks[2].perHour).toBe(0);
    // F3: each week's tokens by model family, most first; they add up to the week's tokens
    expect(c.weeks.map((w) => w.families)).toEqual([[["Opus", 1200]], [["Opus", 378000], ["GPT", 26000], ["Sonnet", 12000]], []]);
    for (const w of c.weeks) expect(w.families.reduce((m, [, n]) => m + n, 0)).toBe(w.tok);
    const empty = cOf("2026-10-05", "2026-10-11");
    expect(empty.weeks.map((w) => [w.tok, w.perHour])).toEqual([[0, null]]);
    expect([empty.tok, empty.perHour, empty.unit, empty.rows]).toEqual([0, null, 1, 1]);
  });

  it("usdShort: whole dollars, thousands as k", () => {
    expect([usdShort(11.5), usdShort(0.4), usdShort(1234), usdShort(822)]).toEqual(["$12", "$0", "$1.2k", "$822"]);
  });
});

describe("drawCompute", () => {
  it("表: four stacked kinds per week (output at least 2px), cost above, the week, $/h under it; computeAt by column", () => {
    const c = cOf("2026-09-14", "2026-09-27"), r = rec();
    const g = drawComputeOmote(r.ctx, c, { w: 600, h: computeHeight(c.rows) }, font);
    expect(r.calls.filter((x) => x.op === "fillRect")).toHaveLength(8);
    const t = r.calls.filter((x) => x.op === "fillText").map((x) => String(x.args[0]));
    expect(t).toEqual(["$0", "W38", "$0/h", "$12", "W39", "$2/h"]);
    expect(g.n).toBe(2);
    expect(computeAt(g, g.x0 + g.cw * 1.5)).toBe(1);
    expect(computeAt(g, g.x0 - 1)).toBeNull();
    expect(computeAt(g, g.x0 + g.cw * 2 + 1)).toBeNull();
  });

  it("里: one lit dot per count (208 for W39 at 2000), the white output dots on top", () => {
    const c = cOf(), r = rec();
    drawComputeUra(r.ctx, c, { w: 600, h: computeHeight(c.rows), offX: 0, offY: 0 }, "zh", noGlyph);
    const lit = r.calls.filter((x) => x.op === "fill" && x.fill.startsWith("#"));
    expect(lit).toHaveLength(208);
    expect(lit.slice(-4).map((x) => x.fill)).toEqual(["#ffffff", "#ffffff", "#ffffff", "#ffffff"]);
  });

  it("narrow: twelve weeks in 200px make 3-dot columns — the unit steps up until W39 fits the canvas's 13 rows; nothing drawn above the top", () => {
    const c = cOf("2026-07-06", "2026-09-27"), h = computeHeight(c.rows);
    expect([c.weeks.length, c.unit, c.rows]).toEqual([12, 2000, 13]);
    const f = fitCompute(c, 3);
    expect(f.unit).toBe(20000);                                     // 10000: 38 + 2 + 1 + 1 = 42 dots, 14 rows of 3; 20000: 22
    expect(f.counts[11].reduce((m, k) => m + k, 0)).toBeLessThanOrEqual(3 * 13);
    expect(fitCompute(c, 16)).toEqual({ unit: 2000, counts: c.weeks.map((w) => w.counts) });   // full width: the derived unit
    const u = rec(), g = drawComputeUra(u.ctx, c, { w: dotsPx(200), h: dotsPx(h), offX: 0, offY: 0 }, "zh", noGlyph);   // 66 dots, as 200px of 表
    const lit = u.calls.filter((x) => x.op === "fill" && x.fill.startsWith("#"));
    expect(g.unit).toBe(20000);
    expect(lit).toHaveLength(f.counts.flat().reduce((m, k) => m + k, 0));   // every dot drawn, none dropped off the top
    expect(Math.min(...u.calls.filter((x) => x.op === "arc").map((x) => x.args[1] as number))).toBeGreaterThan(0);
    const o = rec(), go = drawComputeOmote(o.ctx, c, { w: 200, h }, font);
    expect(go.unit).toBe(20000);
    expect(Math.min(...o.calls.filter((x) => x.op === "fillRect").map((x) => x.args[1] as number))).toBeGreaterThanOrEqual(0);
  });

  it("labels that do not fit a column (P2: twelve weeks' $388$559$603 ran together) go on every other week — or every third …", () => {
    const c = cOf("2026-07-06", "2026-09-27");
    c.weeks.forEach((w) => { w.tok = 1; w.cost = 388; w.perHour = 34; });
    // a stand-in pixel font: 5 dots a character, one row high, every dot lit — a label is a run of dots on its row
    const ura = (w: number) => {
      const { ctx, calls } = rec();
      drawComputeUra(ctx, c, { w: w * PITCH, h: dotsPx(computeHeight(c.rows)), offX: 0, offY: 0 }, "zh", (s) => ({ w: s.length * 5, h: 1, on: new Uint8Array(s.length * 5).fill(1) }));
      const runs = (j: number) => {
        const xs = [...new Set(calls.filter((x) => x.op === "arc" && x.args[2] !== PITCH * 0.3 && x.args[1] === j * PITCH + PITCH / 2).map((x) => ((x.args[0] as number) - PITCH / 2) / PITCH))].sort((a, b) => a - b);
        return xs.reduce((m, x, i) => (i && x === xs[i - 1] + 1 ? m : m + 1), 0);
      };
      const base = 12 + c.rows;
      return { ph: runs(base + 12), wk: runs(base + 2) };
    };
    // 200 dots: 16 a column; "$34/h" is 25 dots (+ 2 apart) → every other week, six runs apart. 400 dots: 33 a column, all fit
    expect(ura(200)).toEqual({ ph: 6, wk: 12 });
    expect(ura(400)).toEqual({ ph: 12, wk: 12 });
    const omote = (w: number) => {
      const r = rec();
      drawComputeOmote(r.ctx, c, { w, h: computeHeight(c.rows) }, font);     // the recorder measures 6px a character
      const t = r.calls.filter((x) => x.op === "fillText").map((x) => [String(x.args[0]), x.args[1] as number] as const);
      for (const pat of [/^\$388$/, /\/h$/]) {
        const xs = t.filter(([s]) => pat.test(s)).map(([, x]) => x);
        xs.slice(1).forEach((x, i) => expect(x - xs[i]).toBeGreaterThanOrEqual(30));   // never closer than the widest ("$34/h")
      }
      return t.filter(([s]) => s === "$388").length;
    };
    expect(omote(300)).toBe(6);                                       // 24px a column
    expect(omote(1200)).toBe(12);
  });
});
