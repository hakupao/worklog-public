// The PDF composer (spec 2026-10-09 §3): left the week's 案件 (own row in order / folded into その他 / not shown),
// right the server's PDF HTML for the draft. Text changes only on 生成; the download asks first when it is stale.
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import type { ComposeMode, ComposeRowOut } from "../../../api/types";
import { InlineEdit } from "../../../components/InlineEdit";
import { subscribeHash } from "../../../lib/hash";
import { isValidWeek, reportWeekDates, shiftWeek } from "../../../lib/jst";
import { fmtHm } from "../../../i18n/format";
import { t } from "../../../i18n/t";
import { LANGS, type Lang } from "../../../prefs/types";
import { parseV2Route } from "../../../route";
import { useV2 } from "../../../ui/context";
import { Led } from "../../../ui/Led";
import { BADGE_H, TaskBadge } from "../../../ui/TaskBadge";
import { weekText } from "../../TimelinePage";
import { downloadPdf } from "../pdf";
import { composeHref, rpHash } from "../state";
import { atCap, canSet, groups, moveShown, setMode } from "./list";
import { GENERATING_RETRY_MS, useCompose } from "./useCompose";

const MODES: ComposeMode[] = ["show", "other", "hide"];

/** Fits the preview page once its web fonts are in (fitting before measures fallback glyphs); at once when the
 *  frame has no font API. */
export function fitWhenReady(w: (Window & { __fit?: () => unknown }) | null): void {
  if (!w) return;
  const run = () => { try { w.__fit?.(); } catch { /* not ready */ } };
  const ready = w.document?.fonts?.ready;
  if (ready) void ready.then(run, run); else run();
}
const h1 = (m: number) => `${(Math.round(m / 6) / 10).toFixed(1)}h`;

/** The composer's week from its address (`#/v2/report/<week>/pdf`); null when it is no valid week — never this
 *  week instead, as the 週報's own address falls back to. */
const weekOf = (hash: string): string | null => {
  const w = parseV2Route(hash).param;
  return w && isValidWeek(w) ? w : null;
};

export function ComposePage() {
  const { lang } = useV2();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const week = weekOf(hash);
  const [dl, setDl] = useState<Lang>("ja");          // design D5: Japanese unless picked, whatever the UI language
  if (!week) {
    return (
      <div className="rp cmp">
        <section className="sec rp-ctl">
          <a className="key dim" href="#/v2/report"><Led ui tier={1} fit text={t(lang, "rp.cmp.back")} /></a>
        </section>
        <section className="rp-wait" role="alert"><Led ui tier={2} fit text={t(lang, "rp.unavailable")} /></section>
      </div>
    );
  }
  // one composer per week and export language: a switch starts from that view, with no rows or token carried over
  return <Composer key={`${week}/${dl}`} week={week} dl={dl} setDl={setDl} back={rpHash(hash, { week })} />;
}

