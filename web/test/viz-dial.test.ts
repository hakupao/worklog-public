import { describe, expect, it } from "vitest";
import { peakDay, sessionsOn } from "../src/pages/stats/viz/dayview";
import { angleOf, clockOf, defaultDialDay, deriveDial, dialAt, dialGeom, DIAL_HEIGHT, drawDialOmote, drawDialUra, drawHandOmote, drawHandUra, packLanes, tOf, type Dial } from "../src/pages/stats/viz/dial";
import { PITCH } from "../src/led/lattice";
import { perDay, prepare, segments, type DayAgg } from "../src/pages/stats/viz/wall";
import { inkOf, lineColor } from "../src/ui/palette";
import { rec, type Call } from "./canvas-rec";
import { jst, VIZ } from "./viz-fixture";

const prep = prepare(VIZ), segs = segments(prep), days = perDay(prep);
const d21 = deriveDial(prep, segs, days[0]), d22 = deriveDial(prep, segs, days[1]);
const noGlyph = () => ({ w: 0, h: 8, on: new Uint8Array(0) });
const dots = (calls: Call[]) => {
  const arcs = calls.filter((c) => c.op === "arc"), fills = calls.filter((c) => c.op === "fill");
  return fills.map((c, i) => ({ x: arcs[i].args[0] as number, y: arcs[i].args[1] as number, fill: c.fill, alpha: c.alpha }));
};
const TAU = Math.PI * 2;
const G = { w: 600, h: DIAL_HEIGHT, offX: 0, offY: 0 };
/** 里 at the same 200 × 170 dots (the canvas is sized in 表 units; the lattice is PITCH). */
const GU = { w: 200 * PITCH, h: 170 * PITCH, offX: 0, offY: 0 };

describe("deriveDial", () => {
  it("greedy lanes for 9/21: A, D and E share lane 0 (each starts after the last ended), B lane 1, C lane 2 → 3 lanes", () => {
    expect(d21.arcs.map((o) => [o.s.id, o.lane])).toEqual([["A", 0], ["B", 1], ["C", 2], ["D", 0], ["E", 0]]);
    expect(d21.lanes).toBe(3);
    expect(d21.pieces.map((g) => g.c)).toEqual([1, 2, 3, 2, 1, 1, 1]);
    expect(d22.arcs.map((o) => [o.s.id, o.lane])).toEqual([["E", 0], ["F", 0]]);
    expect(d22.lanes).toBe(1);
  });

  it("a lane is reused only once its session has ended (touching ends reuse it)", () => {
    const ss = sessionsOn(prep, "2026-09-21");
    const touch = [{ ...ss[0], a: 0, b: 10 }, { ...ss[1], a: 10, b: 20 }, { ...ss[2], a: 15, b: 30 }];
    expect(packLanes(touch).arcs.map((o) => o.lane)).toEqual([0, 0, 1]);
  });

  it("default day: the latest with ≥ 3h wall clock, else the peak day", () => {
    expect(defaultDialDay(days, peakDay(days))).toBe("2026-09-21");
    const short = (date: string, union: number): DayAgg => ({ ...days[0], date, union });
    expect(defaultDialDay([short("2026-09-01", 179), short("2026-09-02", 30)], "2026-09-01")).toBe("2026-09-01");
    expect(defaultDialDay([short("2026-09-01", 200), short("2026-09-02", 180), short("2026-09-03", 30)], null)).toBe("2026-09-02");
  });

  it("clock-face time: midnight at the top, clockwise; a 5:00 day's 00:00–04:59 is the next calendar morning", () => {
    expect(clockOf(jst("2026-09-21T09:30"))).toBe(9.5);
    expect(clockOf(jst("2026-09-22T00:00"))).toBe(0);
    expect(angleOf(jst("2026-09-21T18:00"))).toBeCloseTo(TAU * 0.75);
    expect(tOf("2026-09-21", 9.5)).toBe(jst("2026-09-21T09:30"));
    expect(tOf("2026-09-21", 5)).toBe(jst("2026-09-21T05:00"));
    expect(tOf("2026-09-21", 2)).toBe(jst("2026-09-22T02:00"));
    expect(tOf("2026-09-21", 4.5)).toBe(jst("2026-09-22T04:30"));
  });
});

