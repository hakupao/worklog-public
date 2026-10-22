import { normalizePrefs } from "./normalize";
import type { Prefs } from "./types";

const KEY = "wl-v2-prefs";

export function readCachedPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizePrefs(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export function writeCachedPrefs(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode / quota: the server copy still holds */ }
}
