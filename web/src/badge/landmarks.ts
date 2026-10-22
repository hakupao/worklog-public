import { poly } from "./geom";

/** Hand-drawn far-layer silhouettes (spec §2.2, D9), 100-unit box, standing on y = 100. Detail is deliberately low:
 *  they only ever appear behind the hero at M (as the far layer) and L. */
export type LandmarkName = "fuji" | "fujiCap" | "pagoda" | "castle" | "tower" | "torii" | "house";

const pagoda = () => {
  let d = poly([[49, 2], [51, 2], [51, 22], [49, 22]]);
  for (let k = 0; k < 5; k++) {
    const y = 100 - k * 15, bw = 13 - k * 1.6, rw = 30 - k * 4;
    d += poly([[50 - bw, y], [50 + bw, y], [50 + bw, y - 9], [50 - bw, y - 9]]);
    d += poly([[50 - rw, y - 9], [50 + rw, y - 9], [50 + rw - 7, y - 15], [50 - rw + 7, y - 15]]);
  }
  return d;
};
const castle = () =>
  poly([[12, 100], [88, 100], [80, 74], [20, 74]]) +
  [[60, 74, 14], [46, 58, 12], [34, 44, 10]].map(([w, y, h]) =>
    poly([[50 - w / 2 + 6, y], [50 + w / 2 - 6, y], [50 + w / 2 - 6, y - h + 5], [50 - w / 2 + 6, y - h + 5]]) +
    poly([[50 - w / 2, y - h + 5], [50 + w / 2, y - h + 5], [50 + w / 4, y - h], [50 - w / 4, y - h]])).join("") +
  poly([[44, 30], [56, 30], [50, 20]]);

export const LANDMARKS: Record<LandmarkName, string> = {
  fuji: "M0 100L34 38Q42 30 50 30Q58 30 66 38L100 100Z",
  fujiCap: "M34 38Q42 30 50 30Q58 30 66 38L61 46L55 41L49 48L43 41L37 45Z",
  pagoda: pagoda(),
  castle: castle(),
  tower: poly([[28, 100], [38, 100], [47, 40], [53, 40], [62, 100], [72, 100], [54, 18], [51, 0], [49, 0], [46, 18]]) +
    poly([[38, 58], [62, 58], [62, 54], [38, 54]]) + poly([[44, 32], [56, 32], [56, 28], [44, 28]]),
  torii: poly([[6, 22], [94, 22], [90, 30], [10, 30]]) + poly([[18, 40], [82, 40], [82, 46], [18, 46]]) +
    poly([[27, 30], [35, 30], [36, 100], [26, 100]]) + poly([[65, 30], [73, 30], [74, 100], [64, 100]]),
  house: poly([[10, 100], [90, 100], [90, 64], [10, 64]]) + poly([[2, 66], [98, 66], [70, 40], [30, 40]]),
};
