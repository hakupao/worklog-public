import { useIsMutating } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { Note, Session } from "../api/types";
import { currentWeek, shiftWeek } from "../lib/jst";
import { dirName } from "../lib/format";
import { fmtMoney } from "../i18n/format";
import { t } from "../i18n/t";
import { mdOf } from "../predict/time";
import { useV2 } from "../ui/context";
import { Led } from "../ui/Led";
import { Mod } from "../ui/Mod";
import { Drawer } from "../ui/Drawer";
import { TipHost } from "../ui/TipHost";
import { DayList } from "./timeline/DayList";
import { NoteDrawer } from "./timeline/NoteDrawer";
import { defaultDay } from "./timeline/rows";
import { SessionDrawer } from "./timeline/SessionDrawer";
import { useTl, type TlState } from "./timeline/state";
import { useTimelineData, type TimelineData } from "./timeline/useTimelineData";
import { WeekChart } from "./timeline/WeekChart";

/** 时间线 (spec §3.1): the week as five day bands, the chosen day's sessions and notes, and 未关联 as a
 *  filter of the same page (?unlinked=1) instead of a page of its own. */
export function TimelinePage() {
  const { lang } = useV2();
  const [st, set, go] = useTl();
  const data = useTimelineData(st.week, st.hidden);
  const L = data.layout;
  const day = st.day ?? (L ? defaultDay(L.bands) : null);
  // Every session the page knows, by id: the week's (the selected day's copy first, for its day share)
  // and the cross-week 未关联 list. The drawer reads the live row from here, so a write shows at once.
  const known = useMemo(() => {
    const m = new Map<string, Session>();
    const bands = L ? [...L.bands].sort((x, y) => Number(y.date === day) - Number(x.date === day)) : [];
    for (const b of bands) for (const s of b.sessions) if (!m.has(s.id)) m.set(s.id, s);
    for (const s of data.unlinked ?? []) if (!m.has(s.id)) m.set(s.id, s);
    return m;
  }, [L, day, data.unlinked]);
  const pool = useMemo(() => [...known.values()], [known]);
  const openS = st.open?.kind === "s" ? known.get(st.open.id) ?? null : null;
  const openN = useMemo<Note | null>(() => {
    if (st.open?.kind !== "n" || !L) return null;
    for (const b of L.bands) for (const n of b.notes) if (n.id === st.open.id) return n;
    return null;
  }, [st.open, L]);
  // 隐藏本周此目录: the displayed week's not-hidden sessions in the open session's directory, but only
  // when the open session is itself one of the week's (from the cross-week list it would hide another week's)
  const sameDir = useMemo(() => {
    if (!openS || !L) return null;
    const week = new Map<string, Session>();
    for (const b of L.bands) for (const x of b.sessions) week.set(x.id, x);
    return week.has(openS.id) ? [...week.values()].filter((x) => !x.hidden && x.cwd === openS.cwd) : null;
  }, [openS, L]);
  // What the drawer was on is gone (hidden in a batch, linked out of the cross-week list, deleted): drop it
  // from the address too, or it would pop back open when that row reappears (R9). Only once the data it
  // could be in has loaded.
  // Not while a write is in flight: its optimistic step may have taken the row out, and a failure puts it back
  // (the drawer then reopens on it instead of the user having to find it again).
  const writing = useIsMutating();
  useEffect(() => {
    if (writing === 0 && st.open && L && (data.unlinked !== null || data.unlinkedError !== null) && !openS && !openN) set({ open: null });
  }, [writing, st.open, L, data.unlinked, data.unlinkedError, openS, openN, set]);
  const close = () => set({ open: null });
  const label = openN ? t(lang, "tl.row.note") : t(lang, "tl.p.label", { t: openS?.id ?? "" });
  return (
    <TipHost>
      <div className="tl">
        <TopLine st={st} data={data} set={set} go={go} />
        {!L
          ? <section className="tl-wait">
              <Led ui tier={2} fit text={t(lang, data.error ? "now.error" : "now.loading")} />
              {data.error !== null && <button type="button" className="key dim" onClick={data.refetch}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>}
            </section>
          : <>
              <WeekChart L={L} sel={day} onlyUnlinked={st.unlinked} tasks={data.tasks}
                onSelect={(d) => set({ day: d, unlinked: false })}
                onOpen={(id, d) => set({ open: { kind: "s", id }, ...(st.unlinked ? {} : { day: d }) })} />
              <DayList L={L} st={st} day={day} data={data} set={set} />
            </>}
      </div>
      <Drawer open={!!openS || !!openN} onClose={close} label={label} fallback={() => document.querySelector<HTMLElement>(".tl-day")}
        returnTo={() => (st.open ? document.querySelector<HTMLElement>(`.srow[data-id="${CSS.escape(st.open.kind === "s" ? st.open.id : `n:${st.open.id}`)}"]`) : null)}>
        {openS && <SessionDrawer key={openS.id} s={openS} day={st.unlinked ? null : day} tasks={data.tasks} pool={pool} live={!!L?.running.includes(openS.id)} onClose={close}
          dir={st.dir} onDir={(d) => set({ dir: d })} sameDir={sameDir} />}
        {openN && <NoteDrawer key={openN.id} n={openN} tasks={data.tasks} onClose={close} />}
      </Drawer>
    </TipHost>
  );
}

