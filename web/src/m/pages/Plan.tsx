// web/src/m/pages/Plan.tsx
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useDayPlan } from "../../api/queries";
import { isComposingEvent } from "../../lib/ime";
import { todayJst } from "../../lib/jst";
import { t } from "../../i18n/t";
import { addDays, mdOf } from "../../predict/time";
import { replaceHash } from "../../route";
import { useV2 } from "../../ui/context";
import { relWord, stepDay } from "../format";
import { mHref, type MRoute } from "../route";
import { DotBar } from "../ui/dots";
import { DayNav } from "../ui/DayNav";
import { Empty, ErrorState, Loading } from "../ui/State";
import { useSwipe } from "../ui/swipe";
import { usePlanActions } from "./planActions";
import { PlanRow } from "./PlanRow";
import { PlanSheet } from "./PlanSheet";

/** 计划 (spec §5, M4): one day's plan, editable; back without limit, forward up to today + 7. */
export function Plan({ route }: { route: MRoute }) {
  const { lang } = useV2();
  const today = todayJst(), max = addDays(today, 7);
  const date = route.param && route.param <= max ? route.param : today;
  const q = useDayPlan(date);
  const act = usePlanActions(date);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false), adding = useRef(false);
  const go = (d: 1 | -1) => { const n = stepDay(date, d, undefined, max); if (!n) return; setEditing(null); replaceHash(mHref("plan", n === today ? null : n)); };
  const swipe = useSwipe(go);
  const items = useMemo(() => [...(q.data?.items ?? [])].sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1)), [q.data]);
  const done = items.filter((i) => i.final_status === "done").length;
  const editItem = items.find((i) => i.id === editing) ?? null;
  const dayWord = relWord(date, today, lang) || mdOf(date);

  const toggle = (id: string) => { navigator.vibrate?.(10); void act.toggle(id); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (!v || adding.current) return;   // a second Enter / tap while the first POST is in flight would add the row twice
    adding.current = true;
    try {
      const r = await act.add(v);
      if (r) setDraft("");
    } finally { adding.current = false; }
    input.current?.focus();
  };
  // Enter that confirms an IME candidate (Safari: keyCode 229) must not submit the form.
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && isComposingEvent(e, composing.current)) e.preventDefault(); };

  let body: ReactNode;
  if (q.error && q.data === undefined) body = <ErrorState onRetry={() => void q.refetch()} />;
  else if (q.data === undefined) body = <Loading rows={4} />;
  else if (q.data === null) body = (
    <section className="m-grp"><Empty>
      <span>{t(lang, "m.plan.notStarted", { d: dayWord })}</span>
      <button type="button" className="m-btn" onClick={() => void act.start()}>{`[${t(lang, "m.plan.start", { d: dayWord })}]`}</button>
    </Empty></section>
  );
  else body = (
    <>
      <section key={date} className="m-grp">
        {items.length === 0 ? <p className="m-note">{t(lang, "m.plan.empty")}</p>
          : items.map((it) => <PlanRow key={it.id} item={it} onToggle={() => toggle(it.id)} onOpen={() => setEditing(it.id)} />)}
      </section>
      {items.length > 0 && <div className="m-spark"><DotBar value={done} max={items.length} n={20} cell={9} /><span className="m-sn">{Math.round((done / items.length) * 100)}%</span></div>}
      <form className="m-add" onSubmit={(e) => void submit(e)}>
        <input ref={input} className="m-input" value={draft} maxLength={200} enterKeyHint="done" placeholder={t(lang, "m.plan.add")} aria-label={t(lang, "m.plan.add")}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={keyDown}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
        <button type="submit" className="m-btn" disabled={!draft.trim()}>[{t(lang, "m.plan.addBtn")}]</button>
      </form>
      <p className="m-note">{t(lang, "m.plan.hint")}</p>
    </>
  );

  const sub = q.data ? t(lang, "m.now.planDone", { d: done, n: items.length }) : "";
  return (
    <div className="m-stack" {...swipe}>
      <DayNav date={date} today={today} max={max} onGo={go} sub={sub} />
      {body}
      {editItem && <PlanSheet key={editItem.id} item={editItem} act={act} onClose={() => setEditing(null)} />}
    </div>
  );
}
