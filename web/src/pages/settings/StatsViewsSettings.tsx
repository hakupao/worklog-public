import { useState } from "react";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { DEFAULT_PREFS } from "../../prefs/defaults";
import { resolveViews, STATS_VIEW_NEEDS } from "../../prefs/statsViews";
import type { Prefs } from "../../prefs/types";
import { useV2 } from "../../ui/context";
import { MODULES } from "../../world/modules";
import { Item } from "./parts";
import { move } from "./PredictSettings";

/** 统计页视图 (U20): each view on / off and its place in the page; restore resets only this group. */
export function StatsViewsSettings() {
  const { prefs, setPrefs, lang } = useV2();
  const L = (k: StrKey, v?: Record<string, string | number>) => t(lang, k, v);
  const put = (f: (s: Prefs["stats"]) => Prefs["stats"]) => setPrefs((x) => ({ ...x, stats: f(x.stats ?? DEFAULT_PREFS.stats) }));
  const views = resolveViews(prefs.stats);
  // A reorder writes the whole resolved order, so a stale or partial stored order becomes complete.
  const reorder = (from: number, to: number) => put((s) => ({ ...s, order: move(resolveViews(s).map((v) => v.id), from, to) }));
  const toggle = (id: string, on: boolean) => put((s) => ({ ...s, off: on ? s.off.filter((x) => x !== id) : [...s.off, id] }));
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <>
      <h2 className="grp-h">{L("settings.group.stats")}</h2>
      <Item wide name={L("settings.stats.list.name")} desc={L("settings.stats.list.desc")}>
        <ol className="prules sviews">
          {views.map(({ id, on }, i) => {
            const need = STATS_VIEW_NEEDS[id], mod = need && MODULES.find((m) => m.id === need);
            return (
              <li key={id} className={`prule sview${on ? "" : " off"}`} data-view={id} draggable
                onDragStart={(e) => { setDrag(i); e.dataTransfer?.setData("text/plain", id); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) reorder(drag, i); setDrag(null); }}
                onDragEnd={() => setDrag(null)}>
                <span className="grip" aria-hidden="true">⋮⋮</span>
                <label className="on">
                  <input type="checkbox" checked={on} onChange={(e) => toggle(id, e.target.checked)} />
                  <span><b>{L(`sv.${id}.name` as StrKey)}</b><small>{L(`sv.${id}.desc` as StrKey)}</small></span>
                </label>
                {mod ? <span className="need">{L("settings.stats.needs", { m: L(mod.labelKey) })}</span> : <span />}
                <span className="mv">
                  <button type="button" className="opt" disabled={i === 0} aria-label={L("settings.predict.up")} onClick={() => reorder(i, i - 1)}>↑</button>
                  <button type="button" className="opt" disabled={i === views.length - 1} aria-label={L("settings.predict.down")} onClick={() => reorder(i, i + 1)}>↓</button>
                </span>
              </li>
            );
          })}
        </ol>
      </Item>
      <button type="button" className="opt" onClick={() => put(() => structuredClone(DEFAULT_PREFS.stats))}>{L("settings.stats.reset")}</button>
    </>
  );
}
