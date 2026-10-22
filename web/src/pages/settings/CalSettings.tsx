import { useEffect, useState } from "react";
import { isComposingEvent } from "../../lib/ime";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { DEFAULT_PREFS } from "../../prefs/defaults";
import { MMDD_RE, type Break, type CalCfg } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { Item } from "./parts";

const MAX_BREAKS = 20;
const EMPTY: Break = { name: "", from: "", to: "" };
/** The trimmed break if name, from and to are all valid, else null (the server would reject the whole PUT). */
function valid(b: Break): Break | null {
  const name = b.name.trim();
  return name.length >= 1 && name.length <= 40 && MMDD_RE.test(b.from) && MMDD_RE.test(b.to) ? { name, from: b.from, to: b.to } : null;
}

/** 日历: 給料日 and the company breaks the 此刻 page counts business days with. */
export function CalSettings() {
  const { prefs, setPrefs, lang } = useV2();
  const L = (k: StrKey) => t(lang, k);
  const cal = prefs.cal;
  const [adding, setAdding] = useState(false);
  const put = (f: (c: CalCfg) => CalCfg) => setPrefs((p) => ({ ...p, cal: f(p.cal) }));
  return (
    <>
      <h2 className="grp-h">{L("settings.group.cal")}</h2>
      <Item name={L("settings.cal.payday.name")} desc={L("settings.cal.payday.desc")}>
        <Payday label={L("settings.cal.payday.label")} value={cal.payday} onCommit={(payday) => put((c) => ({ ...c, payday }))} />
      </Item>
      <Item wide name={L("settings.cal.breaks.name")} desc={L("settings.cal.breaks.desc")}>
        <div className="calbreaks">
          {cal.breaks.map((b, i) => (
            <BreakRow key={i} value={b}
              onSave={(nb) => put((c) => ({ ...c, breaks: c.breaks.map((x, j) => (j === i ? nb : x)) }))}
              onRemove={() => put((c) => ({ ...c, breaks: c.breaks.filter((_, j) => j !== i) }))} />
          ))}
          {adding && (
            <BreakRow key="new" value={EMPTY}
              onSave={(nb) => { put((c) => ({ ...c, breaks: [...c.breaks, nb] })); setAdding(false); }}
              onRemove={() => setAdding(false)} />
          )}
          <div className="calact">
            <button type="button" className="opt" disabled={adding || cal.breaks.length >= MAX_BREAKS} onClick={() => setAdding(true)}>{L("settings.cal.add")}</button>
            <button type="button" className="opt" onClick={() => { setAdding(false); put(() => { const D = DEFAULT_PREFS.cal; return { ...D, breaks: D.breaks.map((b) => ({ ...b })) }; }); }}>{L("settings.cal.reset")}</button>
          </div>
        </div>
      </Item>
    </>
  );
}

/** Draft; commits on blur / Enter (never one PUT per keystroke); an out-of-range value rolls back. */
function Payday({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 31) { if (n !== value) onCommit(n); } else setDraft(String(value));
  };
  return (
    <input type="number" className="opt calnum" aria-label={label} min={1} max={31} step={1} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter" && !isComposingEvent(e, false)) commit(); }} />
  );
}

/** One break row. Saves only when name, from and to are all valid; otherwise a saved row snaps back on blur,
 *  and a new (empty) row keeps what was typed until it is complete. Keyed by position, so tabbing on keeps focus; it re-syncs when the saved value changes. */
function BreakRow({ value, onSave, onRemove }: { value: Break; onSave: (b: Break) => void; onRemove: () => void }) {
  const { lang } = useV2();
  const L = (k: StrKey) => t(lang, k);
  const isNew = value.name === "";
  const [d, setD] = useState(value);
  useEffect(() => { setD(value); }, [value.name, value.from, value.to]);
  const commit = () => {
    const ok = valid(d);
    if (ok) { if (ok.name !== value.name || ok.from !== value.from || ok.to !== value.to) onSave(ok); else setD(ok); }
    else if (!isNew) setD(value);
  };
  const field = (k: keyof Break, label: StrKey, cls: string, ph?: string) => (
    <input type="text" className={`opt ${cls}`} aria-label={L(label)} placeholder={ph} maxLength={k === "name" ? 40 : 5} value={d[k]}
      onChange={(e) => setD({ ...d, [k]: e.target.value })} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter" && !isComposingEvent(e, false)) e.currentTarget.blur(); }} />
  );
  return (
    <div className="calrow">
      {field("name", "settings.cal.break.name", "calname")}
      {field("from", "settings.cal.break.from", "caldate", "MM-DD")}
      <span aria-hidden="true">–</span>
      {field("to", "settings.cal.break.to", "caldate", "MM-DD")}
      <button type="button" className="opt calx" aria-label={L("settings.cal.break.remove")} onClick={onRemove}>×</button>
    </div>
  );
}
