import type { Countdown } from "../../cal/calendar";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { weekdayOfDate } from "../../predict/dates";
import type { LedSeg } from "../../ui/Led";

/** Brightness tier by rank (rows sorted nearest first, Flighty rule): nearest 0 … farthest 3, spread round(i·3/(n−1)). */
export function rankTiers(n: number): (0 | 1 | 2 | 3)[] {
  if (n <= 1) return n === 1 ? [0] : [];
  return Array.from({ length: n }, (_, i) => Math.round((i * 3) / (n - 1)) as 0 | 1 | 2 | 3);
}

/** Weekday letter of a date in the display language (1 = Mon … 7 = Sun → the 日-first string's index). */
export const wdOf = (lang: Lang, date: string) => t(lang, "now.time.wd")[weekdayOfDate(date) % 7];

export interface CountdownText { kind: LedSeg[]; what: LedSeg[]; date: string; days: string; biz: string }

/** The five cells of one countdown row. The kind labels 給料日 / 月末締め / 祝日 are Japanese words and the holiday
 *  name stays Japanese outside en, so in zh they are drawn with the ja glyphs (prototype `kl` / `wl`). */
export function countdownText(c: Countdown, today: string, payday: number, lang: Lang): CountdownText {
  const jaWord = lang === "zh" && c.kind !== "weekend" && c.kind !== "break";
  const kind: LedSeg[] = [{ t: t(lang, `now.time.k.${c.kind}` as StrKey), ...(jaWord ? { glyph: "ja" as const } : {}) }];
  let what: LedSeg[];
  switch (c.kind) {
    case "payday": what = [{ t: t(lang, c.moved ? "now.time.w.paydayMoved" : "now.time.w.payday", { d: payday }) }]; break;
    case "weekend": what = [{ t: t(lang, "now.time.w.weekend") }]; break;
    case "monthEnd": what = [{ t: t(lang, c.date.slice(0, 7) === today.slice(0, 7) ? "now.time.w.monthEnd" : "now.time.w.monthEndNext") }]; break;
    case "holiday": what = [lang === "en" ? { t: c.name?.en ?? "" } : { t: c.name?.ja ?? "", glyph: "ja" }]; break;
    case "break": what = [{ t: t(lang, "now.time.w.break", { name: c.name?.[lang] ?? "", n: c.len ?? 0 }) }]; break;
  }
  return {
    kind, what,
    date: `${c.date.slice(5, 7)}/${c.date.slice(8, 10)} ${wdOf(lang, c.date)}`,
    days: c.days === 0 ? t(lang, "now.time.today") : t(lang, "now.time.days", { n: c.days }),
    biz: String(c.biz),
  };
}
