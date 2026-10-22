import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api, ApiError } from "../api/client";
import type { DayStatus, PlanItem } from "../api/types";
import { isComposingEvent } from "../lib/ime";
import type { StrKey } from "../i18n/strings";
import { glyphOf, t, tn } from "../i18n/t";
import type { Lang } from "../prefs/types";
import { addDays, mdOf, weekdayOfDate } from "../predict/time";
import { useV2 } from "../ui/context";
import { Led, type LedSeg } from "../ui/Led";
import { Drawer } from "../ui/Drawer";
import { Mod } from "../ui/Mod";
import { C, lineColor } from "../ui/palette";
import { BADGE_H, TaskBadges } from "../ui/TaskBadge";
import { isModuleHidden } from "../world/modules";
import { useWorld } from "../world/store";
import { codeSegs } from "./plan/codes";
import { DayDrawer } from "./plan/DayDrawer";
import { useFlip, useRowFlip } from "./plan/flip";
import { ItemDrawer } from "./plan/ItemDrawer";
import { Judge } from "./plan/Judge";
import { Timetable } from "./plan/Timetable";
import { dayRows, pickable, preview, type AltLine, type DayRow } from "./plan/layout";
import { usePl, type PlOpen } from "./plan/state";
import { usePlanData, type PlanData } from "./plan/usePlanData";
import { usePlanQueue, usePlanRun } from "./plan/write";

const LAMP: Record<DayStatus, string> = { done: "live", partial: "amber", none: "dim" };

/** 计划 (spec §3.1, prototype page-plan.html): the day's 今日安排 board with the AI 对账 column, and the four-horizon
 *  timetable below; every item opens in the glass drawer. */
export function PlanPage() {
  const { lang, prefs } = useV2(), world = useWorld();
  const [st, setOpen, go] = usePl();
  const data = usePlanData(st.date);
  // the day changed under an open 今日安排 drawer (00:00 Tokyo on a bare #/v2/plan): its item is yesterday's, close it
  // (preflight R12). ‹ › already close it themselves.
  // Only that: today → the new today. Going back in history to a day with its drawer in the address keeps it (review B).
  const prevDay = useRef({ date: st.date, isToday: st.isToday });
  useEffect(() => {
    const was = prevDay.current;
    prevDay.current = { date: st.date, isToday: st.isToday };
    if (was.isToday && st.isToday && was.date !== st.date && st.open?.kind === "day") setOpen(null);
  }, [st.date, st.isToday, st.open, setOpen]);
  const solo = isModuleHidden("plan.judge", prefs.omote.hide, world);
  const dayRow = st.open?.kind === "day" && data.plan ? dayRows(data.plan, data.band).find((r) => r.item.id === st.open!.id) : undefined;
  const openItem = st.open?.kind === "item" ? data.items?.find((p) => p.id === st.open!.id) : undefined;
  const drawerLabel = st.open?.kind === "day" ? t(lang, "pl.d.dayLabel", { t: dayRow?.item.text ?? "" })
    : st.open?.kind === "item" ? t(lang, "pl.d.itemLabel", { t: openItem?.text ?? "" }) : "";
  return (
    <div className="pl">
      <div className={`pl-mid${solo ? " solo" : ""}`}>
        <section className="pl-day" tabIndex={-1} aria-label={t(lang, "pl.day.title")}>
          <DayHead date={st.date} isToday={st.isToday} today={data.today} go={go} />
          <DayBody date={st.date} isToday={st.isToday} data={data} open={st.open} setOpen={setOpen} />
        </section>
        {!solo && <span className="vr" />}
        <Mod id="plan.judge" className="pl-side">
          <aside aria-label={t(lang, "pl.j.title")}><Judge plan={data.plan} failed={data.dayError !== null} days={data.histDays} plans={data.histPlans} date={st.date} /></aside>
        </Mod>
      </div>
      <Drawer open={st.open !== null} onClose={() => setOpen(null)} label={drawerLabel}
        fallback={() => document.querySelector<HTMLElement>(st.open?.kind === "item" ? ".pl-tt" : ".pl-day")}
        returnTo={() => (st.open ? document.querySelector<HTMLElement>(`${st.open.kind === "day" ? ".drow" : ".ttrow"}[data-id="${CSS.escape(st.open.id)}"]`) : null)}>
        {st.open?.kind === "day" && <DayDrawer key={st.open.id} plan={data.plan} row={dayRow} failed={data.dayError !== null} retry={data.refetchDay} onClose={() => setOpen(null)} setOpen={setOpen} />}
        {st.open?.kind === "item" && <ItemDrawer key={st.open.id} id={st.open.id} stripDays={data.stripDays} stripBands={data.stripBands} onClose={() => setOpen(null)} />}
      </Drawer>
      <Timetable items={data.items} error={data.itemsError} retry={data.refetchItems} stripDays={data.stripDays} stripBands={data.stripBands} open={st.open} setOpen={setOpen} />
    </div>
  );
}

