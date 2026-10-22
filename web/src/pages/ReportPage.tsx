import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApiError, UnauthorizedError, api } from "../api/client";
import { keys } from "../api/queries";
import type { Grid, SheetKey } from "../api/types";
import { subscribeHash } from "../lib/hash";
import { isComposingEvent } from "../lib/ime";
import { jstDateOf, reportWeekDates, reportWeekOf, shiftWeek, todayJst } from "../lib/jst";
import { fmtHm } from "../i18n/format";
import { STRINGS, type StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import { LANGS, type Lang } from "../prefs/types";
import { useV2 } from "../ui/context";
import { Led } from "../ui/Led";
import { Drawer } from "../ui/Drawer";
import { Mod } from "../ui/Mod";
import { C } from "../ui/palette";
import { useWorld } from "../world/store";
import { useMinute } from "./now/useNowData";
import { CellDrawer } from "./report/CellDrawer";
import { ComposePage } from "./report/compose/ComposePage";
import { DaysView } from "./report/DaysView";
import { WeekDigest } from "./report/Digests";
import { DeliverablesView } from "./report/DeliverablesView";
import { HoursView } from "./report/HoursView";
import { matrixOf } from "./report/matrix";
import { downloadPdf } from "./report/pdf";
import { RangeXlsx, useRangeBounds } from "./report/RangeXlsx";
import { cellParam, composeHref, isComposeHash, useRp, type Rp, type RpCell } from "./report/state";
import { SummaryView } from "./report/SummaryView";
import { useReportData, type ReportData } from "./report/useReportData";
import { TasksView } from "./report/TasksView";
import { useReportWrite } from "./report/write";
import { weekText } from "./TimelinePage";

/** After a click on 下载, the download list is re-read when the window gets focus back or after this long, whichever
 *  comes first (a download that goes to the browser's download bar never takes the focus away). The server records
 *  the download when it answers the xlsx request, so by then the list has it. */
export const DL_REFRESH_MS = 4000;

/** A sheet tab's name (brief assumption 2): the JP sheet names in zh / ja, English in en; a sheet this page does
 *  not know keeps the server's title. */
function sheetName(lang: Lang, g: Grid): string {
  const k = `rp.sh.${g.key}`;
  return k in STRINGS ? t(lang, k as StrKey) : g.title;
}

/** The sheet `k` of the preview (activeSheet only names a sheet the preview has). */
const grid = (sheets: Grid[], k: SheetKey) => sheets.find((g) => g.key === k)!;

/** The address's sheet when the preview on screen has it; else 日別作業, else the first sheet. */
function activeSheet(sheets: Grid[], want: SheetKey): SheetKey | null {
  const has = (k: SheetKey) => sheets.some((g) => g.key === k);
  return has(want) ? want : has("days") ? "days" : sheets[0]?.key ?? null;
}

/** The report route: `#/v2/report/<week>/pdf` is the PDF composer (spec 2026-10-09 §3.1), checked before the
 *  週報's own address reading (which would take it for the plain report); anything else is the 週報. */
export function ReportPage() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  return isComposeHash(hash) ? <ComposePage /> : <WeeklyReport />;
}

/** 週報 (spec §3.1, prototype page-report.html): the week's report as the xlsx will have it — week and download
 *  on the control line, the 未关联 warning, one tab per sheet and that sheet's view below. */
