import { afterEach, describe, expect, it, vi } from "vitest";
import { H, W } from "../src/badge/geom";
import { canvasSampler } from "../src/badge/sampler";
import { buildScene } from "../src/badge/scene";
import { knockout, sampleCells, STEP, URA, uraSvg, type Sampler } from "../src/badge/ura";

const ID = "T20261001-01";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
// a hero block in the middle, a far layer along the bottom, nothing elsewhere
const fake: Sampler = (x, y) => (x > 80 && x < 110 && y > 30 && y < 70 ? "hero" : y > 80 ? "bg" : y < 20 ? "acc" : null);

describe("sampleCells", () => {
  it("only cells inside the field, on the step grid", () => {
    const cells = sampleCells(fake, STEP.L);
    expect(cells.length).toBeGreaterThan(300);
    for (const c of cells) { expect(c.x).toBeGreaterThan(7); expect(c.x).toBeLessThan(W - 7); }
    expect(Math.max(...cells.map((c) => c.x))).toBeGreaterThan(300);
    expect(new Set(cells.map((c) => c.t))).toEqual(new Set(["hero", "bg", "acc", "off"]));
  });
  it("coarser at S than at L", () => { expect(sampleCells(fake, STEP.S).length).toBeLessThan(sampleCells(fake, STEP.L).length / 3); });
});

describe("knockout", () => {
  const k = (gx: number, gy: number, t: "hero" | "bg" | "off") => ({ gx, gy, x: gx, y: gy, t });
  it("w=1 turns off any lit non-hero cell touching a hero cell (8 neighbours), keeps hero cells", () => {
    const out = knockout([k(5, 5, "hero"), k(6, 6, "bg"), k(7, 5, "bg"), k(4, 5, "off")], 1);
    expect(out.map((c) => c.t)).toEqual(["hero", "off", "bg", "off"]);
  });
  it("w=2 reaches two cells out; w=0 changes nothing", () => {
    const cells = [k(5, 5, "hero"), k(7, 5, "bg"), k(8, 5, "bg")];
    expect(knockout(cells, 2).map((c) => c.t)).toEqual(["hero", "off", "bg"]);
    expect(knockout(cells, 0)).toEqual(cells);
  });
  it("里 uses no knockout ring (G0 round 1)", () => {
    expect(URA.knockout).toBe(0);
    // behaviour, not just the constant (controller ruling): far dots right next to the hero stay lit, so no dot is "off"
    const ring: Sampler = (x, y) => (x > 140 && x < 180 && y > 30 && y < 70 ? "hero" : "bg");
    const s = uraSvg(buildScene(ID, "phosphor:cat", "L"), "#25e0c8", "L", ID, "u", ring);
    expect(s).toContain('<g fill="#63b2ae" opacity=".2"></g>');
  });
});

describe("uraSvg", () => {
  it("the glass highlight is stretched with the capsule", () => {
    const s = uraSvg(buildScene(ID, "phosphor:cat", "L"), "#25e0c8", "L", ID, "u", fake);
    expect(s).toContain('cx="134.7" cy="14" rx="151.6" ry="20"'); // 80 and 90 × 320/190
  });
  it("G0 round 1 tiers: off .2 / far .6 / near 1 in a 60 %-grey colour, hero pure colour with a strong glow", () => {
    const s = uraSvg(buildScene(ID, "phosphor:cat", "L"), "#25e0c8", "L", ID, "u", fake);
    expect(s).toContain('<g fill="#63b2ae" opacity=".2">');  // mix(#25e0c8 → #8c939c, .6)
    expect(s).toContain('<g fill="#63b2ae" opacity=".6">');
    expect(s).toContain('<g fill="#63b2ae" opacity="1">');
    expect(s).toContain('<g fill="#25e0c8" filter="url(#glo-u)">');
    expect(s).toContain('fill="#091e1d"');                     // field: #06080a mixed 10 % toward #25e0c8
    expect(s).toContain('stdDeviation="3"'); expect(s).toContain('<feFuncA type="linear" slope="2"/>');
  });
  it("without a sampler falls back to a glowing silhouette, not an empty capsule", () => {
    const s = uraSvg(buildScene(ID, "phosphor:cat", "S"), "#25e0c8", "S", ID, "u", null);
    expect(s).toContain("matrix("); expect(s).toContain('filter="url(#glo-u)"'); expect(s).not.toContain("<circle");
  });
});

describe("canvasSampler", () => {
  it("is null when the canvas has no 2D context (jsdom, setup.ts stubs getContext → null)", () => {
    expect(canvasSampler(buildScene(ID, "phosphor:cat", "L"))).toBeNull();
  });
  it("is null, not a throw, when getContext throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => { throw new Error("boom"); });
    expect(canvasSampler(buildScene(ID, "phosphor:cat", "L"))).toBeNull();
  });
});

describe("even-odd objects in 里", () => {
  it("the no-canvas silhouette fills even-odd", () => {
    expect(uraSvg(buildScene(ID, "fluent:panda", "S"), "#25e0c8", "S", ID, "u", null)).toContain('fill-rule="evenodd"');
    expect(uraSvg(buildScene(ID, "phosphor:cat", "S"), "#25e0c8", "S", ID, "u", null)).not.toContain("fill-rule");
  });
  it("the sampler paints the hero with the object's rule", () => {
    vi.stubGlobal("Path2D", class { constructor(public d: string) {} });
    const fills: unknown[][] = [];
    const ctx = { fillStyle: "", strokeStyle: "", lineWidth: 1, setTransform() {}, stroke() {}, fill: (...a: unknown[]) => { fills.push(a); }, getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4) }) };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    expect(canvasSampler(buildScene(ID, "fluent:panda", "S"))).not.toBeNull();
    expect(fills.at(-1)![1]).toBe("evenodd");
    canvasSampler(buildScene(ID, "phosphor:cat", "S"));
    expect(fills.at(-1)![1]).toBe("nonzero");
  });
});

describe("S level on phone cards (B2 G2 follow-up, user picked variant C)", () => {
  it("S: field mixes 25 % badge colour and off dots show at .35; M and L keep the G0 values", async () => {
    const { mix } = await import("../src/badge/geom");
    const svg = (lv: "S" | "M" | "L") => uraSvg(buildScene(ID, "phosphor:cat", lv), "#25e0c8", lv, ID, "u", fake);
    expect(svg("S")).toContain(`fill="${mix(URA.field, "#25e0c8", 0.25)}"`);
    expect(svg("S")).toContain('opacity=".35">');
    for (const lv of ["M", "L"] as const) {
      expect(svg(lv)).toContain(`fill="${mix(URA.field, "#25e0c8", 0.1)}"`);
      expect(svg(lv)).not.toContain('opacity=".35">');
    }
  });
});
