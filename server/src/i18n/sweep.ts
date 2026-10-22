// server/src/i18n/sweep.ts
import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { SOURCES, sourceOf, type Entity, type Source } from "./registry";
import { MODEL, TranslateFormatError, polishAndTranslate, translate } from "./translator";

/** A text whose polish failed this many times with a format failure is translated as typed instead (input polish §11).
 *  The count rides in last_error as a `pf<N>|` prefix, kept across API errors in between; a legacy row with only
 *  `format:` counts its attempts (the old rule). */
export const POLISH_TRIES = 3;
export const SWEEP_LIMIT = 8;

export type StaleItem = {
  entity: Entity; field: string; entity_id: string; text: string; attempts: number;
  /** TranslateFormatErrors (bad reply / empty slot / guard) on this text so far; API and network errors do not count. */
  format_fails: number;
  /** 1 when the registry's `polish` condition holds for this row (input polish §5). */
  polishable: number;
  /** 还原: the raw text the user pinned, or null. */
  pinned_raw: string | null;
};

const staleSql = (s: Source, only: boolean) => `
  SELECT '${s.entity}' AS entity, '${s.field}' AS field, ${s.id} AS entity_id, ${s.text} AS text,
         CASE WHEN x.failed_text IS ${s.text} THEN COALESCE(x.attempts, 0) ELSE 0 END AS attempts,
         CASE WHEN x.failed_text IS NOT ${s.text} THEN 0
              WHEN x.last_error LIKE 'pf%|%' THEN CAST(substr(x.last_error, 3, instr(x.last_error, '|') - 3) AS INTEGER)
              WHEN x.last_error LIKE 'format:%' THEN x.attempts ELSE 0 END AS format_fails,
         CASE WHEN ${s.polish ?? "0"} THEN 1 ELSE 0 END AS polishable, x.pinned_raw AS pinned_raw, b.rowid AS _r
  FROM ${s.from} b
  LEFT JOIN translations x ON x.entity = '${s.entity}' AND x.field = '${s.field}' AND x.entity_id = ${s.id}
  WHERE ${s.text} <> ''
    AND (x.entity_id IS NULL OR (x.source_text IS NOT ${s.text}
         AND (x.failed_text IS NOT ${s.text} OR x.next_try_at IS NULL OR x.next_try_at <= ?1)))
    ${only ? `AND ${s.id} = ?3` : ""}`;

/** Fields with no fresh translation, oldest base rows first, at most `limit`. */
export async function findStale(db: D1Database, nowIso: string, limit: number, only?: { entity: Entity; entity_id: string }): Promise<StaleItem[]> {
  const sources = only ? SOURCES.filter((s) => s.entity === only.entity) : SOURCES;
  // One query per source: D1 caps compound SELECT terms far below SOURCES.length.
  const parts = await Promise.all(sources.map(async (s) => {
    const sql = staleSql(s, Boolean(only)) + " ORDER BY _r LIMIT ?2";
    const stmt = only ? db.prepare(sql).bind(nowIso, limit, only.entity_id) : db.prepare(sql).bind(nowIso, limit);
    return (await stmt.all<StaleItem & { _r: number }>()).results;
  }));
  return parts.flat().sort((a, b) => a._r - b._r).slice(0, limit).map(({ _r, ...x }) => x);
}

const currentText = async (db: D1Database, s: Source, id: string) =>
  (await db.prepare(`SELECT ${s.text} AS v FROM ${s.from} b WHERE ${s.id} = ?1`).bind(id).first<{ v: string }>())?.v ?? null;

async function writeOk(db: D1Database, it: StaleItem, t: { source: string | null; zh: string; ja: string; en: string }, model: string,
                       polishedFrom: string | null = null) {
  await db.prepare(
    `INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, failed_text, attempts, next_try_at, last_error, updated_at, polished_from)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, 0, NULL, NULL, ?10, ?11)
     ON CONFLICT(entity, entity_id, field) DO UPDATE SET source_text = excluded.source_text, source_lang = excluded.source_lang,
       zh = excluded.zh, ja = excluded.ja, en = excluded.en, model = excluded.model,
       failed_text = NULL, attempts = 0, next_try_at = NULL, last_error = NULL, updated_at = excluded.updated_at,
       polished_from = excluded.polished_from`,
  ).bind(it.entity, it.entity_id, it.field, it.text, t.source, t.zh, t.ja, t.en, model, new Date().toISOString(), polishedFrom).run();
}

