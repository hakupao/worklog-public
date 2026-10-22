import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { keys, useDashboard } from "../../api/queries";
import { todayJst } from "../../lib/jst";
import { compactCount } from "../../lib/format";
import { fmtMoney } from "../../i18n/format";
import { t } from "../../i18n/t";
import { replaceHash } from "../../route";
import { useV2 } from "../../ui/context";
import { hours1, LOCALE } from "../format";
import { mHref, type MRoute, type StatsRange } from "../route";
import { DotBar, DotCol, DotNum } from "../ui/dots";
import { Seg } from "../ui/Seg";
import { ErrorState, Loading } from "../ui/State";
import { datesOf, rangeDates, topTasks, weeksOf } from "./statsRange";

const RANGES: [StatsRange, "m.day.today" | "m.st.week" | "m.st.month"][] = [["today", "m.day.today"], ["week", "m.st.week"], ["month", "m.st.month"]];

/** 统计 (spec §5): 工作时间 from the timeline's wall minutes, 累计 / tokens / cost / by-task from /api/dashboard; days cut at 0:00. */
export function Stats({ route }: { route: MRoute }) {
  const { lang } = useV2();
  const today = todayJst();
  const { from, to } = rangeDates(route.range, today);
  const weeks = weeksOf(from, to);
  const tls = useQueries({ queries: weeks.map((w) => ({ queryKey: keys.timeline(w, false), queryFn: () => api.timeline(w, false) })) });
  const dash = useDashboard(from, to);
  // The tapped day column; keyed by range so a range change clears it.
  const [picked, setPicked] = useState<{ range: StatsRange; date: string } | null>(null);
  const sel = picked && picked.range === route.range ? picked.date : null;
  const h = t(lang, "m.unit.h");

  const failed = dash.error || tls.some((q) => q.error);
  const ready = dash.data !== undefined && !dash.isPlaceholderData && tls.every((q) => q.data !== undefined);
  const chips = (
    <Seg label={t(lang, "m.st.range")} value={route.range} options={RANGES.map(([r, k]) => [r, t(lang, k)])}
      onChange={(r) => { setPicked(null); replaceHash(mHref("stats", null, r === "week" ? undefined : { range: r })); }} />
  );
  if (failed && !ready) return <div className="m-stack">{chips}<ErrorState onRetry={() => { void dash.refetch(); tls.forEach((q) => void q.refetch()); }} /></div>;
  if (!ready) return <div className="m-stack">{chips}<Loading rows={5} /></div>;

  const byDate = new Map(tls.flatMap((q) => q.data?.days ?? []).map((d) => [d.date, d]));
  const days = datesOf(from, to).map((date) => { const d = byDate.get(date); return { date, wall: d ? d.wall_minutes ?? d.minutes : 0 }; });
  const wall = days.reduce((s, d) => s + d.wall, 0);
  const o = dash.data!.overview;
  const unlinked = dash.data!.time.unlinked_minutes;
  const tasks = topTasks(dash.data!.time.by_task.map((x) => ({ title: x.title, minutes: x.minutes })), 5, t(lang, "m.st.other"));
  const top = Math.max(1, ...tasks.map((x) => x.minutes)), mx = Math.max(1, ...days.map((d) => d.wall));
  const weekday = new Intl.DateTimeFormat(LOCALE[lang], { weekday: "narrow", timeZone: "UTC" });
  const colLabel = (date: string, i: number) => (route.range === "week" ? weekday.format(new Date(`${date}T00:00:00Z`)) : i % 5 === 0 || date === today ? String(Number(date.slice(8))) : "");
  const selDay = days.find((d) => d.date === sel);

  const md = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

  return (
    <div className="m-stack" key={route.range}>
      {chips}
      <section className="m-grp">
        <div className="m-big">
          <div><span className="m-lab">{t(lang, "m.st.wall")}</span><DotNum text={hours1(wall)} unit={h} /></div>
          <div><span className="m-lab">{t(lang, "m.now.sum")}</span><DotNum text={hours1(o.minutes)} unit={h} /></div>
        </div>
        <div className="m-mid">
          <div><span className="m-lab">{t(lang, "m.st.tokens")}</span><span className="m-v">{compactCount(o.tokens)}</span></div>
          <div><span className="m-lab">{t(lang, "m.st.cost")}</span><span className="m-v">{fmtMoney(o.cost_usd, lang)}{o.cost_partial ? "+" : ""}</span></div>
        </div>
      </section>
      {o.cost_partial && <p className="m-note">{t(lang, "m.st.partial")}</p>}
      {route.range !== "today" && <>
        <h2 className="m-cap"><span>{t(lang, "m.st.daily")}</span></h2>
        <section className="m-grp">
          <div className="m-cols">
            {days.map((d, i) => (
              <button key={d.date} type="button" aria-label={md(d.date)} aria-pressed={d.date === sel} className={d.date === today ? "today" : undefined}
                onClick={() => setPicked(d.date === sel ? null : { range: route.range, date: d.date })}>
                <DotCol value={d.wall} max={mx} today={d.date === today} />
                <span>{colLabel(d.date, i)}</span>
              </button>
            ))}
          </div>
          <p className="m-pick">{selDay ? `${md(selDay.date)} · ${hours1(selDay.wall)}${h}` : " "}</p>
        </section>
      </>}
      <h2 className="m-cap"><span>{t(lang, "m.st.byTask")}</span></h2>
      <section className="m-grp">
        {tasks.map((x, i) => (
          <div key={`${x.title}-${i}`} className="m-rk"><span>{x.title}</span><span className="m-side">{hours1(x.minutes)}{h}</span><DotBar value={x.minutes} max={top} /></div>
        ))}
        {unlinked > 0 && (
          <div className="m-rk un"><span>{t(lang, "m.unlinked")}</span><span className="m-side">{hours1(unlinked)}{h}</span></div>
        )}
      </section>
      <p className="m-note m-center">{t(lang, "m.st.sessions", { n: o.sessions })}</p>
    </div>
  );
}
