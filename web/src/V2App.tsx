import { useCallback, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setApiLang } from "./api/client";
import { useTasks } from "./api/queries";
import { ToastHost } from "./components/Toast";
import { subscribeHash } from "./lib/hash";
import { htmlLang } from "./i18n/t";
import type { StrKey } from "./i18n/strings";
import { motion, setMotion } from "./led/motion";
import { readOverrides, withoutOverride } from "./prefs/overrides";
import type { Lang } from "./prefs/types";
import { PREFS_KEY, usePrefs } from "./prefs/usePrefs";
import { NowPage } from "./pages/NowPage";
import { PlanPage } from "./pages/PlanPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { TasksPage } from "./pages/TasksPage";
import { TimelinePage } from "./pages/TimelinePage";
import { UsagePage } from "./pages/UsagePage";
import { parseV2Route, replaceHash } from "./route";
import "./styles/v2.css";
import { V2Context, type V2Ctx } from "./ui/context";
import { Shell } from "./ui/Shell";
import { useTaskBadgesVersion } from "./ui/taskBadges";
import { ensureWebFonts } from "./ui/webfonts";
import { applyWorld, resetWorldStore } from "./world/store";
import { isWorldBusy, setWorldFxSource, setWorldPersist } from "./world/transitions";

export default function V2App() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const route = useMemo(() => parseV2Route(hash), [hash]);
  const over = useMemo(() => readOverrides(hash), [hash]);
  const { prefs, setPrefs, resetPrefs } = usePrefs();
  const lang: Lang = over.lang ?? prefs.lang;
  const world = over.world ?? prefs.world;
  const qc = useQueryClient();
  useTasks();                                                    // feeds the badge registry (client.ts); B1
  // B2: a registry change re-renders the page (render-time lineColor() reads it); no remount, so no query refetches.
  // Memoised canvas draws take the version through useCanvas / EChart / RunChart deps.
  useTaskBadgesVersion();

  // <html> belongs to v2 while it is mounted. Layout effects: set before the first paint, so neither
  // the old styles nor the wrong world ever flash.
  useLayoutEffect(() => {
    const h = document.documentElement, oldLang = h.lang, oldTitle = document.title;
    h.classList.add("v2");
    ensureWebFonts();
    return () => {
      h.classList.remove("v2"); h.lang = oldLang; document.title = oldTitle;
      delete h.dataset.font;
      resetWorldStore();                     // back to 里 and no data-world: the old UI never sees it
      setWorldPersist(() => {});             // an in-flight world toggle must not write prefs after unmount
      setWorldFxSource(() => "scan");
      document.getElementById("wbeam")?.remove(); document.getElementById("whead")?.remove();
    };
  }, []);
  useLayoutEffect(() => { document.documentElement.lang = htmlLang(lang); }, [lang]);
  // Data text comes back in the display language (X-Lang). Header first, then invalidate: every refetch
  // goes out in the new language. Prefs are not localized and a refetch would race the PUT that carries
  // the switch (and could revert it), so they stay out. Prefs load asynchronously: the first requests go
  // out in the default zh, and the prefs' language, once it arrives, triggers one refresh.
  const notPrefs = useCallback((q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== PREFS_KEY[0], []);
  useLayoutEffect(() => { setApiLang(lang); void qc.invalidateQueries({ predicate: notPrefs }); }, [lang, qc, notPrefs]);
  useLayoutEffect(() => () => { setApiLang(null); void qc.invalidateQueries({ predicate: notPrefs }); }, [qc, notPrefs]);
  useLayoutEffect(() => { document.documentElement.dataset.font = prefs.omote.font; }, [prefs.omote.font]);
  useLayoutEffect(() => { setMotion(prefs); }, [prefs]);
  // Not while a toggle runs: Dock drops ?world= right before toggleWorld, which applies the new world
  // itself (after the ink frame); re-applying the revealed prefs world here would cut that short.
  useLayoutEffect(() => { if (!isWorldBusy()) applyWorld(world); }, [world]);
  useEffect(() => {
    setWorldFxSource(() => prefs.worldFx);
    setWorldPersist((w) => {
      if (readOverrides(window.location.hash).world) replaceHash(withoutOverride(window.location.hash, "world"));
      setPrefs((p) => ({ ...p, world: w }));
    });
  }, [prefs.worldFx, setPrefs]);

  const setLang = useCallback((l: Lang, origin?: Element | null) => {
    const r = origin?.getBoundingClientRect();
    motion.origin = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    if (readOverrides(window.location.hash).lang) replaceHash(withoutOverride(window.location.hash, "lang"));
    setPrefs((p) => ({ ...p, lang: l }));
  }, [setPrefs]);

  const ctx: V2Ctx = useMemo(() => ({ prefs, lang, setPrefs, resetPrefs, setLang }), [prefs, lang, setPrefs, resetPrefs, setLang]);
  const titleKey = `nav.${route.page}` as StrKey;
  return (
    <V2Context.Provider value={ctx}>
      <Shell page={route.page} titleKey={titleKey}>
        {route.page === "settings" ? <SettingsPage /> : route.page === "now" ? <NowPage /> : route.page === "timeline" ? <TimelinePage /> : route.page === "tasks" ? <TasksPage /> : route.page === "plan" ? <PlanPage /> : route.page === "report" ? <ReportPage /> : route.page === "stats" ? <StatsPage /> : <UsagePage />}
      </Shell>
      <ToastHost />
    </V2Context.Provider>
  );
}
