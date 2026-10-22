import { useEffect } from "react";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { LANGS } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { desktopHref, setMobileOptOut, type MPage } from "../route";
import { nextChoice, type ThemeChoice } from "../theme";
import { NAV } from "./nav";

export function TopBar({ page, theme }: { page: MPage; theme: { choice: ThemeChoice; setChoice: (c: ThemeChoice) => void } }) {
  const { lang, setLang } = useV2();
  const title = t(lang, NAV[page]);
  useEffect(() => { document.title = `${title} · worklog`; }, [title]);
  const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
  const toDesktop = () => { setMobileOptOut(true); window.location.hash = desktopHref(page); };
  return (
    <header className="m-top">
      <h1>{title}</h1>
      <button type="button" className="m-bk" aria-label={t(lang, "m.theme.label", { v: t(lang, `m.theme.${theme.choice}` as StrKey) })}
        onClick={() => theme.setChoice(nextChoice(theme.choice))}>{`[${t(lang, `m.theme.short.${theme.choice}` as StrKey)}]`}</button>
      <button type="button" className="m-bk" aria-label={t(lang, "nav.langGroup")} onClick={() => setLang(next)}>{`[${t(lang, `m.lang.short.${lang}` as StrKey)}]`}</button>
      <button type="button" className="m-bk" onClick={toDesktop}>{`[${t(lang, "m.desktop.short")}]`}</button>
    </header>
  );
}
