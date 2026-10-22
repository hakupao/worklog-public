import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { compactCount, hours, usd } from "../../../lib/format";
import { useCanvas } from "../../../chart/useCanvas";
import { glyphOf } from "../../../i18n/t";
import { mdOf } from "../../../predict/time";
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
import { computeAt, computeHeight, deriveCompute, drawComputeOmote, drawComputeUra, type Compute as Cm, type ComputeGeom, type Share } from "../viz/compute";
import { DAY_MS } from "../viz/day";
import { pct } from "../viz/fmt";
import { tv } from "../viz/strings";

const md = (date: string, plus: number) => mdOf(new Date(Date.parse(`${date}T00:00:00Z`) + plus * DAY_MS).toISOString().slice(0, 10));
/** An amount; `*` when some of its sessions are unpriced. */
const amt = (x: number, partial: boolean) => usd(x) + (partial ? "*" : "");
const perH = (x: number | null) => (x === null ? "—" : usd(x));

/** 算力构成 (needs stats.cost, so 表 with amounts hidden never renders it): weekly token columns by kind with the
 *  week's cost and cost per wall-clock hour, and beside them the machine / agent shares of wall clock and cost, the
 *  model families' tokens and the subagents' share. The range's cost and cost per wall-clock hour as the key figure. */
export function Compute({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, segs, days } = useViz();
  const c = useMemo(() => deriveCompute(prep, segs, days), [prep, segs, days]);
  const [drawn, setDrawn] = useState<number | null>(null);   // the unit as drawn (narrow columns take a larger one)
  const unit = drawn ?? c.unit;
  if (!prep.sessions.length) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const top = c.weeks.reduce((m, w) => (w.cost > m.cost ? w : m));
  const summary = tv(lang, "cmp.sum", {
    w: c.weeks.length, k: compactCount(c.tok), u: compactCount(unit), c: amt(c.cost, c.partial), r: perH(c.perHour), bw: top.label, bc: amt(top.cost, top.partial),
  }) + (lang === "en" ? ". " : "。") + [...c.machines, ...c.agents].map((s) => tv(lang, "cmp.share", { k: s.key, w: hours(s.wall), c: usd(s.cost) })).join(lang === "en" ? "; " : "；");
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "cmp.meta", { c: amt(c.cost, c.partial), r: perH(c.perHour) })} summary={summary}>
      <div className="sv-cmp">
        <div className="main">
          <ComputeChart c={c} onUnit={setDrawn} />
          <div className="sv-cap"><Led ui tier={3} clip className="fill" color={C.DIM} text={tv(lang, "cmp.unit", { u: compactCount(unit) })} /></div>
          {c.partial && <div className="sv-cap"><Led ui tier={3} clip className="fill" color={C.DIM} text={tv(lang, "cmp.partial")} /></div>}
        </div>
        <div className="side">
          <Shares title={tv(lang, "cmp.mach")} rows={c.machines} />
          <Shares title={tv(lang, "cmp.agent")} rows={c.agents} />
          <div className="st-sub"><Led ui tier={2} fit text={tv(lang, "cmp.fam")} /></div>
          <div className="st-list" style={{ "--bc": "112px minmax(0,1fr) 72px 64px" } as CSSProperties}>
            {c.families.map(([f, n]) => (
              <div key={f} className="st-r">
                <span className="nm"><Led tier={1} fit color={C.WARM} text={f} /></span>
                <ListBar frac={n / c.families[0][1]} />
                <span className="r"><Led tier={1} fit text={compactCount(n)} /></span>
                <span className="r"><Led tier={2} fit text={pct(n / c.tok)} /></span>
              </div>
            ))}
          </div>
          <div className="st-sub"><Led ui tier={2} fit text={tv(lang, "cmp.sub", { p: pct(c.tok ? c.sub / c.tok : 0, 1) })} /></div>
        </div>
      </div>
    </ViewFrame>
  );
}

function Shares({ title, rows }: { title: string; rows: Share[] }) {
  const { lang } = useV2();
  const wall = rows.reduce((m, s) => m + s.wall, 0), cost = rows.reduce((m, s) => m + s.cost, 0);
  return (
    <>
      <div className="st-sub"><Led ui tier={2} fit text={title} /></div>
      <div className="st-list" style={{ "--bc": "176px minmax(0,1fr) 64px minmax(0,1fr) 64px" } as CSSProperties}>
        <div className="st-r head">
          <span /><Led ui tier={3} fit color={C.DIM} text={tv(lang, "cmp.wall")} /><span /><Led ui tier={3} fit color={C.DIM} text={tv(lang, "cmp.cost")} /><span />
        </div>
        {rows.map((s) => (
          <div key={s.key} className="st-r">
            <span className="nm"><Led tier={1} fit color={C.WARM} text={s.key} /></span>
            <ListBar frac={wall ? s.wall / wall : 0} />
            <span className="r"><Led tier={1} fit text={pct(wall ? s.wall / wall : 0)} /></span>
            <ListBar frac={cost ? s.cost / cost : 0} color={C.WARM} />
            <span className="r"><Led tier={1} fit text={pct(cost ? s.cost / cost : 0)} /></span>
          </div>
        ))}
      </div>
    </>
  );
}

function ComputeChart({ c, onUnit }: { c: Cm; onUnit: (u: number) => void }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang), fade = useFade();
  const geom = useRef<ComputeGeom | null>(null);
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawComputeOmote(x, c, { w, h }, bodyFont) : drawComputeUra(x, c, { w, h, offX, offY }, glyphOf(lang));
    onUnit(geom.current.unit);
  }, [c, world, lang, tick]);
  useEffect(() => { setTip(null); }, [c, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, i = g ? computeAt(g, e.clientX - r.left) : null;
    if (i === null) { setTip(null); return; }
    const w = c.weeks[i];
    setTip({
      x: e.clientX, y: e.clientY, body: (
        <>
          <div className="h">{tv(lang, "stream.week", { w: w.label, a: md(w.mon, 0), b: md(w.mon, 6) }) + (w.cut ? tv(lang, "stream.cut") : "")}</div>
          <div className="m">{tv(lang, "cmp.tip", { k: compactCount(w.tok), c: amt(w.cost, w.partial), r: perH(w.perHour), h: hours(w.union) })}</div>
          <div className="s">{tv(lang, "cmp.kinds", { cr: compactCount(w.kinds.cache_read), cw: compactCount(w.kinds.cache_write), i: compactCount(w.kinds.input), o: compactCount(w.kinds.output) })}</div>
          {w.families.length > 0 && <div className="s">{w.families.map(([f, n]) => `${f} ${compactCount(n)}`).join(" · ")}</div>}
        </>
      ),
    });
  };
  const height = computeHeight(c.rows);
  return <canvas ref={ref} className="sv-cmpc" style={{ ...fade, height }} aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />;
}
