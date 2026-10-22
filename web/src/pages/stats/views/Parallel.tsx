import { useCallback, useEffect, useMemo } from "react";
import { t } from "../../../i18n/t";
import type { World } from "../../../prefs/types";
import { useV2 } from "../../../ui/context";
import { tipBadgeUrl, useTaskBadgeImg } from "../../../ui/taskBadgeImg";
import { useWorld } from "../../../world/store";
import { taskCode } from "../../now/format";
import { EChart } from "../EChart";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { axisKeys, deriveParallel, parallelOption } from "../viz/parallel";
import { tv } from "../viz/strings";

/** 会话平行坐标: every session as one line over six axes (five with stats.cost hidden), brushable; the session count
 *  is the key figure. */
export function Parallel({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, cost } = useViz();
  const rows = useMemo(() => deriveParallel(prep), [prep]);
  const name = useCallback((k: string) => (k ? taskCode(k) : t(lang, "tl.unlinked")), [lang]);
  const bimg = useTaskBadgeImg(), bw = useWorld(), ids = useMemo(() => [...new Set(rows.map((r) => r.s.task_id).filter((x): x is string => !!x))], [rows]);
  useEffect(() => { if (bimg) void bimg.warm(ids, bw); }, [bimg, ids, bw]);
  const option = useCallback((world: World, c: boolean) => parallelOption(world, rows, c, name, lang, (id) => tipBadgeUrl(id, world)), [rows, name, lang]);
  if (!rows.length) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const axes = axisKeys(cost).map((k) => tv(lang, k));
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "par.meta", { n: rows.length })}
      summary={tv(lang, "par.sum", { n: rows.length, k: axes.length, axes: axes.join(lang === "en" ? ", " : "、") })}>
      <EChart option={option} height={320} label={t(lang, "sv.parallel.name")} onHoverTask />
    </ViewFrame>
  );
}
