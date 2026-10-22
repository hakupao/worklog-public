// Small text formats the hand-drawn views share (Tokyo wall clock, no host time zone).
import { DAY_MS, HOUR_MS } from "./day";

const JST = 9 * HOUR_MS;
const two = (n: number) => String(n).padStart(2, "0");

/** JST clock "HH:MM" of an instant. */
export function hm(ms: number): string {
  const m = Math.floor((((ms + JST) % DAY_MS) + DAY_MS) % DAY_MS / 60_000);
  return `${two(Math.floor(m / 60))}:${two(m % 60)}`;
}

/** Clock "HH:MM" of `h` hours after 05:00 (rounded to the minute; 24 reads 05:00). */
export function clock5(h: number): string {
  const m = (Math.round((h + 5) * 60) % 1440 + 1440) % 1440;
  return `${two(Math.floor(m / 60))}:${two(m % 60)}`;
}

/** Minutes as "2h05m". */
export function hmin(min: number): string {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}h${two(m % 60)}m`;
}

/** A share as a percentage with `d` decimals, trailing zeros kept off: 0.2667 → "27%". */
export function pct(x: number, d = 0): string {
  return `${Math.round(x * 100 * 10 ** d) / 10 ** d}%`;
}
