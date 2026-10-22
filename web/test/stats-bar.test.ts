import { describe, expect, it } from "vitest";
import { drawBarOmote } from "../src/pages/stats/bar";
import { barColor } from "../src/pages/stats/ListBar";
import { C } from "../src/ui/palette";
import { rec } from "./canvas-rec";

describe("统计 list bar (表)", () => {
  it("a printed bar in the given colour on a hairline track, rows × 3px tall, centred", () => {
    const { ctx, calls } = rec();
    drawBarOmote(ctx, 0.25, "#25e0c8", { w: 80, h: 15 }, 3);
    expect(calls.filter((c) => c.op === "fillRect").map((r) => [r.fill, ...r.args])).toEqual([
      ["rgba(15,28,46,.08)", 0, 7, 80, 1],
      ["#25e0c8", 0, 3, 20, 9],
    ]);
    expect(calls.some((c) => c.op === "arc")).toBe(false);
  });
  it("a zero share draws only the track; frac is clamped", () => {
    const a = rec();
    drawBarOmote(a.ctx, 0, "#0f1c2e", { w: 80, h: 15 }, 3);
    expect(a.calls.filter((c) => c.op === "fillRect")).toHaveLength(1);
    const b = rec();
    drawBarOmote(b.ctx, 4, "#0f1c2e", { w: 80, h: 15 }, 3);
    expect(b.calls.filter((c) => c.op === "fillRect")[1].args[2]).toBe(80);
  });
});

describe("ListBar colour", () => {
  it("里 warm highlight → 表 teal accent (a pale peach bar on paper read as missing, shots 7b); task colours and the defaults kept", () => {
    expect(barColor("omote", C.WARM)).toBe("#0e7c86");
    expect(barColor("ura", C.WARM)).toBe(C.WARM);
    expect(barColor("omote", "#25e0c8")).toBe("#25e0c8");
    expect(barColor("omote", undefined)).toBe("#0f1c2e");
    expect(barColor("ura", undefined)).toBe(C.AMBER);
  });
});
