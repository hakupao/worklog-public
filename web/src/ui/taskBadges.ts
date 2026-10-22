// Task badges B1: the stored badge of every 案件 this page has seen, fed by the API client (web/src/api/client.ts)
// from every response carrying task rows. lineColor (palette.ts) and resolveBadge (badge/cache.ts) read it first.
// Must not import from ../badge/ (objects.gen.ts is 239 KB and palette.ts is on every page).
import { useSyncExternalStore } from "react";
import { LINE_PALETTE } from "./palette-data";

type Row = { id: string; badge_obj?: string | null; badge_color?: number | null };
const map = new Map<string, { obj: string | null; color: number | null }>();
const subs = new Set<() => void>();
let version = 0;

const validColor = (c: unknown): number | null =>
  Number.isInteger(c) && (c as number) >= 0 && (c as number) < LINE_PALETTE.length ? (c as number) : null;

export function noteTaskBadges(rows: readonly Row[]): void {
  let changed = false;
  for (const r of rows) {
    if (!r || typeof r !== "object" || typeof r.id !== "string") continue;   // an odd row is not a crash
    if (r.badge_obj === undefined && r.badge_color === undefined) continue;   // old server: unknown, keep what we had
    const next = { obj: typeof r.badge_obj === "string" ? r.badge_obj : null, color: validColor(r.badge_color) };
    const cur = map.get(r.id);
    if (cur && cur.obj === next.obj && cur.color === next.color) continue;
    map.set(r.id, next); changed = true;
  }
  if (changed) { version++; for (const f of subs) f(); }
}
export const taskBadgeOf = (id: string) => map.get(id);
export const taskBadgesVersion = () => version;
export function subscribeTaskBadges(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; }
/** Re-render on every registry change (B2: replaces V2App's one-time remount). */
export const useTaskBadgesVersion = () => useSyncExternalStore(subscribeTaskBadges, taskBadgesVersion, () => 0);
export function __resetTaskBadgesForTests(): void { map.clear(); subs.clear(); version = 0; }
