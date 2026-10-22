import { describe, expect, it } from "vitest";
import { STRINGS } from "../src/i18n/strings";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { resolveViews, STATS_VIEW_NEEDS } from "../src/prefs/statsViews";
import { STATS_VIEWS } from "../src/prefs/types";

const ids = (r: { id: string }[]) => r.map((v) => v.id);

describe("STATS_VIEWS", () => {
  it("24 ids in the design order (spec §4)", () => {
    expect(STATS_VIEWS).toHaveLength(24);
    expect(new Set(STATS_VIEWS).size).toBe(24);
    expect([STATS_VIEWS[0], STATS_VIEWS[7], STATS_VIEWS[18], STATS_VIEWS[23]]).toEqual(["headlines", "hours24", "plans", "review"]);
    expect(DEFAULT_PREFS.stats).toEqual({ order: [...STATS_VIEWS], off: [] });
  });
  it("every view has a name and a one-line description (static: no {placeholders})", () => {
    for (const id of STATS_VIEWS) for (const k of [`sv.${id}.name`, `sv.${id}.desc`]) {
      expect(STRINGS, k).toHaveProperty([k]);
      for (const l of ["zh", "ja", "en"] as const) expect((STRINGS as Record<string, Record<string, string>>)[k][l], `${k}.${l}`).not.toMatch(/\{\w+\}/);
    }
  });
  it("needs: compute / ai hide with stats.cost, review with stats.review", () => {
    expect(STATS_VIEW_NEEDS).toEqual({ compute: "stats.cost", ai: "stats.cost", review: "stats.review" });
  });
});

describe("resolveViews", () => {
  it("missing stats = every view on, default order", () => {
    const r = resolveViews(undefined);
    expect(ids(r)).toEqual(STATS_VIEWS);
    expect(r.every((v) => v.on)).toBe(true);
  });
  it("keeps the stored order, drops unknown ids and duplicates, appends the missing ones in default order", () => {
    const r = resolveViews({ order: ["review", "gone", "dial", "review", "headlines"], off: [] });
    expect(ids(r).slice(0, 3)).toEqual(["review", "dial", "headlines"]);
    expect(ids(r).slice(3)).toEqual(STATS_VIEWS.filter((id) => !["review", "dial", "headlines"].includes(id)));
    expect(r).toHaveLength(24);
  });
  it("off turns views off wherever they sit; unknown off ids are ignored", () => {
    const r = resolveViews({ order: ["dial"], off: ["dial", "terrain", "nope"] });
    expect(r.filter((v) => !v.on).map((v) => v.id)).toEqual(["dial", "terrain"]);
    expect(r[0]).toEqual({ id: "dial", on: false });
  });
});
