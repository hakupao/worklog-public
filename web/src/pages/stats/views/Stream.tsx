import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf, t } from "../../../i18n/t";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { setHoverTask } from "../../../ui/hover";
import { Led } from "../../../ui/Led";
import { C, lineColor } from "../../../ui/palette";
import { useTaskGlyph } from "../../../ui/taskGlyph";
import { useTip } from "../../../ui/TipHost";
import { BADGE_H, TaskBadge } from "../../../ui/TaskBadge";
import { useWorld } from "../../../world/store";
import { taskCode } from "../../now/format";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { DAY_MS } from "../viz/day";
import { tv } from "../viz/strings";
import { deriveStream, drawStreamOmote, drawStreamUra, STREAM_HEIGHT, streamAt, type Stream as St, type StreamGeom } from "../viz/stream";
import { TipBadge, useViewHover } from "./DayParts";

const md = (date: string, plus: number) => mdOf(new Date(Date.parse(`${date}T00:00:00Z`) + plus * DAY_MS).toISOString().slice(0, 10));

/** 案件时间流: each task's weekly wall clock as a band (concurrent tasks split evenly, U17), weeks the range cuts
 *  labelled dim; a legend of the tasks by their range total. The task with the most time as the key figure. */
export function Stream({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, days, tasks } = useViz();
  const st = useMemo(() => deriveStream(prep, days), [prep, days]);
  const rows = useMemo(() => [...st.totals].sort((a, b) => b[1] - a[1]), [st]);
  if (days.length < 2 || !rows.length) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const [top, topMin] = rows[0];
  const cut = st.weeks.filter((w) => w.cut).map((w) => w.label);
  const summary = tv(lang, "stream.sum", { w: st.weeks.length, n: rows.length, k: taskCode(top || null), h: hours(topMin) })
    + (cut.length ? tv(lang, "cal.cut", { w: cut.join(lang === "en" ? ", " : "、") }) : "");
  const title = (k: string) => (k ? tasks.get(k)?.title ?? k : t(lang, "tl.unlinked"));
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "stream.meta", { k: taskCode(top || null) })} summary={summary}>
      <StreamChart st={st} title={title} />
      <div className="sv-leg">
        {rows.map(([k, m]) => (
          <div key={k} className="st-r" data-task={k || undefined} style={{ "--lc": lineColor(k || null) } as CSSProperties}>
            <span className="nm">{k ? <TaskBadge id={k} height={BADGE_H.row} /> : <Led tier={1} fit color={C.DIM} text={taskCode(null)} />}</span>
            <span className="nm"><Led tier={2} clip className="fill" text={title(k)} /></span>
            <span className="r"><Led tier={1} fit text={hours(m)} /></span>
          </div>
        ))}
      </div>
    </ViewFrame>
  );
}

function StreamChart({ st, title }: { st: St; title: (k: string) => string }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade(), sil = useTaskGlyph();
  const [hover, cv] = useViewHover();
  const geom = useRef<StreamGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawStreamOmote(x, st, hover, { w, h }, bodyFont, sil) : drawStreamUra(x, st, hover, { w, h, offX, offY }, glyphOf(lang), undefined, sil);
  }, [st, hover, world, lang, tick, sil], cv);
  useEffect(() => { setTip(null); }, [st, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, hit = g ? streamAt(g, st, e.clientX - r.left, e.clientY - r.top) : null;
    setHoverTask(hit ? hit.key || null : null);
    if (!hit) { setTip(null); return; }
    const wk = st.weeks[hit.w], k = hit.key;
    setTip({
      x: e.clientX, y: e.clientY, body: (
        <>
          <div className="h">
            <TipBadge id={k || null} />
            <span>{title(k)}</span>
          </div>
          <div className="m">{tv(lang, "stream.week", { w: wk.label, a: md(wk.mon, 0), b: md(wk.mon, 6) }) + (wk.cut ? tv(lang, "stream.cut") : "")} · {tv(lang, "wall", { v: hours(wk.by.get(k) ?? 0) })}</div>
          <div className="s">{tv(lang, "stream.tot", { h: hours(st.totals.get(k) ?? 0) })}</div>
        </>
      ),
    });
  };
  return (
    <canvas ref={ref} className="sv-stream" style={{ ...fade, height: STREAM_HEIGHT }} aria-hidden="true"
      onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setTip(null); }} />
  );
}
