import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { Dashboard } from "../../api/types";
import { hours } from "../../lib/format";
import { useCanvas } from "../../chart/useCanvas";
import type { StrKey } from "../../i18n/strings";
import { glyphOf, t } from "../../i18n/t";
import { loadPixelFont } from "../../led/fonts";
import type { Lang } from "../../prefs/types";
import { mdOf, weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C } from "../../ui/palette";
import { useTip } from "../../ui/TipHost";
import { useWorld } from "../../world/store";
import { dailyAt, drawDailyOmote, drawDailyUra, type DailyGeom, type Day } from "./daily";
import { drawHeatOmote, drawHeatUra, heatAt, type HeatGeom } from "./heat";
import { ListBar } from "./ListBar";
import { None, Sub } from "./parts";
import { rhythmOf } from "./sections";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const dow = (lang: Lang, i: number) => t(lang, `tl.dow.${i}` as StrKey);       // i: 1 = Monday … 7 = Sunday
export const bodyFont = (wt: number) => `${wt} 11px ${getComputedStyle(document.body).fontFamily}`;

/** The 里 labels are dot glyphs in the pixel font: redraw once the sizes the chart uses have loaded (Judge's Hist). */
export function useFontTick(lang: Lang): number {
  const [tick, setTick] = useState(0), glyph = glyphOf(lang);
  useEffect(() => {
    let live = true;
    void Promise.all([loadPixelFont(8, glyph), loadPixelFont(10, glyph)]).then(() => { if (live) setTick((n) => n + 1); });
    return () => { live = false; };
  }, [glyph]);
  return tick;
}

/** 工作节奏 (the `rhythm` view; its frame carries the title): avg start / end / late night / weekend, the daily bars with their 8h / 24h
 *  lines and the overlap note, then the 7×24 matrix beside the session lengths. */
export function RhythmCol({ d }: { d: Dashboard }) {
  const { lang } = useV2();
  const r = rhythmOf(d);
  const kv = (key: StrKey, v: string) => (
    <div className="st-kv"><Led ui tier={2} fit color={C.DIM} text={t(lang, key)} /><Led size={12} tier={1} fit text={v} /></div>
  );
  const peak = r?.daily.reduce<Day | null>((m, x) => (x.minutes > 0 && (!m || x.minutes > m.minutes) ? x : m), null) ?? null;
  const fmax = Math.max(0, ...(r?.focus ?? []).map((f) => f.count));
  return (
    <div className="st-rh">
      {r === null ? <None text={t(lang, "st.empty")} /> : (
        <>
          <div className="st-kvl">
            {kv("st.r.start", r.start ?? "—")}
            {kv("st.r.end", r.end ?? "—")}
            {kv("st.r.late", pct(r.late))}
            {kv("st.r.weekend", pct(r.weekend))}
          </div>
          <Sub text={t(lang, "st.r.daily")} />
          {r.daily.length ? (
            <>
              <DailyChart days={r.daily} />
              <div className="st-note">
                <span className="nm"><Led ui tier={3} clip className="fill" color="#6f5530" text={t(lang, "st.r.overlap")} /></span>
                {peak && <Led ui tier={2} fit color={C.DIM} text={t(lang, "st.r.peak", { d: mdOf(peak.date), h: hours(peak.minutes) })} />}
              </div>
            </>
          ) : <None text={t(lang, "st.empty")} />}
          <div className="st-rh2">
            <div>
              <Sub text={t(lang, "st.r.heat")} />
              {r.heat ? <HeatChart grid={r.heat} /> : <None text={t(lang, "st.empty")} />}
            </div>
            <div>
              <Sub text={t(lang, "st.r.focus")} />
              {r.focus.length ? (
                <div className="st-list st-foc">
                  {r.focus.map((f) => (
                    <div key={f.bucket} className="st-r">
                      <Led ui tier={2} fit color={C.DIM} text={t(lang, "st.r.min", { n: f.bucket })} />
                      <ListBar frac={fmax > 0 ? f.count / fmax : 0} />
                      <span className="r"><Led ui tier={1} fit text={t(lang, "st.r.cnt", { n: f.count })} /></span>
                    </div>
                  ))}
                </div>
              ) : <None text={t(lang, "st.empty")} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A day's tip: the date and weekday, its hours, and the overlap note when it is over 24h. */
function DailyChart({ days }: { days: Day[] }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang);
  const geom = useRef<DailyGeom | null>(null);
  const sig = days.map((x) => `${x.date}:${x.minutes}`).join(",");
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawDailyOmote(x, days, { w, h }, bodyFont) : drawDailyUra(x, days, { w, h, offX, offY }, glyphOf(lang));
  }, [sig, world, lang, tick]);
  useEffect(() => { setTip(null); }, [sig, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = geom.current, i = g ? dailyAt(g, e.clientX - e.currentTarget.getBoundingClientRect().left) : null;
    if (i === null) { setTip(null); return; }
    const day = days[i];
    setTip({ x: e.clientX, y: e.clientY, body: (
      <>
        <div className="h">{t(lang, "tl.d.title", { d: day.date, w: dow(lang, weekdayOfDate(day.date)) })}</div>
        <div className="m">{hours(day.minutes)}</div>
        {day.minutes > 1440 && <div className="s">{t(lang, "st.r.overlap")}</div>}
      </>
    ) });
  };
  const busy = days.filter((x) => x.minutes > 0);
  return (
    <>
      <canvas ref={ref} className="st-daily" aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />
      {busy.length > 0 && <span className="v2-sr">{busy.map((x) => `${x.date} ${hours(x.minutes)}`).join("; ")}</span>}
    </>
  );
}

/** An hour's tip: weekday and hour, its minutes. */
function HeatChart({ grid }: { grid: number[][] }) {
  const { lang } = useV2(), world = useWorld(), setTip = useTip(), tick = useFontTick(lang);
  const geom = useRef<HeatGeom | null>(null);
  const labels = [1, 2, 3, 4, 5, 6, 7].map((i) => dow(lang, i));
  const sig = grid.map((row) => row.join(",")).join(";");
  const ref = useCanvas((x, w, h, offX, offY) => {
    geom.current = world === "omote" ? drawHeatOmote(x, grid, labels, { w, h }, bodyFont)
      : drawHeatUra(x, grid, labels, { w, h, offX, offY }, glyphOf(lang), lang === "en" ? 8 : 10);
  }, [sig, world, lang, tick]);
  useEffect(() => { setTip(null); }, [sig, setTip]);
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), g = geom.current, at = g ? heatAt(g, e.clientX - r.left, e.clientY - r.top) : null;
    if (at === null) { setTip(null); return; }
    const [dd, hh] = at;
    setTip({ x: e.clientX, y: e.clientY, body: (
      <>
        <div className="h">{t(lang, "st.r.hour", { d: labels[dd], h: hh })}</div>
        <div className="m">{t(lang, "st.r.min", { n: grid[dd][hh] })}</div>
      </>
    ) });
  };
  const busy = grid.flatMap((row, dd) => row.map((v, hh) => ({ v, dd, hh }))).filter((c) => c.v > 0);
  return (
    <>
      <canvas ref={ref} className="st-heat" aria-hidden="true" onPointerMove={move} onPointerLeave={() => setTip(null)} />
      {busy.length > 0 && <span className="v2-sr">{busy.map((c) => `${t(lang, "st.r.hour", { d: labels[c.dd], h: c.hh })} ${t(lang, "st.r.min", { n: c.v })}`).join("; ")}</span>}
    </>
  );
}
