import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import type { StrKey } from "../../../i18n/strings";
import { glyphOf, t } from "../../../i18n/t";
import type { Lang } from "../../../prefs/types";
import { useV2 } from "../../../ui/context";
import { Led } from "../../../ui/Led";
import { C } from "../../../ui/palette";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { ListBar } from "../ListBar";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { busiest } from "../viz/echarts-theme";
import { deriveFingerprint, drawFpOmote, drawFpUra, drawHoursOmote, drawHoursUra, FP_HEIGHT, fpAt, HOURS_HEIGHT, type Fingerprint as Fp, type FpGeom } from "../viz/fingerprint";
import { hh } from "../viz/hours24";
import { tv } from "../viz/strings";

const wdName = (lang: Lang, w: number) => tv(lang, "wd.name", { d: t(lang, `tl.dow.${w + 1}` as StrKey) });

/** 节律指纹: seven rings of 24 clock hours (Monday inside), each cell its weekday-hour's average wall clock per day;
 *  beside it the weekday averages and the hour totals. Needs every weekday in the range (≥ 7 days, as 星期均值). The
 *  brightest cell as the key figure. */
export function Fingerprint({ id, num }: ViewProps) {
  const { lang } = useV2(), { segs, days } = useViz();
  const fp = useMemo(() => deriveFingerprint(segs, days), [segs, days]);
  if (days.length < 7 || !fp.best) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const b = fp.best, bw = busiest(fp.wd.avg);
  const summary = tv(lang, "fp.sum", {
    w: wdName(lang, b.w), h: hh(b.h), m: Math.round(fp.av[b.w][b.h]), bh: hh(fp.bestH), v: hours(fp.hours[fp.bestH]), bw: wdName(lang, bw), a: hours(fp.wd.avg[bw] ?? 0),
  });
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "fp.meta", { w: wdName(lang, b.w), h: hh(b.h) })} summary={summary}>
      <div className="sv-fp">
        <Rings fp={fp} />
        <div className="side">
          <div className="st-sub"><Led ui tier={2} fit text={tv(lang, "fp.wd")} /></div>
          <WeekdayRows fp={fp} best={bw} />
          <div className="st-sub"><Led ui tier={2} fit text={tv(lang, "fp.hours")} /></div>
          <HourBars fp={fp} />
        </div>
      </div>
    </ViewFrame>
  );
}

function Rings({ fp }: { fp: Fp }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const geom = useRef<FpGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawFpOmote(x, fp, { w, h }, bodyFont) : drawFpUra(x, fp, { w, h, offX, offY }, glyphOf(lang));
  }, [fp, world, lang, tick]);
  useEffect(() => { setTip(null); }, [fp, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, c = g ? fpAt(g, e.clientX - r.left, e.clientY - r.top) : null;
    setTip(c ? {
      x: e.clientX, y: e.clientY, body: (
        <>
          <div className="h">{tv(lang, "fp.tip", { w: wdName(lang, c.w), a: hh(c.h), b: hh(c.h + 1) })}</div>
          <div className="m">{tv(lang, "fp.avg", { m: Math.round(fp.av[c.w][c.h]) })}</div>
          <div className="s">{tv(lang, "fp.tot", { h: hours(fp.hm[c.w][c.h]), n: fp.wd.n[c.w] })}</div>
        </>
      ),
    } : null);
  };
  return <canvas ref={ref} className="sv-fpr" style={{ ...fade, height: FP_HEIGHT }} aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />;
}

function WeekdayRows({ fp, best }: { fp: Fp; best: number }) {
  const { lang } = useV2(), max = Math.max(0, ...fp.wd.avg.map((m) => m ?? 0));
  return (
    <div className="st-list" style={{ "--bc": "72px minmax(0,1fr) 184px" } as CSSProperties}>
      {fp.wd.avg.map((m, w) => (
        <div key={w} className="st-r">
          <span className="nm"><Led tier={w >= 5 ? 2 : 1} fit text={wdName(lang, w)} /></span>
          <ListBar frac={max > 0 ? (m ?? 0) / max : 0} color={w === best ? C.WARM : undefined} />
          <span className="r"><Led tier={1} fit color={w === best ? C.WARM : C.AMBER} text={tv(lang, "weekday.perDay", { v: hours(m ?? 0) })} /></span>
        </div>
      ))}
    </div>
  );
}

function HourBars({ fp }: { fp: Fp }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), fade = useFade();
  const ref = useCanvas((x, w, h, offX, offY) => {
    if (world === "omote") drawHoursOmote(x, fp.hours, fp.bestH, { w, h }, bodyFont);
    else drawHoursUra(x, fp.hours, fp.bestH, { w, h, offX, offY });
  }, [fp, world]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), h = Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * 24);
    setTip(h >= 0 && h < 24 ? { x: e.clientX, y: e.clientY, body: <><div className="h">{`${hh(h)}–${hh(h + 1)}`}</div><div className="m">{tv(lang, "wall", { v: hours(fp.hours[h]) })}</div></> } : null);
  };
  return <canvas ref={ref} className="sv-fph" style={{ ...fade, height: HOURS_HEIGHT }} aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />;
}
