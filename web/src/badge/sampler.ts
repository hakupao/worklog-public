import type { Tier } from "./biomes";
import { H, W } from "./geom";
import type { Scene } from "./scene";
import type { Sampler } from "./ura";

const CODE: Record<Tier, string> = { bg: "#00ff00", acc: "#0000ff", hero: "#ff0000" };

/** Browser seam #1: paint the scene's layers in three code colours on a W×H canvas, then read which layer is
 *  under a point (hero wins: it is painted last). Null when there is no 2D canvas — the renderer falls back. */
export function canvasSampler(scene: Scene): Sampler | null {
  try {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    if (!cx) return null;
    for (const it of scene.items) {
      cx.setTransform(...(it.mat ?? [1, 0, 0, 1, 0, 0]));
      const p = new Path2D(it.d);
      if (it.mode === "stroke") { cx.strokeStyle = CODE[it.tier]; cx.lineWidth = (it.w ?? 1) * 1.6; cx.stroke(p); }
      else { cx.fillStyle = CODE[it.tier]; cx.fill(p, it.rule ?? "nonzero"); }
    }
    const px = cx.getImageData(0, 0, W, H).data;
    return (x, y) => {
      const o = (Math.floor(y) * W + Math.floor(x)) * 4;
      return px[o] > 128 ? "hero" : px[o + 2] > 128 ? "acc" : px[o + 1] > 128 ? "bg" : null;
    };
  } catch { return null; }
}
