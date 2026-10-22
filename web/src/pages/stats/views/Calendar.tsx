import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import type { StrKey } from "../../../i18n/strings";
import { glyphOf, t } from "../../../i18n/t";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { CAL_HEIGHT, calAt, deriveCalendar, drawCalendarOmote, drawCalendarUra, type CalGeom, type Calendar as Cal } from "../viz/calendar";
import { tv } from "../viz/strings";
import { DayTip } from "./Waterfall";

/** 日历热力: weeks × weekdays, a bar per day as long as its wall clock, whiter the more it ran in parallel; the
 *  longest streak marked, weeks the range cuts labelled dim. Active days as the key figure. */
export function Calendar({ id, num }: ViewProps) {
  const { lang } = useV2(), { days } = useViz();
  const cal = useMemo(() => deriveCalendar(days), [days]);
  const active = days.filter((d) => d.union > 0).length;
  if (days.length < 2 || active === 0) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const top = days.reduce((m, d) => (d.union > m.union ? d : m));
  const cut = cal.weeks.filter((w) => w.cut).map((w) => w.label);
  const summary = tv(lang, "cal.sum", { w: cal.weeks.length, a: active, n: days.length, s: cal.streak?.len ?? 0, d: mdOf(top.date), h: hours(top.union) })
    + (cut.length ? tv(lang, "cal.cut", { w: cut.join(lang === "en" ? ", " : "、") }) : "");
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "cal.meta", { a: active, n: days.length })} summary={summary}>
      <CalChart cal={cal} />
    </ViewFrame>
  );
}

function CalChart({ cal }: { cal: Cal }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const geom = useRef<CalGeom | null>(null);
  const labels = useMemo(() => Array.from({ length: 7 }, (_, i) => t(lang, `tl.dow.${i + 1}` as StrKey)), [lang]);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawCalendarOmote(x, cal, labels, { w, h }, bodyFont)
      : drawCalendarUra(x, cal, labels, { w, h, offX, offY }, glyphOf(lang), lang === "en" ? 8 : 10);
  }, [cal, labels, world, lang, tick]);
  useEffect(() => { setTip(null); }, [cal, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, c = g ? calAt(g, cal, e.clientX - r.left, e.clientY - r.top) : null;
    if (!c) { setTip(null); return; }
    setTip({ x: e.clientX, y: e.clientY, body: <DayTip lang={lang} d={c.day} dow={c.dow} /> });
  };
  return <canvas ref={ref} className="sv-cal" style={{ ...fade, height: CAL_HEIGHT }} aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />;
}
