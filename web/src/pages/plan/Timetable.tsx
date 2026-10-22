import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { api } from "../../api/client";
import { keys } from "../../api/queries";
import type { Horizon, PlanItem } from "../../api/types";
import { isComposingEvent } from "../../lib/ime";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C, lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadges } from "../../ui/TaskBadge";
import { useWorld } from "../../world/store";
import { codeSegs, dowShort } from "./codes";
import { DayStrip } from "../tasks/DayStrip";
import type { Band } from "../timeline/week";
import { closedRows, HORIZONS, ttGroups, type TtRow } from "./layout";
import type { PlOpen } from "./state";
import { usePlanRun } from "./write";

/** The week strip: one 10-dot slot per weekday, lit when its tasks had a session that day (prototype drawWeek). */
export const WK = { colW: 10, gap: 1, rows: 4 } as const;
const HZ_LAMP: Record<Horizon, string> = { daily: "live", week: "amber", near: "dim", far: "dim" };

/** 计划 · 时刻表 (prototype page-plan.html:424-466): the standing plan items by horizon, each a row with its
 *  tasks, this week's strip, its 截止日 and its order; done / dropped behind a toggle; ＋ 新增条目. */
export function Timetable({ items, error, retry, stripDays, stripBands, open, setOpen }: {
  items: PlanItem[] | null; error: unknown; retry: () => void;
  stripDays: string[]; stripBands: (Band | null)[]; open: PlOpen; setOpen: (o: PlOpen) => void;
}) {
  const { lang } = useV2();
  const [showClosed, setShowClosed] = useState(false);
  const closed = useQuery({ queryKey: keys.planItems(true), queryFn: () => api.planItems(true) });
  const closedList = Array.isArray(closed.data) ? closed.data : null;
  const [adding, setAdding] = useState(false);
  const newBtn = useRef<HTMLButtonElement>(null);
  const sel = open?.kind === "item" ? open.id : null;
  const groups = items ? ttGroups(items, stripBands) : [];
  return (
    <section className="pl-tt" aria-label={t(lang, "pl.tt.title")}>
      <div className="sec">
        <Led ui size={12} tier={2} fit text={t(lang, "pl.tt.title")} />
        <span className="nm"><Led ui tier={2} clip className="fill" text={t(lang, "pl.tt.sub")} /></span>
        {!adding && <button ref={newBtn} type="button" className="key" onClick={() => setAdding(true)}><Led ui tier={1} fit text={t(lang, "pl.tt.new")} /></button>}
      </div>
      {adding && <NewItem onDone={(id) => {
        setAdding(false);
        if (id) setOpen({ kind: "item", id });
        else requestAnimationFrame(() => newBtn.current?.focus());     // Esc: back to ＋ 新增条目, not to <body>
      }} />}
      <div className="theads" aria-hidden="true">
        <Led ui tier={3} fit text={t(lang, "pl.th.item")} />
        <Led ui tier={3} fit text={t(lang, "pl.th.tasks")} />
        <span className="wkh">{stripDays.map((d) => <span key={d}><Led ui tier={3} fit text={dowShort(lang, d)} /></span>)}</span>
        <Led ui tier={3} fit text={t(lang, "pl.th.until")} />
        <span className="r"><Led ui tier={3} fit text={t(lang, "pl.th.ord")} /></span>
      </div>
      {!items
        ? <div className="pl-wait">
            <Led ui tier={2} fit text={t(lang, error ? "now.error" : "now.loading")} />
            {error !== null && <button type="button" className="key dim" onClick={retry}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>}
          </div>
        : groups.map((g) => (
            <div key={g.horizon} role="group" aria-label={t(lang, `pl.h.${g.horizon}` as StrKey)}>
              <div className="ghead">
                <span className={`lamp ${HZ_LAMP[g.horizon]}`} />
                <Led ui tier={g.horizon === "far" ? 2 : 1} fit text={`${t(lang, `pl.h.${g.horizon}` as StrKey)} ${g.rows.length}`} />
                <Led ui tier={2} fit text={t(lang, `pl.hzs.${g.horizon}` as StrKey)} />
                <span className="grow" />
              </div>
              <div role="list">{g.rows.map((r) => <TtRowView key={r.item.id} r={r} sel={sel === r.item.id} onOpen={() => setOpen({ kind: "item", id: r.item.id })} />)}</div>
            </div>
          ))}
      <div className="ghead">
        <button type="button" className="key dim" aria-expanded={showClosed} onClick={() => setShowClosed(!showClosed)}>
          <Led ui tier={1} fit text={showClosed ? t(lang, "pl.closed.hide") : closedList ? t(lang, "pl.closed.show", { n: closedList.length }) : t(lang, "pl.closed.showN")} />
        </button>
        <span className="grow" />
      </div>
      {showClosed && !closedList && (
        <div className="pl-wait">
          <Led ui tier={2} fit text={t(lang, closed.error ? "now.error" : "now.loading")} />
          {closed.error !== null && <button type="button" className="key dim" onClick={() => void closed.refetch()}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>}
        </div>
      )}
      {showClosed && closedList && (
        <div role="list" className="closed" aria-label={t(lang, "pl.closed.label")}>
          {closedList.length === 0
            ? <div role="listitem" className="ttrow empty"><Led ui tier={3} fit text={t(lang, "pl.closed.none")} /></div>
            : closedRows(closedList, stripBands).map((r) => <TtRowView key={r.item.id} r={r} sel={sel === r.item.id} onOpen={() => setOpen({ kind: "item", id: r.item.id })} />)}
        </div>
      )}
    </section>
  );
}

