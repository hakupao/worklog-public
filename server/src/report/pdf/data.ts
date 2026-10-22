// server/src/report/pdf/data.ts
// What the one-page PDF report shows (design 2026-10-08 §4.1), from the week the 週報 builds (wall clock, Sat→Fri)
// and its AI digests, all text already in the export language. No report_overrides: those belong to a template.
import type { Lang } from "../../i18n/langs";
import { LABELS } from "../labels";
import type { ComposeItem } from "../compose/selection";
import { UNASSIGNED, workedOf } from "../compose/selection";
import type { LangText } from "../compose/store";
import type { DigestOut, WeekData } from "../types";

/** rest = how many 案件 a composed その他 row folds in (set on that row only). */
export interface PdfTask { title: string; requester: string; minutes: number; rest?: number }
export interface PdfData {
  week: string; lang: Lang; issued: string; name: string; summary: string[];
  /** minutes = wall clock (工作时间); sum = 累計, every session's own time (parallel ones in full; absent = not shown) */
  days: { date: string; minutes: number; sum?: number; text: string[] }[];
  tasks: PdfTask[]; taskCount: number; totalMinutes: number; sumMinutes?: number;
  /** Set by pdfDataComposed only: the sheet then counts a hidden or cut summary line as overflow (html.ts). */
  composed?: true;
}

/** 0.1 h, from minutes: "0h" when it shows as zero. */
export function hoursText(min: number): string {
  const h = Math.round(min / 6) / 10;
  return h === 0 ? "0h" : `${h.toFixed(1)}h`;
}

/** Digest lines for the sheet: the PDF version, else the web text (a hand edit clears pdf_text). */
const lines = (d?: DigestOut | null) => (d ? (d.pdf_text ?? d.text) : "").split("\n").map((s) => s.trim()).filter(Boolean);

const sumOf = (data: WeekData, date: string) => data.day_sum_minutes.find(([d]) => d === date)?.[1] ?? 0;
const sumAll = (data: WeekData) => data.day_sum_minutes.reduce((a, [, m]) => a + m, 0);

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A day's line (user feedback 10/9: the AI line named one or two 案件 beside the whole day's hours): every 案件
 *  worked that day by its short name (its プロジェクト) with that day's hours, most first — `ATLAS 10.9h · BEACON 0.2h`.
 *  What no 案件 holds is the 未関連 label; on a composed sheet the 案件 in `folded` (other / hide, 未関連 by its id)
 *  join one その他 entry. A share that shows as 0h is left out. Minutes are the day's wall-clock buckets
 *  (`day_buckets`, unrounded), so the entries add up to the day total. */
export function dayLines(data: WeekData, lang: Lang, folded: Set<string> | null = null): Record<string, string[]> {
  const L = LABELS[lang], project = new Map(data.tasks.map((r) => [r.task.id, r.task.project || r.task.title]));
  const out: Record<string, string[]> = {};
  for (const [date] of data.day_minutes) {
    const by = new Map<string, number>();
    let rest = 0;
    for (const [bucket, m] of Object.entries(data.day_buckets[date] ?? {})) {
      if (folded?.has(bucket === "" ? UNASSIGNED : bucket)) { rest += m; continue; }
      const name = bucket === "" ? L.unassigned : project.get(bucket) ?? bucket;
      by.set(name, (by.get(name) ?? 0) + m);
    }
    const parts = [...by].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
      .filter(([, m]) => hoursText(m) !== "0h").map(([name, m]) => `${name} ${hoursText(m)}`);
    if (hoursText(rest) !== "0h") parts.push(`${L.pdf.other} ${hoursText(rest)}`);
    out[date] = parts.length ? [parts.join(" · ")] : [];
  }
  return out;
}

export function pdfDataOf(data: WeekData, digests: { week: DigestOut | null; days: Record<string, DigestOut> },
                          o: { lang: Lang; issued: string; name: string }): PdfData {
  const totalMinutes = data.day_minutes.reduce((a, [, m]) => a + m, 0);
  const real = data.tasks.filter((r) => r.week_minutes > 0)
    .map((r): PdfTask => ({ title: r.task.title, requester: r.task.requester, minutes: r.week_minutes }));
  // Buckets partition the day totals, so what no task holds is the 未関連 bucket (plus float residue).
  const rest = totalMinutes - real.reduce((a, t) => a + t.minutes, 0);
  const tasks = rest >= 0.5 ? [...real, { title: LABELS[o.lang].unassigned, requester: "", minutes: rest }] : real;
  tasks.sort((a, b) => b.minutes - a.minutes || cmp(a.title, b.title));
  return {
    week: data.summary.week, lang: o.lang, issued: o.issued, name: o.name,
    summary: lines(digests.week),
    days: ((t) => data.day_minutes.map(([date, minutes]) => ({ date, minutes, sum: sumOf(data, date), text: t[date] ?? [] })))(dayLines(data, o.lang)),
    tasks, taskCount: real.length, totalMinutes, sumMinutes: sumAll(data),
  };
}

/** The PDF of a composed week (spec 2026-10-09 §6.3): show rows in the selection's order, then one その他 row holding
 *  every other + hide row's minutes (`rest` = how many 案件 it folds; overflow rows join it in renderReportHtml);
 *  text from the composer, not the digests. taskCount and totals are the week's, whatever is hidden. */
export function pdfDataComposed(data: WeekData, items: ComposeItem[], text: LangText,
                                o: { lang: Lang; issued: string; name: string }): PdfData {
  const worked = new Map(workedOf(data, LABELS[o.lang].unassigned).map((x) => [x.id, x]));
  const totalMinutes = data.day_minutes.reduce((a, [, m]) => a + m, 0);
  const shown = items.filter((i) => i.mode === "show" && worked.has(i.id)).map((i): PdfTask => {
    const x = worked.get(i.id)!;
    return { title: x.title, requester: x.requester, minutes: x.minutes };
  });
  const folded = items.filter((i) => i.mode !== "show" && worked.has(i.id));
  const restMin = folded.reduce((a, i) => a + worked.get(i.id)!.minutes, 0);
  const tasks = folded.length > 0 ? [...shown, { title: "", requester: "", minutes: restMin, rest: folded.length }] : shown;
  return {
    week: data.summary.week, lang: o.lang, issued: o.issued, name: o.name, summary: text.summary,
    days: ((t) => data.day_minutes.map(([date, minutes]) => ({ date, minutes, sum: sumOf(data, date), text: t[date] ?? [] })))(
      dayLines(data, o.lang, new Set(items.filter((i) => i.mode !== "show").map((i) => i.id)))),
    tasks, taskCount: data.tasks.filter((r) => r.week_minutes > 0).length, totalMinutes, sumMinutes: sumAll(data), composed: true,
  };
}
