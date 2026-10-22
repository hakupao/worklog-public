import { svgPathBbox } from "svg-path-bbox";
import { describe, expect, it } from "vitest";
import { CULLED } from "../src/badge/culled";
import { OBJECTS } from "../src/badge/objects.gen";
import { BADGE_OBJECTS, OBJECT_BOX, isBadgeObject, objectFillRule, objectPath, objectSource, pickFallbackObject } from "../src/badge/objects";

const of = (p: string) => BADGE_OBJECTS.filter((n) => n.startsWith(p));

describe("badge objects", () => {
  it("two sources, every name namespaced, every name has a path", () => {
    expect(OBJECT_BOX).toBe(256);
    expect(of("phosphor:")).toHaveLength(83);
    expect(of("fluent:")).toHaveLength(114);
    expect(BADGE_OBJECTS).toHaveLength(83 + 114);
    for (const n of BADGE_OBJECTS) expect(objectPath(n), n).toMatch(/^M[\d.]/);
  });
  it("names are unique; the same name in both libraries is two objects", () => {
    expect(new Set(BADGE_OBJECTS).size).toBe(BADGE_OBJECTS.length);
    for (const n of ["cat", "dog", "rocket", "ghost"]) {
      expect(objectPath(`phosphor:${n}`), n).toBeTruthy();
      expect(objectPath(`fluent:${n}`), n).toBeTruthy();
      expect(objectPath(`phosphor:${n}`)).not.toBe(objectPath(`fluent:${n}`));
    }
  });
  it("bare (pre-namespace) and unknown names have no path", () => {
    for (const n of ["cat", "no-such-thing", "phosphor:", "fluent:no-such"]) expect(objectPath(n), n).toBeNull();
  });
  it("prototype keys are not objects", () => { for (const n of ["constructor", "toString", "__proto__"]) expect(objectPath(n), n).toBeNull(); });
  it("Fluent glyphs are fitted to 224 and centred in the 256 box", () => {
    for (const n of of("fluent:")) {
      const [x0, y0, x1, y1] = svgPathBbox(objectPath(n)!);
      expect(Math.abs(Math.max(x1 - x0, y1 - y0) - 224), n).toBeLessThanOrEqual(2); // arcs: bbox of curves vs fitted box (controller ruling, preflight)
      expect(Math.abs((x0 + x1) / 2 - 128), n).toBeLessThanOrEqual(1.5);
      expect(Math.abs((y0 + y1) / 2 - 128), n).toBeLessThanOrEqual(1.5);
    }
  });
  it("exactly the five known Fluent glyphs fill even-odd; everything else nonzero", () => {
    expect(BADGE_OBJECTS.filter((n) => objectFillRule(n) === "evenodd")).toEqual(["fluent:panda", "fluent:dog-face", "fluent:jellyfish", "fluent:cherries", "fluent:castle"]);
    expect(objectFillRule("no-such")).toBe("nonzero");
  });
  it("the fallback pick is stable and always a listed object", () => {
    for (const s of [0, 1, 7, 2 ** 31, 4294967295]) {
      expect(BADGE_OBJECTS).toContain(pickFallbackObject(s));
      expect(pickFallbackObject(s)).toBe(pickFallbackObject(s));
    }
  });
  it("nothing is culled yet; membership and source follow the name", () => {
    for (const n of BADGE_OBJECTS) expect(isBadgeObject(n), n).toBe(true);
    for (const n of ["cat", "__proto__", "constructor"]) expect(isBadgeObject(n), n).toBe(false);
    expect(objectSource("fluent:panda")).toBe("fluent");
    expect(objectSource("phosphor:cat")).toBe("phosphor");
  });
  it("the list is never empty", () => { expect(BADGE_OBJECTS.length).toBeGreaterThan(0); });
  it("every CULLED name is a generated object", () => { for (const n of CULLED) expect(Object.hasOwn(OBJECTS, n), n).toBe(true); });
  it("a name without a source prefix has no source", () => { for (const n of ["phosphorx", "fluent", "cat", "x:cat"]) expect(objectSource(n), n).toBeNull(); });
});
