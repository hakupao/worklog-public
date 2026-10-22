import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { SOURCES } from "../i18n/registry";
import { translateSoon } from "../i18n/sweep";

export const i18n = new Hono<AppEnv>();

const Pin = z.object({ entity: z.string(), entity_id: z.string().min(1), field: z.string(), pinned: z.boolean() });

/** 还原 / 恢复润色 (input polish §8): pin or unpin the field's current raw text. Only the translation row changes
 *  (pinned_raw, and source_text '' so the field is stale and the sweep redoes it now); the base row and its
 *  updated_at — the editors' optimistic lock — are never touched. */
i18n.post("/pin", async (c) => {
  const body = Pin.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "not polishable" }, 400);
  const { entity, entity_id, field, pinned } = body.data;
  const src = SOURCES.find((s) => s.entity === entity && s.field === field && s.polish);
  if (!src) return c.json({ error: "not polishable" }, 400);
  const db = c.env.DB;
  const cur = await db.prepare(`SELECT ${src.text} AS v FROM ${src.from} b WHERE ${src.id} = ?1`).bind(entity_id).first<{ v: string }>();
  if (!cur) return c.json({ error: "not found" }, 404);
  await db.prepare(
    `INSERT INTO translations (entity, entity_id, field, source_text, pinned_raw, updated_at) VALUES (?1, ?2, ?3, '', ?4, ?5)
     ON CONFLICT(entity, entity_id, field) DO UPDATE SET source_text = '', pinned_raw = excluded.pinned_raw,
       failed_text = NULL, attempts = 0, next_try_at = NULL, updated_at = excluded.updated_at`,
  ).bind(entity, entity_id, field, pinned ? cur.v : null, new Date().toISOString()).run();
  translateSoon(c, src.entity, entity_id);
  return c.json({ entity, entity_id, field, pinned, raw: cur.v });
});
