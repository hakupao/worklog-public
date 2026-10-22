import type { StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import type { Lang } from "../prefs/types";
import { addDays, daysBetween } from "../predict/time";

export const LOCALE: Record<Lang, string> = { zh: "zh-CN", ja: "ja-JP", en: "en-US" };

/** Minutes as H:MM. Rounds first, so 59.6 min reads 1:00, not 0:00. */
export function hmClock(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
/** Minutes as hours with one decimal: 90 → "1.5". */
export const hours1 = (min: number) => (Math.max(0, min) / 60).toFixed(1);

/** 今天 / 明天 / 昨天 (in the interface language) for those three days, else "". */
export function relWord(date: string, today: string, lang: Lang): string {
  const d = daysBetween(today, date);
  return d === 0 ? t(lang, "m.day.today") : d === 1 ? t(lang, "m.day.tomorrow") : d === -1 ? t(lang, "m.day.yesterday") : "";
}
/** "10/13 周二 · 今天": month/day, the short weekday in the interface language, and the relative word if any. */
export function dayTitle(date: string, today: string, lang: Lang): string {
  const wd = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const head = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${wd}`;
  const rel = relWord(date, today, lang);
  return rel ? `${head} · ${rel}` : head;
}

/** The words of an m.* string before its single {placeholder}, e.g. "同步 " — the number is rendered after it in Doto. */
export function splitAt(lang: Lang, key: StrKey): string { return t(lang, key, { t: "\u0000", h: "\u0000" }).split("\u0000")[0]; }

/** A machine not collected for this long is shown in the warning colour (spec §5). */
export const SYNC_STALE_MIN = 120;
export const isSyncStale = (lastSeen: number | null, now: number) => lastSeen === null || now - lastSeen > SYNC_STALE_MIN * 60_000;

/** The day before / after `date`, or null past min / max. */
export function stepDay(date: string, dir: 1 | -1, min?: string, max?: string): string | null {
  const next = addDays(date, dir);
  if (min !== undefined && next < min) return null;
  if (max !== undefined && next > max) return null;
  return next;
}
/** A horizontal swipe: 1 = to the next day (finger moved left), -1 = to the previous one, 0 = not a swipe. */
export function swipeOf(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}
