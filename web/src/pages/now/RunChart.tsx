import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { latticeOffset } from "../../chart/dots";
import { fmtMoney } from "../../i18n/format";
import { t } from "../../i18n/t";
import { loadPixelFont } from "../../led/fonts";
import { OMOTE_UNIT, PITCH } from "../../led/lattice";
import type { SnapSession, Snapshot } from "../../predict/snapshot";
import { hmOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { setHoverTask, useHoverTask } from "../../ui/hover";
import { C, lineColor } from "../../ui/palette";
import { useWorld } from "../../world/store";
import { surface } from "../../chart/canvas";
import { BOT, chartHeight, DENSE_ROW, DENSE_TRACKS, drawOmote, drawUra, geometry, hitTest, layoutChart, rowHeight, TOP, type Geom, type Hover, type Track } from "./chart";
import { taskCode } from "./format";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { useTaskBadgesVersion } from "../../ui/taskBadges";
import { useTip } from "../../ui/TipHost";

export function RunChart({ snap }: { snap: Snapshot }) {
  const { lang } = useV2(), world = useWorld();
  const L = useMemo(() => layoutChart(snap), [snap]);
  const cv = useRef<HTMLCanvasElement>(null), geom = useRef<Geom | null>(null), scroller = useRef<HTMLDivElement>(null);
  // The chart takes the room its column leaves (relayout fix round 1): rows share it, 22–40px each (ROW_MIN–ROW_MAX); past ROW_MIN the
  // body scrolls, labels, tracks and hours together. `room` is the scroller's height, which does not depend on the content.
  const [room, setRoom] = useState(0);
  const hasTracks = L.tracks.length > 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const read = () => setRoom(Math.floor(el.getBoundingClientRect().height));   // floor: a rounded-up clientHeight makes the body 0.4px taller → stray scrollbar
    read();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasTracks]);
  const rowH = rowHeight(L, room);
  // Dense rows (T10 verdict 6): a 10px LED is taller than the pitch and the badge eats the label. Past 6 tracks, or once
  // a measured row is under 24px, labels drop the badge for a line-colour bar and labels and hours step down to 8px
  // (CJK lights 7 rows = 14px at the 2px lattice). An unmeasured scroller (room 0) says nothing about the rows.
  const dense = L.tracks.length > DENSE_TRACKS || (room > 0 && rowH < DENSE_ROW);
  // Hover joins the page-wide link (ui/hover.ts): a hovered row anywhere lifts its track here, and a
  // hovered track here lifts that task's rows (Shell paints .hl from the same source). The unlinked
  // track has no task id, so its highlight stays local to the chart.
  const linked = useHoverTask();
  const [unlinkedHover, setUnlinkedHover] = useState(false);
  const hover: Hover = linked !== null ? { taskId: linked } : unlinkedHover ? { taskId: null } : null;
  const setTip = useTip();
  // new data under a still mouse: the session the tip described may be gone, so drop it until the next move.
  // Keyed on the sessions, not on L: the snapshot (and so L) is rebuilt every minute for "now" (final review).
  const sig = useMemo(() => `${snap.sessions.map((x) => `${x.id}@${x.end}@${x.minutes}@${x.taskId}`).join("|")}#${snap.running.map((r) => r.session.id).join(",")}`, [snap]);
  useEffect(() => { setTip(null); }, [sig, setTip]);
  const [fontTick, setFontTick] = useState(0);
  const bv = useTaskBadgesVersion();
  // the 里 hour digits are pixel-font bitmaps: redraw once the 8px cut is in
  useEffect(() => { let live = true; void loadPixelFont(8, "zh").then(() => { if (live) setFontTick((n) => n + 1); }); return () => { live = false; }; }, []);
  useLayoutEffect(() => {
    const el = cv.current;
    if (!el) return;
    const draw = () => {
      const s = surface(el);
      if (!s) return;
      const u = world === "omote" ? OMOTE_UNIT : PITCH, { offX, offY } = latticeOffset(el, u);
      const g = geometry(L, s.w, s.h, u, offX, offY);
      geom.current = g;
      const h: Hover = linked !== null ? { taskId: linked } : unlinkedHover ? { taskId: null } : null;
      if (world === "omote") drawOmote(s.ctx, L, g, h, `500 11px ${getComputedStyle(document.body).fontFamily}`);
      else drawUra(s.ctx, L, g, h);
    };
    draw();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [L, world, linked, unlinkedHover, fontTick, bv]);

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = geom.current;
    if (!g) return;
    const r = e.currentTarget.getBoundingClientRect(), hit = hitTest(L, g, e.clientX - r.left, e.clientY - r.top);
    const k = hit ? hit.track.taskId : null;
    setHoverTask(k);
    setUnlinkedHover(!!hit && k === null);
    setTip(hit?.session ? { x: e.clientX, y: e.clientY, body: <SessionTip s={hit.session} snap={snap} /> } : null);
  };
  const legend = L.machines.length >= 2
    ? t(lang, "now.dia.legend", { a: L.machines[0], b: L.machines[1] })
    : t(lang, "now.dia.legend1", { a: L.machines[0] ?? "--" });
  return (
    <section className="dia">
      <div className="sec"><Led ui size={12} tier={2} fit text={t(lang, "now.dia.title")} /><Led ui tier={3} fit text={legend} /></div>
      {L.tracks.length === 0
        ? <div className="dia-empty"><Led ui tier={3} fit text={t(lang, "now.dia.empty")} /></div>
        : (
          <div className="dia-scroll" ref={scroller}>
          <div className={`dia-body${dense ? " dense" : ""}`} style={{ height: `${chartHeight(L, rowH)}px`, "--rowh": `${rowH}px` } as CSSProperties}>
            <div className="labels" style={{ paddingTop: TOP, paddingBottom: BOT }}>
              {L.tracks.map((tr) => <TrackLabel key={tr.taskId ?? "-"} tr={tr} snap={snap} rowH={rowH} dense={dense} />)}
            </div>
            <div className="cv-wrap">
              <canvas ref={cv} className="dia-cv" aria-hidden="true" data-hover={hover ? hover.taskId ?? "-" : undefined}
                onPointerMove={move} onPointerLeave={() => { setHoverTask(null); setUnlinkedHover(false); setTip(null); }} />
            </div>
            <div className="hours" style={{ paddingTop: TOP, paddingBottom: BOT }}>
              {L.tracks.map((tr) => (
                <div key={tr.taskId ?? "-"} className="h" data-task={tr.taskId ?? undefined}>
                  <Led tier={2} size={dense ? 8 : 10} align="right" className="fill" text={`${(tr.minutes / 60).toFixed(1)}H`} />
                </div>
              ))}
            </div>
          </div>
          </div>
        )}
    </section>
  );
}

