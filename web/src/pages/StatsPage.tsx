import { lazy, Suspense, type CSSProperties } from "react";
import type { Dashboard, Hint, Overview } from "../api/types";
import { compactCount, hours } from "../lib/format";
import { todayJst } from "../lib/jst";
import { delta, PRESETS } from "./stats/range";
import { fmtMoney } from "../i18n/format";
import type { StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import type { Lang } from "../prefs/types";
import { useV2 } from "../ui/context";
import { Led } from "../ui/Led";
import { Mod } from "../ui/Mod";
import { C, lineColor } from "../ui/palette";
import { TipHost } from "../ui/TipHost";
import { BADGE_H, TaskBadge } from "../ui/TaskBadge";
import { isModuleHidden } from "../world/modules";
import { useWorld } from "../world/store";
import { useMinute } from "./now/useNowData";
import { AiCol } from "./stats/AiCol";
import { hintLinks, hintText } from "./stats/hints";
import { Failure, None, Partial } from "./stats/parts";
import { ReviewSec } from "./stats/ReviewSec";
import { RhythmCol } from "./stats/RhythmCol";
import { ShareCol } from "./stats/ShareCol";
import { useSt, type St } from "./stats/state";
import { TimeCol } from "./stats/TimeCol";
import { useStatsData, type StatsData } from "./stats/useStatsData";
import { useStatsSessions } from "./stats/useStatsSessions";
import { clockHour } from "./stats/viz/day";

/** The views (sub-project 7b) are their own chunk, loaded with the page. */
const Views = lazy(() => import("./stats/Views"));

/** A range's text: the date alone for one day, else `from 〜 to` (the old page's). */
const rangeText = (r: { from: string; to: string }) => (r.from === r.to ? r.from : `${r.from} 〜 ${r.to}`);

/** The change against the previous range, from range.ts's delta: its Chinese 新 is worded here; the rest ("—",
 *  "0%", "+12%") reads the same in every language. */
function deltaText(lang: Lang, cur: number, prev: number): string {
  const d = delta(cur, prev);
  return d.dir === "new" ? t(lang, "st.d.new") : d.text;
}

const OV_NUMS = ["minutes", "active_days", "sessions", "tasks_done", "tokens", "cost_usd"] as const;
const overview = (o: unknown): boolean =>
  typeof o === "object" && o !== null && OV_NUMS.every((k) => Number.isFinite((o as Record<string, unknown>)[k]));
const range = (r: unknown): boolean =>
  typeof r === "object" && r !== null && typeof (r as Record<string, unknown>).from === "string" && typeof (r as Record<string, unknown>).to === "string";

/** An answer the page can draw: the figures are numbers and the previous range has dates (a proxy page or a schema
 *  change is a failure to retry, not a crash or NaN on screen). */
function usable(d: Dashboard | undefined): Dashboard | undefined {
  return d && overview(d.overview) && overview(d.overview_prev) && range(d.prev_range) && Array.isArray(d.hints) ? d : undefined;
}

/** 统计 (spec §3.1, prototype page-stats.html layout A; 7b spec §3): the range on the control line, the figure
 *  strip led by 总工时, the hints, then the view area (stats/Views, its own chunk): the user's views in order, the
 *  sub-project 7 blocks among them (时间花在哪, 依頼元与产出, 工作节奏, AI 使用效率, 周复盘 — drawn from the dashboard,
 *  the others from the sessions; until its data is in each view holds its place and number with a wait line, R4). AI 使用效率 is module stats.cost and 周复盘 stats.review: hidden (表), they are not
 *  rendered (registry needs). */
export function StatsPage() {
  const s = useSt();
  const data = useStatsData(s.st.from, s.st.to);
  const ses = useStatsSessions(s.st.from, s.st.to);
  const d = usable(data.dash);
  const { prefs } = useV2(), world = useWorld();
  const ai = !isModuleHidden("stats.cost", prefs.omote.hide, world);
  const wait = () => <WaitLine failed={data.error !== null || data.dash !== undefined} text="st.failed" />;
  const blocks = d ? {
    time: () => <TimeCol d={d} />, share: () => <ShareCol d={d} />, rhythm: () => <RhythmCol d={d} />,
    ai: () => <AiCol d={d} />, review: () => <ReviewSec data={data} />,
  } : { time: wait, share: wait, rhythm: wait, ai: wait, review: wait };
  // one TipHost for the page (one persistent tooltip), as on 此刻 and 时间线
  return (
    <TipHost>
      <div className="stp">
        <section className="st-top">
          <Controls s={s} stale={data.stale || ses.stale} />
          {/* a refresh that failed with figures on screen: say so and keep them */}
          {d && data.error !== null && <Failure err={data.error} retry={data.refetch} className="st-fail" />}
          {d ? <><Figures d={d} /><Hints hints={d.hints} cost={ai} /></> : <Wait data={data} odd={data.dash !== undefined} />}
        </section>
        <Before5 s={s} />
        {ses.error !== null && <Failure err={ses.error} retry={ses.refetch} className="st-fail sv-fail" text="sv.failed" />}
        <Suspense fallback={null}><Views blocks={blocks} blocksReady={d !== undefined} sessions={ses.data} tasks={ses.tasks} tasksIn={ses.tasksIn} pending={() => <WaitLine failed={ses.error !== null} text="sv.failed" />} /></Suspense>
      </div>
    </TipHost>
  );
}

/** Today between 0:00 and 5:00 (U15): the views' day starts at 5:00, so a range that starts today is all but empty
 *  while the blocks have figures — say why (one dim line) and, on 今天, offer yesterday; the range is not moved. */
function Before5({ s }: { s: St }) {
  const { lang } = useV2();
  const now = useMinute();
  if (s.st.from !== todayJst(now) || clockHour(now.getTime()) >= 5) return null;
  return (
    <div className="sv-before">
      <span className="nm"><Led ui tier={2} clip className="fill" color={C.DIM} text={t(lang, "sv.before5")} /></span>
      {s.st.preset === "day" && (
        <button type="button" className="key dim" onClick={() => s.setBack(s.st.back + 1)}><Led ui tier={1} fit color={C.WARM} text={t(lang, "sv.before5.go")} /></button>
      )}
    </div>
  );
}

/** presets | ◀ range ▶ | 更新中… (`stale`: the dashboard or the views' sessions on screen are another range's) */
function Controls({ s, stale }: { s: St; stale: boolean }) {
  const { lang } = useV2();
  const { st, setPreset, setBack } = s;
  return (
    <div className="sec st-ctl">
      <div className="keys" role="group" aria-label={t(lang, "st.range")}>
        {PRESETS.map(({ key }) => (
          <button key={key} type="button" className={`key${st.preset === key ? " on" : " dim"}`} aria-pressed={st.preset === key} onClick={() => setPreset(key)}>
            <Led ui tier={1} fit text={t(lang, `st.preset.${key}` as StrKey)} />
          </button>
        ))}
      </div>
      <span className="vr" />
      <div className="keys" role="group" aria-label={t(lang, "st.nav")}>
        <button type="button" className="key dim" aria-label={t(lang, "st.prev")} onClick={() => setBack(st.back + 1)}><Led ui tier={2} fit text="◀" /></button>
        <Led ui size={12} tier={1} fit text={rangeText(st)} />
        <button type="button" className="key dim" aria-label={t(lang, "st.next")} disabled={st.back === 0} onClick={() => setBack(st.back - 1)}><Led ui tier={2} fit text="▶" /></button>
      </div>
      {/* only while the figures on screen are another range's — not on the 5-minute refresh */}
      {stale && <span role="status"><Led ui tier={3} fit text={t(lang, "tl.updating")} /></span>}
    </div>
  );
}

type FigKey = "minutes" | "active_days" | "sessions" | "tasks_done" | "tokens";
const FIGS: { k: FigKey; value: (o: Overview) => string }[] = [
  { k: "minutes", value: (o) => hours(o.minutes) },
  { k: "active_days", value: (o) => String(o.active_days) },
  { k: "sessions", value: (o) => String(o.sessions) },
  { k: "tasks_done", value: (o) => String(o.tasks_done) },
  { k: "tokens", value: (o) => compactCount(o.tokens) },
];

/** 总工时 (the one L0 figure) and five more, each with its change against the previous range of the same length;
 *  等价费用 is the stats.cost module. */
function Figures({ d }: { d: Dashboard }) {
  const { lang } = useV2();
  const o = d.overview, p = d.overview_prev;
  const empty = o.minutes === 0 && o.sessions === 0 && o.tasks_done === 0 && o.tokens === 0;
  const label = (k: FigKey | "cost_usd") => <Led ui tier={2} fit color={C.DIM} text={t(lang, `st.f.${k}` as StrKey)} />;
  const change = (cur: number, prev: number) => <Led ui tier={2} fit color={C.DIM} text={deltaText(lang, cur, prev)} />;
  return (
    <>
      <div className="st-figs">
        {FIGS.map(({ k, value }) => (
          <div key={k} className={`st-fig${k === "minutes" ? " hero" : ""}`}>
            {label(k)}
            <div className="v">
              {k === "minutes" ? <Led size={8} scale={2} tier={0} fit text={value(o)} /> : <Led size={12} tier={1} fit text={value(o)} />}
              {k === "active_days" && <Led ui tier={2} fit color={C.DIM} text={t(lang, "st.u.days")} />}
            </div>
            {change(o[k], p[k])}
          </div>
        ))}
        <Mod id="stats.cost" className="st-fig">
          {label("cost_usd")}
          <div className="v">
            <Led size={12} tier={1} fit text={`≈${fmtMoney(o.cost_usd, lang)}`} />
            {o.cost_partial === true && <Partial />}
          </div>
          {change(o.cost_usd, p.cost_usd)}
        </Mod>
      </div>
      {empty && <div className="st-empty"><Led ui tier={2} fit color={C.DIM} text={t(lang, "st.empty")} /></div>}
      <div className="st-vs"><Led ui tier={3} fit color="#6f5530" text={t(lang, "st.vs", { r: rangeText(d.prev_range) })} /></div>
    </>
  );
}

/** One line per hint (the server sorts warn first and keeps at most 3 links), its links as keys on the right: a task
 *  by its line code (the title on hover), anything else by its label. A row that isn't an object with a string id and
 *  text (the fallback wording) is skipped; with
 *  stats.cost hidden (`cost` false) so is costly-session, which is an amount. */
function Hints({ hints: all, cost }: { hints: Hint[]; cost: boolean }) {
  const { lang } = useV2();
  const hints = all.filter((h): h is Hint => typeof h === "object" && h !== null && typeof h.id === "string" && typeof h.text === "string" && (cost || h.id !== "costly-session"));
  return (
    <section className="st-hints" aria-label={t(lang, "st.hints")}>
      <div className="st-sh">
        <Led ui size={12} tier={2} fit color={C.WARM} text={t(lang, "st.hints")} />
        <span className="grow" />
        <Led ui tier={2} fit color={C.DIM} text={String(hints.length)} />
      </div>
      {hints.length === 0 && <div className="st-none"><Led ui tier={2} fit color={C.DIM} text={t(lang, "st.hints.none")} /></div>}
      {hints.map((h, i) => (
        <div key={`${h.id}-${i}`} className="st-hint" data-level={h.level}>
          <span className="pip" />
          <span className="nm"><Led ui tier={1} clip className="fill" color={C.WARM} text={hintText(lang, h)} /></span>
          <span className="lk">
            {hintLinks(lang, h).map((l, j) => {
              const id = l.taskId;
              if (!id) return <a key={j} className="key dim" href={l.href}><Led ui tier={1} fit color={C.WARM} text={l.label} /></a>;
              const lc = lineColor(id);
              return (
                <a key={j} className="key dim" href={l.href} title={l.label} aria-label={l.label} data-task={id} style={{ "--lc": lc } as CSSProperties}>
                  <TaskBadge id={id} height={BADGE_H.chip} title={null} />
                </a>
              );
            })}
          </span>
        </div>
      ))}
    </section>
  );
}

/** A view's body while its data is not in (R4): 读取中, or one dim line once the request failed (重试 is at the top);
 *  the view keeps its place and number either way. */
function WaitLine({ failed, text }: { failed: boolean; text: StrKey }) {
  const { lang } = useV2();
  return (
    <div className="sv-pend">
      {failed ? <None text={t(lang, text)} /> : <div className="st-wait" role="status"><Led ui tier={2} fit text={t(lang, "now.loading")} /></div>}
    </div>
  );
}

/** Nothing to draw yet: the first load, or why there is none. `odd`: the server answered, but not with a dashboard
 *  — a failure to retry, not an endless 读取中. */
function Wait({ data, odd }: { data: StatsData; odd: boolean }) {
  const { lang } = useV2();
  if (data.error !== null || odd) return <Failure err={data.error} retry={data.refetch} className="st-wait" />;
  return <div className="st-wait" role="status"><Led ui tier={2} fit text={t(lang, "now.loading")} /></div>;
}
