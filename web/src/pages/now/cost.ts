import { weekDates } from "../../predict/rules";
import type { SnapSession, Snapshot } from "../../predict/snapshot";

export interface Cost { today: number; n: number; byMachine: { name: string; usd: number }[]; week: number; partial: boolean; asOf: number | null }
const sum = (xs: SnapSession[]) => xs.reduce((n, x) => n + (x.cost ?? 0), 0);

/** AI 费用: every session active today, at its whole-session cost (a cross-day session counts in full,
 *  as the prototype's footnote says); the week the same way. */
export function costOf(s: Snapshot): Cost {
  const today = s.sessions.filter((x) => x.days.includes(s.date)), week = weekDates(s);
  const names = [...new Set([...s.machines.map((m) => m.name), ...today.map((x) => x.machine)])].sort();
  const seen = s.machines.map((m) => m.lastSeen).filter((v): v is number => v !== null);
  return {
    today: sum(today), n: today.length,
    byMachine: names.map((name) => ({ name, usd: sum(today.filter((x) => x.machine === name)) })),
    week: sum(s.sessions.filter((x) => x.days.some((d) => week.includes(d)))),
    partial: today.some((x) => x.costPartial),
    asOf: seen.length ? Math.max(...seen) : null,
  };
}
