import { describe, expect, it, vi } from "vitest";
import { resolveBadge } from "../src/badge/cache";
import { BADGE_OBJECTS, isBadgeObject, objectPath } from "../src/badge/objects";

// What G0 round 2 will do: paste culled names into CULLED. vi.mock is hoisted above the imports.
vi.mock("../src/badge/culled", () => ({ CULLED: ["phosphor:cat"] }));

describe("a culled object", () => {
  it("leaves the list but keeps its path", () => {
    expect(BADGE_OBJECTS).not.toContain("phosphor:cat");
    expect(isBadgeObject("phosphor:cat")).toBe(false);
    expect(objectPath("phosphor:cat")).toMatch(/^M/);
    expect(isBadgeObject("fluent:cat")).toBe(true);
  });
  it("a stored badge naming it falls back to a listed object with a path (never an empty capsule)", () => {
    const r = resolveBadge({ id: "T20261001-01", obj: "phosphor:cat", color: 3 });
    expect(r.obj).not.toBe("phosphor:cat");
    expect(BADGE_OBJECTS).toContain(r.obj);
    expect(objectPath(r.obj)).toMatch(/^M/);
    expect(resolveBadge({ id: "T20261001-01", obj: "fluent:cat" }).obj).toBe("fluent:cat");
  });
});
