import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { StatsPlan } from "../../../api/types";
import { hours } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf } from "../../../i18n/t";
import type { Lang } from "../../../prefs/types";
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
import { derivePlans, drawPlansOmote, drawPlansUra, plansAt, plansHeight, type Plans as Pl, type PlansGeom } from "../viz/plans";
import { tv, type VStrKey } from "../viz/strings";
import { dayLabel, TipBadge, useViewHover } from "./DayParts";

const st = (lang: Lang, v: StatsPlan["ai_status"]) => tv(lang, `pl.st.${v ?? "null"}` as VStrKey);

/** 计划兑现: the tasks the range's day-plan items name × the plan dates, each cell the items' AI / manual lamps over
 *  the task's wall clock that day; a several-task item sits in each of its tasks' rows. Items, AI done / judged,
 *  manual done and agreement as the key figure. */
export function Plans({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, plans } = useViz();
  const pl = useMemo(() => derivePlans(prep, plans), [prep, plans]);
  if (!pl.items) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const f = { n: pl.items, a: pl.aiDone, j: pl.judged, m: pl.manDone, g: pl.agree, b: pl.both };
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "pl.meta", f)} summary={tv(lang, "pl.sum", { ...f, d: pl.dates.length, r: pl.rows.length })}>
      {pl.rows.length > 0 ? <PlansChart pl={pl} />
        : <div className="sv-thin"><Led ui tier={2} clip className="fill" color={C.DIM} text={tv(lang, "pl.nolink")} /></div>}
    </ViewFrame>
  );
}

/** The matrix with its legend: how the columns fitted (C2: merged lamps, only the latest dates) comes from the draw. */
function PlansChart({ pl }: { pl: Pl }) {
  const { lang } = useV2();
  const [fit, setFit] = useState({ shown: pl.dates.length, merged: false });
  return (
    <>
      <PlansCanvas pl={pl} onFit={(g) => setFit((f) => (f.shown === g.nc && f.merged === g.merged ? f : { shown: g.nc, merged: g.merged }))} />
      {fit.shown < pl.dates.length && <div className="sv-cap"><Led ui tier={3} clip className="fill" color={C.DIM} text={tv(lang, "pl.last", { n: fit.shown })} /></div>}
      <div className="sv-cap"><Led ui tier={3} clip className="fill" color={C.DIM} text={tv(lang, fit.merged ? "pl.legend1" : "pl.legend")} /></div>
    </>
  );
}

function PlansCanvas({ pl, onFit }: { pl: Pl; onFit: (g: PlansGeom) => void }) {
  const { lang } = useV2(), { tasks } = useViz(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade(), sil = useTaskGlyph();
  const [hover, cv] = useViewHover();
  const geom = useRef<PlansGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawPlansOmote(x, pl, hover, { w, h }, bodyFont, sil) : drawPlansUra(x, pl, hover, { w, h, offX, offY }, glyphOf(lang), undefined, sil);
    onFit(geom.current);
  }, [pl, hover, world, lang, tick, sil], cv);
  useEffect(() => { setTip(null); }, [pl, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, at = g ? plansAt(g, e.clientX - r.left, e.clientY - r.top) : null;
    const row = at ? pl.rows[at.r] : null;
    setHoverTask(row ? row.task : null);
    if (!at || !row) { setTip(null); return; }
    const cell = row.cells[at.c];
    setTip({
      x: e.clientX, y: e.clientY, body: (
        <>
          <div className="h">
            <TipBadge id={row.task} />
            <span>{tasks.get(row.task)?.title ?? row.task}</span>
          </div>
          <div className="m">{tv(lang, "pl.day", { d: dayLabel(lang, pl.dates[at.c]), h: hours(cell.wall) })}</div>
          {cell.items.length ? cell.items.map((it, i) => (
            <div key={i} className="s">
              <span>{it.text}</span>{" · "}{tv(lang, "pl.item", { a: st(lang, it.ai_status), m: st(lang, it.manual_status) })}
              {it.task_ids.length > 1 ? tv(lang, "pl.items", { h: hours(cell.itemWall[i]) }) : ""}
            </div>
          )) : <div className="s">{tv(lang, "pl.none")}</div>}
        </>
      ),
    });
  };
  return (
    <canvas ref={ref} className="sv-pl" style={{ ...fade, height: plansHeight(pl.rows.length) }} aria-hidden="true"
      onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setTip(null); }} />
  );
}
