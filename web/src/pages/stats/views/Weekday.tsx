import { useCallback, useMemo } from "react";
import { hours } from "../../../lib/format";
import type { StrKey } from "../../../i18n/strings";
import { t } from "../../../i18n/t";
import type { World } from "../../../prefs/types";
import { useV2 } from "../../../ui/context";
import { EChart } from "../EChart";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { busiest } from "../viz/echarts-theme";
import { tv } from "../viz/strings";
import { deriveWeekday, weekdayOption } from "../viz/weekday";

/** 星期均值: average wall clock per weekday as dot bars. Needs every weekday in the range (≥ 7 days) and some work. */
export function Weekday({ id, num }: ViewProps) {
  const { lang } = useV2(), { days } = useViz();
  const w = useMemo(() => deriveWeekday(days), [days]);
  const names = useMemo(() => Array.from({ length: 7 }, (_, i) => t(lang, `tl.dow.${i + 1}` as StrKey)), [lang]);
  const option = useCallback((world: World) => weekdayOption(world, w, names, lang), [w, names, lang]);
  const best = busiest(w.avg);
  if (days.length < 7 || best < 0) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const list = w.avg.map((m, i) => `${names[i]} ${hours(m ?? 0)}`).join(lang === "en" ? ", " : "、");
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "weekday.meta", { d: names[best] })} summary={tv(lang, "weekday.sum", { list })}>
      <EChart option={option} height={230} label={t(lang, "sv.weekday.name")} />
    </ViewFrame>
  );
}
