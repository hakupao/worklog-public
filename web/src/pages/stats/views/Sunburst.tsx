import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf, t } from "../../../i18n/t";
import type { Lang } from "../../../prefs/types";
import { useV2 } from "../../../ui/context";
import { setHoverTask } from "../../../ui/hover";
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
import { pct } from "../viz/fmt";
import { tv } from "../viz/strings";
import { deriveSunburst, drawSunOmote, drawSunUra, NO_REQ, SUN_HEIGHT, sunAt, UNLINKED, type Sunburst as Sb, type SunGeom, type SunMach, type SunTask } from "../viz/sunburst";
import { TipBadge, useViewHover } from "./DayParts";

const reqName = (lang: Lang, r: string) => (r === UNLINKED ? t(lang, "tl.unlinked") : r === NO_REQ ? tv(lang, "sun.noreq") : r);

/** 依頼元旭日: requester → task → machine rings on wall clock (overlaps and several requesters split evenly), and the
 *  requesters as a list beside. The largest requester's share as the key figure. */
export function Sunburst({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, segs, tasks } = useViz();
  const sb = useMemo(() => deriveSunburst(prep, segs, tasks), [prep, segs, tasks]);
  if (sb.total <= 0) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const reqs = sb.rings[0], top = reqs[0];
  const summary = tv(lang, "sun.sum", {
    t: hours(sb.total), list: reqs.map((z) => tv(lang, "sun.item", { r: reqName(lang, z.req), h: hours(z.v), p: pct(z.v / sb.total) })).join(lang === "en" ? ", " : "、"),
  });
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "sun.meta", { r: reqName(lang, top.req), p: pct(top.v / sb.total) })} summary={summary}>
      <div className="sv-fp">
        <SunChart sb={sb} />
        <div className="side">
          <div className="st-list" style={{ "--bc": "minmax(0,1.3fr) minmax(0,1fr) 84px 64px" } as CSSProperties}>
            {reqs.map((z) => (
              <div key={z.req} className="st-r">
                <span className="nm" lang={z.req === UNLINKED || z.req === NO_REQ ? undefined : "ja"}><Led tier={1} clip className="fill" color={z.req === UNLINKED || z.req === NO_REQ ? C.DIM : C.WARM} text={[{ t: reqName(lang, z.req), glyph: z.req === UNLINKED || z.req === NO_REQ ? undefined : "ja" }]} /></span>
                <ListBar frac={z.v / top.v} color={z.ri === 0 ? C.WARM : undefined} />
                <span className="r"><Led tier={1} fit text={hours(z.v)} /></span>
                <span className="r"><Led tier={2} fit text={pct(z.v / sb.total)} /></span>
              </div>
            ))}
          </div>
          <div className="sv-cap"><Led ui tier={3} clip className="fill" color={C.DIM} text={tv(lang, "sun.legend")} /></div>
        </div>
      </div>
    </ViewFrame>
  );
}

function SunChart({ sb }: { sb: Sb }) {
  const { lang } = useV2(), { tasks } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const [hover, cv] = useViewHover();
  const geom = useRef<SunGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawSunOmote(x, sb, hover, { w, h }, bodyFont, hours(sb.total)) : drawSunUra(x, sb, hover, { w, h, offX, offY }, glyphOf(lang));
  }, [sb, hover, world, lang, tick], cv);
  useEffect(() => { setTip(null); }, [sb, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, at = g ? sunAt(g, sb, e.clientX - r.left, e.clientY - r.top) : null;
    if (!at) { setHoverTask(null); setTip(null); return; }
    const p = (v: number) => tv(lang, "sun.tip", { h: hours(v), p: pct(v / sb.total, 1) });
    if (at.ring === 0) {
      const z = sb.rings[0][at.i];
      setHoverTask(null);
      setTip({ x: e.clientX, y: e.clientY, body: <><div className="h"><span lang={z.req === UNLINKED || z.req === NO_REQ ? undefined : "ja"}>{reqName(lang, z.req)}</span></div><div className="m">{p(z.v)}</div></> });
      return;
    }
    const z: SunTask | SunMach = at.ring === 1 ? sb.rings[1][at.i] : sb.rings[2][at.i];
    setHoverTask(z.task || null);
    setTip({
      x: e.clientX, y: e.clientY, body: (
        <>
          <div className="h">
            <TipBadge id={z.task || null} />
            <span>{z.task ? tasks.get(z.task)?.title ?? z.task : t(lang, "tl.unlinked")}</span>
          </div>
          <div className="m">{"machine" in z ? `${z.machine} · ` : ""}{p(z.v)}</div>
          <div className="s"><span lang={z.req === UNLINKED || z.req === NO_REQ ? undefined : "ja"}>{reqName(lang, z.req)}</span></div>
        </>
      ),
    });
  };
  return (
    <canvas ref={ref} className="sv-sun" style={{ ...fade, height: SUN_HEIGHT }} aria-hidden="true"
      onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setTip(null); }} />
  );
}
