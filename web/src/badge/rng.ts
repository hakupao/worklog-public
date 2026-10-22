/** 32-bit FNV-1a of a string: the seed every badge's randomness starts from. */
export function fnv1a(s: string): number {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
/** A small deterministic PRNG in [0,1) (prototype badge-lod.html `rng`). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return s / 4294967296; };
}
