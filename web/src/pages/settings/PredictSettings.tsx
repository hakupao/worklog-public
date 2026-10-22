import { useEffect, useState, type HTMLAttributes } from "react";
import { isComposingEvent } from "../../lib/ime";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { DEFAULT_PREFS } from "../../prefs/defaults";
import {
  HM_RE, MODE_IDS, RULE_IDS, RUNNING_OPTIONS, type ModeCfg, type ModeId, type PredictPrefs, type RuleCfg, type RuleId,
} from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { Item, Opt } from "./parts";

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** The list order: weight high → low; equal weights keep the default order. */
export function rulesByWeight(rules: Record<RuleId, RuleCfg>): RuleId[] {
  return [...RULE_IDS].sort((a, b) => rules[b].weight - rules[a].weight || RULE_IDS.indexOf(a) - RULE_IDS.indexOf(b));
}
/** Assumption 11: after a reorder the weight is the rank — 100 for the first, then 90, 80, … */
export function reweigh(rules: Record<RuleId, RuleCfg>, order: RuleId[]): Record<RuleId, RuleCfg> {
  const out = { ...rules };
  order.forEach((id, i) => { out[id] = { ...rules[id], weight: Math.max(0, 100 - i * 10) }; });
  return out;
}
export function move<T>(xs: T[], from: number, to: number): T[] {
  const a = [...xs];
  const [x] = a.splice(from, 1);
  a.splice(Math.max(0, Math.min(a.length, to)), 0, x);
  return a;
}

/** 预判规则 (spec §7.3): every rule on / off, its mode, its params and (by order) its weight; each mode's
 *  window and weekdays; restore the defaults. */
export function PredictSettings() {
  const { prefs, setPrefs, lang } = useV2();
  const P = prefs.predict, L = (k: StrKey, v?: Record<string, string | number>) => t(lang, k, v);
  const put = (f: (p: PredictPrefs) => PredictPrefs) => setPrefs((x) => ({ ...x, predict: f(x.predict) }));
  const order = rulesByWeight(P.rules);
  const reorder = (from: number, to: number) => put((p) => ({ ...p, rules: reweigh(p.rules, move(rulesByWeight(p.rules), from, to)) }));
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <>
      <h2 className="grp-h">{L("settings.group.predict")}</h2>
      <Item name={L("settings.predict.running.name")} desc={L("settings.predict.running.desc")}>
        {RUNNING_OPTIONS.map((m) => <Opt key={m} on={P.runningMin === m} onClick={() => put((p) => ({ ...p, runningMin: m }))}>{L("settings.predict.min", { n: m })}</Opt>)}
      </Item>
      <Item wide name={L("settings.predict.modes.name")} desc={L("settings.predict.modes.desc")}>
        <div className="pmodes">
          {MODE_IDS.map((id) => <ModeRow key={id} id={id} cfg={P.modes[id]} onChange={(c) => put((p) => ({ ...p, modes: { ...p.modes, [id]: c } }))} />)}
        </div>
      </Item>
      <Item wide name={L("settings.predict.rules.name")} desc={L("settings.predict.rules.desc")}>
        <ol className="prules">
          {order.map((id, i) => (
            <RuleRow key={id} id={id} cfg={P.rules[id]} first={i === 0} last={i === order.length - 1}
              onChange={(c) => put((p) => ({ ...p, rules: { ...p.rules, [id]: c } }))}
              onMove={(d) => reorder(i, i + d)}
              drag={{
                draggable: true,
                onDragStart: (e) => { setDrag(i); e.dataTransfer?.setData("text/plain", id); },
                onDragOver: (e) => e.preventDefault(),
                onDrop: (e) => { e.preventDefault(); if (drag !== null && drag !== i) reorder(drag, i); setDrag(null); },
                onDragEnd: () => setDrag(null),
              }} />
          ))}
        </ol>
      </Item>
      <button type="button" className="opt" onClick={() => put(() => structuredClone(DEFAULT_PREFS.predict))}>{L("settings.predict.reset")}</button>
    </>
  );
}

