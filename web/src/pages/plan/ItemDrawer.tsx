import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { Horizon, PlanItem, PlanItemPatch } from "../../api/types";
import { InlineEdit } from "../../components/InlineEdit";
import { toast } from "../../components/Toast";
import { currentWeek } from "../../lib/jst";
import { TaskForm } from "../../components/TaskForm";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { jstDate, mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { PolishMark } from "../../ui/PolishMark";
import { lineColor } from "../../ui/palette";
import type { Band } from "../timeline/week";
import { applyDelta, Chips } from "./Chips";
import { dowShort } from "./codes";
import { closedRows, HORIZONS, isIdle, ttGroups, type TtRow } from "./layout";
import { useChosen, useFresh, usePlanQueue, type QueueOpts } from "./write";

/** One plan item in the glass drawer (prototype page-plan.html renderPlan, plus every action of the old PlanRow):
 *  上周遗留, its text, 档位, 案件, 截止日, order, this week's run, and 完成 / 放弃 / 转成案件 — or 恢复 once closed. */
export function ItemDrawer({ id, stripDays, stripBands, onClose }: {
  id: string; stripDays: string[]; stripBands: (Band | null)[]; onClose: () => void;
}) {
  const { lang } = useV2();
  // the page's own cache keys (the timetable reads both): no extra request
  const active = useQuery({ queryKey: keys.planItems(false), queryFn: () => api.planItems(false) });
  const closed = useQuery({ queryKey: keys.planItems(true), queryFn: () => api.planItems(true) });
  const a = Array.isArray(active.data) ? active.data : null, c = Array.isArray(closed.data) ? closed.data : null;
  const item = a?.find((p) => p.id === id) ?? c?.find((p) => p.id === id);
  const row = item ? (item.status === "active" ? ttGroups([item], stripBands).flatMap((g) => g.rows)[0] : closedRows([item], stripBands)[0]) : undefined;
  return (
    <div className="dw pl-dw" style={{ "--lc": item?.tasks[0] ? lineColor(item.tasks[0].id) : "#ffad3a" } as CSSProperties}>
      <div className="dw-h">
        <span className="kind">{t(lang, "pl.d.itemKind", { h: item ? t(lang, `pl.h.${item.horizon}` as StrKey) : "" })}</span>
        <span className="grow" />
        <button type="button" className="ib lg2-fill" aria-label={t(lang, "common.close")} onClick={onClose}>×</button>
      </div>
      <div className="dw-b">
        {item && row
          ? <Body item={item} row={row} siblings={(a ?? []).filter((p) => p.horizon === item.horizon && p.status === "active")} stripDays={stripDays} onClose={onClose} />
          : a && c
          ? <p className="mute" role="status">{t(lang, "pl.d.notFound")}</p>
          : active.isError || closed.isError
          ? <p className="mute" role="alert">{t(lang, "pl.d.loadFailed")} <button type="button" className="fb lg2-fill" onClick={() => { void active.refetch(); void closed.refetch(); }}>{t(lang, "tl.retry")}</button></p>
          : <p className="mute" role="status">{t(lang, "pl.d.loading")}</p>}
      </div>
    </div>
  );
}

function Body({ item, row, siblings, stripDays, onClose }: { item: PlanItem; row: TtRow; siblings: PlanItem[]; stripDays: string[]; onClose: () => void }) {
  const { lang } = useV2();
  const queue = usePlanQueue(), fresh = useFresh();
  // writes queue up (preflight R1); each carries the item's updated_at as of its turn
  const save = (p: PlanItemPatch, o: QueueOpts = {}) =>
    queue(() => api.patchPlanItem(item.id, (fresh.item(item.id) ?? item).updated_at, p), { key: JSON.stringify(p), ...o });
  const idx = siblings.findIndex((p) => p.id === item.id), open = item.status === "active";
  // New items all start at sort 0, so a move renumbers the whole horizon to its displayed order (the old page's move) —
  // the order as it is when the move's turn comes (review A).
  const move = (dir: -1 | 1) => queue(async () => {
    const all = fresh.items(), h = (fresh.item(item.id) ?? item).horizon;
    const order = all ? all.filter((p) => p.horizon === h && p.status === "active") : [...siblings];
    const i = order.findIndex((p) => p.id === item.id), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return null;
    [order[i], order[j]] = [order[j], order[i]];
    let last: PlanItem | null = null;
    for (const [i, x] of order.entries()) {
      if (x.sort === i) continue;
      last = await api.patchPlanItem(x.id, (fresh.item(x.id) ?? x).updated_at, { sort: i });
    }
    return last;
  });
  const [converting, setConverting] = useState(false);
  const [, chooseHorizon] = useChosen<Horizon>(item.horizon);
  return (
    <>
      {item.stale && open && (
        <div className="stale" role="status">
          <span className="lamp red" />
          <span>{t(lang, "pl.d.stale", { w: item.week ?? "" })}</span>
          <span className="grow" />
          <button type="button" className="fb lg2-fill pri" onClick={() => void save({ week: currentWeek() })}>{t(lang, "pl.d.keep")}</button>
          <button type="button" className="fb lg2-fill" onClick={() => void save({ horizon: "near" })}>{t(lang, "pl.d.demote")}</button>
        </div>
      )}
      {!open && <p className="mute closedNote">{t(lang, item.status === "done" ? "pl.d.closedDone" : "pl.d.closedDropped", { d: item.done_at ? mdOf(jstDate(Date.parse(item.done_at))) : "--" })}</p>}
      <InlineEdit ariaLabel={t(lang, "pl.d.title")} className="dw-title" value={item.text}
        onSave={async (v) => {
          if (v.trim() === "") { toast.info(t(lang, "pl.d.titleEmpty")); return; }
          // a failure stays in the field with the draft (InlineEdit says why), not lost behind a toast (preflight R4)
          if (v.trim() !== item.text) await save({ text: v.trim() }, { rethrow: true });
        }}
        display={<span>{item.text}</span>} />
      <PolishMark meta={item._polish?.text} entity="plan_item" entityId={item.id} field="text" />
      <div className="fields">
        <span className="k">{t(lang, "pl.d.horizon")}</span>
        <span className="segf" role="radiogroup" aria-label={t(lang, "pl.d.horizon")}>
          {HORIZONS.map((h: Horizon) => (
            <button key={h} type="button" role="radio" aria-checked={item.horizon === h} className={`fb${item.horizon === h ? " on" : ""}`}
              onClick={() => chooseHorizon(h, () => save({ horizon: h }))}>{t(lang, `pl.h.${h}` as StrKey)}</button>
          ))}
        </span>
        <span className="k">{t(lang, "pl.d.tasks")}</span>
        <Chips tasks={item.tasks} onEscape={onClose} onChange={(d) => queue(() => {
          const cur = fresh.item(item.id) ?? item;
          return api.patchPlanItem(item.id, cur.updated_at, { task_ids: applyDelta(cur.tasks.map((x) => x.id), d) });
        }, { key: JSON.stringify(d) })} />
        {item.horizon === "daily" && <>
          <span className="k">{t(lang, "pl.d.until")}</span>
          <Until item={item} save={save} />
        </>}
        {open && <>
          <span className="k">{t(lang, "pl.d.order")}</span>
          <span className="opts">
            <button type="button" className="fb lg2-fill" disabled={idx <= 0} onClick={() => void move(-1)}>{t(lang, "pl.d.up")}</button>
            <button type="button" className="fb lg2-fill" disabled={idx < 0 || idx >= siblings.length - 1} onClick={() => void move(1)}>{t(lang, "pl.d.down")}</button>
          </span>
        </>}
      </div>
      <h3>{t(lang, "pl.d.week")}<span className="grow" /></h3>
      <div className="wkline">
        {stripDays.map((d, i) => (
          <span key={d} className={row.perDay[i] > 0 ? "on" : undefined}>
            <b>{row.perDay[i] > 0 ? (row.perDay[i] / 60).toFixed(1) : "–"}</b>{dowShort(lang, d)}
          </span>
        ))}
      </div>
      <div className="acts">
        {open
          ? <>
              <button type="button" className="fb lg2-fill pri" onClick={() => void save({ status: "done" })}>{t(lang, "pl.d.done")}</button>
              <button type="button" className="fb lg2-fill" onClick={() => void save({ status: "dropped" })}>{t(lang, "pl.d.drop")}</button>
              {item.horizon === "far" && <button type="button" className="fb lg2-fill" onClick={() => setConverting(true)}>{t(lang, "pl.d.convert")}</button>}
            </>
          : <button type="button" className="fb lg2-fill pri" onClick={() => void save({ status: "active" })}>{t(lang, "pl.d.restore")}</button>}
      </div>
      {converting && (
        <TaskForm defaultTitle={item.text} onCancel={() => setConverting(false)}
          onCreated={(task) => {
            setConverting(false);
            // the old page's 转成案件: link the new task and close the far item in one write
            void queue(() => {
              const cur = fresh.item(item.id) ?? item;
              return api.patchPlanItem(item.id, cur.updated_at, { task_ids: applyDelta(cur.tasks.map((x) => x.id), { add: task.id }), status: "done" });
            });
          }} />
      )}
    </>
  );
}

/** 截止日 (daily only): a native date field fires per segment, so it keeps a draft and saves once, on blur; empty
 *  clears it. Past it (or with every task done) the item is 不在期 and no longer comes into a day. */
function Until({ item, save }: { item: PlanItem; save: (p: PlanItemPatch) => Promise<unknown> }) {
  const { lang } = useV2();
  const [v, setV] = useState(item.until_date ?? "");
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(item.until_date ?? ""); }, [item.until_date]);
  // Esc or a hash change unmounts without a blur: save a changed date then too (preflight R2)
  const last = useRef({ v, item, save });
  last.current = { v, item, save };
  useEffect(() => () => {
    const { v: d, item: it, save: sv } = last.current;
    if (focused.current && (d || null) !== it.until_date) void sv({ until_date: d || null });
  }, []);
  return (
    <span className="opts">
      <input type="date" className="inp" aria-label={t(lang, "pl.d.until")} value={v}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          focused.current = false;
          const next = v || null;
          if (next === item.until_date) return;
          void save({ until_date: next });
        }} />
      {isIdle(item) && <span className="badge idle">{t(lang, "pl.tag.idle")}</span>}
    </span>
  );
}
