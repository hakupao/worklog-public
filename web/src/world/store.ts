import { useSyncExternalStore } from "react";
import type { World } from "../prefs/types";

let current: World = "ura";
const subs = new Set<() => void>();

export const getWorld = () => current;
export function applyWorld(w: World): void {
  document.documentElement.dataset.world = w;
  if (w === current) return;
  current = w;
  subs.forEach((f) => f());
  document.dispatchEvent(new CustomEvent("worldchange", { detail: w }));
}
export function subscribeWorld(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export const useWorld = () => useSyncExternalStore(subscribeWorld, getWorld, () => "ura" as World);
export function resetWorldStore() { current = "ura"; delete document.documentElement.dataset.world; }