function ModeRow({ id, cfg, onChange }: { id: ModeId; cfg: ModeCfg; onChange: (c: ModeCfg) => void }) {
  const { lang } = useV2();
  const L = (k: StrKey) => t(lang, k), name = L(`mode.name.${id}` as StrKey);
  const time = (k: "from" | "to") => (
    <input type="time" step={60} value={cfg[k]} aria-label={`${name} ${L(`settings.predict.${k}` as StrKey)}`}
      onChange={(e) => { if (HM_RE.test(e.target.value)) onChange({ ...cfg, [k]: e.target.value }); }} />
  );
  return (
    <div className="pmode" data-mode={id}>
      <b>{name}</b>{time("from")}<span>–</span>{time("to")}
      <span className="days" role="group" aria-label={L("settings.predict.days")}>
        {DAYS.map((d) => (
          <button key={d} type="button" className="opt day" aria-pressed={cfg.days.includes(d)}
            onClick={() => onChange({ ...cfg, days: cfg.days.includes(d) ? cfg.days.filter((x) => x !== d) : [...cfg.days, d].sort((a, b) => a - b) })}>
            {L(`weekday.${d}` as StrKey)}
          </button>
        ))}
      </span>
    </div>
  );
}

function RuleRow({ id, cfg, first, last, onChange, onMove, drag }: {
  id: RuleId; cfg: RuleCfg; first: boolean; last: boolean;
  onChange: (c: RuleCfg) => void; onMove: (d: -1 | 1) => void; drag: HTMLAttributes<HTMLLIElement> & { draggable: boolean };
}) {
  const { lang } = useV2();
  const L = (k: StrKey) => t(lang, k), p = cfg.params;
  const param = (patch: RuleCfg["params"]) => onChange({ ...cfg, params: { ...p, ...patch } });
  return (
    <li className={`prule${cfg.on ? "" : " off"}`} data-rule={id} {...drag}>
      <span className="grip" aria-hidden="true">⋮⋮</span>
      <label className="on">
        <input type="checkbox" checked={cfg.on} onChange={(e) => onChange({ ...cfg, on: e.target.checked })} />
        <span><b>{L(`rule.${id}.name` as StrKey)}</b><small>{L(`rule.${id}.desc` as StrKey)}</small></span>
      </label>
      <select aria-label={L("settings.predict.mode")} value={cfg.mode} onChange={(e) => onChange({ ...cfg, mode: e.target.value as RuleCfg["mode"] })}>
        {[...MODE_IDS, "all" as const].map((m) => <option key={m} value={m}>{L(`mode.name.${m}` as StrKey)}</option>)}
      </select>
      <span className="params">
        {p.minMinutes !== undefined && <NumParam label={L("settings.predict.p.minMinutes")} value={p.minMinutes} lo={0} hi={600} onCommit={(v) => param({ minMinutes: v })} />}
        {p.minutes !== undefined && <NumParam label={L("settings.predict.p.minutes")} value={p.minutes} lo={1} hi={1440} onCommit={(v) => param({ minutes: v })} />}
        {p.days !== undefined && <NumParam label={L("settings.predict.p.days")} value={p.days} lo={1} hi={7} onCommit={(v) => param({ days: v })} />}
        {p.keywords !== undefined && <KwParam label={L("settings.predict.p.keywords")} value={p.keywords} onCommit={(v) => param({ keywords: v })} />}
      </span>
      <span className="mv">
        <button type="button" className="opt" disabled={first} aria-label={L("settings.predict.up")} onClick={() => onMove(-1)}>↑</button>
        <button type="button" className="opt" disabled={last} aria-label={L("settings.predict.down")} onClick={() => onMove(1)}>↓</button>
      </span>
    </li>
  );
}

/** Edits a draft; commits on blur / Enter (never one PUT per keystroke); an out-of-range value rolls back. */
function NumParam({ label, value, lo, hi, onCommit }: { label: string; value: number; lo: number; hi: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isInteger(n) && n >= lo && n <= hi) { if (n !== value) onCommit(n); } else setDraft(String(value));
  };
  return (
    <label className="param">{label}
      <input type="number" min={lo} max={hi} step={1} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter" && !isComposingEvent(e, false)) commit(); }} />
    </label>
  );
}
function KwParam({ label, value, onCommit }: { label: string; value: string[]; onCommit: (v: string[]) => void }) {
  const shown = value.join("、");
  const [draft, setDraft] = useState(shown);
  useEffect(() => { setDraft(shown); }, [shown]);
  const commit = () => {
    const ks = draft.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
    if (ks.length >= 1 && ks.length <= 20 && ks.every((k) => k.length <= 20)) { if (ks.join("、") !== shown) onCommit(ks); } else setDraft(shown);
  };
  return (
    <label className="param kw">{label}
      <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter" && !isComposingEvent(e, false)) commit(); }} />
    </label>
  );
}
