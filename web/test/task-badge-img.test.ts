import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadTaskBadgeImg } from "../src/ui/taskBadgeImg";

describe("taskBadgeImg (ECharts tooltip badge, #47–49)", () => {
  it("img() is null until warm resolves, then a data url for that id and world", async () => {
    const b = await loadTaskBadgeImg();
    expect(b.img("T20261001-01", "ura")).toBeNull();
    await b.warm(["T20261001-01"], "ura");
    expect(b.img("T20261001-01", "ura")).toMatch(/^data:image\//);
    expect(b.img("T20261001-01", "omote")).toBeNull();
  });
  it("has no static runtime import of badge/", () => {
    const src = readFileSync("src/ui/taskBadgeImg.ts", "utf8");
    expect(src).not.toMatch(/^(import|export)\b(?!\s+type\b)(?:[^;"']*?\bfrom\s*|\s*)["']\.\.\/badge\//m);
    expect(src).toContain('import("../badge/cache")');
  });
});