describe("dial geometry and hit test", () => {
  // 200 × 170 dots, centre dot (100, 85); R 74, lanes 25.16–62.16, 9.25 a lane (4 at least)
  const g = dialGeom(GU, true, 3);
  const at = (h: number, r: number) => { const a = (h / 24) * TAU; return [g.cx + Math.sin(a) * r * PITCH, g.cy - Math.cos(a) * r * PITCH] as const; };
  const hit = (d: Dial, h: number, r: number) => dialAt(g, d, ...at(h, r));
  const idOf = (x: ReturnType<typeof hit>) => (x && "arc" in x ? x.arc.s.id : x);

  it("geometry", () => {
    expect(g).toEqual({ cx: 100 * PITCH + PITCH / 2, cy: 85 * PITCH + PITCH / 2, u: PITCH, R: 74, R0: 74 * 0.34, RL: 74 * 0.84, lw: (74 * 0.5) / 4 });
  });

  it("an arc: lane by radius, instant by angle", () => {
    expect(idOf(hit(d21, 9.5, 28))).toBe("A");
    expect(idOf(hit(d21, 10.75, 25.16 + 1.4 * 9.25))).toBe("B");
    expect(idOf(hit(d21, 10.75, 25.16 + 2.4 * 9.25))).toBe("C");
    expect(idOf(hit(d21, 1, 28))).toBe("D");                       // 01:00 of 9/22, inside 9/21's day
    expect(idOf(hit(d21, 4.5, 28))).toBe("E");
    expect(hit(d21, 2, 28)).toBeNull();                              // 02:00: D has ended, E not begun
    expect(hit(d21, 6, 28)).toBeNull();
  });

  it("the ring: the instant and the sessions open then; the centre and outside are nothing", () => {
    expect(hit(d21, 10.75, 64)).toEqual({ ms: jst("2026-09-21T10:45"), c: 3 });
    expect(hit(d21, 3, 64)).toEqual({ ms: jst("2026-09-22T03:00"), c: 0 });
    expect(hit(d21, 10, 10)).toBeNull();
    expect(hit(d21, 10, 80)).toBeNull();
  });
});

describe("drawDialUra / drawDialOmote / the hand", () => {
  // a lattice dot of the face near (h, r): its colour and alpha
  const face = (calls: Call[], h: number, r: number) => {
    const a = (h / 24) * TAU, i = 100 + Math.round(Math.sin(a) * r), j = 85 - Math.round(Math.cos(a) * r);
    return dots(calls).filter((d) => d.x === i * PITCH + PITCH / 2 && d.y === j * PITCH + PITCH / 2);
  };

  it("里: lane dots in the task's line colour where its session is active; the hovered task keeps its brightness, others .3", () => {
    const r = rec();
    const g = drawDialUra(r.ctx, d21, null, "9/21", GU, "zh", noGlyph);
    expect(g).toEqual(dialGeom(GU, true, 3));
    expect(face(r.calls, 10, 28)).toMatchObject([{ fill: lineColor("T1"), alpha: 0.92 }]);
    expect(face(r.calls, 0, 28)).toMatchObject([{ fill: "#9aa0a8", alpha: 0.92 }]);   // D at midnight, unlinked grey
    expect(face(r.calls, 6, 28)[0].fill).toMatch(/^rgba\(255,236,214,0\.04\)/);        // nothing at 06:00
    const h = rec();
    drawDialUra(h.ctx, d21, "T2", "9/21", GU, "zh", noGlyph);
    expect(face(h.calls, 10, 28)[0].alpha).toBeCloseTo(0.92 * 0.3);
    expect(face(h.calls, 11.5, 25.16 + 1.4 * 9.25)).toMatchObject([{ fill: lineColor("T2"), alpha: 0.92 }]);
  });

  it("里: the concurrency ring is whiter with more open — ×3 at 10:45 warm", () => {
    const r = rec();
    drawDialUra(r.ctx, d21, null, "9/21", GU, "zh", noGlyph);
    expect(face(r.calls, 10.75, 64)).toMatchObject([{ fill: "#ffe2b8", alpha: 0.25 + 0.13 * 3 }]);
    expect(face(r.calls, 9.5, 64)).toMatchObject([{ fill: "#ffad3a" }]);
  });

  it("表: one arc per active interval per session in the deepened line colour (+ its span, the ring, the rim)", () => {
    const r = rec();
    drawDialOmote(r.ctx, d21, "T1", "9/21", { w: 600, h: DIAL_HEIGHT }, () => "500 11px sans-serif");
    const arcs = r.calls.filter((c) => c.op === "arc");
    expect(arcs).toHaveLength(1 + 7 + 5 * 2);                         // rim, 7 ring pieces, 5 sessions × (span + interval)
    const a9 = -Math.PI / 2 + (9 / 24) * TAU;
    expect(arcs.some((c) => Math.abs((c.args[3] as number) - a9) < 1e-9)).toBe(true);
    expect(r.calls.filter((c) => c.op === "stroke" && c.alpha === 0.3).length).toBe(3 * 2);   // B, D, E dimmed
    expect(inkOf(lineColor("T1"))).toMatch(/^#/);
  });

  it("the hand: its own canvas cleared, bright dots along the now angle; 表 a teal line and the time", () => {
    const g = dialGeom(GU, true, 3), r = rec();
    drawHandUra(r.ctx, g, jst("2026-09-21T06:00"), GU.w, GU.h);
    expect(r.calls[0]).toMatchObject({ op: "clearRect", args: [0, 0, GU.w, GU.h] });
    const ds = dots(r.calls);
    expect(ds.length).toBeGreaterThan(50);
    expect(ds.every((d) => d.fill === "#fff6e8" && d.y === g.cy)).toBe(true);        // 06:00 points right
    expect(Math.max(...ds.map((d) => d.x))).toBe(g.cx + 75 * PITCH);
    const o = rec();
    drawHandOmote(o.ctx, dialGeom(G, false, 3), jst("2026-09-21T06:00"), 600, DIAL_HEIGHT, () => "11px sans-serif");
    expect(o.calls.find((c) => c.op === "fillText")!.args[0]).toBe("06:00");
  });
});
