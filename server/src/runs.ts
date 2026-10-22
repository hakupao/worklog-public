const HOUR = 3_600_000;

/** 24 hourly slots, oldest first, the last one being the hour that contains `now`. Tokyo is a whole number of hours
 *  from UTC, so these are also JST hours. A run outside the window (or an unparseable stamp) lights nothing. */
export function hourSlots(runs: string[], now: number): boolean[] {
  const end = Math.floor(now / HOUR) * HOUR + HOUR, start = end - 24 * HOUR;
  const out = Array<boolean>(24).fill(false);
  for (const r of runs) {
    const t = Date.parse(r);
    if (Number.isFinite(t) && t >= start && t < end) out[Math.floor((t - start) / HOUR)] = true;
  }
  return out;
}
