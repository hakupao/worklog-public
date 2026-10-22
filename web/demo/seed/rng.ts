// Seeded randomness: mulberry32, one stream per concern so editing one generator does not reshuffle the others.

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [a, b], both inclusive. */
  int(a: number, b: number): number;
  chance(p: number): boolean;
  pick<T>(xs: readonly T[]): T;
  weighted<T>(xs: readonly (readonly [T, number])[]): T;
  hex(n: number): string;
  uuid(): string;
}

/** FNV-1a of a label, so each stream gets a stable seed from its name. */
const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};

export function rng(label: string, seed = 20261015): Rng {
  let s = (hash(label) ^ seed) >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (a: number, b: number) => a + Math.floor(next() * (b - a + 1));
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join("");
  return {
    next, int, hex,
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    weighted: (xs) => {
      const total = xs.reduce((a, [, w]) => a + w, 0);
      let r = next() * total;
      for (const [x, w] of xs) { if ((r -= w) < 0) return x; }
      return xs[xs.length - 1][0];
    },
    uuid: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[int(0, 3)]}${hex(3)}-${hex(12)}`,
  };
}
