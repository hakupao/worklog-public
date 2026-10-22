import { useEffect, useMemo, useRef, type PointerEvent } from "react";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf } from "../../../i18n/t";
import { useV2 } from "../../../ui/context";
import { setHoverTask } from "../../../ui/hover";
import { Led } from "../../../ui/Led";
import { C } from "../../../ui/palette";
import { useTaskGlyph } from "../../../ui/taskGlyph";
import { useTip } from "../../../ui/TipHost";
import { useWorld } from "../../../world/store";
import { taskCode } from "../../now/format";
import { bodyFont, useFontTick } from "../RhythmCol";
import { useFade } from "../useReveal";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { densityAt, densityHeight, deriveDensity, drawDensityOmote, drawDensityUra, type DensityGeom, type DensityRow } from "../viz/density";
import { tv } from "../viz/strings";
import { TipBadge, useViewHover } from "./DayParts";

const one = (v: number) => String(Math.round(v * 10) / 10);

/** 产出密度: per task, its sessions' turns per wall-clock hour on a log axis with the median; tasks with too little
 *  (lab filter) and unlinked time left out. The fastest task's median as the key figure. */
export function Density({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep } = useViz();
  const rows = useMemo(() => deriveDensity(prep), [prep]);
  if (!rows.length) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const f = rows[0], s = rows[rows.length - 1];
  const summary = tv(lang, "den.sum", { n: rows.length, k: taskCode(f.task), m: one(f.med), s: taskCode(s.task), l: one(s.med) });
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "den.meta", { k: taskCode(f.task), m: Math.round(f.med) })} summary={summary}>
      <DensityChart rows={rows} />
      <div className="sv-cap"><Led ui tier={3} clip className="fill" color={C.DIM} text={tv(lang, "den.cap")} /></div>
    </ViewFrame>
  );
}

function DensityChart({ rows }: { rows: DensityRow[] }) {
  const { lang } = useV2(), { tasks } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade(), sil = useTaskGlyph();
  const [hover, cv] = useViewHover();
  const geom = useRef<DensityGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawDensityOmote(x, rows, hover, { w, h }, bodyFont, sil) : drawDensityUra(x, rows, hover, { w, h, offX, offY }, glyphOf(lang), undefined, sil);
  }, [rows, hover, world, lang, tick, sil], cv);
  useEffect(() => { setTip(null); }, [rows, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, i = g ? densityAt(g, e.clientY - r.top) : null;
    const R = i === null ? null : rows[i];
    setHoverTask(R ? R.task : null);
    setTip(R ? {
      x: e.clientX, y: e.clientY, body: (
        <>
          <div className="h">
            <TipBadge id={R.task} />
            <span>{tasks.get(R.task)?.title ?? R.task}</span>
          </div>
          <div className="m">{tv(lang, "den.tip", { m: one(R.med), f: one(R.fmed) })}</div>
          <div className="s">{tv(lang, "den.tip.s", { n: R.sessions, h: hours(R.wall), t: R.turns, f: R.files })}</div>
        </>
      ),
    } : null);
  };
  return (
    <canvas ref={ref} className="sv-den" style={{ ...fade, height: densityHeight(rows.length) }} aria-hidden="true"
      onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setTip(null); }} />
  );
}
