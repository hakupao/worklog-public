import type { World } from "../prefs/types";
import { fromOklab, oklab, type Lab, type RGB } from "./oklab";
import type { Period } from "./registry";
import type { Cell } from "./sample";

const GHOST: RGB = [255, 236, 214], BLACK: RGB = [0, 0, 0], INK: RGB = [0x0b, 0x16, 0x26];
const GHOST_A = 0.05, DIM = 0.78;
const L_PAPER = oklab([0xf4, 0xf5, 0xf7])[0];   // the 表 page paper; the plate leaves it showing between dots
const INK_L = 0.52;                              // no 表 ink is lighter than this; lighter targets print as less of it

const alphaOf = (c: Cell) => (c.w === 0 ? GHOST_A : Math.min(0.72, 0.3 + 0.7 * c.w));
/** What a cell looks like in 里, over `ground`. */
const uraLook = (c: Cell, ground: RGB): Lab => {
  const fg = c.w === 0 ? GHOST : c.rgb, a = alphaOf(c);
  return oklab([0, 1, 2].map((i) => fg[i] * a + ground[i] * (1 - a)) as RGB);
};

/** Dawn and day: the frame's 里 lightness range re-graded into [.40, .86], order kept; chroma lifted toward the bright
 *  end, and the floor pulled toward 表 ink blue so it does not print as a neutral grey. Each target is clipped to sRGB
 *  (the lifted chroma can leave the gamut). A frame with no range prints at the light end, never as a solid block. */
function light(look: Lab[]): Lab[] {
  let lo = 1, hi = 0;
  for (const [L] of look) { lo = Math.min(lo, L); hi = Math.max(hi, L); }
  return look.map(([L, a, b]) => {
    const t = hi - lo > 1e-6 ? (L - lo) / (hi - lo) : 1, k = 1.35 + 0.9 * t, f = (1 - t) * (1 - t);
    return oklab(fromOklab([0.4 + 0.46 * t, a * k - 0.012 * f, b * k - 0.06 * f]));
  });
}

/** A target printed as an ink (lightness ≤ .52, chroma lifted) and the dot radius (in pitches, at most 1/√π ≈ .56) of
 *  the coverage that ink needs on paper to reach the target's lightness; 0 when there is no ink to print. */
function print([L, a, b]: Lab): [number, string] {
  const li = Math.min(L, INK_L), span = L_PAPER - li;
  const cov = L <= li ? 1 : Math.max(0, Math.min(1, (L_PAPER - L) / span));
  const lift = 1 + (0.5 * (L - li)) / Math.max(0.01, span), [r, g, bl] = fromOklab([li, a * lift, b * lift]);
  return [Math.sqrt(cov / Math.PI), `rgb(${r},${g},${bl})`];
}

/** One sampled frame onto a 2D context, `pitch` css px per dot (the caller owns size and transform).
 *  里: each cell in its palette colour at alpha min(.72, .3+.7w), empty cells a ghost at .05, on the black board.
 *  表: a colour AM halftone on the page's paper. Each cell's target is what 里 shows — over 表 deep ink for dusk and
 *  night (deep), re-graded light for dawn and day — printed by print(): light areas are small dots on paper, dark ones
 *  dots that close up. No ground is painted, so there is no plate edge.
 *  dim (alert): 里 alpha x .78; 表 is paper and does not dim. */
export function drawScene(ctx: CanvasRenderingContext2D, s: { C: number; R: number; cells: Cell[] }, world: World, pitch: number, dim: boolean, period: Period): void {
  const { C, R, cells } = s, k = dim ? DIM : 1;
  ctx.clearRect(0, 0, C * pitch, R * pitch);
  const dot = (i: number, rad: number, fill: string) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc((i % C) * pitch + pitch / 2, Math.floor(i / C) * pitch + pitch / 2, rad, 0, Math.PI * 2); ctx.fill();
  };
  if (world === "ura") {
    cells.forEach((c, i) => {
      const [r, g, b] = c.w === 0 ? GHOST : c.rgb;
      dot(i, pitch * 0.36, `rgba(${r},${g},${b},${alphaOf(c) * k})`);
    });
    return;
  }
  // a cell's print depends only on its colour and weight (and, by day, the frame's range): work out each pair once
  const seen = new Map<string, number>(), uniq: Cell[] = [];
  const idx = cells.map((c) => {
    const key = `${c.rgb}|${c.w}`;
    let n = seen.get(key);
    if (n === undefined) { n = uniq.length; seen.set(key, n); uniq.push(c); }
    return n;
  });
  const deep = period === "dusk" || period === "night";
  const inks = (deep ? uniq.map((c) => uraLook(c, INK)) : light(uniq.map((c) => uraLook(c, BLACK)))).map(print);
  idx.forEach((n, i) => {
    const [rad, fill] = inks[n];
    if (pitch * rad >= 0.3) dot(i, pitch * rad, fill);
  });
}
