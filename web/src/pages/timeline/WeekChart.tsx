import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Task } from "../../api/types";
import { latticeOffset } from "../../chart/dots";
import { useCanvas } from "../../chart/useCanvas";
import { fmtMoney } from "../../i18n/format";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { loadPixelFont } from "../../led/fonts";
import { OMOTE_UNIT, PITCH } from "../../led/lattice";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { setHoverTask, useHoverTask } from "../../ui/hover";
import { Led } from "../../ui/Led";
import { Mod } from "../../ui/Mod";
import { C } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { useTip } from "../../ui/TipHost";
import { useWorld } from "../../world/store";
import { taskCode } from "../now/format";
import { bandHeight, drawBandOmote, drawBandUra, drawRulerOmote, drawRulerUra, hitBand, RULER_H, weekGeom, type WGeom, type WHover } from "./chart";
import { SessionTip } from "./SessionTip";
import type { Band, WeekLayout } from "./week";

const hoursText = (m: number) => `${(m / 60).toFixed(1)}H`;
/** The 累计 shows under the 工作时间 only when parallel sessions make it differ at 0.1 h (user 10/9: both figures). */
const cumDiffers = (b: { minutes: number; wall: number }) => hoursText(b.minutes) !== hoursText(b.wall);
const omoteFont = () => `500 11px ${getComputedStyle(document.body).fontFamily}`;
/** 里 on the PITCH lattice; 表 keeps the 3px grid (its own offsets on OMOTE_UNIT). */
const geomFor = (world: string, L: WeekLayout, w: number, h: number, offX: number, offY: number, el: HTMLCanvasElement) => {
  if (world !== "omote") return weekGeom(L, w, h, PITCH, offX, offY);
  const o = latticeOffset(el, OMOTE_UNIT);
  return weekGeom(L, w, h, OMOTE_UNIT, o.offX, o.offY);
};

/** The week (spec §3.1 时间线): the hour ruler, one band per day, the legend of lines. */
export function WeekChart({ L, sel, onlyUnlinked, tasks, onSelect, onOpen }: {
  L: WeekLayout; sel: string | null; onlyUnlinked: boolean; tasks: Record<string, Task>;
  onSelect: (day: string) => void; onOpen: (sessionId: string, day: string) => void;
}) {
  const { lang } = useV2(), world = useWorld();
  const linked = useHoverTask();
  // 未关联 has no task id, so its hover cannot ride the page-wide link: it stays on this chart.
  const [unHover, setUnHover] = useState(false);
  const hover: WHover = linked !== null ? linked : unHover ? null : undefined;
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => { let live = true; void loadPixelFont(8, "zh").then(() => { if (live) setFontTick((n) => n + 1); }); return () => { live = false; }; }, []);
  const ruler = useCanvas((x, w, h, offX, offY, el) => {
    const g = geomFor(world, L, w, h, offX, offY, el);
    if (world === "omote") drawRulerOmote(x, L, g, omoteFont()); else drawRulerUra(x, L, g);
  }, [L, world, fontTick]);
  const setHover = (k: WHover) => { setHoverTask(typeof k === "string" ? k : null); setUnHover(k === null); };
  return (
    <section className="tl-week" aria-label={t(lang, "tl.chart")}>
      <div className="ruler">
        <span />
        <canvas ref={ruler} className="ruler-cv" aria-hidden="true" />
        <span />
      </div>
      {L.bands.map((b) => (
        <BandRow key={b.date} L={L} b={b} sel={!onlyUnlinked && b.date === sel} hover={hover} onlyUnlinked={onlyUnlinked} tasks={tasks}
          world={world} setHover={setHover} onSelect={onSelect} onOpen={onOpen} />
      ))}
      <Mod id="timeline.legend">
        <div className="legend">
          <Led ui tier={2} fit text={t(lang, "tl.lines")} />
          <div className={`lg${hover !== undefined ? " has-hl" : ""}`}>
            {L.legend.map((k) => (
              <button key={k ?? "-"} type="button" className={`lgk${hover !== undefined && hover === k ? " on" : ""}`} data-task={k ?? undefined}
                aria-label={k ? `${taskCode(k)} ${tasks[k]?.title ?? ""}` : t(lang, "tl.unlinked")}
                onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(undefined)} onFocus={() => setHover(k)} onBlur={() => setHover(undefined)}>
                {k ? <TaskBadge id={k} height={BADGE_H.row} /> : <Led tier={1} fit text={[{ t: taskCode(null), kind: "dim" }]} />}
              </button>
            ))}
          </div>
          <Led ui tier={3} fit text={t(lang, "tl.lines.hint")} />
        </div>
      </Mod>
    </section>
  );
}

