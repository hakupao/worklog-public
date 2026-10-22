import holiday_jp from "@holiday-jp/holiday_jp";
import { addDays, daysBetween, weekdayOfDate } from "../predict/dates";
import type { Break, CalCfg, Lang } from "../prefs/types";
import { holidayLabel, holidayZh } from "./holidays";

export { periodOf, sunTimes } from "./sun";

export type { Break, CalCfg };
export type Countdown = {
  kind: "payday" | "weekend" | "monthEnd" | "holiday" | "break"; date: string; days: number; biz: number;
  name?: { ja: string; zh: string; en: string }; moved?: boolean; len?: number;
};
export type DayCell = { date: string; d: number; dow: number; off: boolean; holiday: string | null; today: boolean; future: boolean };
export type Calendar = {
  isOff(date: string): boolean;
  holidayName(date: string, lang: Lang): string | null;
  bizOfMonth(today: string): { index: number; total: number; left: number };
  countdowns(today: string): Countdown[];
  monthGrid(today: string): (DayCell | null)[][];
  ephemeris(today: string): { isoWeek: number; fy: number; fq: number; wareki: string };
};

const SCAN_LIMIT = 400;
const pad = (n: number) => String(n).padStart(2, "0");
// The library keys its table by "YYYY-MM-DD", so a plain lookup needs no Date and no time zone.
const holidayOf = (date: string) => (holiday_jp.holidays as Record<string, { name: string; name_en: string } | undefined>)[date] ?? null;
const monthOf = (date: string) => date.slice(0, 7);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m: 1..12
const lastDayOf = (y: number, m: number) => `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
const nextMonth = (y: number, m: number): [number, number] => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const inBreak = (b: Break, md: string) => (b.to >= b.from ? md >= b.from && md <= b.to : md >= b.from || md <= b.to);

function isoWeek(date: string): number {
  const t = new Date(Date.parse(`${date}T00:00:00Z`));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - y0) / 86_400_000 + 1) / 7);
}

function wareki(date: string): string {
  const y = Number(date.slice(0, 4));
  if (date >= "2019-05-01") { const n = y - 2018; return `令和${n === 1 ? "元" : n}年`; }
  if (date >= "1989-01-08") { const n = y - 1988; return `平成${n === 1 ? "元" : n}年`; }
  return `${y}年`;
}

export function makeCalendar(cfg: CalCfg): Calendar {
  const isOff = (date: string) =>
    weekdayOfDate(date) > 5 || holidayOf(date) !== null || cfg.breaks.some((b) => inBreak(b, date.slice(5)));
  // Business days strictly between a and b.
  const bizBetween = (a: string, b: string) => {
    let n = 0;
    for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (!isOff(d)) n++;
    return n;
  };
  const bizDaysOf = (y: number, m: number) => {
    const out: string[] = [];
    for (let d = `${y}-${pad(m)}-01`; monthOf(d) === `${y}-${pad(m)}`; d = addDays(d, 1)) if (!isOff(d)) out.push(d);
    return out;
  };
  const make = (kind: Countdown["kind"], today: string, date: string, extra: Partial<Countdown> = {}): Countdown =>
    ({ kind, date, days: daysBetween(today, date), biz: bizBetween(today, date), ...extra });

  // Breaks are user-editable and could cover every day: give up after SCAN_LIMIT steps and keep the nominal date.
  const backToBizDay = (nominal: string) => {
    let d = nominal;
    for (let i = 0; isOff(d); i++) {
      if (i >= SCAN_LIMIT) return nominal;
      d = addDays(d, -1);
    }
    return d;
  };
  const payday = (today: string): Countdown => {
    let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    for (;;) {
      const nominal = `${y}-${pad(m)}-${pad(Math.min(cfg.payday, daysInMonth(y, m)))}`;
      const d = backToBizDay(nominal);
      if (d >= today) return make("payday", today, d, { moved: d !== nominal });
      [y, m] = nextMonth(y, m);
    }
  };
  const monthEnd = (today: string): Countdown => {
    let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    for (;;) {
      const d = backToBizDay(lastDayOf(y, m));
      if (d >= today) return make("monthEnd", today, d);
      [y, m] = nextMonth(y, m);
    }
  };
  const weekend = (today: string): Countdown => {
    let d = today;
    while (weekdayOfDate(d) !== 6) d = addDays(d, 1);
    return make("weekend", today, d);
  };
  const holiday = (today: string): Countdown | null => {
    for (let i = 1; i < 800; i++) {
      const d = addDays(today, i), h = holidayOf(d);
      if (h) return make("holiday", today, d, { name: { ja: h.name, zh: holidayZh(h.name), en: h.name_en } });
    }
    return null;
  };
  const nextBreak = (today: string): Countdown | null => {
    const y = Number(today.slice(0, 4));
    let best: { b: Break; from: string; to: string } | null = null;
    for (const b of cfg.breaks) {
      for (const by of [y - 1, y, y + 1]) {
        const from = `${by}-${b.from}`;
        if (from <= today || (best && from >= best.from)) continue;
        best = { b, from, to: `${b.to >= b.from ? by : by + 1}-${b.to}` };
      }
    }
    if (!best) return null;
    const name = best.b.name;
    return make("break", today, best.from, { name: { ja: name, zh: name, en: name }, len: daysBetween(best.from, best.to) + 1 });
  };

  return {
    isOff,
    holidayName(date, lang) {
      const h = holidayOf(date);
      return h ? holidayLabel(h.name, h.name_en, lang) : null;
    },
    bizOfMonth(today) {
      const biz = bizDaysOf(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
      return { index: biz.indexOf(today) + 1, total: biz.length, left: biz.filter((d) => d > today).length };
    },
    countdowns(today) {
      const list = [payday(today), weekend(today), monthEnd(today), holiday(today), nextBreak(today)].filter((x): x is Countdown => x !== null);
      return list.sort((a, b) => a.days - b.days);
    },
    monthGrid(today) {
      const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
      const cells: (DayCell | null)[] = Array.from({ length: weekdayOfDate(`${y}-${pad(m)}-01`) - 1 }, () => null);
      for (let n = 1; n <= daysInMonth(y, m); n++) {
        const date = `${y}-${pad(m)}-${pad(n)}`, h = holidayOf(date);
        cells.push({ date, d: n, dow: weekdayOfDate(date), off: isOff(date), holiday: h ? h.name : null, today: date === today, future: date > today });
      }
      while (cells.length % 7) cells.push(null);
      return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
    },
    ephemeris(today) {
      const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
      return { isoWeek: isoWeek(today), fy: m >= 4 ? y : y - 1, fq: Math.floor(((m - 4 + 12) % 12) / 3) + 1, wareki: wareki(today) };
    },
  };
}
