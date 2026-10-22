import type { Lang } from "../prefs/types";

const TZ = "Asia/Tokyo";
const LOCALE: Record<Lang, string> = { zh: "zh-CN", ja: "ja-JP", en: "en-US" };
const parts = (d: Date, o: Intl.DateTimeFormatOptions, loc = "en-GB") =>
  Object.fromEntries(new Intl.DateTimeFormat(loc, { timeZone: TZ, hourCycle: "h23", ...o }).formatToParts(d).map((p) => [p.type, p.value]));

export function fmtClock(d: Date): string {
  const p = parts(d, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${p.hour}:${p.minute}:${p.second}`;
}
export function fmtHm(iso: string): string {
  const p = parts(new Date(iso), { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
}
export function fmtDate(d: Date, lang: Lang): string {
  if (lang === "en") {
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: TZ })
      .format(d).toUpperCase();
  }
  const date = new Intl.DateTimeFormat(LOCALE[lang], { year: "numeric", month: "long", day: "numeric", timeZone: TZ }).format(d);
  const wd = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "short", timeZone: TZ }).format(d);
  return `${date}（${wd}）`;
}
export function fmtMoney(usd: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }).format(usd);
}
/** Whole dollars, for list columns (brief assumption 4); a cost under half a dollar is "<$1", not "$0". */
export function fmtUsd0(usd: number, lang: Lang): string {
  const f = (v: number) => new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(v);
  return usd > 0 && usd < 0.5 ? `<${f(1)}` : f(usd);
}
