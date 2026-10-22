import type { ReactNode } from "react";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";

/** Rows the height of real rows, so the page does not jump when data arrives. */
export function Loading({ rows = 3 }: { rows?: number }) {
  const { lang } = useV2();
  return <div className="m-skel" aria-busy="true" aria-label={t(lang, "m.loading")}>{Array.from({ length: rows }, (_, i) => <div key={i} className="m-skel-row" />)}</div>;
}
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { lang } = useV2();
  return (
    <div className="m-state" role="alert">
      <p>{t(lang, "m.err.load")}</p>
      <button type="button" className="m-btn" onClick={onRetry}>{t(lang, "m.err.retry")}</button>
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="m-state">{children}</div>;
}
