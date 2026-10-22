import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import type { DayPlan, DayPlanItem, DayPlanItemPatch, DayStatus } from "../../api/types";
import { InlineEdit } from "../../components/InlineEdit";
import { toast } from "../../components/Toast";
import { jstDateOf, weekOfDate } from "../../lib/jst";
import type { StrKey } from "../../i18n/strings";
import { t, tn } from "../../i18n/t";
import { hmOf, mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { PolishMark } from "../../ui/PolishMark";
import { lineColor } from "../../ui/palette";
import { applyDelta, Chips } from "./Chips";
import type { DayRow } from "./layout";
import type { PlOpen } from "./state";
import { useChosen, useFresh, usePlanQueue, type QueueOpts } from "./write";

const STATUSES: DayStatus[] = ["done", "partial", "none"];

/** One 今日安排 item in the glass drawer (prototype page-plan.html renderDay, plus the old DayItem's actions): its
 *  text, 判定 (automatic or yours), 案件, 具体要求, order, the AI's verdict with the sessions it cites, and 删除. */
export function DayDrawer({ plan, row, failed, retry, onClose, setOpen }: {
  /** undefined while the day loads (or when it failed: `failed`). */
  plan: DayPlan | null | undefined; row: DayRow | undefined; failed: boolean; retry: () => void; onClose: () => void; setOpen: (o: PlOpen) => void;
}) {
  const { lang } = useV2();
  const it = row?.item;
  return (
    <div className="dw pl-dw" style={{ "--lc": it?.tasks[0] ? lineColor(it.tasks[0].id) : "#ffad3a" } as CSSProperties}>
      <div className="dw-h">
        <span className="kind">{t(lang, "pl.d.dayKind", { d: plan ? mdOf(plan.date) : "" })}</span>
        <span className="grow" />
        <button type="button" className="ib lg2-fill" aria-label={t(lang, "common.close")} onClick={onClose}>×</button>
      </div>
      <div className="dw-b">
        {it && plan && row
          ? <Body plan={plan} row={row} onClose={onClose} setOpen={setOpen} />
          : plan === undefined && failed
          ? <p className="mute" role="alert">{t(lang, "pl.d.loadFailed")} <button type="button" className="fb lg2-fill" onClick={retry}>{t(lang, "tl.retry")}</button></p>
          : <p className="mute" role="status">{t(lang, plan === undefined ? "pl.d.loading" : "pl.d.notFound")}</p>}
      </div>
    </div>
  );
}

function Body({ plan, row, onClose, setOpen }: { plan: DayPlan; row: DayRow; onClose: () => void; setOpen: (o: PlOpen) => void }) {
  const { lang } = useV2();
  const queue = usePlanQueue(), fresh = useFresh();
  const it = row.item;
  // writes queue up (preflight R1); each carries the row's updated_at as of its turn (the cache), not of this render
  const save = (p: DayPlanItemPatch, o: QueueOpts = {}) => queue(() => {
    const cur = fresh.day(plan.date, it.id) ?? it;
    return api.patchDayPlanItem(it.id, cur.updated_at, p);
  }, { key: JSON.stringify(p), ...o });
  const idx = plan.items.findIndex((x) => x.id === it.id);
  // New items all start one past the last sort, so a move renumbers the whole day to its displayed order — the order
  // as it is when the move's turn comes (review A), so two quick ↓ move two places.
  const move = (dir: -1 | 1) => queue(async () => {
    const order = [...(fresh.dayItems(plan.date) ?? plan.items)];
    const i = order.findIndex((x) => x.id === it.id), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return null;
    [order[i], order[j]] = [order[j], order[i]];
    let last: DayPlanItem | null = null;
    for (const [i, x] of order.entries()) {
      if (x.sort === i) continue;
      const cur = fresh.day(plan.date, x.id) ?? x;
      last = await api.patchDayPlanItem(x.id, cur.updated_at, { sort: i });
    }
    return last;
  });
  return (
    <>
      <InlineEdit ariaLabel={t(lang, "pl.d.title")} className="dw-title" value={it.text}
        onSave={async (v) => {
          if (v.trim() === "") { toast.info(t(lang, "pl.d.titleEmpty")); return; }
          // a failure stays in the field with the draft (InlineEdit says why), not lost behind a toast (preflight R4)
          if (v.trim() !== it.text) await save({ text: v.trim() }, { rethrow: true });
        }}
        display={<span>{it.text}</span>} />
      <PolishMark meta={it._polish?.text} entity="day_plan_item" entityId={it.id} field="text" />
      {it.plan_item_id && (
        <button type="button" className="fb lg2-fill from" onClick={() => setOpen({ kind: "item", id: it.plan_item_id! })}>{t(lang, "pl.d.fromPlan")}</button>
      )}
      <div className="fields">
        <span className="k">{t(lang, "pl.d.status")}</span>
        <Verdict it={it} save={save} />
        <span className="k">{t(lang, "pl.d.tasks")}</span>
        <Chips tasks={it.tasks} onEscape={onClose} onChange={(d) => queue(() => {
          const cur = fresh.day(plan.date, it.id) ?? it;
          return api.patchDayPlanItem(it.id, cur.updated_at, { task_ids: applyDelta(cur.tasks.map((x) => x.id), d) });
        }, { key: JSON.stringify(d) })} />
        <span className="k">{t(lang, "pl.d.detail")}</span>
        <Detail it={it} save={save} />
        <span className="k">{t(lang, "pl.d.order")}</span>
        <span className="opts">
          <button type="button" className="fb lg2-fill" disabled={idx <= 0} onClick={() => void move(-1)}>{t(lang, "pl.d.up")}</button>
          <button type="button" className="fb lg2-fill" disabled={idx < 0 || idx >= plan.items.length - 1} onClick={() => void move(1)}>{t(lang, "pl.d.down")}</button>
        </span>
      </div>
      <Evidence row={row} />
      <Delete it={it} date={plan.date} queue={queue} onClose={onClose} />
    </>
  );
}

/** 判定: [自动 · the AI's verdict] [完成] [部分] [未做] — the old 改判 select as one segmented control. */
function Verdict({ it, save }: { it: DayPlanItem; save: (p: DayPlanItemPatch) => Promise<unknown> }) {
  const { lang } = useV2();
  const [, choose] = useChosen<DayStatus | "auto">(it.manual_status ?? "auto");
  const on = it.manual_status ?? "auto";
  const auto = it.ai_status ? t(lang, "pl.d.auto", { s: t(lang, `pl.s.${it.ai_status}` as StrKey) }) : t(lang, "pl.d.autoNone");
  const opts: [DayStatus | "auto", string][] = [["auto", auto], ...STATUSES.map((s): [DayStatus, string] => [s, t(lang, `pl.s.${s}` as StrKey)])];
  return (
    <span className="segf" role="radiogroup" aria-label={t(lang, "pl.d.status")}>
      {opts.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={on === v} className={`fb${on === v ? " on" : ""}`}
          onClick={() => choose(v, () => save({ manual_status: v === "auto" ? null : v }))}>{label}</button>
      ))}
    </span>
  );
}

