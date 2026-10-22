import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf } from "../../../i18n/t";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { setHoverTask } from "../../../ui/hover";
import { Led } from "../../../ui/Led";
import { C } from "../../../ui/palette";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { useMinute } from "../../now/useNowData";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { day5 } from "../viz/day";
import { peakDay } from "../viz/dayview";
import { defaultDialDay, deriveDial, dialAt, dialGeom, DIAL_HEIGHT, drawDialOmote, drawDialUra, drawHandOmote, drawHandUra, type Dial as D, type DialGeom } from "../viz/dial";
import { hm } from "../viz/fmt";
import { tv } from "../viz/strings";
import { dayLabel, DayKeys, SessionTip, useViewHover } from "./DayParts";

/** 大圆表盘: one 5:00 day as a 24-hour face — sessions as arcs in greedy lanes, the concurrency ring, the now hand
 *  (moved once a minute, on the day that holds now). The latest day with three hours or more opens first; the day
 *  keys step through days with sessions, to the peak day and to today. The time now as the key figure on today's face,
 *  the day's wall clock on any other (R3). */
export function Dial({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, segs, days } = useViz(), now = useMinute();
  const peak = useMemo(() => peakDay(days), [days]);
  const [pick, setPick] = useState<string | null>(null);
  const date = pick !== null && days.some((d) => d.date === pick) ? pick : defaultDialDay(days, peak);
  const dial = useMemo(() => { const d = days.find((x) => x.date === date); return d ? deriveDial(prep, segs, d) : null; }, [prep, segs, days, date]);
  if (!dial || !days.some((d) => d.union > 0)) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const today = day5(now.getTime()), d = dial.day;
  const summary = tv(lang, "dial.sum", { d: dayLabel(lang, d.date), u: hours(d.union), s: hours(d.sum), c: d.peak, k: dial.arcs.length, l: dial.lanes });
  return (
    <ViewFrame id={id} num={num} meta={d.date === today ? tv(lang, "dial.meta", { t: hm(now.getTime()) }) : tv(lang, "wall", { v: hours(d.union) })} summary={summary}>
      <div className="sv-dial">
        <Face dial={dial} now={d.date === today ? now.getTime() : null} />
        <div className="side">
          <DayKeys days={days} date={d.date} peak={peak} today={days.some((x) => x.date === today) ? today : null} onPick={setPick} />
          <Led ui size={12} tier={1} fit color={C.WARM} text={tv(lang, "wall", { v: hours(d.union) })} />
          <Led ui tier={2} fit text={tv(lang, "dial.fig", { s: hours(d.sum), c: d.peak })} />
          <Led ui tier={2} fit color={C.DIM} text={tv(lang, "dial.lanes", { k: dial.arcs.length, l: dial.lanes })} />
        </div>
      </div>
    </ViewFrame>
  );
}

/** The face is drawn once per day / hover / world / size (faded in by useFade); the hand is its own overlay canvas,
 *  redrawn when the minute turns (`now`; null = the day shown is not today, no hand). */
function Face({ dial, now }: { dial: D; now: number | null }) {
  const { lang } = useV2(), { tasks, cost } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const [hover, cv] = useViewHover();
  const geom = useRef<DialGeom | null>(null);
  const label = mdOf(dial.day.date);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawDialOmote(x, dial, hover, label, { w, h }, bodyFont) : drawDialUra(x, dial, hover, label, { w, h, offX, offY }, glyphOf(lang));
  }, [dial, hover, label, world, lang, tick], cv);
  const hand = useCanvas((x, w, h, offX, offY) => {
    const g = dialGeom({ w, h, offX, offY }, world === "ura", dial.lanes);
    if (now === null) x.clearRect(0, 0, w, h);
    else if (world === "omote") drawHandOmote(x, g, now, w, h, bodyFont);
    else drawHandUra(x, g, now, w, h);
  }, [now, dial.lanes, world]);
  useEffect(() => { setTip(null); }, [dial, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, hit = g ? dialAt(g, dial, e.clientX - r.left, e.clientY - r.top) : null;
    if (hit && "arc" in hit) {
      const o = hit.arc;
      setHoverTask(o.s.task_id);
      setTip({ x: e.clientX, y: e.clientY, body: <SessionTip o={o} title={o.s.task_id ? tasks.get(o.s.task_id)?.title : undefined} cost={cost} /> });
      return;
    }
    setHoverTask(null);
    setTip(hit ? { x: e.clientX, y: e.clientY, body: <div className="m">{hit.c ? tv(lang, "tip.at", { t: hm(hit.ms), c: hit.c }) : tv(lang, "tip.idle", { t: hm(hit.ms) })}</div> } : null);
  };
  return (
    <div className="sv-stack" style={{ height: DIAL_HEIGHT }}>
      <canvas ref={ref} className="sv-dl" style={{ ...fade, height: DIAL_HEIGHT }} aria-hidden="true"
        onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setTip(null); }} />
      <canvas ref={hand} className="sv-ov sv-hand" style={fade} aria-hidden="true" />
    </div>
  );
}
