import { capsule, f, FIELD, mix } from "./geom";
import type { Level } from "./lod";

/** Spec §2.1 diamond-cut bevel: bright bands across a tinted metal ring, six machining hairlines, a bright chamfer
 *  edge and a dark step into the field. `under` goes before the field, `over` after it.
 *  At S (≤ 24 px) the hairlines are below one device pixel and cost ~0.6 ms of SVG parse each badge; they are dropped there. */
export function rim(u: string, base: string, r: () => number, level?: Level): { defs: string; under: string; over: string } {
  const hi = mix(base, "#ffffff", 0.6), mid = mix(base, "#000000", 0.15), deep = mix(base, "#000000", 0.5), white = "#ffffff";
  const stops: [number, string][] = [[0, hi], [0.07, white], [0.1, hi], [0.22, mid], [0.38, deep], [0.47, hi], [0.5, white], [0.53, hi], [0.66, deep], [0.82, mid], [0.9, white], [0.93, hi], [1, mid]];
  const hair = [1.4, 2.3, 3.1, 4, 4.8, 5.5].map((k, j) =>
    `<path d="${capsule(k)}" fill="none" stroke="${j % 2 ? "#000000" : white}" stroke-opacity="${f(0.08 + r() * 0.18)}" stroke-width="${f(0.25 + r() * 0.3)}"/>`).join("");
  return {
    defs: `<linearGradient id="cut-${u}" x1="0" y1="0" x2="1" y2=".55">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient><clipPath id="cl-${u}"><path d="${FIELD}"/></clipPath>`,
    under: `<path d="${capsule(0)}" fill="url(#cut-${u})"/>${level === "S" ? "" : hair}<path d="${capsule(6.2)}" fill="none" stroke="${white}" stroke-opacity=".7" stroke-width=".8"/>`,
    over: `<path d="${FIELD}" fill="none" stroke="#000000" stroke-opacity=".55" stroke-width="1.2"/><path d="${capsule(0.5)}" fill="none" stroke="${white}" stroke-opacity=".35" stroke-width=".7"/>`,
  };
}
