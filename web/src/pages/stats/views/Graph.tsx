import { useCallback, useEffect, useMemo } from "react";
import { hours } from "../../../lib/format";
import { t } from "../../../i18n/t";
import type { World } from "../../../prefs/types";
import { useV2 } from "../../../ui/context";
import { tipBadgeUrl, useTaskBadgeImg } from "../../../ui/taskBadgeImg";
import { useTaskGlyph } from "../../../ui/taskGlyph";
import { useWorld } from "../../../world/store";
import { taskCode } from "../../now/format";
import { EChart } from "../EChart";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { deriveGraph, graphOption } from "../viz/graph";
import { tv } from "../viz/strings";

/** Pairs listed in the screen-reader summary. */
const MAX_PAIRS = 8;

/** 并行关系网: the linked tasks as a force graph, joined by the minutes they were open together; the most parallel
 *  pair is the key figure. */
export function Graph({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, segs, tasks } = useViz();
  const g = useMemo(() => deriveGraph(prep, segs), [prep, segs]);
  const title = useCallback((k: string) => tasks.get(k)?.title ?? "", [tasks]);
  const sil = useTaskGlyph(), bimg = useTaskBadgeImg(), bw = useWorld(), ids = useMemo(() => g.nodes.map((n) => n.task), [g]);
  useEffect(() => { if (bimg) void bimg.warm(ids, bw); }, [bimg, ids, bw]);
  const option = useCallback((world: World) => graphOption(world, g, taskCode, title, (id) => tipBadgeUrl(id, world), sil), [g, title, sil]);
  if (!g.nodes.length) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const top = g.edges[0];
  const list = g.edges.slice(0, MAX_PAIRS).map((e) => tv(lang, "graph.pair", { a: taskCode(e.a), b: taskCode(e.b), h: hours(e.min) })).join(lang === "en" ? ", " : "、");
  return (
    <ViewFrame id={id} num={num} meta={top ? tv(lang, "graph.meta", { a: taskCode(top.a), b: taskCode(top.b) }) : tv(lang, "graph.none")}
      summary={tv(lang, "graph.sum", { n: g.nodes.length, e: g.edges.length, list: list || tv(lang, "graph.none") })}>
      <EChart option={option} height={380} label={t(lang, "sv.graph.name")} onHoverTask />
    </ViewFrame>
  );
}
