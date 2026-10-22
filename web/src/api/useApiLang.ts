import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import type { Lang } from "../prefs/types";
import { PREFS_KEY } from "../prefs/usePrefs";
import { setApiLang } from "./client";

const notPrefs = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== PREFS_KEY[0];

/** Data text comes back in the display language (X-Lang); both shells (V2App, MobileApp) set it here. Header first,
 *  then invalidate: every refetch goes out in the new language. Prefs are not localized and a refetch would race the
 *  PUT that carries the switch (and could revert it), so they stay out. Prefs load asynchronously: the first requests
 *  go out in the default zh, and the prefs' language, once it arrives, triggers one refresh. Cancel first: a query
 *  still on its first load (no data yet) is not cancelled by a refetch, which would re-join the old-language request.
 *  On unmount the header goes away and the data is refetched without it. */
export function useApiLang(lang: Lang): void {
  const qc = useQueryClient();
  useLayoutEffect(() => {
    setApiLang(lang);
    void qc.cancelQueries({ predicate: notPrefs }).then(() => qc.invalidateQueries({ predicate: notPrefs }));
  }, [lang, qc]);
  useLayoutEffect(() => () => { setApiLang(null); void qc.invalidateQueries({ predicate: notPrefs }); }, [qc]);
}
