import type { LedFx } from "../prefs/types";
import type { Board, Dot } from "./board";
import { cl, eio, lerp } from "./ease";

export type FxDraw = (b: Board, A: Dot[], B: Dot[], u: number, ms: number, dur: number) => void;

const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const rnd = (i: number) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const HOT = "#ffe2b0";

// Fluorescent-starter curve: dark, two or three uneven flashes, then steady.
const K: [number, number][] = [[0, 0], [0.07, 0.9], [0.13, 0.06], [0.22, 0], [0.3, 0.55], [0.37, 0.12], [0.52, 1], [1, 1]];
export function flickerLevel(v: number): number {
  if (v <= 0) return 0;
  for (let i = 1; i < K.length; i++) if (v <= K[i][0]) { const [t0, a] = K[i - 1], [t1, b] = K[i]; return lerp(a, b, (v - t0) / (t1 - t0)); }
  return 1;
}

const byXY = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x - q.x || p.y - q.y;
/** Old dots to new dots, one to one in reading order; when the counts differ, proportional indexing
 *  makes one old dot feed several new ones (split) or several land on one (merge). */
export function pairDots<T extends { x: number; y: number }>(A: T[], B: T[]): [T | null, T | null][] {
  const a = A.slice().sort(byXY), c = B.slice().sort(byXY), m = Math.max(a.length, c.length), out: [T | null, T | null][] = [];
  for (let k = 0; k < m; k++) out.push([a.length ? a[Math.floor((k * a.length) / m)] : null, c.length ? c[Math.floor((k * c.length) / m)] : null]);
  return out;
}

/** Pairs dots per slot (by identity, not position): a slot on one side only — a module hidden in 表 —
 *  yields one-sided pairs, so its dots burn out (or ignite) instead of shifting every later slot. */
export function pairSlots<S, T extends { x: number; y: number }>(A: Map<S, T[]>, B: Map<S, T[]>): [T | null, T | null][] {
  const out: [T | null, T | null][] = [];
  for (const s of new Set([...A.keys(), ...B.keys()])) out.push(...pairDots(A.get(s) ?? [], B.get(s) ?? []));
  return out;
}

const DUR: Partial<Record<LedFx, number>> = { roll: 460, flicker: 1150, morph: 1000, decode: 1100 };
export function fxDuration(fx: LedFx, b: Pick<Board, "prev" | "cur" | "gd">): number {
  if (fx === "flap") return 460 + Math.max(b.prev?.nk ?? 0, b.cur?.nk ?? 0) * 34;
  if (fx === "scan" || fx === "ripple") return b.gd || 900;
  if (fx === "flicker" && b.prev && !b.prev.w) return 760;
  return DUR[fx] ?? 460;
}

