import { UnauthorizedError } from "../../api/client";
import type { StrKey } from "../../i18n/strings";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C } from "../../ui/palette";
import { t } from "../../i18n/t";

/** A section's heading line (the hints' pattern): the name, then an optional figure on the right. */
export function Head({ text, meta }: { text: string; meta?: string }) {
  return (
    <div className="st-sh">
      <Led ui size={12} tier={2} fit color={C.WARM} text={text} />
      <span className="grow" />
      {meta !== undefined && <Led ui tier={2} fit color={C.DIM} text={meta} />}
    </div>
  );
}

/** A sub-heading inside a section. */
export function Sub({ text }: { text: string }) {
  return <div className="st-sub"><Led ui tier={2} fit color={C.DIM} text={text} /></div>;
}

/** An empty state: one dim line, not a void (clipped to the column: the English lines are long). */
export function None({ text }: { text: string }) {
  return <div className="st-none"><Led ui tier={2} clip className="fill" color={C.DIM} text={text} /></div>;
}

/** The * after an amount some sessions of which are unpriced; the words on hover and for screen readers. */
export function Partial() {
  const { lang } = useV2();
  return (
    <span className="st-pt" title={t(lang, "st.partial")}>
      <Led tier={1} fit color={C.WARM} text="*" /><span className="v2-sr">{t(lang, "st.partial")}</span>
    </span>
  );
}

/** A query's failure with 重试 (the dashboard's by default, the reviews' with `text`); a 401 is the app-wide
 *  banner's (createQueryClient). */
export function Failure({ err, retry, className, text = "st.failed" }: { err: unknown; retry: () => void; className: string; text?: StrKey }) {
  const { lang } = useV2();
  if (err instanceof UnauthorizedError) return null;
  return (
    <div className={className} role="alert">
      <Led ui tier={2} fit text={t(lang, text)} />
      <button type="button" className="key dim" onClick={retry}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>
    </div>
  );
}
