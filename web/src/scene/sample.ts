import type { Frame } from "ascii.rest";
import type { SceneDef } from "./registry";

/** w: the glyph's weight 0..1; rgb: its palette colour. */
export type Cell = { w: number; rgb: [number, number, number] };

const W: Record<string, number> = { " ": 0, "·": 0.34, "•": 0.67, "●": 1 };
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const WHITE: [number, number, number] = [255, 255, 255];

/** One frame at `t` → the cells of rows [r0, r1). */
export function sampleFrame(def: SceneDef, frame: Frame, t: number, rows: [number, number]): { C: number; R: number; cells: Cell[] } {
  const { cols, rows: all, palette = [] } = def.meta;
  const color = new Uint8Array(cols * all);
  const txt = frame(t, { color }).split("\n");
  const pal = palette.map(hex);
  const [r0, r1] = rows, C = cols, R = r1 - r0, cells: Cell[] = new Array(C * R);
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    const sy = r0 + y, w = W[txt[sy]?.[x] ?? " "] ?? 0, rgb = pal[color[sy * cols + x]] ?? WHITE;
    cells[y * C + x] = { w, rgb };
  }
  return { C, R, cells };
}
