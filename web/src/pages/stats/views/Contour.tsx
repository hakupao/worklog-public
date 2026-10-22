import { useEffect, useRef, type PointerEvent } from "react";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf } from "../../../i18n/t";
import { useV2 } from "../../../ui/context";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { tv } from "../viz/strings";
import { contourAt, contourHeight, drawContourOmote, drawContourUra, type ContourGeom, type Terrain as Tr } from "../viz/terrain";
import { LandNote, LandTip, useLand } from "./Terrain";

/** 地形 · 等高线: the 立体 view's land (the same memoised grid) from above, a contour wherever the level changes, the
 *  six summits marked ×height date. The true peak as the key figure; the heights are smoothed, and it says so. */
export function Contour({ id, num }: ViewProps) {
  const { lang } = useV2(), L = useLand(lang);
  if (!L) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  return (
    <ViewFrame id={id} num={num} meta={L.meta} summary={tv(lang, "cont.sum", { list: L.list(L.land.peaks) }) + L.note}>
      <ContourMap land={L.land} />
      <LandNote text={L.note} />
    </ViewFrame>
  );
}

function ContourMap({ land }: { land: Tr }) {
  const { lang } = useV2(), { days } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const geom = useRef<ContourGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawContourOmote(x, land, { w, h }, bodyFont) : drawContourUra(x, land, { w, h, offX, offY }, glyphOf(lang));
  }, [land, world, lang, tick]);
  useEffect(() => { setTip(null); }, [land, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, hit = g ? contourAt(g, e.clientX - r.left, e.clientY - r.top) : null;
    setTip(hit ? { x: e.clientX, y: e.clientY, body: <LandTip lang={lang} land={land} day={days[hit.d]} {...hit} /> } : null);
  };
  return <canvas ref={ref} className="sv-cont" style={{ ...fade, height: contourHeight(land.dates.length) }} aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />;
}
