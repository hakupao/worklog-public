// The collectors' own traces: a week of harvest runs per machine (macmini every 15 minutes around the clock, win11
// hourly while the PC is on) and each machine's last collection just before DEMO_NOW. SQL: the heartbeat and ingest
// routes stamp the server's "now", which would put every run at DEMO_NOW.
import { TODAY, addDays, iso, isWorkday, jstMs } from "./calendar";
import { rng } from "./rng";
import type { SessionRec } from "./sessions";
import type { MachineKey, SeedCtx } from "./types";
import { MACHINES } from "./world";

/** The last collection of each machine (macmini's tiered :04/:19/:34/:49 run, win11's hourly one). */
export const LAST_RUN: Record<MachineKey, number> = {
  mac: jstMs(TODAY, 15 * 60 + 19, 12),
  win: jstMs(TODAY, 15 * 60, 35),
};

export async function seedRuns(ctx: SeedCtx, recs: SessionRec[]): Promise<number> {
  const R = rng("runs");
  let n = 0;
  for (const m of ["mac", "win"] as MachineKey[]) {
    const mine = recs.filter((r) => r.machine === m).map((r) => ({ s: r.startMs, e: r.endMs }));
    const runs: number[] = [];
    for (let d = addDays(TODAY, -7); d <= TODAY; d = addDays(d, 1)) {
      if (m === "mac") for (let k = 0; k < 96; k++) runs.push(jstMs(d, 4 + k * 15, R.int(5, 40)));
      else if (isWorkday(d)) for (let h = 8; h <= 20; h++) runs.push(jstMs(d, h * 60, R.int(20, 45)));
    }
    const all = runs.filter((x) => x < LAST_RUN[m] - 60_000).concat([LAST_RUN[m]]);
    let prev = all[0] - 15 * 60_000;
    for (const at of all) {
      const added = mine.filter((x) => x.s > prev && x.s <= at).length;
      const updated = mine.filter((x) => x.s <= prev && x.e > prev).length;
      await ctx.sql("INSERT OR IGNORE INTO harvest_runs (machine, at, new, updated) VALUES (?1, ?2, ?3, ?4)", MACHINES[m], iso(at), added, updated);
      prev = at; n++;
    }
    await ctx.sql(`INSERT INTO machines (name, last_seen_at) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      MACHINES[m], iso(LAST_RUN[m]));
  }
  return n;
}
