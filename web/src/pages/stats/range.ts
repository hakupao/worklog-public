export type Preset = "day" | "week" | "month" | "4w" | "3m";
export const PRESETS: { key: Preset; label: string }[] = [
  { key: "day", label: "今天" }, { key: "week", label: "本周" }, { key: "month", label: "本月" },
  { key: "4w", label: "近 4 周" }, { key: "3m", label: "近 3 个月" },
];

const DAY = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7));
/** First day of the month `n` months before the one `date` is in (n = 0 is that month). */
const monthStart = (date: string, n: number) => {
  const d = new Date(date + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
};

/** `today` is the Tokyo calendar date (lib/jst.ts todayJst()). */
export function presetRange(preset: Preset, today: string): { from: string; to: string } {
  return rangeAt(preset, 0, today);
}

const ROLLING: Partial<Record<Preset, number>> = { day: 1, "4w": 28, "3m": 90 };

/** The range `offset` steps before the preset's current one (offset 0 = presetRange). The current
 *  week and month end today; earlier ones are whole (Mon–Sun, 1st–last). Rolling presets step by
 *  their own length so pages are back to back. `to` never passes today, since offset is >= 0. */
export function rangeAt(preset: Preset, offset: number, today: string): { from: string; to: string } {
  switch (preset) {
    case "week": {
      if (offset === 0) return { from: mondayOf(today), to: today };
      const from = addDays(mondayOf(today), -7 * offset);
      return { from, to: addDays(from, 6) };
    }
    case "month": {
      if (offset === 0) return { from: monthStart(today, 0), to: today };
      const from = monthStart(today, offset);
      return { from, to: addDays(monthStart(today, offset - 1), -1) };
    }
    default: {
      const len = ROLLING[preset]!;
      const to = addDays(today, -len * offset);
      return { from: addDays(to, -(len - 1)), to };
    }
  }
}

export function delta(cur: number, prev: number): { text: string; dir: "up" | "down" | "flat" | "new" } {
  if (prev === 0) return cur === 0 ? { text: "—", dir: "flat" } : { text: "新", dir: "new" };
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return { text: "0%", dir: "flat" };
  return { text: `${p > 0 ? "+" : ""}${p}%`, dir: p > 0 ? "up" : "down" };
}
