import { Hono } from "hono";
import type { AppEnv } from "../env";
import { weekRange } from "../jst";

export const reportDownloads = new Hono<AppEnv>();

// Read-only: the rows are written by the xlsx route (reports.ts recordDownload).
reportDownloads.get("/", async (c) => {
  const week = c.req.query("week") ?? "";
  if (!weekRange(week)) return c.json({ error: "invalid week" }, 400);
  const { results } = await c.env.DB.prepare(
    "SELECT week, template, at FROM report_downloads WHERE week = ?1 ORDER BY at DESC, template",
  ).bind(week).all<{ week: string; template: string; at: string }>();
  return c.json(results);
});
