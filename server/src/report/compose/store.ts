// D1 access for the PDF composer (spec 2026-10-09 §4–§5). Every write is one statement; the selection is guarded by
// updated_at like the other editable rows, the generation by a time-boxed lock column.
import type { Lang } from "../../i18n/langs";
import { reportWeekOf, reportWeekRange } from "../week";
import type { ComposeItem } from "./selection";

export type LangText = { summary: string[]; days: Record<string, string[]> };
export type ComposeText = Record<Lang, LangText>;
export interface ComposeRow {
  week: string; items: ComposeItem[]; text: ComposeText | null; source_lang: Lang | null; edited: boolean;
  gen_selection_hash: string | null; gen_inputs_hash: string | null; gen_model: string | null; generated_at: string | null;
  generating_at: string | null; translating_at: string | null; updated_at: string;
  /** The last retranslation for the current edit failed (kept in the text JSON as `translate_failed`, so no column). */
  translate_failed: boolean;
}
/** The generation lock expires after this long (a killed Worker never frees it). */
export const LOCK_MS = 180_000;
/** A hand edit's retranslation runs inside its PUT (translate timeout 60 s): a translating_at older than this was left
 *  by a request that died, and reads as a failed retranslation. */
export const TRANSLATE_MS = 90_000;
const LOOKBACK = 8;

type Raw = Omit<ComposeRow, "items" | "text" | "edited" | "translate_failed"> & { items: string; text: string | null; edited: number };
const parse = (r: Raw): ComposeRow => {
  const { translate_failed, ...text } = r.text ? JSON.parse(r.text) : { translate_failed: undefined };
  return { ...r, items: JSON.parse(r.items), text: r.text ? text as ComposeText : null, edited: r.edited === 1, translate_failed: translate_failed === true };
};

export async function loadRow(db: D1Database, week: string): Promise<ComposeRow | null> {
  const r = await db.prepare("SELECT * FROM pdf_compose WHERE week = ?1").bind(week).first<Raw>();
  return r ? parse(r) : null;
}

/** The items of the nearest earlier report week with a row, at most 8 weeks back (one query); [] when none. */
export async function previousItems(db: D1Database, week: string): Promise<ComposeItem[]> {
  const weeks: string[] = [];
  let cur = week;
  for (let i = 0; i < LOOKBACK; i++) {
    const range = reportWeekRange(cur);
    if (!range) break;
    cur = reportWeekOf(range.startMs - 1);
    weeks.push(cur);
  }
  if (weeks.length === 0) return [];
  const rows = (await db.prepare(`SELECT week, items FROM pdf_compose WHERE week IN (${weeks.map((_, i) => `?${i + 1}`).join(",")})`)
    .bind(...weeks).all<{ week: string; items: string }>()).results;
  const byWeek = new Map(rows.map((r) => [r.week, r.items]));
  for (const w of weeks) if (byWeek.has(w)) return JSON.parse(byWeek.get(w)!);
  return [];
}

/** Writes the selection. token null = the first write (no row yet); otherwise the row's updated_at. false = conflict. */
export async function putItems(db: D1Database, week: string, items: ComposeItem[], token: string | null, now: string): Promise<boolean> {
  const json = JSON.stringify(items);
  const r = token === null
    ? await db.prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(week) DO NOTHING").bind(week, json, now).run()
    : await db.prepare("UPDATE pdf_compose SET items = ?2, updated_at = ?3 WHERE week = ?1 AND updated_at = ?4").bind(week, json, now, token).run();
  return r.meta.changes === 1;
}

/** Takes the week's generation lock (creating the row from `initial` when there is none). false = someone holds it. */
export async function takeLock(db: D1Database, week: string, initial: ComposeItem[], now: Date): Promise<boolean> {
  const iso = now.toISOString(), expired = new Date(now.getTime() - LOCK_MS).toISOString();
  const [, take] = await db.batch([
    db.prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(week) DO NOTHING").bind(week, JSON.stringify(initial), iso),
    db.prepare("UPDATE pdf_compose SET generating_at = ?2 WHERE week = ?1 AND (generating_at IS NULL OR generating_at < ?3)").bind(week, iso, expired),
  ]);
  return take.meta.changes === 1;
}

/** Frees the lock; with `at` (the takeLock time) only while it is still that holder's, so a late release never frees
 *  a lock another request has taken over since. */
export async function releaseLock(db: D1Database, week: string, at?: string): Promise<void> {
  await (at === undefined
    ? db.prepare("UPDATE pdf_compose SET generating_at = NULL WHERE week = ?1").bind(week)
    : db.prepare("UPDATE pdf_compose SET generating_at = NULL WHERE week = ?1 AND generating_at = ?2").bind(week, at)).run();
}

/** Stores a generation and frees the lock — only while the lock is still this request's (`lockedAt`, the takeLock
 *  time): false = another request took the lock over meanwhile, nothing written. */
export async function writeGenerated(db: D1Database, week: string,
  g: { text: ComposeText; selHash: string; inputsHash: string; model: string }, now: string, lockedAt: string): Promise<boolean> {
  const r = await db.prepare(
    `UPDATE pdf_compose SET text = ?2, gen_selection_hash = ?3, gen_inputs_hash = ?4, gen_model = ?5, generated_at = ?6,
       edited = 0, source_lang = NULL, translating_at = NULL, generating_at = NULL WHERE week = ?1 AND generating_at = ?7`,
  ).bind(week, JSON.stringify(g.text), g.selHash, g.inputsHash, g.model, now, lockedAt).run();
  return r.meta.changes === 1;
}

/** A hand edit of one language: stored at once, the other two marked as being retranslated. */
export async function writeEdit(db: D1Database, week: string, lang: Lang, t: LangText, now: string): Promise<void> {
  await db.prepare(
    `UPDATE pdf_compose SET text = json_remove(json_set(text, '$.' || ?2, json(?3)), '$.translate_failed'), edited = 1, source_lang = ?2, translating_at = ?4 WHERE week = ?1`,
  ).bind(week, lang, JSON.stringify(t), now).run();
}

/** The retranslation's result (null = it failed: the other two keep their old text and the text JSON gets
 *  `translate_failed`, which the next edit or generation clears). Written only while the edit it
 *  belongs to is still the latest (translating_at unchanged), so a newer edit or a generation is never overwritten. */
export async function writeTranslated(db: D1Database, week: string, editedAt: string, text: ComposeText | null): Promise<void> {
  await db.prepare(
    `UPDATE pdf_compose SET text = CASE WHEN ?3 IS NULL THEN json_set(text, '$.translate_failed', json('true')) ELSE ?3 END,
       translating_at = NULL WHERE week = ?1 AND translating_at = ?2`,
  ).bind(week, editedAt, text ? JSON.stringify(text) : null).run();
}
