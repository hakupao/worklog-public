import type { Glyph, Lang } from "../prefs/types";
import { STRINGS, type StrKey } from "./strings";

export function t(lang: Lang, key: StrKey, vars: Record<string, string | number> = {}): string {
  const row = STRINGS[key] as { zh: string; ja: string; en: string };
  let s = row[lang];
  if (!s?.trim()) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing ${lang} for "${key}", using zh`);
    s = row.zh;
  }
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** A count with its unit (`tk.u.*`): the `.one` key for 1, `.other` otherwise. */
export const tn = (lang: Lang, unit: "tk.u.sess" | "tk.u.note" | "tk.u.plan", n: number): string =>
  t(lang, `${unit}.${n === 1 ? "one" : "other"}` as StrKey, { n });

export const htmlLang = (lang: Lang) => (lang === "zh" ? "zh-CN" : lang) as "zh-CN" | "ja" | "en";
export const glyphOf = (lang: Lang): Glyph => (lang === "ja" ? "ja" : "zh");
