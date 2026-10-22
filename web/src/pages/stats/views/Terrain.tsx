import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import type { StrKey } from "../../../i18n/strings";
import { glyphOf, t as tr } from "../../../i18n/t";
import type { Lang } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { Led } from "../../../ui/Led";
import { C } from "../../../ui/palette";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { day5, weekdayOf } from "../viz/day";
import { clock5, hm } from "../viz/fmt";
import { tv } from "../viz/strings";
import { drawTerrainOmote, drawTerrainUra, terrainAt, terrainOf, TERRAIN_HEIGHT, turn, VIEW0, zAt, type Peak, type Terrain as Tr, type TerrGeom, type View } from "../viz/terrain";
import { peak, type DayAgg } from "../viz/wall";

/** What both 地形 views say (shared with Contour): the grid, the true peak, and the line stating the heights are
 *  smoothed — the land's top beside the true ×N from the sweep. Null when the range is too thin to draw (one day,
 *  nothing open). */
export function useLand(lang: Lang) {
  const { segs, days } = useViz();
  const pk = peak(segs);
  if (days.length < 2 || !pk) return null;
  const land = terrainOf(segs, days), d = mdOf(day5(pk.at)), at = hm(pk.at);
  return {
    land,
    meta: tv(lang, "terr.meta", { c: pk.c, d }),
    note: tv(lang, "terr.note", { z: land.zmax.toFixed(1), c: pk.c, d, t: at }),
    list: (ps: Peak[]) => ps.map((p) => `${mdOf(land.dates[p.d])} ${clock5(p.b / 4)} ≈${p.z.toFixed(1)}`).join(lang === "en" ? ", " : "、") || "—",
  };
}

/** The smoothed-heights line under a 地形 view. */
export function LandNote({ text }: { text: string }) {
  return <div className="sv-cap"><Led ui tier={2} clip className="fill" color={C.DIM} text={text} /></div>;
}

/** A point on the land: the day, the smoothed height there (marked as such), and the day's own wall clock, summed
 *  and true peak. */
export function LandTip({ lang, land, day, d, h, bf }: { lang: Lang; land: Tr; day: DayAgg; d: number; h: number; bf: number }) {
  return (
    <>
      <div className="h">{tr(lang, "tl.d.title", { d: day.date, w: tr(lang, `tl.dow.${weekdayOf(day.date) + 1}` as StrKey) })}</div>
      <div className="m">{tv(lang, "terr.tip", { t: clock5(h), z: zAt(land, d, bf).toFixed(1) })}</div>
      <div className="s">{tv(lang, "tip.wall", { u: hours(day.union), s: hours(day.sum), c: day.peak })}</div>
    </>
  );
}

/** 地形 · 立体: the days × hours of concurrency as a relief (hidden lines removed), turned by drag or the arrow keys;
 *  the three highest summits dated. The true peak as the key figure; the heights are smoothed, and it says so. */
export function Terrain({ id, num }: ViewProps) {
  const { lang } = useV2(), { days } = useViz(), L = useLand(lang);
  if (!L) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  return (
    <ViewFrame id={id} num={num} meta={L.meta} summary={tv(lang, "terr.sum", { n: days.length, list: L.list(L.land.peaks.slice(0, 3)) }) + L.note}>
      <Relief land={L.land} />
      <LandNote text={L.note} />
    </ViewFrame>
  );
}

const KEYS: Record<string, [number, number]> = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] };

/** The relief, redrawn per view / data / world / size (faded in by useFade). No sway: it would change the projection
 *  and so redraw the whole relief every frame; the drag / keys turn it instead, a drag at most once per frame and, in
 *  里, coarse until the release (P1) — the release draws it whole at the last pointer. */
function Relief({ land }: { land: Tr }) {
  const { lang } = useV2(), { days } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const [view, setView] = useState<View>(VIEW0);
  const [coarse, setCoarse] = useState(false), lo = coarse && world === "ura";
  const geom = useRef<TerrGeom | null>(null), drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const frame = useRef<{ id: number; v: View } | null>(null);   // the drag's latest view, applied on the next frame
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current.id); }, []);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawTerrainOmote(x, land, view, { w, h }, bodyFont) : drawTerrainUra(x, land, view, { w, h, offX, offY }, glyphOf(lang), undefined, lo);
  }, [land, view, lo, world, lang, tick]);
  useEffect(() => { setTip(null); }, [land, setTip]);
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, v: view };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setTip(null);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const dr = drag.current;
    if (dr) {
      const v = turn(dr.v, (e.clientX - dr.x) / 160, -(e.clientY - dr.y) / 200);
      if (frame.current) frame.current.v = v;
      else frame.current = { v, id: requestAnimationFrame(() => { const f = frame.current!; frame.current = null; setView(f.v); setCoarse(true); }) };
      return;
    }
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, hit = g ? terrainAt(g, land, e.clientX - r.left, e.clientY - r.top) : null;
    setTip(hit ? { x: e.clientX, y: e.clientY, body: <LandTip lang={lang} land={land} day={days[hit.d]} {...hit} /> } : null);
  };
  const up = () => {
    drag.current = null;
    const f = frame.current;                      // a frame still pending: its view goes into the one whole redraw
    if (f) { cancelAnimationFrame(f.id); frame.current = null; setView(f.v); }
    setCoarse(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    setView((v) => turn(v, k[0], k[1]));
  };
  return (
    <div className="sv-tw" tabIndex={0} role="group" aria-label={tv(lang, "terr.keys")} onKeyDown={key}>
      <canvas ref={ref} className="sv-terr" style={{ ...fade, height: TERRAIN_HEIGHT }} aria-hidden="true"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setTip(null)} />
    </div>
  );
}
