// Task badges B1 (spec §3): which object and colour a new 案件 gets. Pure; server/src/badge/assign.ts does the D1 side.
import { BADGE_OBJECT_NAMES } from "./names.gen";

/** 32-bit FNV-1a — a copy of web/src/badge/rng.ts `fnv1a` (pinned by web/test/badge-server-parity.test.ts). */
export function fnv1a(s: string): number {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** LINE_PALETTE.length in web/src/ui/palette.ts (pinned by the parity test). */
export const PALETTE_SIZE = 12;

const listed = new Set(BADGE_OBJECT_NAMES);

/** How many open/hold 案件 use each object and each colour. */
export interface Usage { obj: Map<string, number>; color: number[] }
export const emptyUsage = (): Usage => ({ obj: new Map(), color: Array(PALETTE_SIZE).fill(0) });

export const isValidBadge = (obj: unknown, color: unknown): boolean =>
  typeof obj === "string" && listed.has(obj) && Number.isInteger(color) && (color as number) >= 0 && (color as number) < PALETTE_SIZE;

/** Counts one stored badge; a culled / unknown object or an out-of-range colour is not counted. */
export function countUsage(u: Usage, obj: string, color: number): void {
  if (!isValidBadge(obj, color)) return;
  u.obj.set(obj, (u.obj.get(obj) ?? 0) + 1);
  u.color[color]++;
}

/** Least-used object and colour (unused = count 0 comes first), ties broken by the id's hash. */
export function allocateBadge(id: string, u: Usage): { obj: string; color: number } {
  let min = Infinity, objs: string[] = [];
  for (const n of BADGE_OBJECT_NAMES) {
    const k = u.obj.get(n) ?? 0;
    if (k < min) { min = k; objs = [n]; } else if (k === min) objs.push(n);
  }
  const cmin = Math.min(...u.color), colors = u.color.flatMap((k, i) => (k === cmin ? [i] : []));
  return { obj: objs[fnv1a(id + "|obj") % objs.length], color: colors[fnv1a(id + "|color") % colors.length] };
}
