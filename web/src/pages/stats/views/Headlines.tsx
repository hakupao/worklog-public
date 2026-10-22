import { useMemo } from "react";
import { compactCount, hours, usd } from "../../../lib/format";
import type { StrKey } from "../../../i18n/strings";
import { t } from "../../../i18n/t";
import type { Lang } from "../../../prefs/types";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { Led, type LedSeg } from "../../../ui/Led";
import { C, lineColor } from "../../../ui/palette";
import { BADGE_H, TaskBadge } from "../../../ui/TaskBadge";
import { taskCode } from "../../now/format";
import { useViz } from "../useViz";
import { Thin, ViewFrame } from "../ViewFrame";
import type { ViewProps } from "../Views";
import { clock5, hm, hmin, pct } from "../viz/fmt";
import { deriveHeadlines, type Headlines as H } from "../viz/headlines";
import { tv, type VStrKey } from "../viz/strings";
import { day5 } from "../viz/day";

/** One cell: label, figure, two lines (a line may name a task: its code in the line colour, then the title). */
interface Cell { k: string; label: string; value: string; a: string; b: string | LedSeg[]; task?: string }

const plain = (b: string | LedSeg[]) => (typeof b === "string" ? b : b.map((s) => s.t).join(""));
const wdName = (lang: Lang, w: number) => tv(lang, "wd.name", { d: t(lang, `tl.dow.${w + 1}` as StrKey) });
const dt = (ms: number) => `${mdOf(day5(ms))} ${hm(ms)}`;

function taskLine(lang: Lang, task: string | null, title: string | undefined): string | LedSeg[] {
  if (!task) return t(lang, "tl.unlinked");
  return [{ t: taskCode(task), kind: "code", color: lineColor(task) }, { t: ` ${title ?? ""}`.trimEnd() }];
}

/** The ten cells (lab s0 less the finish drift, plus a separate finish median); the costliest session only where
 *  amounts may show (`cost`), so 表 with stats.cost hidden has nine. */
export function cellsOf(h: H, lang: Lang, titleOf: (id: string) => string | undefined, cost: boolean): Cell[] {
  const L = (k: string) => tv(lang, `hl.${k}` as VStrKey);
  const med = (k: "start" | "end", v: number | null): Cell => ({
    k, label: L(k), value: v === null ? "—" : clock5(v),
    a: v === null ? tv(lang, "hl.med.none") : tv(lang, "hl.med.a", { n: h.workdays }), b: v === null ? "" : L(`${k}.b`),
  });
  const cells: Cell[] = [
    { k: "wall", label: L("wall"), value: hours(h.wall), a: tv(lang, "hl.wall.a", { s: hours(h.summed) }), b: tv(lang, "hl.wall.b", { p: pct(h.wall ? h.summed / h.wall - 1 : 0) }) },
    { k: "peak", label: L("peak"), value: `×${h.peak?.c ?? 0}`, a: h.peak ? dt(h.peak.at) : "—", b: tv(lang, "hl.peak.b", { n: h.peak?.c ?? 0 }) },
    { k: "dense", label: L("dense"), value: hours(h.dense?.sum ?? 0), a: tv(lang, "hl.dense.a", { d: h.dense ? mdOf(h.dense.date) : "—" }), b: tv(lang, "hl.dense.b", { u: hours(h.dense?.union ?? 0) }) },
    h.longest
      ? { k: "long", label: L("long"), value: hmin(h.longest.wall), a: tv(lang, "hl.long.a", { d: dt(h.longest.t0) }), b: taskLine(lang, h.longest.task, h.longest.task ? titleOf(h.longest.task) : undefined), task: h.longest.task ?? undefined }
      : { k: "long", label: L("long"), value: "—", a: "", b: "" },
    med("start", h.start),
    med("end", h.end),
    h.wd
      ? { k: "wd", label: L("wd"), value: wdName(lang, h.wd.best), a: tv(lang, "hl.wd.a", { h: hours(h.wd.avg) }), b: tv(lang, "hl.wd.b", { q: wdName(lang, h.wd.low), l: hours(h.wd.lowAvg) }) }
      : { k: "wd", label: L("wd"), value: "—", a: "", b: "" },
    h.costly
      ? { k: "cost", label: L("cost"), value: usd(h.costly.cost), a: tv(lang, "hl.cost.a", { d: mdOf(day5(h.costly.t0)), k: h.costly.tokens === null ? "—" : compactCount(h.costly.tokens) }), b: taskLine(lang, h.costly.task, h.costly.task ? titleOf(h.costly.task) : undefined), task: h.costly.task ?? undefined }
      : { k: "cost", label: L("cost"), value: "—", a: tv(lang, "hl.cost.none"), b: "" },
    h.tokens.all
      ? { k: "tok", label: L("tok"), value: compactCount(h.tokens.all), a: tv(lang, "hl.tok.a", { c: pct(h.tokens.cacheRead / h.tokens.all, 1) }), b: tv(lang, "hl.tok.b", { o: pct(h.tokens.output / h.tokens.all, 2) }) }
      : { k: "tok", label: L("tok"), value: "0", a: tv(lang, "hl.tok.none"), b: "" },
    { k: "days", label: L("days"), value: `${h.active}/${h.days}`, a: tv(lang, "hl.days.a", { n: h.streak?.len ?? 0 }), b: h.streak ? `${mdOf(h.streak.from)}–${mdOf(h.streak.to)}` : "" },
  ];
  return cost ? cells : cells.filter((c) => c.k !== "cost");
}

/** The badge carries the code; the Led keeps it only when no title follows (else an empty line). */
const titled = (b: LedSeg[]): LedSeg[] => {
  const rest = b.filter((s) => s.kind !== "code").map((s) => ({ ...s, t: s.t.trimStart() }));
  return rest.some((s) => s.t) ? rest : b;
};

/** 洞察头条: ten big figures with two lines of context each (wall clock vs summed, peak, fullest day, longest session,
 *  median start / finish, weekdays, costliest session, tokens, active days and streak). A cell naming a task carries
 *  its data-task, so the page's hover lights it. */
export function Headlines({ id, num }: ViewProps) {
  const { lang } = useV2(), { prep, segs, days, tasks, cost } = useViz();
  const h = useMemo(() => deriveHeadlines(prep, segs, days), [prep, segs, days]);
  if (h.wall <= 0) return <ViewFrame id={id} num={num}><Thin /></ViewFrame>;
  const cells = cellsOf(h, lang, (k) => tasks.get(k)?.title, cost);
  const summary = cells.map((c) => tv(lang, "hl.cell", { l: c.label, v: c.value, a: c.a, b: plain(c.b) })).join(lang === "en" ? "; " : "；");
  return (
    <ViewFrame id={id} num={num} meta={tv(lang, "hl.meta", { n: h.sessions })} summary={summary}>
      <div className="sv-hl">
        {cells.map((c) => (
          <div key={c.k} className="hc" data-cell={c.k} data-task={c.task}>
            <Led ui tier={2} clip className="fill" color={C.DIM} text={c.label} />
            <div className="v"><Led ui={c.k === "wd"} size={12} tier={c.k === "wall" ? 0 : 1} fit text={c.value} /></div>
            <Led ui tier={3} clip className="fill" text={c.a || " "} />
            {typeof c.b === "string"
              ? <Led ui tier={3} clip className="fill" text={c.b || " "} />
              : <span className="hl-task">
                  {c.task && <TaskBadge id={c.task} height={BADGE_H.chip} />}
                  <Led tier={3} clip className="fill" task={c.task} text={titled(c.b)} />
                </span>}
          </div>
        ))}
      </div>
    </ViewFrame>
  );
}