async function writeFail(db: D1Database, it: StaleItem, err: unknown, now: Date) {
  const attempts = it.attempts + 1, isFormat = err instanceof TranslateFormatError;
  const fails = it.format_fails + (isFormat ? 1 : 0);
  const minutes = Math.min(5 * 2 ** (attempts - 1), 60);
  await db.prepare(
    `INSERT INTO translations (entity, entity_id, field, failed_text, attempts, next_try_at, last_error, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(entity, entity_id, field) DO UPDATE SET failed_text = excluded.failed_text, attempts = excluded.attempts,
       next_try_at = excluded.next_try_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
  ).bind(it.entity, it.entity_id, it.field, it.text, attempts, new Date(now.getTime() + minutes * 60_000).toISOString(),
    ((fails ? `pf${fails}|` : "") + (isFormat ? "format:" : "") + String(err)).slice(0, 300), now.toISOString()).run();
}

async function cleanOrphans(db: D1Database) {
  await db.batch(SOURCES.map((s) => db.prepare(
    `DELETE FROM translations WHERE entity = '${s.entity}' AND field = '${s.field}'
       AND entity_id NOT IN (SELECT ${s.id} FROM ${s.from} b)`)));
}

let warnedNoKey = false;

export async function runSweep(
  env: Env, opts: { client?: Anthropic; now?: Date; limit?: number; cleanup?: boolean; only?: { entity: Entity; entity_id: string } } = {},
): Promise<{ done: number; failed: number; skipped?: "no-key"; stopped: boolean }> {
  const db = env.DB, now = opts.now ?? new Date();
  if (opts.cleanup && !opts.only) await cleanOrphans(db);
  if (!env.ANTHROPIC_API_KEY && !opts.client) {
    if (!warnedNoKey) { console.log("[i18n] ANTHROPIC_API_KEY not set; translations skipped"); warnedNoKey = true; }
    return { done: 0, failed: 0, skipped: "no-key", stopped: false };
  }
  const client = opts.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const items = await findStale(db, now.toISOString(), opts.limit ?? SWEEP_LIMIT, opts.only);   // budget: 15 findStale + 2×8 items (+ up to 3 writeFails for D1 writes failing in flight, which stop the round) + 15 hourly orphan statements = 49 ≤ 50 (Workers Free D1 queries per invocation)
  let done = 0, failed = 0, stopped = false, next = 0;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const it = items[next++];
      const src = sourceOf(it.entity, it.field);
      try {
        if (src.identity?.(it.text)) {
          await writeOk(db, it, { source: null, zh: it.text, ja: it.text, en: it.text }, "identity"); done++; continue;
        }
        // a person's text is polished once per distinct input, unless pinned (还原) or its polish keeps failing the format checks
        const polish = it.polishable === 1 && it.pinned_raw !== it.text && it.format_fails < POLISH_TRIES;
        const t = polish ? await polishAndTranslate(client, it.text, it.entity, it.field) : await translate(client, it.text, it.entity, it.field);
        if ((await currentText(db, src, it.entity_id)) !== it.text) continue;   // edited meanwhile: next round
        await writeOk(db, it, t, MODEL, polish ? it.text : null); done++;
      } catch (e) {
        failed++;
        if (!(e instanceof TranslateFormatError)) stopped = true;           // API / network / D1: stop the round
        try { await writeFail(db, it, e, now); } catch (e2) { console.error("[i18n] writeFail", e2); stopped = true; }
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { done, failed, stopped };
}

export const translateOne = (env: Env, entity: Entity, entity_id: string, client?: Anthropic) =>
  runSweep(env, { only: { entity, entity_id }, client, limit: SWEEP_LIMIT });

/** After a web edit: translate that row now, in the background. Never throws (no ExecutionContext in some tests). */
export function translateSoon(c: Context<AppEnv>, entity: Entity, entity_id: string): void {
  try {
    c.executionCtx.waitUntil(translateOne(c.env, entity, entity_id).catch((e) => console.error("[i18n] translateSoon", e)));
  } catch { /* no execution context */ }
}
