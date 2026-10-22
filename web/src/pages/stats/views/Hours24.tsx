import { useCallback, useMemo } from "react";
import { hours } from "../../../lib/format";
import { t } from "../../../i18n/t";
import type { World } from "../../../prefs/types";
import { useV2 } from "../../../ui/context";
import { EChart } from "../EChart";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { busiest } from "../viz/echarts-theme";
import { deriveHours24, hh, hours24Option } from "../viz/hours24";
import { tv } from "../viz/strings";

/** 24 小时分布: the range's wall clock per clock hour on a polar bar; the busiest hour is the key figure. */
export function Hours24({ id, num }: ViewProps) {
  const { lang } = useV2(), { segs } = useViz();
  const mins = useMemo(() => deriveHours24(segs), [segs]);
  const best = busiest(mins), total = mins.reduce((a, b) => a + b, 0);
  const option = useCallback((world: World) => hours24Option(world, mins, lang), [mins, lang]);
  if (best < 0) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "hours24.meta", { h: hh(best) })}
      summary={tv(lang, "hours24.sum", { h: hh(best), v: hours(mins[best]), t: hours(total) })}>
      <EChart option={option} height={300} label={t(lang, "sv.hours24.name")} />
    </ViewFrame>
  );
}