/** 具体要求: saved on blur when it changed since the focus (the old page's rule): a judgement or another machine's
 *  edit arriving while you type does not overwrite the box, and an untouched focus never overwrites theirs. */
function Detail({ it, save }: { it: DayPlanItem; save: (p: DayPlanItemPatch) => Promise<unknown> }) {
  const { lang } = useV2();
  const [v, setV] = useState(it.detail);
  const focused = useRef(false), atFocus = useRef(it.detail);
  useEffect(() => { if (!focused.current) setV(it.detail); }, [it.detail]);
  // Esc or a hash change unmounts the drawer without a blur (React calls no onBlur on unmount): save what is typed
  // then too (preflight R2). The latest draft and save are read from a ref at that moment.
  const last = useRef({ v, save });
  last.current = { v, save };
  useEffect(() => () => {
    if (focused.current && last.current.v !== atFocus.current) void last.current.save({ detail: last.current.v });
  }, []);
  return (
    <div className="pm-w">
    <textarea className="inp" rows={3} aria-label={t(lang, "pl.d.detail")} placeholder={t(lang, "pl.d.detailPh")} value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={() => { focused.current = true; atFocus.current = it.detail; }}
      onBlur={() => { focused.current = false; if (v !== atFocus.current) void save({ detail: v }); }} />
    <PolishMark meta={it._polish?.detail} entity="day_plan_item" entityId={it.id} field="detail" />
    </div>
  );
}

