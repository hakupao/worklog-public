import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { surface } from "../../../chart/canvas";
import { useCanvas } from "../../../chart/useCanvas";
import type { StrKey } from "../../../i18n/strings";
import { glyphOf, t } from "../../../i18n/t";
import { reducedMotion } from "../../../led/motion";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { setHoverTask } from "../../../ui/hover";
import { Led } from "../../../ui/Led";
import { C } from "../../../ui/palette";
import { useTaskGlyph } from "../../../ui/taskGlyph";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { weekdayOf } from "../viz/day";
import { peakDay, piecesOn, sessionsOn, type DaySession } from "../viz/dayview";
import { hm } from "../viz/fmt";
import { drawLanesOmote, drawLanesUra, drawRippleUra, drawRiverOmote, drawRiverUra, laneAt, lanesHeight, RIVER_HEIGHT, riverAt, waveAt, type LanesGeom, type RiverGeom } from "../viz/river";
import { tv } from "../viz/strings";
import type { DayAgg } from "../viz/wall";
import { DayKeys, SessionTip, useViewHover, useVisible } from "./DayParts";

/** 并行编队: the range's concurrency as a river, and one day — the peak day until another is picked (a click on the
 *  river, or the day keys) — opened up as one swim lane per session. The peak as the key figure. */
export function River({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, segs, days } = useViz();
  const peak = useMemo(() => peakDay(days), [days]);
  const [pick, setPick] = useState<string | null>(null);
  const date = pick !== null && days.some((d) => d.date === pick) ? pick : peak;
  const ss = useMemo(() => (date ? sessionsOn(prep, date) : []), [prep, date]);
  const pieces = useMemo(() => (date ? piecesOn(segs, date) : []), [segs, date]);
  const union = days.reduce((m, d) => m + d.union, 0);
  if (days.length < 2 || union <= 0 || !peak || !date) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const pk = days.find((d) => d.date === peak)!, day = days.find((d) => d.date === date)!;
  const summary = tv(lang, "river.sum", {
    n: days.length, c: pk.peak, d: mdOf(peak), t: hm(pk.peakAt!), o: mdOf(date), k: ss.length, u: hours(day.union), s: hours(day.sum),
  });
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "river.meta", { c: pk.peak, d: mdOf(peak) })} summary={summary}>
      <RiverChart days={days} sel={days.indexOf(day)} onPick={setPick} />
      <div className="sv-cap">
        <DayKeys days={days} date={date} peak={peak} onPick={setPick} />
        <span className="grow" />
        <Led ui tier={2} fit color={C.DIM} text={tv(lang, "river.day", { k: ss.length, c: day.peak, t: day.peakAt === null ? "—" : hm(day.peakAt) })} />
      </div>
      <Lanes day={day} ss={ss} pieces={pieces} />
    </ViewFrame>
  );
}

function RiverTip({ d }: { d: DayAgg }) {
  const { lang } = useV2();
  const ge = d.ge.slice(1).flatMap((m, k) => (m > 0 ? [tv(lang, "river.ge", { k: k + 1, h: hours(m) })] : []));
  return (
    <>
      <div className="h">{t(lang, "tl.d.title", { d: d.date, w: t(lang, `tl.dow.${weekdayOf(d.date) + 1}` as StrKey) })}</div>
      <div className="m">{tv(lang, "tip.wall", { u: hours(d.union), s: hours(d.sum), c: d.peak })}</div>
      {ge.length > 0 && <div className="s">{ge.join(" · ")}</div>}
    </>
  );
}

/** The river: its static layer drawn once per data / day / world / size (faded in by useFade); in 里 the travelling
 *  ripple runs on an overlay canvas, only while the river is on screen and motion is allowed. */
function RiverChart({ days, sel, onPick }: { days: readonly DayAgg[]; sel: number; onPick: (date: string) => void }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const geom = useRef<RiverGeom | null>(null), wrap = useRef<HTMLDivElement>(null), ov = useRef<HTMLCanvasElement>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawRiverOmote(x, days, sel, { w, h }, bodyFont) : drawRiverUra(x, days, sel, { w, h, offX, offY }, glyphOf(lang));
  }, [days, sel, world, lang, tick]);
  const visible = useVisible(wrap);
  useEffect(() => {
    const el = ov.current;
    if (!el || world !== "ura" || !visible || reducedMotion()) return;
    let id = 0, at: RiverGeom | null = null, s: ReturnType<typeof surface> = null;
    const frame = () => {
      if (reducedMotion()) return;
      const g = geom.current;
      if (g && g.cols) {
        if (g !== at) { at = g; s = surface(el); }     // the static layer was redrawn (data, size): size the overlay again
        if (s) drawRippleUra(s.ctx, g, waveAt(g.cols, performance.now()), s.w, s.h);
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [world, visible]);
  useEffect(() => { setTip(null); }, [days, setTip]);
  const dayAt = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, i = g ? riverAt(g, e.clientX - r.left) : null;
    return i === null ? null : days[i];
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = dayAt(e);
    setTip(d ? { x: e.clientX, y: e.clientY, body: <RiverTip d={d} /> } : null);
  };
  const click = (e: MouseEvent<HTMLCanvasElement>) => { const d = dayAt(e); if (d && d.union > 0) onPick(d.date); };
  return (
    <div ref={wrap} className="sv-stack" style={{ height: RIVER_HEIGHT }}>
      <canvas ref={ref} className="sv-rv" style={{ ...fade, height: RIVER_HEIGHT }} aria-hidden="true"
        onPointerMove={move} onPointerLeave={() => setTip(null)} onClick={click} />
      {world === "ura" && <canvas ref={ov} className="sv-ov" style={fade} aria-hidden="true" />}
    </div>
  );
}

/** The opened day: a concurrency strip, then one lane per session. Hover lights the session's task across the
 *  page (and here: the other tasks' lanes drop to .3). */
function Lanes({ day, ss, pieces }: { day: DayAgg; ss: DaySession[]; pieces: ReturnType<typeof piecesOn> }) {
  const { lang } = useV2(), { tasks, cost } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade(), sil = useTaskGlyph();
  const [hover, cv] = useViewHover();
  const geom = useRef<LanesGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawLanesOmote(x, day, pieces, ss, hover, { w, h }, bodyFont, sil)
      : drawLanesUra(x, day, pieces, ss, hover, { w, h, offX, offY }, glyphOf(lang), undefined, sil);
  }, [day, pieces, ss, hover, world, lang, tick, sil], cv);
  useEffect(() => { setTip(null); }, [ss, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, i = g ? laneAt(g, e.clientY - r.top) : null, o = i === null ? null : ss[i];
    setHoverTask(o ? o.s.task_id : null);
    setTip(o ? { x: e.clientX, y: e.clientY, body: <SessionTip o={o} title={o.s.task_id ? tasks.get(o.s.task_id)?.title : undefined} cost={cost} /> } : null);
  };
  return (
    <canvas ref={ref} className="sv-ln" style={{ ...fade, height: lanesHeight(ss.length) }} aria-hidden="true"
      onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setTip(null); }} />
  );
}
