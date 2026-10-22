import type { CSSProperties } from "react";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { DotIcon } from "./dots";
import { mHref, type MPage } from "../route";
import { NAV } from "./nav";

/** The floating bottom bar: one link per page that exists, the current one marked. */
export function TabBar({ page, pages }: { page: MPage; pages: MPage[] }) {
  const { lang } = useV2();
  return (
    <nav className="m-tabs" aria-label={t(lang, "nav.pages")}>
      <div className="m-tabs-in" style={{ "--n": pages.length } as CSSProperties}>
        {pages.map((p) => (
          <a key={p} href={mHref(p)} aria-current={p === page ? "page" : undefined}>
            <DotIcon name={p} />{t(lang, NAV[p])}
          </a>
        ))}
      </div>
    </nav>
  );
}