function WeeklyReport() {
  const rp = useRp(), { st } = rp;
  const data = useReportData(st.week);
  const today = todayJst(useMinute());
  // an odd answer (a proxy page, a schema change) is no preview, not a crash
  const p = data.preview && Array.isArray(data.preview.sheets) ? data.preview : undefined;
  // the preview on screen is the address's week (not one kept while another loads)
  const ready = p !== undefined && p.week === st.week;
  // the matrix of the preview on screen (kept while another week loads, so 日別作業 never blanks), and
  // the same matrix only when it is the address's (the drawer: never edit another week's)
  const shownMx = useMemo(() => (p ? matrixOf(p, data.timeline, data.tasks, today) : null), [p, data.timeline, data.tasks, today]);
  const matrix = ready ? shownMx : null;
  const sheet = p ? activeSheet(p.sheets, st.sheet) : null;
  const write = useReportWrite();
  const edits = ready ? write : null;
  const lang = useV2().lang;
  // an answer without digests (an older server) shows none, not a crash
  const dg = p?.digests && typeof p.digests === "object" ? p.digests : { week: null, days: {} };
  // the cell the drawer was last opened on: its LED half takes the focus back, even when the drawer opened from the
  // address before the matrix was drawn (Drawer asks returnTo at open time, the fallback at close time)
  const lastCell = useRef<RpCell | null>(null);
  if (st.cell) lastCell.current = st.cell;
  const cellEl = (c: RpCell | null) => (c ? document.querySelector<HTMLElement>(`.rp-days .cell[data-cell="${CSS.escape(cellParam(c))}"]`) : null);
  return (
    <div className="rp">
      <section className="rp-top">
        <Controls rp={rp} data={data} ready={ready} />
        {p && p.unassigned_sessions > 0 && (
          <Mod id="report.warn"><Warn week={p.week} n={p.unassigned_sessions} m={p.unassigned_minutes} /></Mod>
        )}
        {/* a refresh that failed with a preview on screen: say so and keep the page (the old page did the same) */}
        {p && data.error !== null && <Failure err={data.error} retry={data.refetch} className="rp-fail" />}
        {p && <WeekDigest key={p.week} week={p.week} d={dg.week} live={p.week === reportWeekOf()} write={edits} />}
        {p && <Tabs sheets={p.sheets} active={sheet} setSheet={rp.setSheet} />}
      </section>
      {p
        // one view per sheet and shown preview (a week switch mounts a new one, so no field open on the
        // old preview lives on into the new); it edits only while that preview is the address's — a kept one is
        // read-only (an edit there would land in the cache under a placeholder the screen does not show)
        ? sheet && (
          <section className="rp-body">
            <div key={`${p.week}/${sheet}`} className="rp-view" data-sheet={sheet}>
              {sheet === "days" && <DaysView m={shownMx} data={data} setCell={ready ? rp.setCell : null} sums={p.day_sum_minutes ?? null} />}
              {sheet === "summary" && <SummaryView grid={grid(p.sheets, "summary")} week={p.week} write={edits} />}
              {sheet === "tasks" && <TasksView grid={grid(p.sheets, "tasks")} week={p.week} write={edits} />}
              {sheet === "hours" && <HoursView grid={grid(p.sheets, "hours")} week={p.week} write={edits} />}
              {sheet === "deliverables" && <DeliverablesView grid={grid(p.sheets, "deliverables")} week={p.week} write={edits} />}
            </div>
          </section>
        )
        : <Wait data={data} odd={data.preview !== undefined} />}
      <Drawer open={st.cell !== null} onClose={() => rp.setCell(null)} label={t(lang, "rp.e.label")}
        returnTo={() => cellEl(st.cell)}
        fallback={() => cellEl(lastCell.current) ?? document.querySelector<HTMLElement>(".rp-view[data-sheet=days]")}>
        {st.cell && <CellDrawer key={`${st.week}/${cellParam(st.cell)}`} week={st.week} at={st.cell} m={matrix} write={write} onClose={() => rp.setCell(null)} />}
      </Drawer>
    </div>
  );
}

/** Re-reads the week's download list once after a click on 下载: on the next window focus or after DL_REFRESH_MS. */
function useDownloadRefresh(week: string): () => void {
  const qc = useQueryClient();
  const armed = useRef<(() => void) | null>(null);
  useEffect(() => () => armed.current?.(), []);
  return useCallback(() => {
    armed.current?.();
    const stop = () => { clearTimeout(id); window.removeEventListener("focus", fire); armed.current = null; };
    const fire = () => { stop(); void qc.invalidateQueries({ queryKey: keys.reportDownloads(week) }); };
    const id = window.setTimeout(fire, DL_REFRESH_MS);
    window.addEventListener("focus", fire);
    armed.current = stop;
  }, [qc, week]);
}

