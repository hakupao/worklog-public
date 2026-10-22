import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient } from "../src/api/queries";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import type { Lang, Prefs } from "../src/prefs/types";
import { V2Context, type V2Ctx } from "../src/ui/context";

/** Renders v2 components with fixed prefs and no network (the real provider lives in V2App). */
export function V2TestProvider({ children, prefs = {}, lang, setPrefs = () => {} }: {
  children: ReactNode; prefs?: Partial<Prefs>; lang?: Lang; setPrefs?: V2Ctx["setPrefs"];
}) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  const ctx: V2Ctx = { prefs: p, lang: lang ?? p.lang, setPrefs, resetPrefs: () => {}, setLang: () => {} };
  return <QueryClientProvider client={createQueryClient()}><V2Context.Provider value={ctx}>{children}</V2Context.Provider></QueryClientProvider>;
}
