import type { Hint } from "../../api/types";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { UNLINKED_HREF } from "../../predict/rules";
import type { Lang } from "../../prefs/types";
import { toV2Href } from "./hrefs";

/** Each hint id the page words itself, with the params its template needs (server/src/dashboard/hints.ts fixes
 *  the keys per id). */
const TEMPLATES: Record<string, { key: StrKey; needs: string[] }> = {
  "unlinked": { key: "st.hint.unlinked", needs: ["n", "hours"] },
  "done-no-deliverable": { key: "st.hint.done-no-deliverable", needs: ["n"] },
  "machine-silent": { key: "st.hint.machine-silent", needs: ["names", "days"] },
  "stale-open": { key: "st.hint.stale-open", needs: ["n", "days"] },
  "summary-fallback": { key: "st.hint.summary-fallback", needs: ["n"] },
  "late-night": { key: "st.hint.late-night", needs: ["pct"] },
  "weekend": { key: "st.hint.weekend", needs: ["pct"] },
  "costly-session": { key: "st.hint.costly-session", needs: ["n", "usd", "max"] },
  "subagent-heavy": { key: "st.hint.subagent-heavy", needs: ["n", "pct"] },
};
const scalar = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";

/** The hint in the page's language from its template and params; the server's Chinese `text` when the id is
 *  unknown (a newer server) or a param is missing (an older one). */
export function hintText(lang: Lang, h: Hint): string {
  const tpl = Object.hasOwn(TEMPLATES, h.id) ? TEMPLATES[h.id] : undefined;
  const p = h.params && typeof h.params === "object" ? h.params : {};
  if (!tpl || !tpl.needs.every((k) => scalar(p[k]))) return h.text;
  // the server joins machine names with 「、」, which reads wrong in English
  const vars = lang === "en" && typeof p.names === "string" ? { ...p, names: p.names.split("、").join(", ") } : p;
  return t(lang, tpl.key, vars);
}

/** The raw task id a hint link opens: the server writes `#/v2/tasks/<encoded id>` (an older answer, `#/tasks/<raw id>`). */
function taskIdOf(href: string): string | null {
  const v2 = /^#\/v2\/tasks\/(.+)$/.exec(href);
  if (v2) { try { return decodeURIComponent(v2[1]); } catch { return null; } }
  return /^#\/tasks\/(.+)$/.exec(href)?.[1] ?? null;
}

/** The hint's links on v2 addresses, each with the task it opens (its raw id, for the line code and colour) or
 *  null. The unlinked one is worded here, in the page's language (the v2 filter it opens lists the unlinked
 *  sessions of all weeks, as the old 去关联（全部） did). Other labels are data (task titles, week labels). A link that isn't `{label, href}` is dropped. */
export function hintLinks(lang: Lang, h: Hint): { label: string; href: string; taskId: string | null }[] {
  return (Array.isArray(h.links) ? h.links : [])
    .filter((l) => typeof l === "object" && l !== null && typeof l.href === "string" && typeof l.label === "string")
    .map((l) => {
      const href = toV2Href(l.href);
      return {
        label: href === UNLINKED_HREF ? t(lang, "st.hint.k.unlinked") : l.label,
        href,
        taskId: taskIdOf(l.href),
      };
    });
}

