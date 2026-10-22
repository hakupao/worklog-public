import type { TaskSil } from "../src/ui/taskGlyph";

/** 9×9 with empty edge columns: 7 lit columns × 9 rows = 63 lit cells. */
export const BOX: boolean[] = Array.from({ length: 81 }, (_, i) => i % 9 > 0 && i % 9 < 8);
/** A silhouette source for the B3b canvas tests: every task draws path `M<id>` in #3366ff; `dots` null = no 2D canvas. */
export const fakeSil = (dots: boolean[] | null = BOX): TaskSil => ({
  of: (id: string) => ({ d: `M${id}`, rule: "nonzero" as const, color: "#3366ff", box: 256 as const }),
  dots: (_id: string, n: number) => (dots ? dots.slice(0, n * n) : null),
});
