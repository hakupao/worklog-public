// The range xlsx (spec 2026-10-13 §2): GET /api/reports/range/xlsx and /range/bounds. Registered into the reports
// router before /:week/:template, which would otherwise read "range" as a week and "xlsx" as a template.
import type { Hono } from "hono";
import type { AppEnv } from "../env";
import { isLang } from "../i18n/langs";
import { jstNow } from "../jst";
import { MAX_WEEKS, loadRange, rangeLength, rangeWeeks } from "../report/range/data";
import { renderRangeXlsx } from "../report/range/xlsx";
import { noteMs } from "../report/wall";
import { reportWeekOf, reportWeekRange } from "../report/week";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Every week of the range counts as downloaded (此刻's report.undownloaded, 週報's 上次下载): one statement. Never
 *  fails the download. */
async function recordRange(db: D1Database, weeks: string[]): Promise<void> {
  try {
    await db.prepare(`INSERT INTO report_downloads (week, template, at) SELECT value, 'range', ?2 FROM json_each(?1) WHERE true
                      ON CONFLICT(week, template) DO UPDATE SET at = excluded.at`).bind(JSON.stringify(weeks), new Date().toISOString()).run();
  } catch (e) {
    console.error("[reports] could not record the range download", e);
  }
}

export function registerRange(r: Hono<AppEnv>): void {
  r.get("/range/bounds", async (c) => {
    // The earliest session (instants: unixepoch orders any offset) and the earliest note (notes.ts: one naive JST format,
    // so text order is time order), each parsed in JS the way the wall clock reads it.
    const [s, n] = await c.env.DB.batch([
      c.env.DB.prepare("SELECT started_at AS t FROM sessions WHERE hidden = 0 ORDER BY unixepoch(started_at) LIMIT 1"),
      c.env.DB.prepare("SELECT ts AS t FROM notes ORDER BY ts LIMIT 1"),
    ]);
    const times = [
      ...(s.results as Array<{ t: string }>).map((r) => Date.parse(r.t)),
      ...(n.results as Array<{ t: string }>).map((r) => noteMs(r.t)),
    ].filter(Number.isFinite);
    return c.json({ first: times.length ? reportWeekOf(Math.min(...times)) : null, last: reportWeekOf(Date.now()) });
  });

  r.get("/range/xlsx", async (c) => {
    const from = c.req.query("from") ?? "", to = c.req.query("to") ?? "", lang = c.req.query("lang") ?? "ja";
    if (!reportWeekRange(from) || !reportWeekRange(to)) return c.json({ error: "invalid week" }, 400);
    const n = rangeLength(from, to);
    if (n === null) return c.json({ error: "from after to" }, 400);
    if (n > MAX_WEEKS) return c.json({ error: "too many weeks" }, 400);   // counted before rangeWeeks walks it
    const weeks = rangeWeeks(from, to)!;
    if (!isLang(lang)) return c.json({ error: "invalid lang" }, 400);
    const data = await loadRange(c.env.DB, weeks, lang, jstNow().date);
    const body = await renderRangeXlsx(data, lang);
    await recordRange(c.env.DB, weeks);
    return c.body(body, 200, { "Content-Type": XLSX_TYPE, "Content-Disposition": `attachment; filename="${from}_${to}-${lang}.xlsx"` });
  });
}
