import type { Lang } from "../prefs/types";

// zh names for the holidays @holiday-jp/holiday_jp lists by their ja name. ja comes from the library,
// en from its name_en; anything missing here falls back to ja.
const ZH: Record<string, string> = {
  元日: "元旦", 成人の日: "成人日", 建国記念の日: "建国纪念日", 春分の日: "春分日", 天皇誕生日: "天皇诞辰",
  昭和の日: "昭和日", 憲法記念日: "宪法纪念日", みどりの日: "绿之日", こどもの日: "儿童节", 海の日: "海之日",
  山の日: "山之日", 敬老の日: "敬老日", 秋分の日: "秋分日", スポーツの日: "体育日", 体育の日: "体育日",
  "体育の日（スポーツの日）": "体育日", 文化の日: "文化日", 勤労感謝の日: "勤劳感谢日",
  振替休日: "补休", 休日: "国民休日", "休日（祝日扱い）": "国民休日",
};
const SUBSTITUTE = " 振替休日";

export function holidayZh(ja: string): string {
  if (ZH[ja]) return ZH[ja];
  if (ja.endsWith(SUBSTITUTE)) {
    const base = ja.slice(0, -SUBSTITUTE.length);
    if (ZH[base]) return `${ZH[base]} ${ZH["振替休日"]}`;
  }
  return ja;
}

export function holidayLabel(ja: string, en: string, lang: Lang): string {
  return lang === "ja" ? ja : lang === "en" ? en : holidayZh(ja);
}
