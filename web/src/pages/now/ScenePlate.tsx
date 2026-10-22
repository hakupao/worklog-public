import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { surface, type Surface } from "../../chart/canvas";
import { periodOf, sunTimes } from "../../cal/sun";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { reducedMotion } from "../../led/motion";
import { jstDate, jstMinute } from "../../predict/time";
import { loadScenes } from "../../scene/load";
import { useV2 } from "../../ui/context";
import { Led, type LedSeg } from "../../ui/Led";
import { useWorld } from "../../world/store";

type Scenes = Awaited<ReturnType<typeof loadScenes>>;

/** Spec §3 / Global Constraints: 25 s a plate, 200 columns, rows 12–88 shown (a panorama). */
export const CYCLE = 25_000;
const COLS = 200, ROWS: [number, number] = [12, 88];
const SWAP_MS = 600, WORLD_MS = 300;
/** A random scene of `list`, never `prev` again while there is another to show. */
const pickScene = <T extends { id: string }>(list: T[], prev: string | null): T | null => {
  const from = list.length > 1 ? list.filter((s) => s.id !== prev) : list;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
};
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** 此刻 scene plate (spec §2.1, §3): an ascii.rest scene for the Tokyo time of day, a random other one every 25 s, no frame.
 *  Under it one caption row: Fig · 日没 · period, the 1px next-plate line on top. Always in colour: 里 palette dots,
 *  表 a colour halftone, light for dawn / day scenes and deep for dusk / night (draw.ts).
 *  The scene chunk is lazy (D11); while it fails to load the plate stays empty, the caption stays, and each cycle
 *  retries (Review Focus 5). */
