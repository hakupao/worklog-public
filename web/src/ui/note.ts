import { useSyncExternalStore } from "react";

// The dock's 补记 panel, opened from anywhere: the dock (today), or a page for a given day (时间线's
// "＋ 补记" on the selected day). Shell renders the panel from this; null = closed.
let cur: { date: string | null } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function openNote(date: string | null = null): void { cur = { date }; emit(); }
export function closeNote(): void { if (cur) { cur = null; emit(); } }
export const useNotePanel = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => cur, () => null);
export function __resetNoteForTests(): void { cur = null; }
