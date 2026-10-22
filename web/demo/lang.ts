// The UI language as the page shows it: V2App / MobileApp set <html lang> from the language preference.
export type DemoLang = "zh" | "ja" | "en";
export function demoLang(): DemoLang {
  const l = document.documentElement.lang.toLowerCase();
  return l.startsWith("zh") ? "zh" : l.startsWith("en") ? "en" : "ja";
}