/** "10/2 周五 · 今天" with ‹ › around it (any day: the server takes every date), and 回到今天 when away from it. */
function DayHead({ date, isToday, today, go }: { date: string; isToday: boolean; today: string; go: (d: string) => void }) {
  const { lang } = useV2();
  const label: LedSeg[] = [{ t: `${mdOf(date)} ${t(lang, "pl.dowf", { d: t(lang, `tl.dow.${weekdayOfDate(date)}` as StrKey) })}` }];
  if (isToday) label.push({ t: ` · ${t(lang, "tl.today")}`, color: C.GREEN });
  return (
    <div className="sec">
      <Led ui size={12} tier={2} fit text={t(lang, "pl.day.title")} />
      <div className="keys">
        <button type="button" className="key dim" aria-label={t(lang, "pl.prev")} onClick={() => go(addDays(date, -1))}><Led ui tier={1} fit text="‹" /></button>
        <Led ui tier={1} fit text={label} />
        <button type="button" className="key dim" aria-label={t(lang, "pl.next")} onClick={() => go(addDays(date, 1))}><Led ui tier={1} fit text="›" /></button>
      </div>
      <span className="grow" />
      {!isToday && <button type="button" className="key dim" onClick={() => go(today)}><Led ui tier={1} fit text={t(lang, "pl.toToday")} /></button>}
    </div>
  );
}

function DayBody({ date, isToday, data, open, setOpen }: { date: string; isToday: boolean; data: PlanData; open: PlOpen; setOpen: (o: PlOpen) => void }) {
  const { lang } = useV2();
  const { plan } = data;
  const flip = useFlip(open === null && !!plan && plan.items.length > 0);
  if (plan === undefined) {
    return (
      <div className="pl-wait">
        <Led ui tier={2} fit text={t(lang, data.dayError ? "now.error" : "now.loading")} />
        {data.dayError !== null && <button type="button" className="key dim" onClick={data.refetchDay}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>}
      </div>
    );
  }
  if (plan === null) return <Preview date={date} isToday={isToday} items={data.items} itemsFailed={data.itemsError !== null} />;
  const rows = dayRows(plan, data.band);
  return (
    <>
      <div role="list" className="drows" aria-label={t(lang, "pl.rows", { d: mdOf(date) })}>
        {rows.length === 0
          ? <div role="listitem" className="drow empty"><Led ui tier={3} fit text={t(lang, "pl.noItems")} /></div>
          : rows.map((r, i) => <DayRowView key={r.item.id} r={r} i={i} flip={flip} sel={open?.kind === "day" && open.id === r.item.id}
              onOpen={() => setOpen({ kind: "day", id: r.item.id })} />)}
      </div>
      <Adds date={date} pick={data.items ? pickable(data.items, plan) : null} itemsFailed={data.itemsError !== null} />
    </>
  );
}

function altSegs(lang: Lang, a: AltLine): LedSeg[] {
  if (a.kind === "note" || a.kind === "detail") return [{ t: a.text }];
  if (a.kind === "progress") return [{ t: t(lang, "now.plan.aiLabel"), glyph: glyphOf(lang) }, { t: a.text }];
  if (a.kind === "idle") return [{ t: t(lang, "pl.prog0"), kind: "dim", glyph: glyphOf(lang) }];
  if (a.kind === "wait") return [{ t: t(lang, "now.loading"), kind: "dim", glyph: glyphOf(lang) }];
  return [
    { t: `${t(lang, "pl.prog", { h: (a.minutes / 60).toFixed(1), s: tn(lang, "tk.u.sess", a.n) })}  `, color: C.GREEN, glyph: glyphOf(lang) },
    { t: a.summary },
  ];
}

function DayRowView({ r, i, flip, sel, onOpen }: { r: DayRow; i: number; flip: number; sel: boolean; onOpen: () => void }) {
  const { lang } = useV2();
  const [hover, setHover] = useState(false);
  const alt = useRowFlip(flip, i) && !hover;
  const k = r.taskIds[0] ?? null, lc = k ? lineColor(k) : "transparent", none = r.status === "none";
  const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } };
  return (
    <div role="listitem" tabIndex={0} className={`drow ${r.status}${sel ? " sel" : ""}`} data-id={r.item.id} data-task={k ?? undefined}
      style={{ "--lc": lc } as CSSProperties} aria-label={t(lang, "pl.row", { t: r.item.text })}
      onClick={onOpen} onKeyDown={key} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <span className="st">
        <span className={`lamp ${LAMP[r.status]}`} />
        <Led key={r.status} ui tier={none ? 2 : 1} fit color={r.status === "done" ? C.GREEN : C.AMBER} text={t(lang, `pl.s.${r.status}` as StrKey)} />
      </span>
      <span className="nm"><Led key={none ? "n" : "y"} tier={none ? 2 : 1} clip className="fill" task={k ?? undefined} text={alt ? altSegs(lang, r.alt) : r.item.text} /></span>
      <span className="nm">{r.taskIds.length ? <TaskBadges ids={r.taskIds} height={BADGE_H.row} dim={none} /> : <Led key="n" tier={2} clip className="fill" text={codeSegs(lang, [])} />}</span>
      <span className="r"><Led key={r.by ?? "-"} ui tier={r.by ? 1 : 2} fit text={t(lang, `pl.by.${r.by ?? "none"}` as StrKey)} /></span>
    </div>
  );
}