/** ◀ week ▶ (+ 本周) | 更新中… ··· 上次下载 · 导出语言 · ↓ PDF · ↓ xlsx (its range panel below the line) */
function Controls({ rp, data, ready }: { rp: Rp; data: ReportData; ready: boolean }) {
  const { lang } = useV2();
  const { st, go } = rp;
  // the report week, Saturday → Friday: the preview's own range when it is this week's, else computed
  const pr = data.preview?.range?.dates;
  const range = ready && Array.isArray(pr) ? pr : reportWeekDates(st.week);
  const days = range.map((date) => ({ date }));
  const last = data.lastDownload;
  const lastText = last ? t(lang, "rp.lastDl", { t: `${jstDateOf(last.at).slice(5).replace("-", "/")} ${fmtHm(last.at)}` })
    : data.downloads ? t(lang, "rp.noDl") : null;
  const onDownload = useDownloadRefresh(st.week);
  const [dlLang, setDlLang] = useState<Lang>("ja");          // design D5: Japanese unless picked, whatever the UI language
  const [pdf, setPdf] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });
  // busy belongs to the in-flight request (one Browser Run launch per request): a week switch clears only the
  // message, and a request that returns after a switch shows nothing and refreshes nothing
  const at = st.week, atRef = useRef(at);
  atRef.current = at;
  useEffect(() => setPdf((p) => ({ ...p, msg: null })), [at]);
  // the composer's text is older than its selection or the week's data (a hidden 案件 may still be in it): ask first,
  // as the composer's own ↓ PDF does. Asked for this week and export language; another week or language drops it.
  const [ask, setAsk] = useState(false);
  useEffect(() => setAsk(false), [at, dlLang]);
  // ↓ xlsx's range panel: open only while the key is enabled (a week switch that disables it closes it)
  const [rx, setRx] = useState(false);
  const bounds = useRangeBounds(ready);
  const rxId = useId();
  const rxKey = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!ready) setRx(false); }, [ready]);
  const closeRx = useCallback((refocus: boolean) => { setRx(false); if (refocus) rxKey.current?.focus(); }, []);
  const download = async () => {
    const started = at;
    setAsk(false);
    setPdf({ busy: true, msg: null });
    const r = await downloadPdf(started, dlLang);
    const same = atRef.current === started;
    setPdf({ busy: false, msg: !same || r.ok ? null : r.busy ? (r.busy > 60 ? t(lang, "rp.dl.quota") : t(lang, "rp.dl.wait", { s: r.busy })) : t(lang, "rp.dl.fail") });
    if (r.ok && same) onDownload();
  };
  const onPdf = async () => {
    const started = at;
    setPdf({ busy: true, msg: null });
    // no composition (404), no text or a failed check never blocks the download
    const v = await api.compose(started, dlLang).catch(() => null);
    if (v?.text && (v.stale.selection || v.stale.inputs)) {
      setPdf({ busy: false, msg: null });
      if (atRef.current === started) setAsk(true);
      return;
    }
    await download();
  };
  return (
    <>
    <div className="sec rp-ctl">
      <div className="keys" role="group" aria-label={t(lang, "tl.nav")}>
        <button type="button" className="key dim" aria-label={t(lang, "tl.prev")} onClick={() => go(shiftWeek(st.week, -1))}><Led ui tier={2} fit text="◀" /></button>
        <Led ui size={12} tier={1} fit text={weekText(lang, { bands: days }, st.week)} />
        <button type="button" className="key dim" aria-label={t(lang, "tl.next")} onClick={() => go(shiftWeek(st.week, 1))}><Led ui tier={2} fit text="▶" /></button>
        {!st.isThisWeek && <button type="button" className="key" onClick={() => go(reportWeekOf())}><Led ui tier={1} fit text={t(lang, "tl.thisWeek")} /></button>}
      </div>
      {/* only while the preview on screen is another week's — not on a background refresh */}
      {data.stale && <span role="status"><Led ui tier={3} fit text={t(lang, "tl.updating")} /></span>}
      <span className="grow" />
      {lastText && <Led ui tier={2} fit text={lastText} />}
      <div className="keys" role="group" aria-label={t(lang, "rp.dl.lang")}>
        {LANGS.map((l) => (
          <button key={l} type="button" className={`key${dlLang === l ? " on" : " dim"}`} aria-pressed={dlLang === l} onClick={() => setDlLang(l)}>
            <Led ui tier={1} fit text={t(lang, `lang.${l}`)} />
          </button>
        ))}
      </div>
      <a className="key dim cmp-open" href={composeHref(st.week)}><Led ui tier={1} fit text={t(lang, "rp.cmp.open")} /></a>
      {pdf.msg && <span role="status"><Led ui tier={2} fit color={C.WARM} text={pdf.msg} /></span>}
      {ready
        ? <button type="button" className="key pri pdf" disabled={pdf.busy} aria-busy={pdf.busy} onClick={() => void onPdf()}>
            <Led ui tier={1} fit text={t(lang, pdf.busy ? "rp.dl.busy" : "rp.dl.pdf")} />
          </button>
        : <button type="button" className="key pri pdf" disabled><Led ui tier={2} fit text={t(lang, "rp.dl.pdf")} /></button>}
      {/* xlsx: the key opens the range panel (report/RangeXlsx), whose 下载 is a plain same-origin link, never
          fetch + blob: on an expired Access session the xlsx answers a 302 to the login page, which only a navigation
          follows; the file name comes from Content-Disposition. Without a preview of this week the key is disabled. */}
      <button ref={rxKey} type="button" className={`key pri xlsx${rx ? " on" : ""}`} disabled={!ready} aria-expanded={ready ? rx : undefined}
        aria-haspopup="dialog" aria-controls={rx ? rxId : undefined} onClick={() => setRx((o) => !o)}
        onKeyDown={(e) => { if (rx && e.key === "Escape" && !isComposingEvent(e, false)) { e.stopPropagation(); closeRx(false); } }}>
        <Led ui tier={ready ? 1 : 2} fit text={t(lang, "rp.dl.xlsx")} />
      </button>
    </div>
    {rx && <RangeXlsx id={rxId} bounds={bounds} dlLang={dlLang} onDownload={onDownload} onClose={closeRx} keyRef={rxKey} />}
    {ask && (
      <div className="cmp-ask" role="alertdialog">
        <span>{t(lang, "rp.cmp.staleDl")}</span>
        <a className="key pri" href={composeHref(st.week)}><Led ui tier={1} fit text={t(lang, "rp.cmp.genFirst")} /></a>
        <button type="button" className="key dim" disabled={pdf.busy} onClick={() => void download()}><Led ui tier={1} fit text={t(lang, "rp.cmp.dlAnyway")} /></button>
      </div>
    )}
    </>
  );
}

