import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "dark" | "light";
/** Per device (plan Global Constraints): a phone and a desktop often want different themes. */
export const THEME_KEY = "wl-m-theme";
const DARK_Q = "(prefers-color-scheme: dark)";

export function readThemeChoice(): ThemeChoice {
  try { const v = localStorage.getItem(THEME_KEY); return v === "dark" || v === "light" ? v : "system"; } catch { return "system"; }
}
export const resolveTheme = (c: ThemeChoice, sysDark: boolean): "dark" | "light" => (c === "system" ? (sysDark ? "dark" : "light") : c);
export const nextChoice = (c: ThemeChoice): ThemeChoice => (c === "system" ? "dark" : c === "dark" ? "light" : "system");
const systemDark = () => typeof window.matchMedia !== "function" || window.matchMedia(DARK_Q).matches;

export function useMobileTheme() {
  const [choice, setState] = useState<ThemeChoice>(readThemeChoice);
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(DARK_Q), on = () => setSysDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const setChoice = useCallback((c: ThemeChoice) => {
    setState(c);
    try { if (c === "system") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, c); } catch { /* blocked: this page only */ }
  }, []);
  return { choice, resolved: resolveTheme(choice, sysDark), setChoice };
}
