import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import { compactCount, usd } from "../../../lib/format";
import { surface } from "../../../chart/canvas";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf } from "../../../i18n/t";
import { reducedMotion } from "../../../led/motion";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { setHoverTask } from "../../../ui/hover";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { day5 } from "../viz/day";
import { hmin } from "../viz/fmt";
import { deriveStars, drawStarsOmote, drawStarsUra, drawTwinkleUra, starAt, STARS_HEIGHT, type Stars as St, type StarsGeom } from "../viz/stars";
import { tv } from "../viz/strings";
import { SessionTip, useViewHover, useVisible } from "./DayParts";

/** 会话星图: every session in the range as a star (start × log length, size = tokens, colour = task, hollow = Codex);
 *  hovering a task anywhere draws its constellation. The session count and the biggest token count as the key
 *  figure; no amount anywhere when stats.cost is hidden in 表. */
export function Stars({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, cost } = useViz();
  const st = useMemo(() => deriveStars(prep), [prep]);
  if (!st.stars.length) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const day = (ms: number) => mdOf(day5(ms));
  const summary = tv(lang, "stars.sum", { n: st.stars.length, l: hmin(st.longest!.wall), d: day(st.longest!.t0), k: compactCount(st.maxTok) })
    + (cost && st.costliest ? tv(lang, "stars.sum.cost", { c: usd(st.costliest.cost_usd!), d: day(st.costliest.t0) }) : "");
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "stars.meta", { n: st.stars.length, k: compactCount(st.maxTok) })} summary={summary}>
      <StarsChart st={st} />
    </ViewFrame>
  );
}

/** The stars' static layer is drawn once per data / hover / world / size (faded in by useFade); in 里 the twinkle
 *  runs on an overlay canvas, only while the chart is on screen and motion is allowed. */
function StarsChart({ st }: { st: St }) {
  const { lang } = useV2(), { prep, tasks, cost } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const [hover, cv] = useViewHover();
  const geom = useRef<StarsGeom | null>(null), wrap = useRef<HTMLDivElement>(null), ov = useRef<HTMLCanvasElement>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawStarsOmote(x, st, prep, hover, cost, { w, h }, bodyFont)
      : drawStarsUra(x, st, prep, hover, cost, { w, h, offX, offY }, glyphOf(lang));
  }, [st, prep, hover, cost, world, lang, tick], cv);
  const visible = useVisible(wrap);
  useEffect(() => {
    const el = ov.current;
    if (!el || world !== "ura" || !visible || reducedMotion()) return;
    let id = 0, at: StarsGeom | null = null, s: ReturnType<typeof surface> = null;
    const frame = () => {
      if (reducedMotion()) return;
      const g = geom.current;
      if (g) {
        if (g !== at) { at = g; s = surface(el); }     // the static layer was redrawn (data, hover, size): size the overlay again
        if (s) drawTwinkleUra(s.ctx, g, performance.now(), s.w, s.h);
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [world, visible]);
  useEffect(() => { setTip(null); }, [st, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, i = g ? starAt(g, e.clientX - r.left, e.clientY - r.top) : null;
    const s = i === null ? null : st.stars[i].s;
    setHoverTask(s ? s.task_id : null);
    setTip(s ? {
      x: e.clientX, y: e.clientY,
      body: <SessionTip o={{ s, iv: s.iv, a: s.t0, b: s.t1, wall: s.wall }} title={s.task_id ? tasks.get(s.task_id)?.title : undefined} cost={cost} whole />,
    } : null);
  };
  return (
    <div ref={wrap} className="sv-stack" style={{ height: STARS_HEIGHT }}>
      <canvas ref={ref} className="sv-stars" style={{ ...fade, height: STARS_HEIGHT }} aria-hidden="true"
        onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setTip(null); }} />
      {world === "ura" && <canvas ref={ov} className="sv-ov" style={fade} aria-hidden="true" />}
    </div>
  );
}
