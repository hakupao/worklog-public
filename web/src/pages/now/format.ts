import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import type { Snapshot } from "../../predict/snapshot";
import type { Basis, Hit, When } from "../../predict/types";
import type { LedSeg } from "../../ui/Led";
import { machineLabel, seenText } from "../../ui/machine";

export { taskCode } from "../../ui/taskCode";
export function elapsed(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}
export function whenText(lang: Lang, w: When): string {
  switch (w.kind) {
    case "label": return t(lang, `when.${w.key}` as StrKey);
    case "time": return w.hm;
    case "date": return w.md;
  }
}
/** The interface sentence in the UI glyphs, then the data (task name, plan text) in JP glyphs. */
export function suggestionSegs(lang: Lang, s: Pick<Hit, "textKey" | "vars" | "subject">): LedSeg[] {
  const head = t(lang, s.textKey, s.vars);
  return s.subject ? [{ t: `${head} ` }, { t: s.subject }] : [{ t: head }];
}
export const plain = (segs: LedSeg[]) => segs.map((x) => x.t).join("");
export function basisText(lang: Lang, b: Basis): string {
  const parts = [t(lang, "now.basis", { t: b.hm })];
  if (b.running) parts.push(t(lang, "now.basis.running", { n: b.running }));
  parts.push(b.plan ? t(lang, "now.basis.plan", b.plan) : t(lang, "now.basis.noplan"));
  if (b.unlinked) parts.push(t(lang, "now.basis.unlinked", { n: b.unlinked }));
  return parts.join(" · ");
}
/** 运行情报 when nothing alerts: one time if both machines agree, otherwise each machine's own. */
export function syncText(lang: Lang, s: Snapshot): string {
  const ms = s.machines.filter((m): m is typeof m & { lastSeen: number } => m.lastSeen !== null);
  if (ms.length === 0) return t(lang, "now.info.none");
  const at = ms.map((m) => seenText(m.lastSeen, s.date));
  const tail = ms.length === 2 && at[0] === at[1]
    ? t(lang, "now.info.both", { t: at[0] })
    : ms.map((m, i) => t(lang, "machines.synced", { name: machineLabel(m.name), t: at[i] })).join(" · ");
  return tail;   // the heading row says 运行情报 and no red lamp means normal: the times are the news (ruling on 9b)
}
