import type { Item } from "./biomes";
import { f, FIELD, mix } from "./geom";
import type { Level } from "./lod";
import { rim } from "./rim";
import { fnv1a, rng } from "./rng";
import type { Scene } from "./scene";

const OP = { bg: "0.42", acc: "0.75", hero: "1" } as const;

/** Sand grain strength (G0 round 1): scales the speckle's alpha row of the sand filter. */
const GRAIN = 0.4;

/** 表 world, spec §2.4 ①: sandblasted dark field, die-struck relief, diamond-cut rim. The lighting filter (the
 *  costly part, invisible when small) runs only at L; S/M get a gradient + drop shadow. */
export function omoteSvg(scene: Scene, color: string, level: Level, id: string, u: string): string {
  const r = rng(fnv1a(id + "|rim")), rm = rim(u, color, r, level);
  const hi = mix(color, "#ffffff", 0.55), mid = mix(color, "#000000", 0.18), fm = mix(color, "#000000", 0.72), lit = level === "L";
  const relief = lit ? ` filter="url(#emb-${u})"` : "";
  const item = (it: Item) => {
    const tf = it.mat ? ` transform="matrix(${it.mat.join(" ")})"` : "", st = it.mode === "stroke", fr = it.rule ? ` fill-rule="${it.rule}"` : "";
    const ko = it.tier === "hero" && it.mat ? `<path class="ko" d="${it.d}"${fr} fill="${fm}" stroke="${fm}" stroke-width="${f(7 / Math.abs(it.mat[0]))}" stroke-linejoin="round"/>` : "";
    const shade = st ? `fill="none" stroke="#000000" stroke-width="${it.w}"` : `fill="#000000"${fr}`;
    const paint = st ? `fill="none" stroke="url(#rel-${u})" stroke-width="${it.w}"` : `fill="url(#rel-${u})"${fr}`;
    return `<g${tf} opacity="${OP[it.tier]}">${ko}<path d="${it.d}" ${shade} opacity=".6" filter="url(#sink-${u})"/><path d="${it.d}" ${paint}${relief}/></g>`;
  };
  const emb = lit ? `<filter id="emb-${u}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="b"/><feSpecularLighting in="b" surfaceScale="3.5" specularConstant=".95" specularExponent="18" lighting-color="#ffffff" result="s"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting><feComposite in="s" in2="SourceAlpha" operator="in" result="s2"/><feComposite in="SourceGraphic" in2="s2" operator="arithmetic" k2="1" k3=".8"/></filter>` : "";
  return `<defs>${rm.defs}
<linearGradient id="rel-${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset=".6" stop-color="${color}"/><stop offset="1" stop-color="${mid}"/></linearGradient>${emb}
<filter id="sink-${u}" x="-10%" y="-10%" width="130%" height="130%"><feOffset dx="1.2" dy="1.5"/><feGaussianBlur stdDeviation="1"/></filter>
<radialGradient id="fld-${u}" cx=".35" cy=".25" r="1"><stop offset="0" stop-color="${mix(color, "#000000", 0.58)}"/><stop offset="1" stop-color="${mix(color, "#000000", 0.86)}"/></radialGradient>
<filter id="sand-${u}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="2" seed="${fnv1a(id) % 97}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${(1.1 * GRAIN).toFixed(3)} 0 0 0 ${(-0.6 * GRAIN).toFixed(3)}" result="sp"/><feComposite in="sp" in2="SourceAlpha" operator="in" result="sp2"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sp2"/></feMerge></filter></defs>
${rm.under}<g clip-path="url(#cl-${u})"><path d="${FIELD}" fill="url(#fld-${u})" filter="url(#sand-${u})"/>${scene.items.map(item).join("")}</g>${rm.over}`;
}