function TtRowView({ r, sel, onOpen }: { r: TtRow; sel: boolean; onOpen: () => void }) {
  const { lang } = useV2(), world = useWorld();
  const p = r.item, ids = p.tasks.map((x) => x.id), k = ids[0] ?? null;
  const dim = r.idle || p.status !== "active";
  const col = dim ? (world === "omote" ? "#c4cbd4" : "#6d6150") : k ? lineColor(k) : C.AMBER;
  const key = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } };
  const tag = r.tag ? t(lang, `pl.tag.${r.tag}` as StrKey) : "";
  return (
    <div role="listitem" tabIndex={0} className={`ttrow${dim ? " idle" : ""}${sel ? " sel" : ""}`} data-id={p.id} data-task={k ?? undefined}
      style={{ "--lc": k ? lineColor(k) : "#6f6a60" } as CSSProperties} aria-label={t(lang, "pl.row", { t: p.text })} onClick={onOpen} onKeyDown={key}>
      <span className="nm">
        <Led key={dim ? "d" : "a"} tier={dim ? 2 : 1} clip className="fill" task={k ?? undefined} text={p.text} />
        {tag && <Led key={r.tag!} ui tier={r.tag === "stale" ? 0 : 2} fit color={r.tag === "stale" ? C.RED : undefined} text={tag} />}
      </span>
      <span className="nm">{ids.length ? <TaskBadges ids={ids} height={BADGE_H.row} dim={dim} /> : <Led key="n" tier={2} clip className="fill" text={codeSegs(lang, [])} />}</span>
      <DayStrip vals={r.perDay.map((m) => (m > 0 ? 1 : 0))} max={1} color={col} opt={WK} height={36} />
      <Led key={dim ? "d" : "a"} ui tier={dim ? 2 : 1} fit text={p.horizon === "daily" && p.until_date ? t(lang, "pl.until", { d: mdOf(p.until_date) }) : ""} />
      <span className="r"><Led tier={3} fit text={r.order === null ? "" : String(r.order).padStart(2, "0")} /></span>
    </div>
  );
}

/** ＋ 新增条目: a horizon and the text; Enter creates it and opens its drawer, Esc backs out. */
function NewItem({ onDone }: { onDone: (id: string | null) => void }) {
  const { lang } = useV2();
  const run = usePlanRun();
  const qc = useQueryClient();
  const [horizon, setHorizon] = useState<Horizon>("week");
  const [text, setText] = useState("");
  const box = useRef<HTMLInputElement>(null), composing = useRef(false);
  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    const row = await run(() => api.createPlanItem({ horizon, text: v }));
    if (!row) return;
    // in the list at once, so its drawer opens on the row rather than on "not found" until the refetch lands
    qc.setQueryData<PlanItem[]>(keys.planItems(false), (list) => (list && !list.some((p) => p.id === row.id) ? [...list, row] : list));
    onDone(row.id);
  };
  return (
    <div className="newrow" role="group" aria-label={t(lang, "pl.tt.new")}>
      <span className="keys" role="radiogroup" aria-label={t(lang, "pl.d.horizon")}>
        {HORIZONS.map((h) => (
          <button key={h} type="button" role="radio" aria-checked={horizon === h} className={`key ${horizon === h ? "on" : "off"}`}
            // the box keeps focus: Safari / macOS Firefox do not focus a clicked button, so a blur with no target
            // would back out of an empty box before the click lands (final review)
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setHorizon(h); box.current?.focus(); }}>
            <Led ui tier={1} fit text={t(lang, `pl.h.${h}` as StrKey)} />
          </button>
        ))}
      </span>
      <input ref={box} autoFocus className="pl-in" aria-label={t(lang, "pl.newLabel")} placeholder={t(lang, "pl.newLabel")} value={text}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        // leaving an empty box backs out too, for the mouse (review B); a horizon key keeps it (focus comes back)
        onBlur={(e) => { if (!text.trim() && !e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) onDone(null); }}
        onKeyDown={(e) => {
          // an Esc / Enter that cancels or confirms an IME composition is not "back out" / "create" (preflight R3)
          if (isComposingEvent(e, composing.current)) return;
          if (e.key === "Escape") { e.preventDefault(); onDone(null); return; }
          if (e.key !== "Enter") return;
          e.preventDefault();
          void submit();
        }} />
    </div>
  );
}
