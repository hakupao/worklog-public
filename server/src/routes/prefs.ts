import { Hono } from "hono";
import type { AppEnv } from "../env";
import { parseStoredPrefs, PrefsIn } from "../prefs/schema";
import { invalid } from "../schemas";

export const prefs = new Hono<AppEnv>();

prefs.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT json FROM prefs WHERE id = 1").first<{ json: string }>();
  return c.json(parseStoredPrefs(row?.json));
});

// Whole-object replace, last write wins (spec §9): two machines saving different fields never merge.
// One exception (plan assumption 18): a body without `predict` — a tab still running the sub-project 1
// bundle — keeps the stored rules instead of resetting them. A body with `predict` replaces it whole.
// `stats` (sub-project 7b) follows the same rule: a tab on an older bundle keeps the stored view list.
// `report` (S3) and `cal` follow the same rule.
prefs.put("/", async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined || typeof body !== "object" || body === null || Array.isArray(body)) {
    return c.json({ error: "invalid", issues: [{ path: "", message: "expected a JSON object" }] }, 400);
  }
  const parsed = PrefsIn.safeParse(body);
  if (!parsed.success) return invalid(c, parsed.error);
  let next = parsed.data;
  const keep = (["predict", "stats", "report", "cal"] as const).filter((k) => !Object.hasOwn(body, k));
  if (keep.length) {
    const row = await c.env.DB.prepare("SELECT json FROM prefs WHERE id = 1").first<{ json: string }>();
    const stored = parseStoredPrefs(row?.json);
    for (const k of keep) next = { ...next, [k]: stored[k] };
  }
  await c.env.DB.prepare(
    `INSERT INTO prefs (id, json, updated_at) VALUES (1, ?1, ?2)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  ).bind(JSON.stringify(next), new Date().toISOString()).run();
  return c.json(next);
});