/** The AI's verdict: what it read that day (the timeline's split of the item's tasks), its progress and note, and
 *  the sessions it cites — each opens on the timeline. */
function Evidence({ row }: { row: DayRow }) {
  const { lang } = useV2();
  const it = row.item, ev = it.ai_evidence_sessions ?? [];
  const h = (row.minutes / 60).toFixed(1), n = tn(lang, "tk.u.sess", row.sessions.length);
  return (
    <>
      <h3>{t(lang, "pl.d.judge")} <span className="n">{t(lang, "pl.d.ev", { n: tn(lang, "tk.u.sess", ev.length) })}</span><span className="grow" /></h3>
      <div className="judge">
        {it.ai_status
          ? <span>{t(lang, "pl.d.judgeNote", { h, n, s: t(lang, `pl.s.${it.ai_status}` as StrKey) })}</span>
          : <span className="mute">{t(lang, it.tasks.length ? "pl.d.judgeNone" : "pl.d.judgeNoTask", { h, n })}</span>}
        {it.ai_progress && <span className="prog">{it.ai_progress}</span>}
        {it.ai_note && <span className="mute">{it.ai_note}</span>}
      </div>
      {ev.map((s) => {
        const day = jstDateOf(s.started_at);
        return (
          <div key={s.id} className="ev">
            <a className="tm" href={`#/v2/timeline/${weekOfDate(day)}?day=${day}&s=${encodeURIComponent(s.id)}`}
              aria-label={t(lang, "pl.d.evInTl", { t: `${mdOf(day)} ${hmOf(Date.parse(s.started_at))}` })}>{hmOf(Date.parse(s.started_at))}</a>
            <span className="sm">{s.summary || "--"}</span>
          </div>
        );
      })}
    </>
  );
}

/** 删除这条: one confirm step in place (the 案件 drawer's pattern); Esc backs out of it. */
function Delete({ it, date, queue, onClose }: {
  it: DayPlanItem; date: string;
  /** The drawer's own queue: a delete waits for a save still in flight and then carries its fresh updated_at. */
  queue: ReturnType<typeof usePlanQueue>; onClose: () => void;
}) {
  const { lang } = useV2();
  const fresh = useFresh();
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const cancel = useRef<HTMLButtonElement>(null), trigger = useRef<HTMLButtonElement>(null), prev = useRef(step);
  useEffect(() => {
    if (step === "confirm") cancel.current?.focus();
    else if (step === "idle" && prev.current !== "idle") trigger.current?.focus();
    prev.current = step;
  }, [step]);
  const go = async () => {
    setStep("busy");
    const ok = await queue(async () => { await api.deleteDayPlanItem(it.id, (fresh.day(date, it.id) ?? it).updated_at); return true; });
    if (ok) { toast.info(t(lang, "pl.d.deleted")); onClose(); } else setStep("idle");
  };
  return (
    <div className="danger">
      {step === "idle"
        ? <button ref={trigger} type="button" className="fb lg2-fill warn" onClick={() => setStep("confirm")}>{t(lang, "pl.d.delete")}</button>
        : <span className="opts" role="alertdialog" aria-label={t(lang, "pl.d.delConfirm")}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (step === "confirm") setStep("idle"); } }}>
            <span className="mute">{t(lang, "pl.d.delConfirm")}</span>
            <button type="button" className="fb lg2-fill pri warn" disabled={step === "busy"} onClick={() => void go()}>{t(lang, "pl.d.delDo")}</button>
            <button ref={cancel} type="button" className="fb lg2-fill" disabled={step === "busy"} onClick={() => setStep("idle")}>{t(lang, "pl.d.delCancel")}</button>
          </span>}
    </div>
  );
}