/** Before the day starts (user ruling U2): the daily items it will bring in, and 开始. */
function Preview({ date, isToday, items, itemsFailed }: { date: string; isToday: boolean; items: PlanItem[] | null; itemsFailed: boolean }) {
  const { lang } = useV2();
  const run = usePlanRun();
  const pv = items ? preview(items, date) : [];
  // the plan items not loaded (yet, or failed): say that, not "no daily items" (preflight R8)
  const intro = !items ? t(lang, itemsFailed ? "pl.itemsFailed" : "pl.itemsLoading") : t(lang, pv.length ? "pl.empty" : "pl.emptyNone");
  const start = () => run(async () => {
    // 409 exists: started elsewhere (the other machine, another tab) in the meantime — the refetch shows it
    try { return await api.startDayPlan(date); } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as { error?: unknown } | null)?.error === "exists") return null;
      throw err;
    }
  });
  return (
    <div className="preview">
      <div className="pvrow intro"><Led ui tier={2} clip className="fill" text={intro} /></div>
      {pv.map((p) => {
        const ids = p.tasks.map((x) => x.id);
        return (
          <div key={p.id} className="pvrow" style={{ "--lc": ids[0] ? lineColor(ids[0]) : "transparent" } as CSSProperties}>
            <span className="lamp dim" />
            <span className="nm"><Led tier={2} clip className="fill" text={p.text} /></span>
            {ids.length ? <TaskBadges ids={ids} height={BADGE_H.row} max={ids.length} dim /> : <Led tier={2} fit text={codeSegs(lang, [])} />}
          </div>
        );
      })}
      <div className="pvrow">
        <button type="button" className="key pri" onClick={() => void start()}><Led ui tier={1} fit text={t(lang, isToday ? "pl.startToday" : "pl.start")} /></button>
      </div>
    </div>
  );
}

/** ＋ 临时加一条 (a one-off text item) and 从计划添加 (a plan item, with its tasks — the server copies them). */
function Adds({ date, pick, itemsFailed }: { date: string; pick: PlanItem[] | null; itemsFailed: boolean }) {
  const { lang } = useV2();
  // one queue for both controls (review B): an add while another is in flight (its refetch included) waits its
  // turn instead of being dropped; the same text / the same plan item twice in a row is sent once
  const queue = usePlanQueue();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addBtn = useRef<HTMLButtonElement>(null), composing = useRef(false);
  const close = () => { setAdding(false); setDraft(""); requestAnimationFrame(() => addBtn.current?.focus()); };
  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    // cleared at once (the old page's way): the next one can be typed meanwhile, and the same text entered twice is two
    // items (final review). A failure puts the text back if the box is still empty.
    setDraft("");
    if ((await queue(() => api.addDayPlanItem(date, { text }))) === undefined) setDraft((d) => d || text);
  };
  return (
    <div className="adds">
      {adding
        ? <input autoFocus className="pl-in" aria-label={t(lang, "pl.addLabel")} placeholder={t(lang, "pl.addLabel")} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(e) => {
              // an Esc / Enter that cancels or confirms an IME composition is not "close" / "add" (preflight R3)
              if (isComposingEvent(e, composing.current)) return;
              if (e.key === "Escape") { e.preventDefault(); close(); return; }
              if (e.key !== "Enter") return;
              e.preventDefault();
              void submit();
            }}
            onBlur={() => { if (!draft.trim()) setAdding(false); }} />
        : <button ref={addBtn} type="button" className="key" onClick={() => setAdding(true)}><Led ui tier={1} fit text={t(lang, "pl.add")} /></button>}
      <select className="pl-pick" aria-label={t(lang, "pl.pick")} title={t(lang, "pl.hint")} value="" disabled={!pick?.length}
        onChange={(e) => { const id = e.target.value; if (id) void queue(() => api.addDayPlanItem(date, { plan_item_id: id }), { key: `pick:${id}` }); }}>
        <option value="">{t(lang, !pick ? (itemsFailed ? "pl.itemsFailed" : "pl.itemsLoading") : pick.length ? "pl.pick" : "pl.pickNone")}</option>
        {(pick ?? []).map((p) => <option key={p.id} value={p.id}>{`${t(lang, `pl.h.${p.horizon}` as StrKey)} · ${p.text}`}</option>)}
      </select>
      <span className="grow" />
    </div>
  );
}