function TrackLabel({ tr, snap, rowH, dense }: { tr: Track; snap: Snapshot; rowH: number; dense: boolean }) {
  const { lang } = useV2();
  const k = tr.taskId ?? undefined, title = tr.taskId ? snap.tasks[tr.taskId]?.title ?? tr.taskId : null, size = dense ? 8 : 10;
  return (
    <div className="lab" data-task={k} style={dense ? { "--lc": lineColor(tr.taskId) } as CSSProperties : undefined}>
      {dense ? null : tr.taskId
        ? <TaskBadge id={tr.taskId} height={Math.min(BADGE_H.row, Math.floor(rowH) - 2)} dim={!tr.running} />
        : <Led tier={1} fit text={[{ t: taskCode(null), kind: "code", color: tr.running ? lineColor(null) : C.AMBER }]} />}
      {title
        ? <Led tier={2} size={size} clip className="fill" task={k} text={title} />
        : <Led ui tier={2} size={size} clip className="fill" text={t(lang, "now.run.unlinked")} />}
    </div>
  );
}

function SessionTip({ s, snap }: { s: SnapSession; snap: Snapshot }) {
  const { lang } = useV2();
  const task = s.taskId ? snap.tasks[s.taskId] : undefined, live = snap.running.some((r) => r.session.id === s.id);
  return (
    <>
      <div className="h">
        {s.taskId && <><TaskBadge id={s.taskId} height={BADGE_H.tip} /><span className="code" style={{ "--lc": lineColor(s.taskId) } as CSSProperties}>{taskCode(s.taskId)}</span></>}
        <span>{task ? task.title : t(lang, "now.run.unlinked")}</span>
      </div>
      <div className="m">
        {hmOf(s.start)}–{hmOf(s.end)} · {s.machine} · {t(lang, "now.tip.min", { n: s.minutes })}
        {live ? ` · ${t(lang, "now.tip.live")}` : ""}
        {s.cost !== null ? ` · ${t(lang, "now.tip.total", { c: fmtMoney(s.cost, lang) })}` : ""}
      </div>
      {s.summary && <div className="s">{s.summary}</div>}
    </>
  );
}
