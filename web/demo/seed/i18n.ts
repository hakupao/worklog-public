// The translations table (migrations/0011, 0016): the demo writes zh / ja / en for every text it puts in a base table,
// so switching the UI language shows translated data. A row is used only while its source_text equals the base text
// byte for byte (server/src/i18n/store.ts pick), so each row is recorded from the exact text that was written.
import type { Entity } from "../../../server/src/i18n/registry";
import type { Lang, SeedCtx, Tri } from "./types";

/** server/src/i18n/translator.ts MODEL. */
const MODEL = "claude-opus-5-5";

interface Row { entity: Entity; id: string; field: string; text: string; src: Lang | null; tri: Tri; at: string; polishedFrom: string | null; identity: boolean }

export class Translations {
  private rows = new Map<string, Row>();

  /** `tri[src]` is the base text unless `raw` is given: then the base holds what was typed (raw) and the three
   *  languages are its polished form (input polish §6: polished_from = raw). */
  add(entity: Entity, id: string, field: string, tri: Tri, src: Lang, at: string, raw?: string) {
    const text = raw ?? tri[src];
    this.rows.set(`${entity}\u0000${id}\u0000${field}`, { entity, id, field, text, src, tri, at, polishedFrom: raw ?? null, identity: false });
  }

  /** A value kept as is in every language (numbers, dates, codes): model 'identity', no source language. */
  identity(entity: Entity, id: string, field: string, text: string, at: string) {
    this.rows.set(`${entity}\u0000${id}\u0000${field}`, { entity, id, field, text, src: null, tri: { ja: text, zh: text, en: text }, at, polishedFrom: null, identity: true });
  }

  get size() { return this.rows.size; }

  async flush(ctx: SeedCtx): Promise<void> {
    for (const r of this.rows.values()) {
      await ctx.sql(
        `INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, attempts, updated_at, polished_from)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11)
         ON CONFLICT(entity, entity_id, field) DO UPDATE SET source_text = excluded.source_text, source_lang = excluded.source_lang,
           zh = excluded.zh, ja = excluded.ja, en = excluded.en, model = excluded.model, updated_at = excluded.updated_at,
           polished_from = excluded.polished_from`,
        r.entity, r.id, r.field, r.text, r.src, r.tri.zh, r.tri.ja, r.tri.en, r.identity ? "identity" : MODEL, r.at, r.polishedFrom,
      );
    }
  }
}
