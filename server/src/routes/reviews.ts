import { Hono } from "hono";
import type { AppEnv } from "../env";
import { langOf } from "../i18n/langs";
import { localize } from "../i18n/store";
import { weekRange } from "../jst";
import { ReviewIn } from "../schemas";

export const reviews = new Hono<AppEnv>();

reviews.get("/", async (c) => {
  const limit = Math.min(Math.max(Math.trunc(Number(c.req.query("limit") ?? 8)) || 8, 1), 52);
  const { results } = await c.env.DB.prepare(
    "SELECT week, text, model, generated_at, machine FROM weekly_reviews ORDER BY week DESC LIMIT ?1",
  ).bind(limit).all<Record<string, any>>();
  return c.json(await localize(c.env.DB, langOf(c), "weekly_review", results, ["text"], (r) => r.week));
});

reviews.get("/:week", async (c) => {
  const week = c.req.param("week");
  if (!weekRange(week)) return c.json({ error: "invalid week" }, 400);
  const row = await c.env.DB.prepare("SELECT * FROM weekly_reviews WHERE week = ?1").bind(week).first<Record<string, any>>();
  if (!row) return c.json({ error: "no review" }, 404);
  const [out] = await localize(c.env.DB, langOf(c), "weekly_review", [row], ["text"], (r) => r.week);
  return c.json(out);
});

reviews.post("/", async (c) => {
  const parsed = ReviewIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !weekRange(parsed.data.week)) return c.json({ error: "invalid review" }, 400);
  const r = parsed.data;
  const verb = r.force ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
  const res = await c.env.DB.prepare(
    `${verb} INTO weekly_reviews (week, text, model, stats_json, generated_at, machine) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(r.week, r.text, r.model, r.stats_json, new Date().toISOString(), r.machine).run();
  return c.json({ stored: res.meta.changes > 0 });
});
