import { useState } from "react";
import { isComposingEvent } from "../lib/ime";
import type { StrKey } from "../i18n/strings";
import { t } from "../i18n/t";
import {
  DOCK_OPTIONS, FONT_OPTIONS, INK_FX_OPTIONS, LANGS, LED_FX_OPTIONS, SPEED_OPTIONS, WORLD_FX_OPTIONS, type Trigger,
} from "../prefs/types";
import { useV2 } from "../ui/context";
import { dropHashOverride } from "../ui/Dock";
import { MODULES } from "../world/modules";
import { toggleWorld } from "../world/transitions";
import { FxPreview } from "./settings/FxPreview";
import { InkPreview } from "./settings/InkPreview";
import { CalSettings } from "./settings/CalSettings";
import { Item, Opt } from "./settings/parts";
import { PredictSettings } from "./settings/PredictSettings";
import { StatsViewsSettings } from "./settings/StatsViewsSettings";

const TRIGGERS: Trigger[] = ["load", "lang", "data"];
const FONT_NAME = { plex: "IBM Plex", inter: "Inter", geist: "Geist" } as const;

export function SettingsPage() {
  const { prefs, setPrefs, resetPrefs, setLang, lang } = useV2();
  const L = (k: StrKey) => t(lang, k);
  return (
    <div className="set">
      <h2 className="grp-h">{L("settings.group.lang")}</h2>
      <Item name={L("settings.lang.name")} desc={L("settings.lang.desc")}>
        {LANGS.map((l) => <Opt key={l} on={prefs.lang === l} onClick={(e) => { dropHashOverride("lang"); setLang(l, e.currentTarget); }}>{L(`lang.${l}` as StrKey)}</Opt>)}
      </Item>

      <h2 className="grp-h">{L("settings.group.dock")}</h2>
      <Item name={L("settings.dock.name")} desc={L("settings.dock.desc")}>
        {DOCK_OPTIONS.map((d) => <Opt key={d} on={prefs.dock === d} onClick={() => setPrefs((p) => ({ ...p, dock: d }))}>{L(`dock.${d}` as StrKey)}</Opt>)}
      </Item>

      <h2 className="grp-h">{L("settings.group.ura")}</h2>
      {TRIGGERS.map((k) => (
        <Item key={k} name={L(`settings.fx.${k}.name` as StrKey)} desc={L(`settings.fx.${k}.desc` as StrKey)}
          aside={<FxPreview trigger={k} fx={prefs.fx[k]} />}>
          {LED_FX_OPTIONS[k].map((f) => (
            <Opt key={f} on={prefs.fx[k] === f} onClick={() => setPrefs((p) => ({ ...p, fx: { ...p.fx, [k]: f } }))}>{L(`fx.${f}` as StrKey)}</Opt>
          ))}
        </Item>
      ))}
      <Item name={L("settings.speed.name")} desc={L("settings.speed.desc")}>
        {SPEED_OPTIONS.map((s) => <Opt key={s} on={prefs.speed === s} onClick={() => setPrefs((p) => ({ ...p, speed: s }))}>{`${s}×`}</Opt>)}
      </Item>

      <h2 className="grp-h">{L("settings.group.omote")}</h2>
      {TRIGGERS.map((k) => (
        <Item key={k} name={L(`settings.fx.${k}.name` as StrKey)} desc={L(`settings.ofx.${k}.desc` as StrKey)}
          aside={<InkPreview trigger={k} fx={prefs.ofx[k]} />}>
          {INK_FX_OPTIONS[k].map((f) => (
            <Opt key={f} on={prefs.ofx[k] === f} onClick={() => setPrefs((p) => ({ ...p, ofx: { ...p.ofx, [k]: f } }))}>{L(`ofx.${f}` as StrKey)}</Opt>
          ))}
        </Item>
      ))}

      <h2 className="grp-h">{L("settings.group.world")}</h2>
      <Item name={L("settings.worldFx.name")} desc={L("settings.worldFx.desc")}
        aside={<button type="button" className="opt" onClick={(e) => { dropHashOverride("world"); void toggleWorld(e.currentTarget); }}>{L("settings.worldFx.try")}</button>}>
        {WORLD_FX_OPTIONS.map((w) => <Opt key={w} on={prefs.worldFx === w} onClick={() => setPrefs((p) => ({ ...p, worldFx: w }))}>{L(`wfx.${w}` as StrKey)}</Opt>)}
      </Item>
      <Item name={L("settings.font.name")} desc={L("settings.font.desc")}>
        {FONT_OPTIONS.map((f) => (
          <button key={f} type="button" className={`fontpv f-${f}`} aria-pressed={prefs.omote.font === f}
            onClick={() => setPrefs((p) => ({ ...p, omote: { ...p.omote, font: f } }))}>
            <b lang="ja">作業記録 worklog</b><span>{FONT_NAME[f]} · 運行中 RUNNING</span><span className="num">02:47 · 6.4h</span>
          </button>
        ))}
      </Item>
      <Item name={L("settings.hide.name")} desc={L("settings.hide.desc")}>
        <div className="mods">
          {MODULES.map((m) => (
            <label key={m.id}>
              <input type="checkbox" checked={!prefs.omote.hide.includes(m.id)}
                onChange={(e) => setPrefs((p) => ({ ...p, omote: { ...p.omote,
                  hide: e.target.checked ? p.omote.hide.filter((h) => h !== m.id) : [...p.omote.hide, m.id] } }))} />
              {L(m.labelKey)}
            </label>
          ))}
        </div>
      </Item>

      <PredictSettings />

      <StatsViewsSettings />

      <CalSettings />

      <h2 className="grp-h">{L("settings.group.report")}</h2>
      <Item name={L("settings.report.name.name")} desc={L("settings.report.name.desc")}>
        <NameInput key={prefs.report.name} value={prefs.report.name} label={L("settings.report.name.name")}
          onSave={(name) => setPrefs((p) => ({ ...p, report: { name } }))} />
      </Item>

      <button type="button" className="opt reset" onClick={resetPrefs}>{L("settings.reset")}</button>
    </div>
  );
}

/** Saved on blur / Enter, trimmed; an empty or over-long value goes back to the saved one (the whole prefs PUT
 *  would otherwise be a 400). Keyed by the saved value, so a change from another tab resets the field. */
function NameInput({ value, label, onSave }: { value: string; label: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const v = draft.trim();
    if (v.length < 1 || v.length > 60) { setDraft(value); return; }
    setDraft(v);
    if (v !== value) onSave(v);
  };
  return (
    <input type="text" className="opt name" aria-label={label} maxLength={60} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter" && !isComposingEvent(e, false)) e.currentTarget.blur(); }} />
  );
}
