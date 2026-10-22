import { describe, expect, it } from "vitest";
import { omoteSvg } from "../src/badge/omote";
import { rim } from "../src/badge/rim";
import { rng } from "../src/badge/rng";
import { buildScene } from "../src/badge/scene";

const ID = "T20261001-01";
describe("rim", () => {
  it("is tinted by the base colour and has six tool-mark hairlines", () => {
    const x = rim("a", "#25e0c8", rng(1));
    expect(x.defs).toContain('id="cut-a"');
    expect(x.under.match(/stroke-opacity/g)!.length).toBeGreaterThanOrEqual(7);
    expect(x.defs.toLowerCase()).toContain("#ffffff");
  });
  it("drops the six hairlines at S only, and consumes the same random numbers either way", () => {
    const rS = rng(7), rL = rng(7);
    const s = rim("u", "#ff8800", rS, "S"), l = rim("u", "#ff8800", rL, "L");
    const hairs = (x: string) => (x.match(/stroke-opacity="0\.\d+" stroke-width/g) ?? []).length;
    expect(hairs(l.under)).toBe(6);
    expect(hairs(s.under)).toBe(0);
    expect(rS()).toBe(rL());               // both consumed 12 numbers
    expect(rim("u", "#ff8800", rng(7)).under).toBe(l.under);   // no level = full rim, as before
  });
});
describe("omoteSvg", () => {
  it("an even-odd hero keeps its holes: knockout, shade and relief all fill even-odd", () => {
    const count = (s: string) => s.split('fill-rule="evenodd"').length - 1;
    for (const l of ["S", "L"] as const) {
      expect(count(omoteSvg(buildScene(ID, "fluent:panda", l), "#25e0c8", l, ID, "u")), l).toBe(3);
      expect(count(omoteSvg(buildScene(ID, "phosphor:cat", l), "#25e0c8", l, ID, "u")), l).toBe(0);
    }
  });
  it("uses the lighting filter only at L", () => {
    for (const l of ["S", "M"] as const) expect(omoteSvg(buildScene(ID, "phosphor:cat", l), "#25e0c8", l, ID, "u")).not.toContain("feSpecularLighting");
    expect(omoteSvg(buildScene(ID, "phosphor:cat", "L"), "#25e0c8", "L", ID, "u")).toContain("feSpecularLighting");
  });
  it("draws far 0.42, near 0.75, hero 1 and a knockout under the hero", () => {
    const s = omoteSvg(buildScene(ID, "phosphor:cat", "L"), "#25e0c8", "L", ID, "u");
    expect(s).toContain('opacity="0.42"'); expect(s).toContain('opacity="0.75"'); expect(s).toContain('class="ko"');
  });
  it("sand grain at strength 0.4; the hero keeps its knockout ring in 表", () => {
    const s = omoteSvg(buildScene(ID, "phosphor:cat", "M"), "#25e0c8", "M", ID, "u");
    expect(s).toContain('values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0.440 0 0 0 -0.240"');
    expect(s).toContain('class="ko"');
  });
  it("clips the scene to the field and keeps ids unique by suffix", () => {
    const s = omoteSvg(buildScene(ID, "phosphor:cat", "M"), "#ff6a2e", "M", ID, "q7");
    expect(s).toContain('clip-path="url(#cl-q7)"'); expect(s).not.toMatch(/id="[a-z]+"(?!-)/);
  });
  it("is deterministic", () => {
    const a = omoteSvg(buildScene(ID, "phosphor:cat", "L"), "#25e0c8", "L", ID, "u");
    expect(omoteSvg(buildScene(ID, "phosphor:cat", "L"), "#25e0c8", "L", ID, "u")).toBe(a);
  });
});