/** Sessions of the week that are linked to no 案件 (brief assumption 8). They do reach the report — a 未割当 row on
 *  日別作業, inside the day totals on 稼働, and in 未割当工数 — but under no 案件, so the warning points at the
 *  timeline to link them: the ISO week of the report week's Friday, i.e. the same key. */
function Warn({ week, n, m }: { week: string; n: number; m: number }) {
  const { lang } = useV2();
  return (
    <div className="rp-warn">
      <span className="lamp red" />
      <span className="nm"><Led ui tier={1} clip className="fill" color="#ff8a5c" text={t(lang, "rp.warn", { n, m })} /></span>
      <a className="key dim" href={`#/v2/timeline/${week}?unlinked=1`}><Led ui tier={1} fit color={C.WARM} text={t(lang, "rp.warn.k")} /></a>
    </div>
  );
}

/** One tab per sheet of the preview, in the server's order; the hybrid note on the right (hidden on narrow screens)
 *  only where it is true — 里's 日別作業, the one view that sets 作業内容 as type beside LED figures. */
function Tabs({ sheets, active, setSheet }: { sheets: Grid[]; active: SheetKey | null; setSheet: (s: SheetKey) => void }) {
  const { lang } = useV2(), world = useWorld();
  return (
    <nav className="rp-tabs" aria-label={t(lang, "rp.sheets")}>
      {sheets.map((g) => (
        <button key={g.key} type="button" aria-current={g.key === active ? "page" : undefined} onClick={() => setSheet(g.key)}>
          <Led ui tier={1} fit text={sheetName(lang, g)} />
        </button>
      ))}
      <span className="grow" />
      {world === "ura" && active === "days" && <span className="rp-hyb"><b>{t(lang, "rp.hyb.b")}</b>{t(lang, "rp.hyb")}</span>}
    </nav>
  );
}

/** No preview yet: the first load, or why there is none. `odd`: the server answered, but not with a preview
 *  (no sheets — a proxy page, a schema change): a failure to retry, not an endless 读取中. */
function Wait({ data, odd }: { data: ReportData; odd: boolean }) {
  const { lang } = useV2();
  if (data.error !== null || odd) return <Failure err={data.error} retry={data.refetch} className="rp-wait" />;
  return <section className="rp-wait" role="status"><Led ui tier={2} fit text={t(lang, "now.loading")} /></section>;
}

/** The preview query's failure. A 401 is the app-wide banner's (createQueryClient); a 400 / 404 means the server
 *  cannot build that week's report — retrying will not change it; anything else offers 重试. */
function Failure({ err, retry, className }: { err: unknown; retry: () => void; className: string }) {
  const { lang } = useV2();
  if (err instanceof UnauthorizedError) return null;
  const unavailable = err instanceof ApiError && (err.status === 400 || err.status === 404);
  return (
    <section className={className} role="alert">
      <Led ui tier={2} fit text={t(lang, unavailable ? "rp.unavailable" : "rp.failed")} />
      {!unavailable && <button type="button" className="key dim" onClick={retry}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>}
    </section>
  );
}