export const FX: Partial<Record<LedFx, FxDraw>> = {
  flicker(b, A, Bd, u) {
    const blank = !A.length, off = (b.rc ? b.rc.top / window.innerHeight : 0) * 0.1;   // rows lag by ~0.1, one shared beat
    if (!blank && u < 0.16) { const v = u / 0.16; A.forEach((d) => b.dot(d.x, d.y, d.c, (1 - v) * (1 - v), 1, 1 + v)); return; }
    const v = blank ? u : (u - 0.36) / 0.64; if (v < 0) return;
    const I = flickerLevel(cl(v - off));
    Bd.forEach((d) => b.dot(d.x, d.y, d.c, I, 1, I > 0.95 ? 1 : 1.5));
  },
  morph(b, A, Bd, u) {
    if (!b.pd!.pairs) b.pd!.pairs = pairDots(A, Bd);
    const nx = Math.max(1, b.nx);
    for (const [a, c] of b.pd!.pairs) {
      if (a && c) {
        const v = eio(cl((u - (a.x / nx) * 0.3) / 0.7)), s = Math.sin(Math.PI * v);
        b.dot(lerp(a.x, c.x, v), lerp(a.y, c.y, v) - s * (1.5 + Math.abs(c.x - a.x) * 0.04), v < 0.5 ? a.c : c.c, 1, 1 - 0.35 * s, 1 + 0.9 * s);
      } else if (a) { const v = cl(u / 0.45); b.dot(a.x, a.y, a.c, 1 - v, 1 + 0.4 * Math.sin(Math.PI * v), 1 + v); }
      else if (c) { const v = cl((u - 0.3 - (c.x / nx) * 0.3) / 0.4); b.dot(c.x, c.y, c.c, v, 1, 2 - v); }
    }
  },
  scan(b, A, Bd, _u, ms) {
    const p = b.pitch, bar = (ms * b.v - 20 - b.rc!.left - b.offX) / p;
    const hot = (d: Dot) => { const n = Math.abs(d.x - bar); return n < 4 ? 1 - n / 4 : 0; };
    for (const d of A) if (d.x >= bar) { const h = hot(d); b.dot(d.x, d.y, h > 0.5 ? HOT : d.c, 1, 1 + h * 0.3, 1 + h * 1.5); }
    for (const d of Bd) if (d.x < bar) { const h = hot(d); b.dot(d.x, d.y, h > 0.5 ? HOT : d.c, 1, 1 + h * 0.3, 1 + h * 1.5); }
    if (bar > -2 && bar < b.nx + 2) {
      const ctx = b.ctx!, x = b.offX + bar * p, g = ctx.createLinearGradient(x - 12, 0, x + 3, 0);
      g.addColorStop(0, "rgba(255,190,90,0)"); g.addColorStop(1, "rgba(255,210,140,.45)");
      ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - 12, 0, 15, b.h);
    }
  },
  decode(b, A, Bd, u, ms) {
    const fr = Math.floor(ms / 55);
    A.forEach((d, i) => { const off = rnd(i) * 0.45; if (u < off) b.dot(d.x, d.y, d.c, u > off - 0.12 && rnd(i + fr) > 0.5 ? 0.25 : 1); });
    Bd.forEach((d, i) => {
      const lock = 0.25 + rnd(i + 999) * 0.65;
      if (u >= lock) b.dot(d.x, d.y, d.c, 1, 1, u < lock + 0.05 ? 2 : 1);
      else if (u > 0.12 && rnd(i * 7 + fr) < 0.22 * (u / lock)) b.dot(d.x, d.y, d.c, 0.55, 1, 1.5);
    });
  },
  flap(b, A, Bd, _u, ms) {
    const top = b.oy, hh = b.size * b.scale, H = hh + 2;
    const roll = (d: Dot, up: boolean) => {
      const v = eo(cl((ms - d.k * 34) / 460)), y = up ? d.y - H * v : d.y + H * (1 - v);
      if (y >= top - 0.01 && y < top + hh - 0.01) b.dot(d.x, Math.round(y), d.c);
    };
    for (const d of A) roll(d, true);
    for (const d of Bd) roll(d, false);
  },
  ripple(b, A, Bd, _u, ms) {
    const p = b.pitch, r = ms * b.v, O = b.O!, X = b.rc!.left + b.offX + p / 2, Y = b.rc!.top + b.offY + p / 2;
    const dist = (d: Dot) => Math.hypot(X + d.x * p - O.x, (Y + d.y * p - O.y) * 1.15);
    const front = (n: number) => { const q = Math.abs(n - r); return q < 22 ? 1 - q / 22 : 0; };
    for (const d of A) { const n = dist(d); if (n >= r) b.dot(d.x, d.y, d.c, 1, 1, 1 + front(n) * 0.8); }
    for (const d of Bd) { const n = dist(d); if (n < r) { const h = front(n); b.dot(d.x, d.y, h > 0.6 ? HOT : d.c, 1, 1 + h * 0.35, 1 + h * 1.6); } }
  },
};
