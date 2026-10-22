import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import type { StrKey } from "../../../i18n/strings";
import { glyphOf, t } from "../../../i18n/t";
import type { Lang } from "../../../prefs/types";
import { useV2 } from "../../../ui/context";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { dayStartMs, HOUR_MS } from "../viz/day";
import { clock5, hm } from "../viz/fmt";
import { tv } from "../viz/strings";
import type { DayAgg } from "../viz/wall";
import { cAt, deriveWaterfall, drawWaterfallOmote, drawWaterfallUra, waterAt, waterHeight, type WaterGeom, type Waterfall as WF } from "../viz/waterfall";

/** A day's tip (作息瀑布 / 日历热力): the date and weekday; its span, wall clock, summed and peak; its sessions, and
 *  what was open at `at` (hours after 05:00) when the pointer is on the hours. */
export function DayTip({ lang, d, dow, at }: { lang: Lang; d: DayAgg; dow: number; at?: { h: number; c: number } }) {
  const wall = tv(lang, "tip.wall", { u: hours(d.union), s: hours(d.sum), c: d.peak });
  const when = at && (at.c ? tv(lang, "tip.at", { t: clock5(at.h), c: at.c }) : tv(lang, "tip.idle", { t: clock5(at.h) }));
  return (
    <>
      <div className="h">{t(lang, "tl.d.title", { d: d.date, w: t(lang, `tl.dow.${dow + 1}` as StrKey) })}</div>
      <div className="m">{d.union ? `${hm(d.first!)}–${hm(d.last!)} · ${wall}` : "—"}</div>
      <div className="s">{[tv(lang, "tip.sess", { n: d.ids.length }), when].filter(Boolean).join(" · ")}</div>
    </>
  );
}

/** 作息瀑布: a row per 5:00 day × 24 hours from 05:00, brighter where more sessions ran at once; the median start /
 *  finish as the key figure. One day is too little to show (the 今天 range). */
export function Waterfall({ id, num }: ViewProps) {
  const { lang } = useV2(), { segs, days } = useViz();
  const wf = useMemo(() => deriveWaterfall(segs, days), [segs, days]);
  const union = days.reduce((m, d) => m + d.union, 0), sum = days.reduce((m, d) => m + d.sum, 0);
  if (days.length < 2 || union <= 0) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const s = wf.start === null ? "—" : clock5(wf.start), e = wf.end === null ? "—" : clock5(wf.end);
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "wf.meta", { s, e })}
      summary={tv(lang, "wf.sum", { n: days.length, u: hours(union), m: hours(sum), s, e })}>
      <WaterChart wf={wf} />
    </ViewFrame>
  );
}

function WaterChart({ wf }: { wf: WF }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const geom = useRef<WaterGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawWaterfallOmote(x, wf, { w, h }, bodyFont) : drawWaterfallUra(x, wf, { w, h, offX, offY }, glyphOf(lang));
  }, [wf, world, lang, tick]);
  useEffect(() => { setTip(null); }, [wf, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, hit = g ? waterAt(g, e.clientX - r.left, e.clientY - r.top) : null;
    if (!hit) { setTip(null); return; }
    const row = wf.rows[hit.row];
    const at = hit.h === null ? undefined : { h: hit.h, c: cAt(row, dayStartMs(row.day.date) + hit.h * HOUR_MS) };
    setTip({ x: e.clientX, y: e.clientY, body: <DayTip lang={lang} d={row.day} dow={row.dow} at={at} /> });
  };
  return <canvas ref={ref} className="sv-wf" style={{ ...fade, height: waterHeight(wf.rows.length) }} aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />;
}
