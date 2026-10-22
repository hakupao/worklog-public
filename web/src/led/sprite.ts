export const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const hexRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const sprites = new Map<string, { c: HTMLCanvasElement; s: number }>();

/** One lit LED (radius r, glow 0..~2) pre-rendered once per colour/size/glow and stamped with drawImage. The glow is
 *  kept to steps of .05, so a glow that follows a continuous value (the relief's height) shares a few sprites. */
export function sprite(color: string, r: number, glow0: number): { c: HTMLCanvasElement; s: number } | null {
  const glow = Math.round(glow0 * 20) / 20, D = dpr(), key = `${color}${r.toFixed(2)}${glow}${D}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const s = Math.ceil(r * (1 + glow * 2.2) * 2) + 2, c = document.createElement("canvas");
  c.width = c.height = Math.ceil(s * D);
  const x = c.getContext("2d");
  if (!x) return null;
  x.scale(D, D);
  const [R, G, B] = hexRgb(color), m = s / 2;
  if (glow > 0) {
    const h = x.createRadialGradient(m, m, r * 0.5, m, m, s / 2);
    h.addColorStop(0, `rgba(${R},${G},${B},${0.38 * glow})`); h.addColorStop(0.5, `rgba(${R},${G},${B},${0.1 * glow})`); h.addColorStop(1, `rgba(${R},${G},${B},0)`);
    x.fillStyle = h; x.fillRect(0, 0, s, s);
  }
  const g = x.createRadialGradient(m - r * 0.3, m - r * 0.3, 0, m, m, r);
  g.addColorStop(0, `rgb(${Math.min(255, R + 140)},${Math.min(255, G + 130)},${Math.min(255, B + 110)})`);
  g.addColorStop(0.55, color); g.addColorStop(1, `rgba(${(R * 0.7) | 0},${(G * 0.7) | 0},${(B * 0.7) | 0},.75)`);
  x.fillStyle = g; x.beginPath(); x.arc(m, m, r, 0, 6.2832); x.fill();
  const o = { c, s };
  sprites.set(key, o);
  return o;
}
