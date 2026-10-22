/** Badge geometry in field units: a W×H superellipse capsule (spec §2.1, G0 round 1: ratio 3.2). W and H are the
 *  only place the size lives; field, LED grid, svg size, <img> and bitmap widths all derive from them. */
export const W = 320, H = 100;
/** Display width ÷ height. */
export const RATIO = W / H;
/** The width the landscape layouts were drawn at (B0); their absolute x positions scale by SX = W / DESIGN_W. */
export const DESIGN_W = 190;
export const SX = W / DESIGN_W;
const N = 4.2, CX = W / 2, CY = H / 2;
export const f = (n: number) => n.toFixed(1);

const capsules = new Map<number, string>();
/** The capsule outline inset by `inset` units, as an SVG path. Memoised: 180 points × 9 rings per badge was 6 % of the
 *  lab's render time (B2 profile). */
export function capsule(inset: number): string {
  const hit = capsules.get(inset);
  if (hit) return hit;
  const a = CX - 1 - inset, b = CY - 1 - inset, steps = 180;
  let d = "";
  for (let k = 0; k < steps; k++) {
    const t = (k / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    d += (k ? "L" : "M") + f(CX + a * Math.sign(c) * Math.abs(c) ** (2 / N)) + " " + f(CY + b * Math.sign(s) * Math.abs(s) ** (2 / N));
  }
  d += "Z";
  capsules.set(inset, d);
  return d;
}
/** Everything inside the rim. */
export const FIELD = capsule(7);
export const insideField = (x: number, y: number) => Math.abs((x - CX) / (CX - 8)) ** N + Math.abs((y - CY) / (CY - 8)) ** N <= 1;

export const circ = (x: number, y: number, r: number) => `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
export const poly = (pts: [number, number][]) => "M" + pts.map(([x, y]) => f(x) + " " + f(y)).join("L") + "Z";
/** A four-point sparkle. */
export const star4 = (x: number, y: number, q: number) =>
  `M${f(x)} ${f(y - q)}Q${f(x)} ${f(y)} ${f(x + q)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y + q)}Q${f(x)} ${f(y)} ${f(x - q)} ${f(y)}Q${f(x)} ${f(y)} ${f(x)} ${f(y - q)}Z`;

const long = (h: string) => (h.length === 4 ? "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h);
/** `c` moved toward `t` by `a` (0–1). Both #rgb or #rrggbb — the prototype's short-hex bug turned every mix grey. */
export function mix(c: string, t: string, a: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16), C = long(c), T = long(t);
  return "#" + [1, 3, 5].map((i) => Math.round(p(C, i) + (p(T, i) - p(C, i)) * a).toString(16).padStart(2, "0")).join("");
}
