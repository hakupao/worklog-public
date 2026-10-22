import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api, rangeXlsxHref } from "../../api/client";
import type { RangeBounds } from "../../api/types";
import { keys } from "../../api/queries";
import { isComposingEvent } from "../../lib/ime";
import { reportWeekDates, reportWeekOf, shiftWeek } from "../../lib/jst";
import { t } from "../../i18n/t";
import { LANGS, type Lang } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { applyGlass } from "../../ui/glass";
import { Led } from "../../ui/Led";
import { weekText } from "../TimelinePage";

/** The server's cap on one range (server/src/report/range/data.ts MAX_WEEKS). */
export const RANGE_MAX_WEEKS = 52;
/** A guard against a runaway walk on odd bounds; far more weeks than the data can have. */
const WALK_CAP = 1000;

/** Every week key from `first` to `last`, newest first. */
function weeksOf(first: string, last: string): string[] {
  const out: string[] = [];
  for (let w = last; out.length < WALK_CAP; w = shiftWeek(w, -1)) {
    out.push(w);
    if (w <= first) break;
  }
  return out;
}

/** A select option: the year, then the toolbar's week label (a range may cross a new year). */
const optionText = (lang: Lang, w: string) =>
  `${w.slice(0, 4)} · ${weekText(lang, { bands: reportWeekDates(w).map((date) => ({ date })) }, w)}`;

/** The weeks the range panel offers, read by the 週報's control line once ↓ xlsx is enabled (`on`), so they are
 *  usually there when the panel opens. No retries: the panel says the first failure, and opening it again asks again. */
export const useRangeBounds = (on: boolean) =>
  useQuery({ queryKey: keys.rangeBounds(), queryFn: api.rangeBounds, enabled: on, retry: false });

/** ↓ xlsx's panel (spec 2026-10-13 §3): 起始周 / 结束周 between the first week with data and the last report week,
 *  the export language (starting from the toolbar's), and 下载 — a plain link, for the Access 302 reason in
 *  ReportPage's xlsx comment. A range from after to, or over 52 weeks, has no link: a disabled key and the reason.
 *  Esc (not one that ends an IME composition) and a pointer press outside the panel and its key close it; Esc goes
 *  no further (the key's own Esc is ReportPage's). `id` is the key's aria-controls. */
export function RangeXlsx({ id, bounds, dlLang, onDownload, onClose, keyRef }: {
  id: string; bounds: UseQueryResult<RangeBounds>; dlLang: Lang; onDownload: () => void; onClose: (refocus: boolean) => void;
  keyRef: RefObject<HTMLElement | null>;
}) {
  const { lang } = useV2();
  const ref = useRef<HTMLDivElement>(null);
  const b = bounds.data;
  const weeks = useMemo(() => {
    if (!b || typeof b.last !== "string") return null;
    const first = b.first ?? reportWeekOf();
    return weeksOf(first <= b.last ? first : b.last, b.last);
  }, [b]);
  const [pick, setPick] = useState<{ from: string; to: string } | null>(null);
  const [xLang, setXLang] = useState<Lang>(dlLang);
  // a pick the weeks no longer have (a re-read across a week boundary) is dropped for the defaults:
  // to = last, from = max(first, last − 51 weeks), so never over 52 weeks
  const picked = pick && weeks?.includes(pick.from) && weeks.includes(pick.to) ? pick : null;
  const from = picked?.from ?? (weeks ? weeks[Math.min(weeks.length, RANGE_MAX_WEEKS) - 1] : null);
  const to = picked?.to ?? weeks?.[0] ?? null;

  useEffect(() => {
    const el = ref.current!;
    applyGlass(el);
    const away = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!el.contains(n) && !keyRef.current?.contains(n)) onClose(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose, keyRef]);
  useEffect(() => { if (weeks) ref.current?.querySelector<HTMLElement>("select")?.focus(); }, [weeks]);
  // a failure stays until asked again: opening the panel is that ask
  useEffect(() => { if (bounds.isError) void bounds.refetch(); }, []);

  // weeks is newest first: the range's length is from's index − to's index + 1
  const n = weeks && from && to ? weeks.indexOf(from) - weeks.indexOf(to) + 1 : 0;
  const why = n < 1 ? "rp.rx.order" : n > RANGE_MAX_WEEKS ? "rp.rx.tooMany" : null;
  const select = (label: "rp.rx.from" | "rp.rx.to", value: string, set: (w: string) => void) => (
    <label>
      <span>{t(lang, label)}</span>
      <select value={value} onChange={(e) => set(e.target.value)}>
        {weeks!.map((w) => <option key={w} value={w}>{optionText(lang, w)}</option>)}
      </select>
    </label>
  );
  return (
    <div ref={ref} id={id} className="rx lg2" data-edge="12" role="dialog" aria-label={t(lang, "rp.rx.title")}
      onKeyDown={(e) => {
        if (isComposingEvent(e, false)) return;
        if (e.key === "Escape") { e.stopPropagation(); onClose(true); }
      }}>
      <Led ui tier={1} fit text={t(lang, "rp.rx.title")} />
      {!weeks || !from || !to
        ? bounds.isError
          ? <span className="why" role="alert">{t(lang, "rp.rx.failed")}</span>
          : <span className="wait" role="status">{t(lang, "now.loading")}</span>
        : <>
            {select("rp.rx.from", from, (w) => setPick({ from: w, to }))}
            {select("rp.rx.to", to, (w) => setPick({ from, to: w }))}
            <div className="ft">
              <div className="keys" role="group" aria-label={t(lang, "rp.dl.lang")}>
                {LANGS.map((l) => (
                  <button key={l} type="button" className={`key${xLang === l ? " on" : " dim"}`} aria-pressed={xLang === l} onClick={() => setXLang(l)}>
                    <Led ui tier={1} fit text={t(lang, `lang.${l}`)} />
                  </button>
                ))}
              </div>
              <span className="grow" />
              {/* always mounted, so a reason is announced when it appears */}
              <span className="why" role="status">{why ? t(lang, why) : ""}</span>
              {why
                ? <button type="button" className="key pri rx-go" aria-label={t(lang, "rp.rx.go")} disabled><Led ui tier={2} fit text={t(lang, "rp.rx.go")} /></button>
                : <a className="key pri rx-go" aria-label={t(lang, "rp.rx.go")} href={rangeXlsxHref(from, to, xLang)} download onClick={() => { onDownload(); onClose(true); }}>
                    <Led ui tier={1} fit text={t(lang, "rp.rx.go")} />
                  </a>}
            </div>
          </>}
    </div>
  );
}
