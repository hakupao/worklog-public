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
import { pct } from "../viz/fmt";
import { agentName, deriveSankey, sankeyOption, sankeyHeight } from "../viz/sankey";
import { tv } from "../viz/strings";

/** 流向: machine → agent → task on wall clock split evenly; the largest agent's share is the key figure. */
export function Sankey({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, segs } = useViz();
  const f = useMemo(() => deriveSankey(prep, segs), [prep, segs]);
  const name = useCallback((k: string) => (k ? taskCode(k) : t(lang, "tl.unlinked")), [lang]);
  const sil = useTaskGlyph(), bimg = useTaskBadgeImg(), bw = useWorld(), ids = useMemo(() => [...f.tasks.keys()].filter(Boolean), [f]);
  useEffect(() => { if (bimg) void bimg.warm(ids, bw); }, [bimg, ids, bw]);
  const option = useCallback((world: World) => sankeyOption(world, f, name, (id) => tipBadgeUrl(id, world), sil), [f, name, sil]);
  if (f.total <= 0) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const [topA, topV] = [...f.agents][0];
  const sep = lang === "en" ? ", " : "、";
  const list = (m: Map<string, number>, n: (k: string) => string) => [...m].map(([k, v]) => tv(lang, "flow.item", { n: n(k), h: hours(v) })).join(sep);
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "sankey.meta", { a: agentName(topA), p: pct(topV / f.total) })}
      summary={tv(lang, "sankey.sum", { t: hours(f.total), m: list(f.machines, (k) => k), a: list(f.agents, agentName), k: list(f.tasks, name) })}>
      <EChart option={option} height={sankeyHeight(f.tasks.size)} label={t(lang, "sv.sankey.name")} onHoverTask />
    </ViewFrame>
  );
}