export function ScenePlate({ now, alert }: { now: number; alert: boolean }) {
  const { lang } = useV2(), world = useWorld();
  const [mod, setMod] = useState<Scenes | null>(null);
  const [picked, setPicked] = useState<string | null>(null);   // the scene the last turn drew, by id
  const [tight, setTight] = useState(false);      // the caption row overflowed: the period segment steps out

  const date = jstDate(now), nowMin = jstMinute(now);
  const sun = useMemo(() => sunTimes(date), [date]);
  const period = periodOf(nowMin, sun);
  const list = useMemo(() => mod?.forPeriod(period) ?? [], [mod, period]);
  // shown in random order: a period's first plate is drawn when its list arrives, each turn draws another one
  const opening = useMemo(() => pickScene(list, null), [list]);   // random inside a memo: relies on it being kept
  const def = list.find((s) => s.id === picked) ?? opening;
  const turnRef = useRef(() => {});
  turnRef.current = () => setPicked(pickScene(list, def?.id ?? null)?.id ?? null);

  // ---- the cycle: a 1 s clock that stands still while the page is hidden (prototype now-c3a.html setInterval).
  // Reduced motion: one still plate, no rotation (Global Constraints), so no clock and no next-plate line either.
  const cycRef = useRef<HTMLElement>(null), nextAt = useRef(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const setCyc = () => {
      const el = cycRef.current;
      if (!el) return;
      const p = 1 - Math.max(0, nextAt.current - performance.now()) / CYCLE;
      el.classList.toggle("reset", p < 0.06);
      el.style.setProperty("--p", p.toFixed(3));
    };
    nextAt.current = performance.now() + CYCLE;
    setCyc();
    // hidden: the time away is added back on return (a throttled background tab ticks about once a minute, so
    // counting ticks would turn the plate the moment the tab comes back)
    let hiddenAt: number | null = null;
    const vis = () => {
      if (document.hidden) hiddenAt ??= performance.now();
      else if (hiddenAt !== null) { nextAt.current += performance.now() - hiddenAt; hiddenAt = null; setCyc(); }
    };
    document.addEventListener("visibilitychange", vis);
    const id = setInterval(() => {
      if (document.hidden) { hiddenAt ??= performance.now(); return; }
      if (performance.now() >= nextAt.current) { nextAt.current = performance.now() + CYCLE; turnRef.current(); }
      setCyc();
    }, 1000);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, []);

  // ---- the chunk: fetched on mount, and again one cycle after each failure (load.ts forgets a failure). Its own
  // timer, not the turn: under reduced motion the plate never turns.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (mod) return;
    let live = true, id: ReturnType<typeof setTimeout> | undefined;
    loadScenes().then((m) => { if (live) setMod(m); }, () => { if (live) id = setTimeout(() => setRetry((n) => n + 1), CYCLE); });
    return () => { live = false; clearTimeout(id); };
  }, [mod, retry]);

  // ---- drawing: a live canvas plus a ghost that holds the previous picture while it fades out
  const wrapRef = useRef<HTMLDivElement>(null), liveRef = useRef<HTMLCanvasElement>(null), ghostRef = useRef<HTMLCanvasElement>(null);
  const surf = useRef<Surface | null>(null), painted = useRef(false);
  const params = useRef({ world, alert });
  params.current = { world, alert };
  const paintNow = useRef<() => void>(() => {});

  const fade = (ms: number) => {
    const cv = liveRef.current, g = ghostRef.current;
    if (!cv || !g || !painted.current || reducedMotion()) return;
    g.width = cv.width; g.height = cv.height;
    const gx = g.getContext("2d");
    if (!gx) return;
    gx.drawImage(cv, 0, 0);
    g.style.transition = "none"; g.style.opacity = "1";
    void g.offsetWidth;                                   // commit opacity 1 before the transition starts
    g.style.transition = `opacity ${ms}ms ease-out`; g.style.opacity = "0";
  };

  useLayoutEffect(() => {
    const wrap = wrapRef.current, cv = liveRef.current;
    if (!wrap || !cv || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => { surf.current = surface(cv); paintNow.current(); });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = liveRef.current;
    if (!mod || !def || !cv) return;
    const frame = def.make(), t0 = performance.now(), still = reducedMotion();
    const paint = (ts: number) => {
      if (document.hidden) return;
      const s = surf.current ?? (surf.current = surface(cv));
      if (!s) return;
      const { world: w, alert: dim } = params.current;
      mod.drawScene(s.ctx, mod.sampleFrame(def, frame, still ? def.meta.still ?? 2 : (ts - t0) / 1000, ROWS), w, s.w / COLS, dim, def.period);
      painted.current = true;
    };
    paintNow.current = () => paint(performance.now());
    fade(SWAP_MS);
    paint(t0);
    if (still || def.meta.fps <= 0) return;
    const gap = 1000 / def.meta.fps;
    let raf = 0, last = t0;
    const loop = (ts: number) => {
      if (ts - last >= gap - 1) { last = ts; paint(ts); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); paintNow.current = () => {}; };
  }, [mod, def]); // eslint-disable-line react-hooks/exhaustive-deps

  // an alert / world change repaints at once (a still plate has no loop to pick it up); a world change
  // crossfades the old rendering out over 300 ms instead of cutting (spec §7 "jump"; the plate is not in the dot morph)
  const prevWorld = useRef(world), first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (prevWorld.current !== world) { prevWorld.current = world; fade(WORLD_MS); }
    paintNow.current();
  }, [alert, world]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const vis = () => { if (!document.hidden) paintNow.current(); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  // ---- caption: one LED row; when it overflows, the period segment steps out until the row is wider again
  const setMin = Math.round(sun.set), since = nowMin - setMin;
  const per = `${t(lang, `now.scene.per.${period}` as StrKey)}${since > 0 ? ` +${Math.floor(since / 60)}:${pad(since % 60)}` : ""}`;
  const segs: LedSeg[] = [];
  if (def) segs.push({ t: `Fig. ${def.fig} — ${def.cap[lang]}` });
  segs.push({ t: `${segs.length ? " · " : ""}${t(lang, "now.scene.sunset", { t: hm(setMin) })}` });
  if (!tight) segs.push({ t: ` · ${per}`, kind: "dim" });

  const capRef = useRef<HTMLElement>(null), tightAt = useRef(0), tightNow = useRef(false);
  tightNow.current = tight;
  useEffect(() => { setTight(false); }, [def?.id, lang, period]);   // new text: measure the full row again
  useLayoutEffect(() => {
    const cap = capRef.current;
    if (!cap || typeof ResizeObserver !== "function") return;
    const check = () => {
      const w = cap.clientWidth;
      if (!tightNow.current) { if (cap.scrollWidth > w + 1) { tightAt.current = w; setTight(true); } }
      else if (w > tightAt.current) setTight(false);
    };
    const ro = new ResizeObserver(check);
    ro.observe(cap);
    const led = cap.querySelector(":scope > canvas");
    if (led) ro.observe(led);
    return () => ro.disconnect();
  }, []);

  return (
    <figure className="plate">
      <div className="fig-wrap" ref={wrapRef}>
        <canvas className="scn" ref={liveRef} aria-hidden="true" />
        <canvas className="scn ghost" ref={ghostRef} aria-hidden="true" />
      </div>
      <figcaption className="cap" ref={capRef}>
        <i className="cyc" ref={cycRef} aria-hidden="true" />
        <Led ui fit size={10} tier={1} text={segs} />
      </figcaption>
    </figure>
  );
}
