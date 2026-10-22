import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type ComponentType } from "react";
import { useTasks } from "../api/queries";
import { useApiLang } from "../api/useApiLang";
import { ToastHost } from "../components/Toast";
import { subscribeHash } from "../lib/hash";
import { htmlLang } from "../i18n/t";
import type { Lang } from "../prefs/types";
import { usePrefs } from "../prefs/usePrefs";
import { V2Context, type V2Ctx } from "../ui/context";
import { BadgeWorld } from "../ui/TaskBadge";
import { ensureMobileFonts } from "./fonts";
import { Now } from "./pages/Now";
import { Plan } from "./pages/Plan";
import { Stats } from "./pages/Stats";
import { Tasks } from "./pages/Tasks";
import { Timeline } from "./pages/Timeline";
import { M_PAGES, parseMRoute, type MPage, type MRoute } from "./route";
import "./styles/m.css";
import { useMobileTheme } from "./theme";
import { TabBar } from "./ui/TabBar";
import { TopBar } from "./ui/TopBar";

/** The pages that exist. A route to one that does not (yet) shows 此刻. */
export const PAGES: Partial<Record<MPage, ComponentType<{ route: MRoute }>>> = { now: Now, tl: Timeline, plan: Plan, tasks: Tasks, stats: Stats };

export default function MobileApp() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const parsed = useMemo(() => parseMRoute(hash), [hash]);
  const route: MRoute = PAGES[parsed.page] ? parsed : { ...parsed, page: "now", param: null };
  const { prefs, setPrefs, resetPrefs } = usePrefs();
  const lang = prefs.lang;
  const theme = useMobileTheme();   // exactly one instance: the shell owns it, TopBar only toggles it
  useTasks();   // feeds the badge registry so any page — #/m/plan opened directly — shows stored badges (as V2App)

  useLayoutEffect(() => {
    const h = document.documentElement, oldLang = h.lang, oldTitle = document.title;
    h.classList.add("m");
    ensureMobileFonts();
    return () => { h.classList.remove("m"); delete h.dataset.mTheme; h.lang = oldLang; document.title = oldTitle; };
  }, []);
  useLayoutEffect(() => { document.documentElement.dataset.mTheme = theme.resolved; }, [theme.resolved]);
  useLayoutEffect(() => { document.documentElement.lang = htmlLang(lang); }, [lang]);
  useApiLang(lang);
  const setLang = useCallback((l: Lang) => setPrefs((p) => ({ ...p, lang: l })), [setPrefs]);
  const ctx = useMemo<V2Ctx>(() => ({ prefs, lang, setPrefs, resetPrefs, setLang }), [prefs, lang, setPrefs, resetPrefs, setLang]);
  const Page = PAGES[route.page] ?? Now;

  return (
    <V2Context.Provider value={ctx}>
      <div className="m-app">
        <TopBar page={route.page} theme={theme} />
        <main className="m-main" key={route.page}>
          <BadgeWorld.Provider value={theme.resolved === "dark" ? "ura" : "omote"}><Page route={route} /></BadgeWorld.Provider>
        </main>
      </div>
      <TabBar page={route.page} pages={M_PAGES.filter((p) => PAGES[p])} />
      <ToastHost />
    </V2Context.Provider>
  );
}