/** "9/28–10/2 · 第 40 周": Monday to the last band shown (Friday, or the weekend when it has work). Any list of
 *  shown days will do (the 週報 page passes its columns). */
export function weekText(lang: Parameters<typeof t>[0], L: { bands: readonly { date: string }[] } | null, week: string): string {
  const n = Number(week.slice(6));
  if (!L || L.bands.length === 0) return t(lang, "tl.weekN", { n });
  return t(lang, "tl.week", { a: mdOf(L.bands[0].date), b: mdOf(L.bands[L.bands.length - 1].date), n });
}

function TopLine({ st, data, set, go }: { st: TlState; data: TimelineData; set: ReturnType<typeof useTl>[1]; go: (w: string) => void }) {
  const { lang } = useV2();
  const L = data.layout, here = currentWeek();
  const nUn = data.unlinked?.length ?? 0, nHid = L?.hidden ?? 0, unFailed = data.unlinkedError !== null;
  const sum = useMemo(() => (L ? t(lang, "tl.sum", { w: (L.totalWall / 60).toFixed(1), h: (L.totalMinutes / 60).toFixed(1), n: L.sessionCount }) : ""), [L, lang]);
  return (
    <section className="tl-top">
      <div className="sec">
        <div className="keys" role="group" aria-label={t(lang, "tl.nav")}>
          <button type="button" className="key dim" aria-label={t(lang, "tl.prev")} onClick={() => go(shiftWeek(st.week, -1))}><Led ui tier={2} fit text="◀" /></button>
          <Led ui size={12} tier={1} fit text={weekText(lang, L, st.week)} />
          <button type="button" className="key dim" aria-label={t(lang, "tl.next")} onClick={() => go(shiftWeek(st.week, 1))}><Led ui tier={2} fit text="▶" /></button>
          {st.week !== here && <button type="button" className="key" onClick={() => go(here)}><Led ui tier={1} fit text={t(lang, "tl.thisWeek")} /></button>}
        </div>
        <span className="vr" />
        {L && <Led ui tier={1} fit text={sum} />}
        {L && <Mod id="timeline.cost"><Led ui tier={2} fit text={`${fmtMoney(L.cost, lang)}${L.costPartial ? "*" : ""}`} /></Mod>}
        {L && (st.unlinked || st.dir) && <Led ui tier={3} fit text={t(lang, "tl.sumAll")} />}
        {data.fetching && <span role="status"><Led ui tier={3} fit text={t(lang, "tl.updating")} /></span>}
        <span className="grow" />
        {st.dir && (
          <button type="button" className="key on" title={st.dir} aria-label={t(lang, "tl.dir.clear", { d: st.dir })} onClick={() => set({ dir: null })}>
            <Led ui tier={1} fit text={[{ t: t(lang, "tl.dir") }, { t: dirName(st.dir), glyph: "ja" }, { t: " ×" }]} />
          </button>
        )}
        {(nUn > 0 || st.unlinked || unFailed) && (
          <button type="button" className={`key warn${st.unlinked ? " on" : ""}`} aria-pressed={st.unlinked} onClick={() => set({ unlinked: !st.unlinked })}>
            {nUn > 0 && <span className="lamp red" />}
            <Led ui tier={1} fit text={unFailed ? t(lang, "tl.unlinkedUnknown") : t(lang, "tl.unlinkedN", { n: nUn })} />
          </button>
        )}
        {(nHid > 0 || st.hidden) && (
          <button type="button" className={`key dim${st.hidden ? " on" : ""}`} aria-pressed={st.hidden} onClick={() => set({ hidden: !st.hidden })}>
            <Led ui tier={2} fit text={t(lang, "tl.hiddenN", { n: nHid })} />
          </button>
        )}
      </div>
    </section>
  );
}
