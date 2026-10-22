import type { StrKey } from "../../i18n/strings";
import { glyphOf, t } from "../../i18n/t";
import { weekdayOfDate } from "../../predict/time";
import type { Lang } from "../../prefs/types";
import type { LedSeg } from "../../ui/Led";
import { lineColor } from "../../ui/palette";
import { taskCode } from "../now/format";

/** An item's tasks as line codes, each in its line colour; 未关联 (dim, interface glyphs) when it has none. */
export const codeSegs = (lang: Lang, ids: string[]): LedSeg[] => ids.length
  ? ids.map((k, i) => ({ t: `${i ? " " : ""}${taskCode(k)}`, kind: "code", color: lineColor(k) }))
  : [{ t: t(lang, "pl.noTask"), kind: "dim", glyph: glyphOf(lang) }];

/** A weekday in one slot of the week strip / bars (33px at most): 一 / 月 / M (prototype DOWL). */
export const dowShort = (lang: Lang, date: string) => t(lang, `tl.dow.${weekdayOfDate(date)}` as StrKey).slice(0, lang === "en" ? 1 : undefined);
