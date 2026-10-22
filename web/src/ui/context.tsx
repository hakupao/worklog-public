import { createContext, useContext } from "react";
import { DEFAULT_PREFS } from "../prefs/defaults";
import type { Lang, Prefs } from "../prefs/types";

/** What every v2 component reads: the prefs, the effective interface language (prefs or ?lang=),
 *  and the writers. The effective world is not here — it lives in world/store (useWorld). */
export interface V2Ctx {
  prefs: Prefs;
  lang: Lang;
  setPrefs: (update: (p: Prefs) => Prefs) => void;
  resetPrefs: () => void;
  setLang: (l: Lang, origin?: Element | null) => void;
}
export const V2Context = createContext<V2Ctx>({
  prefs: DEFAULT_PREFS, lang: DEFAULT_PREFS.lang, setPrefs: () => {}, resetPrefs: () => {}, setLang: () => {},
});
export const useV2 = () => useContext(V2Context);
