// web/src/m/pages/Timeline.tsx
import { useMemo, useState } from "react";
import { useTasks, useTimeline } from "../../api/queries";
import type { Session } from "../../api/types";
import { todayJst, weekOfDate } from "../../lib/jst";
import { fmtHm } from "../../i18n/format";
import { t } from "../../i18n/t";
import { replaceHash } from "../../route";
import { useV2 } from "../../ui/context";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { hmClock, stepDay } from "../format";
import { mHref, type MRoute } from "../route";
import { DayNav } from "../ui/DayNav";
import { Seg } from "../ui/Seg";
import { Empty, ErrorState, Loading } from "../ui/State";
import { useSwipe } from "../ui/swipe";
import { SessionSheet } from "./SessionSheet";

/** 时间线 (spec §5): one Tokyo day of sessions, read-only; ‹ › and swipes change the day (never past today). */
export function Timeline({ route }: { route: MRoute }) {
  const { lang } = useV2();
  const today = todayJst();
  const date = route.param && route.param <= today ? route.param : today;
  const tl = useTimeline(weekOfDate(date), false);
  const tasks = useTasks();
  const [open, setOpen] = useState<Session | null>(null);
  const href = (d: string, un: boolean) => mHref("tl", d === today ? null : d, un ? { un: "1" } : undefined);
  const go = (d: 1 | -1) => { const n = stepDay(date, d, undefined, today); if (!n) return; replaceHash(href(n, route.unlinked)); };
  const swipe = useSwipe(go);
  const titles = useMemo(() => new Map((tasks.data ?? []).map((x) => [x.id, x.title])), [tasks.data]);
  const title = (s: Session) => (s.task_id ? titles.get(s.task_id) ?? s.task_id : t(lang, "m.unlinked"));

  const ready = tl.data !== undefined && !tl.isPlaceholderData;
  const day = ready ? tl.data!.days.find((d) => d.date === date) : undefined;
  const all = [...(day?.sessions ?? [])].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const list = route.unlinked ? all.filter((s) => s.task_id === null) : all;
  const sub = day ? t(lang, "m.tl.sub", { n: all.length, w: hmClock(day.wall_minutes ?? day.minutes), s: hmClock(day.minutes) }) : "";

  let body;
  if (tl.error && !ready) body = <ErrorState onRetry={() => void tl.refetch()} />;
  else if (!ready) body = <Loading rows={5} />;
  else body = (
    <section key={date} className="m-grp" style={{ marginTop: 12 }}>
      {list.length === 0 ? <Empty>{t(lang, route.unlinked ? "m.tl.emptyUnlinked" : "m.tl.empty")}</Empty> : list.map((s) => (
        <button key={s.id} type="button" className="m-row" onClick={() => setOpen(s)}>
          <span className="m-time">{fmtHm(s.started_at)}</span>
          {s.task_id && <TaskBadge id={s.task_id} height={BADGE_H.mRow} />}
          <span className="m-col"><span className="m-t1">{title(s)}</span><span className="m-t2">{s.summary_effective}</span></span>
          <span className="m-side">{t(lang, "m.min", { n: Math.round(s.minutes_on_day ?? s.minutes_effective) })}</span>
        </button>
      ))}
    </section>
  );

  return (
    <div className="m-stack" {...swipe}>
      <DayNav date={date} today={today} max={today} onGo={go} sub={sub} />
      <Seg label={t(lang, "m.tl.filter")} value={route.unlinked ? "un" : "all"}
        options={[["all", t(lang, "m.tl.all")], ["un", t(lang, "m.tl.unlinkedOnly")]]}
        onChange={(v) => replaceHash(href(date, v === "un"))} />
      {body}
      {open && <SessionSheet s={open} dayMinutes={open.minutes_on_day ?? undefined} title={title(open)} onClose={() => setOpen(null)} />}
    </div>
  );
}