function BandRow({ L, b, sel, hover, onlyUnlinked, tasks, world, setHover, onSelect, onOpen }: {
  L: WeekLayout; b: Band; sel: boolean; hover: WHover; onlyUnlinked: boolean; tasks: Record<string, Task>; world: string;
  setHover: (k: WHover) => void; onSelect: (day: string) => void; onOpen: (sessionId: string, day: string) => void;
}) {
  const { lang } = useV2(), setTip = useTip();
  const geom = useRef<WGeom | null>(null);
  const byId = useMemo(() => new Map(b.sessions.map((s) => [s.id, s])), [b.sessions]);
  const cv = useCanvas((x, w, h, offX, offY, el) => {
    const g = geomFor(world, L, w, h, offX, offY, el);
    geom.current = g;
    if (world === "omote") drawBandOmote(x, L, b, g, hover, onlyUnlinked); else drawBandUra(x, L, b, g, hover, onlyUnlinked);
  }, [L, b, world, hover, onlyUnlinked]);
  // a refetch that changes the band under a still mouse: the tip described what was there before
  // (keyed on what the band shows, not the band object: the layout is rebuilt every minute for "now", and
  // that alone must not knock the tip away or the tip would vanish at each whole minute — R12)
  const sig = useMemo(() => b.sessions.map((s) => `${s.id}@${s.updated_at}`).join("|"), [b.sessions]);
  useEffect(() => { setTip(null); }, [sig, setTip]);
  const hit = (e: MouseEvent<HTMLCanvasElement>) => {
    const g = geom.current;
    if (!g) return null;
    const r = e.currentTarget.getBoundingClientRect();
    return hitBand(L, b, g, e.clientX - r.left, e.clientY - r.top);
  };
  const move = (e: MouseEvent<HTMLCanvasElement>) => {
    const h = hit(e), s = h?.session ? byId.get(h.session.id) : undefined;
    setHover(h ? h.track.taskId : undefined);
    e.currentTarget.style.cursor = s ? "pointer" : "default";
    setTip(s && h?.session ? {
      x: e.clientX, y: e.clientY,
      body: <SessionTip s={s} date={b.date} tasks={tasks} lang={lang} live={L.running.includes(h.session.id)} from={h.session.start} to={h.session.end} />,
    } : null);
  };
  const dow = t(lang, `tl.dow.${b.dow}` as StrKey), label = `${mdOf(b.date)} ${dow}`;
  const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(b.date); } };
  return (
    <div className={`band${sel ? " sel" : ""}${b.isToday ? " today" : ""}`} data-day={b.date} style={{ height: `${bandHeight(b.tracks.length)}px` }}
      role="button" tabIndex={0} aria-pressed={sel} aria-label={`${label} · ${hoursText(b.wall)}${cumDiffers(b) ? ` · ${t(lang, "tl.cum", { h: hoursText(b.minutes) })}` : ""}`} onKeyDown={key}
      onClick={(e) => { if (e.target !== cv.current) onSelect(b.date); }}>
      <span className="bl">
        <Led ui tier={1} fit color={b.isToday ? C.WARM : C.AMBER} text={label} />
        {b.isToday && <Led ui tier={1} fit color={C.GREEN} text={t(lang, "tl.today")} />}
      </span>
      <span className="cv">
        <canvas ref={cv} aria-hidden="true" onPointerMove={move} onPointerLeave={() => { setHover(undefined); setTip(null); }}
          onClick={(e) => { const h = hit(e); if (h?.session) onOpen(h.session.id, b.date); else onSelect(b.date); }} />
      </span>
      <span className="br">
        <span className="hh">
          <Led tier={2} fit text={hoursText(b.wall)} />
          {cumDiffers(b) && <Led ui tier={3} fit text={t(lang, "tl.cum", { h: hoursText(b.minutes) })} />}
        </span>
        <Mod id="timeline.cost"><Led tier={3} fit text={`${fmtMoney(b.cost, lang)}${b.costPartial ? "*" : ""}`} /></Mod>
      </span>
    </div>
  );
}
