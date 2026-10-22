import { sourceOf, type Entity } from "./registry";
import type { Lang } from "./langs";

type TrRow = {
  entity_id: string; field: string; source_text: string; zh: string | null; ja: string | null; en: string | null;
  polished_from: string | null; pinned_raw: string | null;
};
/** Per field, for the v2 editors (input polish): the raw text the user typed, and whether it is pinned (还原). */
export type PolishMeta = { raw: string; pinned: boolean };

/** Translation rows for these ids, keyed `${id}\u0000${field}`. */
export async function loadTr(db: D1Database, entity: Entity, ids: string[]): Promise<Map<string, TrRow>> {
  const out = new Map<string, TrRow>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return out;
  const { results } = await db.prepare(
    `SELECT entity_id, field, source_text, zh, ja, en, polished_from, pinned_raw FROM translations
     WHERE entity = ?1 AND entity_id IN (SELECT value FROM json_each(?2))`,
  ).bind(entity, JSON.stringify(uniq)).all<TrRow>();
  for (const r of results) out.set(`${r.entity_id}\u0000${r.field}`, r);
  return out;
}

/** The fresh translation of `current`, or `current` itself. */
const pick = (tr: Map<string, TrRow>, id: string, field: string, current: unknown, lang: Lang): unknown => {
  if (typeof current !== "string" || current === "") return current;
  const r = tr.get(`${id}\u0000${field}`);
  return r && r.source_text === current && r[lang] != null ? r[lang] : current;
};

/** The polish state of a fresh row for `current`: polished, restored, or none. */
const metaOf = (tr: Map<string, TrRow>, id: string, field: string, current: unknown): PolishMeta | null => {
  if (typeof current !== "string" || current === "") return null;
  const r = tr.get(`${id}\u0000${field}`);
  if (!r || r.source_text !== current) return null;
  if (r.polished_from === current) return { raw: current, pinned: false };
  if (r.pinned_raw === current) return { raw: current, pinned: true };
  return null;
};

/** Copies of `rows` with each text field replaced by its fresh translation. lang null = unchanged.
 *  `meta`: also attach `_polish` (field → raw / pinned) for fields that are polished or restored. The report's
 *  shared sheetsOf / digestsOf paths ask for it too; the xlsx / PDF renderers ignore the extra key. */
export async function localize<T extends Record<string, any>>(
  db: D1Database, lang: Lang | null, entity: Entity, rows: T[], fields: string[], idOf: (r: T) => string = (r) => r.id,
  opts: { meta?: boolean } = {},
): Promise<T[]> {
  if (!lang || rows.length === 0) return rows;
  const tr = await loadTr(db, entity, rows.map(idOf));
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    const meta: Record<string, PolishMeta> = {};
    for (const f of fields) {
      out[f] = pick(tr, idOf(r), f, r[f], lang);
      const m = opts.meta ? metaOf(tr, idOf(r), f, r[f]) : null;
      if (m) meta[f] = m;
    }
    if (Object.keys(meta).length) out._polish = meta;
    return out as T;
  });
}

/** Sessions translate their effective summary; it lands in whichever column carries it, so a
 *  summary_effective derived later (server or client: summary_edited ?? summary) is the translation. */
export async function localizeSessions<T extends { id: string; summary: string | null; summary_edited: string | null }>(
  db: D1Database, lang: Lang | null, rows: T[], opts: { meta?: boolean } = {},
): Promise<T[]> {
  if (!lang || rows.length === 0) return rows;
  const tr = await loadTr(db, "session", rows.map((r) => r.id));
  return rows.map((r) => {
    const col = r.summary_edited != null ? "summary_edited" : "summary";
    const m = opts.meta ? metaOf(tr, r.id, "summary", r[col]) : null;
    return { ...r, [col]: pick(tr, r.id, "summary", r[col], lang), ...(m ? { _polish: { summary: m } } : {}) };
  });
}

export async function localizeTaskRefs<T extends { id: string; title: string }>(db: D1Database, lang: Lang | null, refs: T[]): Promise<T[]> {
  return localize(db, lang, "task", refs, ["title"]);
}

/** Under X-Lang, a field sent back exactly as the fresh translation the client was shown is not an
 *  edit: drop it so the base keeps its source (DayDrawer saves detail on blur, forms re-send fields).
 *  An empty string is never dropped (sessions: "" restores the collector's summary). */
export async function dropUnchanged(
  db: D1Database, lang: Lang | null, entity: Entity, id: string, patch: Record<string, unknown>, map: Record<string, string>,
): Promise<void> {
  if (!lang) return;
  const keys = Object.keys(map).filter((k) => typeof patch[k] === "string" && patch[k] !== "");
  if (keys.length === 0) return;
  const tr = await loadTr(db, entity, [id]);
  for (const k of keys) {
    const field = map[k], r = tr.get(`${id}\u0000${field}`);
    if (!r || r[lang] == null || patch[k] !== r[lang]) continue;
    const src = sourceOf(entity, field);
    const cur = (await db.prepare(`SELECT ${src.text} AS v FROM ${src.from} b WHERE ${src.id} = ?1`).bind(id).first<{ v: string }>())?.v;
    if (cur !== undefined && r.source_text === cur && cur !== patch[k]) delete patch[k];
  }
}
