import { disc, lit } from "../../chart/canvas";
import { bits, type Bitmap } from "../../led/bits";
import type { PixelSize } from "../../led/fonts";
import { PITCH } from "../../led/lattice";
import type { Glyph } from "../../prefs/types";
import { C } from "../../ui/palette";

// 时段分布 (prototype page-stats.html heat()): the 7×24 matrix (Monday first × hour 0–23, minutes), one cell per
// hour, brightness by minutes against the busiest hour; the cells take the slot's whole width. 里: a cluster of
// LED dots per cell on the page's PITCH lattice, dot-glyph labels; 表: printed cells in ink, body-font labels.

const P = PITCH;
const TICKS = [0, 6, 12, 18, 23];
const BAND = 11;           // 里: rows under the grid for the hour ticks (8px glyphs + gap)
const LW_PX = 30, BAND_PX = 16;
const level = (v: number, mx: number) => Math.pow(v / mx, 0.8);

/** Where the cells were drawn (px from the canvas's top left): hour h of weekday d starts at x0 + h·cw, y0 + d·ch. */
export interface HeatGeom { x0: number; y0: number; cw: number; ch: number }
type BitsFn = (text: string, size: PixelSize, glyph: Glyph) => Bitmap;

/** [weekday 0–6 (Monday first), hour 0–23] under the point, or null off the grid. */
export function heatAt(g: HeatGeom, px: number, py: number): [number, number] | null {
  const h = Math.floor((px - g.x0) / g.cw), d = Math.floor((py - g.y0) / g.ch);
  return h >= 0 && h < 24 && d >= 0 && d < 7 ? [d, h] : null;
}

/** `labels`: the seven weekday names, `size` their glyph size (8 for Latin, 10 for CJK). */
export function drawHeatUra(x: CanvasRenderingContext2D, grid: number[][], labels: string[], g: { w: number; h: number; offX: number; offY: number },
  glyph: Glyph, size: PixelSize, bitsFn: BitsFn = bits): HeatGeom {
  x.clearRect(0, 0, g.w, g.h);
  const nx = Math.floor((g.w - g.offX) / P), ny = Math.floor((g.h - g.offY) / P);
  const lb = labels.map((s) => bitsFn(s, size, glyph)), lw = Math.max(0, ...lb.map((b) => b.w)) + 2;
  // fractional steps so the cells take the whole slot, one dot apart: dot i belongs to the cell its centre falls
  // in (what heatAt reads), so cell k starts on the first dot whose centre is past k · step
  const sx = Math.max(2, (nx - lw) / 24), sy = Math.max(2, (ny - BAND) / 7), at = (k: number, s: number) => Math.max(0, Math.ceil(k * s - 0.5));
  const mx = Math.max(1, ...grid.flat());
  const px = (i: number) => g.offX + i * P + P / 2, py = (j: number) => g.offY + j * P + P / 2;
  const glyphAt = (b: Bitmap, i0: number, j0: number, a: number) => {
    x.save(); x.globalAlpha = a;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) if (b.on[j * b.w + i]) lit(x, px(i0 + i), py(j0 + j), P * 0.4, C.AMBER, 0.25);
    x.restore();
  };
  grid.forEach((row, d) => {
    const y0 = at(d, sy), rh = at(d + 1, sy) - y0 - 1;
    glyphAt(lb[d], 0, Math.max(0, y0 + Math.floor((rh - size) / 2)), d >= 5 ? 0.32 : 0.5);
    row.forEach((v, h) => {
      const x0 = lw + at(h, sx), cw = lw + at(h + 1, sx) - x0 - 1;
      const k = v > 0 ? level(v, mx) : 0, glow = Math.round((0.15 + 0.7 * k) * 4) / 4;
      x.save(); x.globalAlpha = v > 0 ? 0.14 + 0.86 * k : 1;
      for (let i = 0; i < cw; i++) for (let j = 0; j < rh; j++) {
        const cx = px(x0 + i), cy = py(y0 + j);
        if (v > 0) lit(x, cx, cy, P * 0.4, C.AMBER, glow);
        else disc(x, cx, cy, P * 0.3, "rgba(255,236,214,.05)");
      }
      x.restore();
    });
  });
  for (const h of TICKS) {
    const b = bitsFn(String(h), 8, glyph);
    glyphAt(b, Math.min(lw + at(h, sx), nx - b.w), at(7, sy) + 2, 0.45);      // 23 stays inside the right edge
  }
  return { x0: g.offX + lw * P, y0: g.offY, cw: sx * P, ch: sy * P };
}

export function drawHeatOmote(x: CanvasRenderingContext2D, grid: number[][], labels: string[], g: { w: number; h: number }, font: (weight: number) => string): HeatGeom {
  x.clearRect(0, 0, g.w, g.h);
  const cw = (g.w - LW_PX) / 24, ch = (g.h - BAND_PX) / 7, mx = Math.max(1, ...grid.flat());
  x.font = font(400); x.textAlign = "left"; x.textBaseline = "alphabetic";
  grid.forEach((row, d) => {
    x.fillStyle = d >= 5 ? "#97a1ae" : "#5b6573";
    x.fillText(labels[d] ?? "", 0, d * ch + ch / 2 + 4);
    row.forEach((v, h) => {
      x.fillStyle = v > 0 ? `rgba(15,28,46,${(0.08 + 0.86 * level(v, mx)).toFixed(3)})` : "rgba(15,28,46,.035)";
      x.fillRect(LW_PX + h * cw, d * ch, Math.max(1, cw - 2), Math.max(1, ch - 2));
    });
  });
  x.fillStyle = "#5b6573";
  for (const h of TICKS) x.fillText(String(h), LW_PX + h * cw, g.h - 2);
  return { x0: LW_PX, y0: 0, cw, ch };
}
