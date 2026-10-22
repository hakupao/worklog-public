import { useEffect, useMemo, useRef, useState } from "react";
import { glyphOf, t } from "../../i18n/t";
import { enter } from "../../ink/fx";
import { loadPixelFont } from "../../led/fonts";
import { reducedMotion } from "../../led/motion";
import type { World } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C } from "../../ui/palette";
import { getHoverTask, setHoverTask, subscribeHover } from "../../ui/hover";
import { isModuleHidden } from "../../world/modules";
import { useTaskBadgesVersion } from "../../ui/taskBadges";
import { useWorld } from "../../world/store";
import { useReveal } from "./useReveal";
import type { EChartsType } from "./viz/echarts";
import { themeOf, type EChartsOptionLike } from "./viz/echarts-theme";

type Item = { task?: string | null } | null | undefined;

/** The ECharts chunk, fetched once for every chart on the page; a failed fetch is forgotten (F5), so the next chart
 *  mounted — the view entered again — tries again. */
let chunk: Promise<typeof import("./viz/echarts")> | null = null;
const loadChunk = () => (chunk ??= import("./viz/echarts").catch((e: unknown) => { chunk = null; throw e; }));

/** One ECharts chart on the board (U19, brief assumption 8). The ECharts chunk loads on first use; the chart is built
 *  on the world's theme and rebuilt (dispose + init) when the world changes; `option(world, cost)` is set whole
 *  (notMerge) with ECharts' own entrance off — 里 fades the box in with the view's reveal, 表 brings its canvas in once
 *  like the hand-drawn views. `cost` = stats.cost not hidden. The option is set again only when its content changed
 *  (functions aside, compared as JSON) or the pixel font arrived: a refetch that derives the same data keeps the
 *  brush, dragged nodes and force layout. `onHoverTask`: items carrying a `task` field write it to the page's hover
 *  store (and clear only what this chart wrote), and the store highlights every item of the hovered task. */
export function EChart({ option, height, label, onHoverTask }: {
  option: (world: World, cost: boolean) => EChartsOptionLike; height: number; label: string; onHoverTask?: boolean;
}) {
  const { prefs, lang } = useV2(), world = useWorld();
  const cost = !isModuleHidden("stats.cost", prefs.omote.hide, world);
  const p = useReveal();
  const ref = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<EChartsType | null>(null);
  const [failed, setFailed] = useState(false);
  const entered = useRef(false);
  const last = useRef<{ chart: EChartsType; sig: string; font: number } | null>(null);

  useEffect(() => {
    let live = true, c: EChartsType | null = null;
    // a world switch after a failed load tries again: the box must be back in the DOM before the chunk resolves
    setFailed(false);
    loadChunk().then((m) => {
      if (!live || !ref.current) return;
      c = m.init(ref.current, themeOf(world), { renderer: "canvas" });
      setChart(c);
    }, () => { if (live) setFailed(true); });
    return () => { live = false; c?.dispose(); setChart(null); };
  }, [world]);

  // 里's axis labels are in the pixel font: set the option again once it has loaded
  const [font, setFont] = useState(0);
  useEffect(() => {
    let live = true;
    void loadPixelFont(12, glyphOf(lang)).then(() => { if (live) setFont((n) => n + 1); });
    return () => { live = false; };
  }, [lang]);

  const bv = useTaskBadgesVersion();
  const opt = useMemo<EChartsOptionLike>(() => ({ ...option(world, cost), animation: false }), [option, world, cost, bv]);
  // A world switch disposes the old chart (the first effect's cleanup runs first) while `chart` still names it until
  // the next render: the effects below skip a disposed chart, and their cleanups do not call into one (ECharts warns).
  useEffect(() => {
    if (!chart || chart.isDisposed()) return;
    const sig = JSON.stringify(opt), l = last.current;
    if (l && l.chart === chart && l.sig === sig && l.font === font) return;
    last.current = { chart, sig, font };
    chart.setOption(opt, { notMerge: true });
    // the canvas exists only after the first paint (inside setOption); 表 brings it in once, on the view's first draw
    if (entered.current) return;
    entered.current = true;
    if (world === "omote" && !reducedMotion()) enter([...ref.current!.querySelectorAll("canvas")]);
  }, [chart, opt, font]); // eslint-disable-line react-hooks/exhaustive-deps -- a world switch makes a new chart

  useEffect(() => {
    if (!chart || chart.isDisposed() || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, [chart]);

  useEffect(() => {
    if (!chart || chart.isDisposed() || !onHoverTask) return;
    let mine: string | null | undefined;           // what this chart wrote (undefined: nothing)
    const over = (e: { data?: unknown }) => { const k = (e.data as Item)?.task; if (k !== undefined) { mine = k; setHoverTask(k); } };
    const out = () => { if (mine !== undefined && getHoverTask() === mine) setHoverTask(null); mine = undefined; };
    chart.on("mouseover", over);
    chart.on("mouseout", out);
    const paint = () => {
      const k = getHoverTask();
      chart.dispatchAction({ type: "downplay" });
      if (k === null) return;
      ((opt.series ?? []) as { data?: Item[] }[]).forEach((s, seriesIndex) => {
        const dataIndex = (s.data ?? []).flatMap((d, i) => (d?.task === k ? [i] : []));
        if (dataIndex.length) chart.dispatchAction({ type: "highlight", seriesIndex, dataIndex });
      });
    };
    const off = subscribeHover(paint);
    // a new chart or option (setOption with notMerge, after the effect above) drops the highlight: paint the store again
    paint();
    return () => { off(); if (!chart.isDisposed()) { chart.off("mouseover", over); chart.off("mouseout", out); } };
  }, [chart, opt, font, onHoverTask]);

  if (failed) return <div className="sv-thin"><Led ui tier={2} clip className="fill" color={C.DIM} text={t(lang, "sv.failed")} /></div>;
  return <div ref={ref} className="sv-ec" role="img" aria-label={label} style={{ height, opacity: p }} />;
}