function Composer({ week, dl, setDl, back }: { week: string; dl: Lang; setDl: (l: Lang) => void; back: string }) {
  const { lang } = useV2();
  const c = useCompose(week, dl);
  const g = groups(c.rows);
  const [ask, setAsk] = useState<null | "overwrite" | "stale">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);       // 409 generating: another tab or click is generating
  const [unavailable, setUnavailable] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const drag = useRef<string | null>(null);
  const v = c.view;

  useEffect(() => {
    if (!locked) return;
    const h = setTimeout(() => { setLocked(false); void c.reload(); }, GENERATING_RETRY_MS);
    return () => clearTimeout(h);
  }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps

  const runGenerate = async () => {
    setAsk(null); setMsg(null);
    const r = await c.generate();
    if (r.ok) return;
    if (r.status === 409 && r.reason === "generating") setLocked(true);
    else if (r.status === 503) { setUnavailable(true); setMsg(t(lang, "rp.cmp.genNone")); }
    else if (r.status === 422) setMsg(t(lang, "rp.cmp.genEmpty"));
    else if (r.status === 500 && r.reason === "hidden leak") setMsg(t(lang, "rp.cmp.genLeak"));
    else setMsg(t(lang, "rp.cmp.genFail", { r: r.reason }));
  };
  const onGenerate = () => (v?.edited ? setAsk("overwrite") : void runGenerate());
  const runPdf = async () => {
    setAsk(null); setMsg(null); setPdfBusy(true);
    const r = await downloadPdf(week, dl);
    setPdfBusy(false);
    if (!r.ok) setMsg(r.busy ? (r.busy > 60 ? t(lang, "rp.dl.quota") : t(lang, "rp.dl.wait", { s: r.busy })) : t(lang, "rp.dl.fail"));
  };
  const onPdf = () => (v?.text && (v.stale.selection || v.stale.inputs) ? setAsk("stale") : void runPdf());
  const onDrop = (to: number) => (e: DragEvent) => {
    e.preventDefault();
    if (drag.current) c.change(moveShown(c.rows, drag.current, to));
    drag.current = null;
  };

  const row = (r: ComposeRowOut, i: number | null) => (
    <div key={r.id} className="cmp-row" data-id={r.id} draggable={i !== null}
      onDragStart={i !== null ? () => { drag.current = r.id; } : undefined}
      onDragOver={i !== null ? (e) => e.preventDefault() : undefined} onDrop={i !== null ? onDrop(i) : undefined}>
      {i !== null && <span className="grip" aria-hidden="true">⠿</span>}
      <span className="code">{r.id === "__unassigned" ? <Led ui tier={2} fit text="----" /> : <TaskBadge id={r.id} height={BADGE_H.row} />}</span>
      <span className="nm">{r.title}</span>
      <span className="m">{h1(r.minutes)}</span>
      {i !== null && <>
        <button type="button" className="key dim up" aria-label={t(lang, "rp.cmp.up")} disabled={i === 0} onClick={() => c.change(moveShown(c.rows, r.id, i - 1))}>↑</button>
        <button type="button" className="key dim dn" aria-label={t(lang, "rp.cmp.down")} disabled={i === g.show.length - 1} onClick={() => c.change(moveShown(c.rows, r.id, i + 1))}>↓</button>
      </>}
      <span className="keys" role="group">
        {MODES.map((m) => {
          const blocked = r.mode !== m && !canSet(c.rows, r.id, m);   // past the shown cap
          return (
            <button key={m} type="button" data-mode={m} className={`key${r.mode === m ? " on" : " dim"}`} aria-pressed={r.mode === m}
              disabled={blocked} title={blocked ? t(lang, "rp.cmp.cap") : undefined}
              onClick={() => c.change(setMode(c.rows, r.id, m))}><Led ui tier={1} fit text={t(lang, `rp.cmp.${m}`)} /></button>
          );
        })}
      </span>
    </div>
  );

  const busy = c.generating || locked || !!v?.generating;
  // another request is generating: our own 409, or a view that says so (another tab) while we are not the one asking
  const elsewhere = locked || (!!v?.generating && !c.generating);
  const status = !v ? null : elsewhere ? t(lang, "rp.cmp.genElsewhere") : !v.text ? t(lang, "rp.cmp.never")
    : v.stale.selection ? t(lang, "rp.cmp.staleSel") : v.stale.inputs ? t(lang, "rp.cmp.staleIn")
    : v.generated_at ? t(lang, "rp.cmp.genOk", { t: fmtHm(v.generated_at) }) : null;
  const days = reportWeekDates(week).map((date) => ({ date }));

  return (
    <div className="rp cmp">
      <section className="sec rp-ctl">
        <a className="key dim" href={back}><Led ui tier={1} fit text={t(lang, "rp.cmp.back")} /></a>
        <div className="keys" role="group" aria-label={t(lang, "tl.nav")}>
          <a className="key dim" aria-label={t(lang, "tl.prev")} href={composeHref(shiftWeek(week, -1))}><Led ui tier={2} fit text="◀" /></a>
          <Led ui size={12} tier={1} fit text={weekText(lang, { bands: days }, week)} />
          <a className="key dim" aria-label={t(lang, "tl.next")} href={composeHref(shiftWeek(week, 1))}><Led ui tier={2} fit text="▶" /></a>
        </div>
        <span className="grow" />
        <div className="keys" role="group" aria-label={t(lang, "rp.dl.lang")}>
          {LANGS.map((l) => (
            <button key={l} type="button" className={`key${dl === l ? " on" : " dim"}`} aria-pressed={dl === l} onClick={() => setDl(l)}>
              <Led ui tier={1} fit text={t(lang, `lang.${l}`)} />
            </button>
          ))}
        </div>
        <button type="button" className="key pri cmp-gen" disabled={!v || busy || unavailable} aria-busy={busy} onClick={onGenerate}>
          <Led ui tier={1} fit text={t(lang, busy ? "rp.cmp.genBusy" : "rp.cmp.gen")} />
        </button>
        <button type="button" className="key pri cmp-pdf" disabled={!v || pdfBusy} aria-busy={pdfBusy} onClick={onPdf}>
          <Led ui tier={1} fit text={t(lang, pdfBusy ? "rp.dl.busy" : "rp.dl.pdf")} />
        </button>
      </section>
      {ask && (
        <div className="cmp-ask" role="alertdialog">
          <span>{t(lang, ask === "overwrite" ? "rp.cmp.overwrite" : "rp.cmp.staleDl")}</span>
          {ask === "overwrite"
            ? <>
                <button type="button" className="key pri" onClick={() => void runGenerate()}><Led ui tier={1} fit text={t(lang, "rp.cmp.gen")} /></button>
                <button type="button" className="key dim" onClick={() => setAsk(null)}><Led ui tier={1} fit text={t(lang, "rp.e.cancel")} /></button>
              </>
            : <>
                <button type="button" className="key pri" disabled={busy || unavailable} onClick={onGenerate}><Led ui tier={1} fit text={t(lang, "rp.cmp.genFirst")} /></button>
                <button type="button" className="key dim" onClick={() => void runPdf()}><Led ui tier={1} fit text={t(lang, "rp.cmp.dlAnyway")} /></button>
              </>}
        </div>
      )}
      {!v
        ? (c.error
          ? <section className="rp-wait" role="alert"><Led ui tier={2} fit text={t(lang, "rp.failed")} /></section>
          : <section className="rp-wait" role="status"><Led ui tier={2} fit text={t(lang, "now.loading")} /></section>)
        : (
          <div className="cmp-body">
            <div className="cmp-left">
              <div className="cmp-show">{g.show.map((r, i) => row(r, i))}</div>
              {atCap(c.rows) && <p className="cmp-note" role="note">{t(lang, "rp.cmp.cap")}</p>}
              <h3 className="cmp-h">{t(lang, "rp.cmp.gOther")}</h3>
              <div className="cmp-other">{g.other.map((r) => row(r, null))}</div>
              <h3 className="cmp-h">{t(lang, "rp.cmp.gHide")}</h3>
              <div className="cmp-hide">{g.hide.map((r) => row(r, null))}</div>
              {status && <p className="cmp-status" role="status">{status}</p>}
              {c.conflict && <p className="cmp-status" role="status">{t(lang, "rp.cmp.conflict")}</p>}
              {c.saveFailed && <p className="cmp-status warn" role="alert">{t(lang, "rp.cmp.saveFail")}</p>}
              {msg && <p className="cmp-status warn" role="alert">{msg}</p>}
              {v.text && (
                <div className="cmp-text">
                  {(v.translating || c.textSaving) && <p className="cmp-status" role="status">{t(lang, "rp.cmp.translating")}</p>}
                  {!v.translating && !c.textSaving && v.translate_failed && <p className="cmp-status warn" role="status">{t(lang, "rp.cmp.trFail")}</p>}
                  {/* no edits while a generation runs: it would overwrite them (the server answers 409 too) */}
                  <InlineEdit ariaLabel={t(lang, "rp.cmp.sum")} className="rp-ed" multiline value={v.text.summary.join("\n")} disabled={busy}
                    restAriaLabel={t(lang, "rp.cmp.editLabel", { l: t(lang, "rp.cmp.sum"), v: v.text.summary.join("\n") })}
                    onSave={(s) => c.saveText({ summary: s.split("\n"), days: v.text!.days })} />
                  {/* the day lines are not edited here: the PDF's 日別 row lists each day's 案件 and hours (pdf/data.ts dayLines) */}
                </div>
              )}
            </div>
            <div className="cmp-right">
              <iframe className="cmp-pv" title="PDF" srcDoc={c.preview ?? ""} onLoad={(e) => {
                try { fitWhenReady(e.currentTarget.contentWindow); } catch { /* not ready */ }
              }} />
            </div>
          </div>
        )}
    </div>
  );
}
