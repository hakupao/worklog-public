import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { isLang, langOf, type Lang } from "../i18n/langs";
import { overrideId } from "../i18n/registry";
import { dropUnchanged, localize } from "../i18n/store";
import { translateSoon } from "../i18n/sweep";
import { weekRange } from "../jst";
import { loadDigestContext } from "../report/digest-context";
import { DIGEST_SCHEMA, DIGEST_SCHEMA_WEEK, LIMITS, ONELINER_CAP, SYSTEM_DAY, SYSTEM_ONELINER, SYSTEM_WEEK, autoDigests, capLines, digestId, digestInputs, digestOne, digestsOf, hashOf, loadInputs, refreshDigests, weekInputOf } from "../report/digests";
import { LABELS, type Labels } from "../report/labels";
import { layoutSheets } from "../report/layout";
import { applyOverrides, deleteOverride, loadOverrides, putOverride } from "../report/overrides";
import { PdfBusy, pdfDeps } from "../report/pdf/browser";
import { renderReportHtml } from "../report/pdf/html";
import { TEMPLATES, TEMPLATE_ALIASES } from "../report/templates";
import type { ReportPreview, Template, TemplateKey } from "../report/types";
import { reportWeekRange } from "../report/week";
import { buildWeek } from "../report/weekly";
import { renderXlsx } from "../report/xlsx";
import { composedPdfData, registerCompose } from "./pdf-compose";
import { registerRange } from "./report-range";
import { DigestGenerated, DigestPatch, OverrideDelete, OverridePut, invalid } from "../schemas";

export const reports = new Hono<AppEnv>();
// /range/* before /:week/:template (which would read "range" as a week).
registerRange(reports);

/** Remembers a week's last successful xlsx or PDF download (migration 0010; rows from before the templates
 *  merged say 'agency' / 'site' — any row of a week counts as downloaded). Never fails the download itself: a
 *  missing table (code deployed before the migration) only logs. */
async function recordDownload(db: D1Database, week: string, template: TemplateKey | "pdf"): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO report_downloads (week, template, at) VALUES (?1, ?2, ?3)
       ON CONFLICT(week, template) DO UPDATE SET at = excluded.at`,
    ).bind(week, template, new Date().toISOString()).run();
  } catch (e) {
    console.error("[reports] could not record the download", e);
  }
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Target = { week: string; key: TemplateKey; template: Template };

/**
 * The report a request names, or the 404 saying there is no such report. A retired template name
 * (agency / site) is the one template, so its edits and downloads are stored under `weekly` too.
 *
 * `Object.hasOwn`, not `in`: every object answers to "toString", and a report template does not.
 * The week is not checked here because each route can only say what it is asked to do with it.
 */
function target(c: Context<AppEnv>, week: string, name: string): Target | Response {
  const key = Object.hasOwn(TEMPLATE_ALIASES, name) ? TEMPLATE_ALIASES[name] : name;
  if (!Object.hasOwn(TEMPLATES, key)) return c.json({ error: "not found" }, 404);
  return { week, key: key as TemplateKey, template: TEMPLATES[key as TemplateKey] };
}

/** An export's language: ?lang=zh|ja|en, Japanese when absent (design D5), null when it is anything else. */
const exportLang = (c: Context<AppEnv>): Lang | null => {
  const v = c.req.query("lang") ?? "ja";
  return isLang(v) ? v : null;
};
const invalidLang = (c: Context<AppEnv>) => c.json({ error: "invalid lang" }, 400);

const invalidWeek = (c: Context<AppEnv>) => c.json({ error: "invalid week" }, 400);

/** The week's sheets with every stored edit applied, or null when the week is not an ISO week.
 *  Data text and edited cells are both in `lang` (null = source text). */
async function sheetsOf(c: Context<AppEnv>, t: Target, lang: Lang | null, L?: Labels) {
  const data = await buildWeek(c.env.DB, t.week, lang);
  if (!data) return null;
  const overrides = await localize(c.env.DB, lang, "report_override", await loadOverrides(c.env.DB, t.week, t.key), ["value"],
    (r) => overrideId(t.week, t.key, r.sheet, r.row_key, r.column), { meta: true });
  return { data, sheets: applyOverrides(layoutSheets(data, t.template, L), overrides) };
}

// A hand edit of a digest line (`:day` = a date of the report week, or `week`), or handing it back to
// the cron. Registered before /:week/:template so "digests" is never read as a template.
reports.patch("/:week/digests/:day", async (c) => {
  const week = c.req.param("week"), param = c.req.param("day");
  const range = reportWeekRange(week);
  if (!range) return invalidWeek(c);
  if (param !== "week" && !range.days.includes(param)) return c.json({ error: "invalid day" }, 400);
  const day = param === "week" ? "" : param, id = digestId(week, day), db = c.env.DB, lang = langOf(c);
  const parsed = DigestPatch.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const now = new Date().toISOString();
  if ("oneliner" in parsed.data) {
    if (day !== "") return c.json({ error: "oneliner is week-only" }, 400);
    const exists = await db.prepare("SELECT 1 AS x FROM report_digests WHERE week = ?1 AND day = ''").bind(week).first();
    if (!exists) return c.json({ error: "not found" }, 404);
    const patch: Record<string, unknown> = { ...parsed.data };
    await dropUnchanged(db, lang, "digest", id, patch, { oneliner: "oneliner" });
    if (patch.oneliner === "") {
      // cleared: back to generation (the next local run writes one; the xlsx names the main 案件 meanwhile)
      await db.prepare("UPDATE report_digests SET oneliner = NULL, oneliner_edited = 0, updated_at = ?2 WHERE week = ?1 AND day = ''")
        .bind(week, now).run();
    } else if (typeof patch.oneliner === "string") {
      await db.prepare("UPDATE report_digests SET oneliner = ?2, oneliner_edited = 1, updated_at = ?3 WHERE week = ?1 AND day = ''")
        .bind(week, patch.oneliner, now).run();
      translateSoon(c, "digest", id);
    }
    return c.json(await digestOne(db, week, day, lang));
  }
  if ("text" in parsed.data) {
    const exists = await db.prepare("SELECT 1 AS x FROM report_digests WHERE week = ?1 AND day = ?2").bind(week, day).first();
    if (!exists) return c.json({ error: "not found" }, 404);
    const patch: Record<string, unknown> = { ...parsed.data };
    await dropUnchanged(db, lang, "digest", id, patch, { text: "text" });
    if (typeof patch.text === "string") {
      // an AI oneliner described the old text: dropped like pdf_text (the next local run writes one); a hand-edited one stays
      await db.prepare(`UPDATE report_digests SET text = ?3, pdf_text = NULL,
                          oneliner = CASE WHEN oneliner_edited = 1 THEN oneliner ELSE NULL END, edited = 1, updated_at = ?4
                        WHERE week = ?1 AND day = ?2`)
        .bind(week, day, patch.text, now).run();
      translateSoon(c, "digest", id);
    }
  } else {
    // A day with no line yet is fine: the refresh creates it (the answer is then just { auto }). `auto` says whether
    // a refresh runs now (DIGESTS_AUTO on) or the line is only marked for the next local generation (R12).
    // the oneliner goes back to generation with the text (day rows never hold one)
    await db.prepare("UPDATE report_digests SET edited = 0, inputs_hash = '', oneliner_edited = 0, updated_at = ?3 WHERE week = ?1 AND day = ?2")
      .bind(week, day, now).run();
    const auto = autoDigests(c.env);
    if (auto) {
      try {
        c.executionCtx.waitUntil(refreshDigests(c.env, week).catch((e) => console.error("[digest] regenerate", e)));
      } catch { /* no execution context */ }
    }
    return c.json({ ...(await digestOne(db, week, day, lang)), auto });
  }
  return c.json(await digestOne(db, week, day, lang));
});

// What the local generator reads: every worked day's input with its hash and stored state, then the week's input
// (built from the stored day lines exactly as refreshDigests does). Registered before /:week/:template.
reports.get("/:week/digest-inputs", async (c) => {
  const week = c.req.param("week"), db = c.env.DB;
  const loaded = await loadInputs(db, week);
  if (!loaded) return invalidWeek(c);
  const rows = new Map((await db.prepare("SELECT day, text, pdf_text, inputs_hash, edited, oneliner, oneliner_edited FROM report_digests WHERE week = ?1")
    .bind(week).all<{ day: string; text: string; pdf_text: string | null; inputs_hash: string; edited: number; oneliner: string | null; oneliner_edited: number }>())
    .results.map((r) => [r.day, r]));
  const item = async (day: string, input: string) => {
    const hash = await hashOf(input), r = rows.get(day);
    return { day, input, hash, text: r?.text ?? null, edited: r?.edited === 1,
      fresh: !!r && r.edited === 0 && r.inputs_hash === hash, pdf_missing: !!r && r.edited === 1 && r.pdf_text === null,
      // a stored week line with no oneliner and none written by hand: what oneliner_only fills
      oneliner: day === "" ? r?.oneliner ?? null : null,
      oneliner_missing: day === "" && !!r && r.oneliner === null && r.oneliner_edited === 0 };
  };
  const items = [];
  for (const [date, input] of Object.entries(loaded.inputs.days)) items.push(await item(date, input));
  const dayTexts = Object.fromEntries([...rows].filter(([d]) => d !== "").map(([d, r]) => [d, r.text]));
  if (Object.keys(loaded.inputs.days).some((d) => d in dayTexts)) items.push(await item("", weekInputOf(loaded.inputs, dayTexts)));
  // R15: each worked task's title in ja / zh / en, localized as the preview and the PDF do (two batched reads; the original when untranslated).
  const byId = new Map(loaded.data.tasks.map((r) => [r.task.id, r.task.title]));
  const ids = new Set(loaded.data.tasks.filter((r) => r.week_minutes > 0).map((r) => r.task.id));
  for (const r of loaded.data.days) if (r.task_id !== null && byId.has(r.task_id)) ids.add(r.task_id);
  const refs = [...ids].map((id) => ({ id, title: byId.get(id)! }));
  const [zh, en] = await Promise.all([localize(db, "zh", "task", refs, ["title"]), localize(db, "en", "task", refs, ["title"])]);
  const names = refs.map((r, i) => ({ ja: r.title, zh: zh[i].title, en: en[i].title }));
  return c.json({ week, system: { day: SYSTEM_DAY, week: SYSTEM_WEEK, oneliner: SYSTEM_ONELINER }, schema: { day: DIGEST_SCHEMA, week: DIGEST_SCHEMA_WEEK }, limits: LIMITS, items, names });
});

// The local generator writes a digest back (and its translations). Refuses a stale input and a hand edit.
reports.put("/:week/digests/:day/generated", async (c) => {
  const week = c.req.param("week"), param = c.req.param("day");
  const range = reportWeekRange(week);
  if (!range) return invalidWeek(c);
  if (param !== "week" && !range.days.includes(param)) return c.json({ error: "invalid day" }, 400);
  const day = param === "week" ? "" : param, id = digestId(week, day), db = c.env.DB;
  const kind = day === "" ? "week" : "day";
  const parsed = DigestGenerated.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const body = parsed.data, now = new Date().toISOString();
  const cur = await db.prepare("SELECT text, edited, oneliner, oneliner_edited FROM report_digests WHERE week = ?1 AND day = ?2").bind(week, day)
    .first<{ text: string; edited: number; oneliner: string | null; oneliner_edited: number }>();
  // Written only while the digest row holds exactly the text just written and is not hand-edited, so a PATCH that
  // lands between the checks above and this batch can never be overwritten, nor get translations of lines it replaced.
  // A oneliner's translations are written only while it is the AI one just stored.
  const guard = (field: "text" | "pdf_text" | "oneliner") =>
    field === "oneliner" ? "oneliner = ?3 AND oneliner_edited = 0" : `${field} = ?3${"pdf_only" in body ? "" : " AND edited = 0"}`;
  const tr = (field: "text" | "pdf_text" | "oneliner", source: string, zh: string, en: string, model: string) => db.prepare(
    `INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, failed_text, attempts, next_try_at, last_error, updated_at)
     SELECT 'digest', ?1, ?2, ?3, 'ja', ?4, ?3, ?5, ?6, NULL, 0, NULL, NULL, ?7
     WHERE EXISTS (SELECT 1 FROM report_digests WHERE week = ?8 AND day = ?9 AND ${guard(field)})
     ON CONFLICT(entity, entity_id, field) DO UPDATE SET source_text = excluded.source_text, source_lang = excluded.source_lang,
       zh = excluded.zh, ja = excluded.ja, en = excluded.en, model = excluded.model,
       failed_text = NULL, attempts = 0, next_try_at = NULL, last_error = NULL, updated_at = excluded.updated_at`,
  ).bind(id, field, source, zh, en, model, now, week, day);
  const firstLines = (s: string, n: number) => s.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, n).join("\n");

  if ("pdf_only" in body) {
    if (!cur) return c.json({ error: "not found" }, 404);
    if (cur.text !== body.source_text) return c.json({ error: "stale" }, 409);
    const pdf = capLines(body.pdf_text.split("\n"), LIMITS[kind].pdf), n = pdf.split("\n").length;
    const [upd] = await db.batch([
      db.prepare("UPDATE report_digests SET pdf_text = ?3, updated_at = ?4 WHERE week = ?1 AND day = ?2 AND text = ?5")
        .bind(week, day, pdf, now, body.source_text),
      tr("pdf_text", pdf, firstLines(body.zh.pdf_text, n), firstLines(body.en.pdf_text, n), body.model),
    ]);
    if (upd.meta.changes === 0) return c.json({ error: "stale" }, 409);   // the text moved on in between
    return c.json({ ok: true });
  }

  if ("oneliner_only" in body) {
    if (day !== "") return c.json({ error: "invalid day" }, 400);
    if (!cur) return c.json({ error: "not found" }, 404);
    const one = capLines([body.oneliner], ONELINER_CAP);
    const [upd] = await db.batch([
      db.prepare(`UPDATE report_digests SET oneliner = ?3, updated_at = ?4
                  WHERE week = ?1 AND day = ?2 AND text = ?5 AND oneliner IS NULL AND oneliner_edited = 0`).bind(week, day, one, now, body.source_text),
      tr("oneliner", one, body.zh.oneliner, body.en.oneliner, body.model),
    ]);
    if (upd.meta.changes === 0) return c.json({ error: "stale" }, 409);   // text moved on, already set, or hand-edited
    return c.json({ ok: true });
  }

  // The hash the cron would compute now: the day input, or the week input from the stored day lines.
  const built = (await loadInputs(db, week))!.inputs;
  const stored = (await db.prepare("SELECT day, text FROM report_digests WHERE week = ?1 AND day != ''").bind(week)
    .all<{ day: string; text: string }>()).results;
  const dayTexts = Object.fromEntries(stored.map((r) => [r.day, r.text]));
  const hasInput = day === "" ? Object.keys(built.days).some((d) => d in dayTexts) : day in built.days;
  if (!hasInput) return c.json({ error: "no_input" }, 404);
  const input = day === "" ? weekInputOf(built, dayTexts) : built.days[day];
  if (body.inputs_hash !== await hashOf(input)) return c.json({ error: "stale" }, 409);
  if (cur?.edited === 1) return c.json({ error: "edited" }, 409);
  const text = capLines(body.text.split("\n"), LIMITS[kind].text), pdf = capLines(body.pdf_text.split("\n"), LIMITS[kind].pdf);
  const nText = text.split("\n").length, nPdf = pdf.split("\n").length;
  // The week's oneliner (a day body's is ignored): an absent one stores NULL so a oneliner of the previous text never
  // survives; a hand-edited one is kept.
  const one = day === "" && body.oneliner ? capLines([body.oneliner], ONELINER_CAP) : null;
  const [put] = await db.batch([
    db.prepare(
      `INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at, oneliner)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?7, ?8)
       ON CONFLICT(week, day) DO UPDATE SET text = excluded.text, pdf_text = excluded.pdf_text, inputs_hash = excluded.inputs_hash,
         model = excluded.model, generated_at = excluded.generated_at, updated_at = excluded.updated_at,
         oneliner = CASE WHEN report_digests.oneliner_edited = 1 THEN report_digests.oneliner ELSE excluded.oneliner END
         WHERE report_digests.edited = 0`,
    ).bind(week, day, text, pdf, body.inputs_hash, body.model, now, one),
    tr("text", text, firstLines(body.zh.text, nText), firstLines(body.en.text, nText), body.model),
    tr("pdf_text", pdf, firstLines(body.zh.pdf_text, nPdf), firstLines(body.en.pdf_text, nPdf), body.model),
    ...(one && body.zh.oneliner && body.en.oneliner ? [tr("oneliner", one, body.zh.oneliner, body.en.oneliner, body.model)] : []),
  ]);
  if (put.meta.changes === 0) return c.json({ error: "edited" }, 409);   // hand-edited in between: nothing was written
  return c.json({ ok: true });
});

// The one-page PDF (design 2026-10-08 §4): no template, no report_overrides. Registered before /:week/:template,
// which would otherwise read "pdf" as a template and 404.
reports.get("/:week/pdf", async (c) => {
  const week = c.req.param("week"), db = c.env.DB;
  const lang = exportLang(c);
  if (!lang) return invalidLang(c);
  if (!reportWeekRange(week)) return invalidWeek(c);
  if (!c.env.BROWSER) return c.json({ error: "pdf unavailable" }, 503);
  const html = renderReportHtml(await composedPdfData(db, week, lang));
  try {
    const { pdf } = await pdfDeps.htmlToPdf(c.env.BROWSER, html);
    await recordDownload(db, week, "pdf");
    return c.body(new Uint8Array(pdf), 200, { // a copy: c.body wants an ArrayBuffer-backed view
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${week}-${lang}.pdf"`,
    });
  } catch (e) {
    if (e instanceof PdfBusy) {
      c.header("Retry-After", String(e.retryAfter));
      return c.json({ error: "pdf busy", retry_after: e.retryAfter }, 503);
    }
    console.error("[pdf] render failed", e);
    return c.json({ error: "pdf failed" }, 502);
  }
});

// The PDF composer (spec 2026-10-09): /:week/pdf/compose[/generate|/text] and /:week/pdf/preview.
registerCompose(reports);

reports.get("/:week/:template", async (c) => {
  const t = target(c, c.req.param("week"), c.req.param("template"));
  if (t instanceof Response) return t;
  const lang = langOf(c);
  const built = await sheetsOf(c, t, lang);
  if (!built) return invalidWeek(c);
  // Staleness hashes the source text, so under X-Lang the week is built once more unlocalized (the week alone);
  // without X-Lang built.data serves: the inputs read no 累計, so history on or off gives the same text.
  // The week was checked by sheetsOf, so loadInputs is never null here.
  const inputs = () => lang ? loadInputs(c.env.DB, t.week).then((x) => x!.inputs)
    : loadDigestContext(c.env.DB, t.week, built.data.dates).then((ctx) => digestInputs(built.data, ctx));
  // Like recordDownload: code deployed before migration 0012 (no report_digests) still serves the preview.
  const digests = await digestsOf(c.env.DB, t.week, lang, inputs).catch((e) => {
    console.error("[reports] could not read the digests", e);
    return { week: null, days: {} };
  });
  return c.json({
    week: t.week, template: t.key,
    range: { from: built.data.dates[0], to: built.data.dates[6], dates: built.data.dates },
    sheets: built.sheets,
    unassigned_sessions: built.data.unassigned_sessions,
    unassigned_minutes: built.data.unassigned_minutes,
    digests,
    day_sum_minutes: Object.fromEntries(built.data.day_sum_minutes),
  } satisfies ReportPreview);
});

reports.get("/:week/:template/xlsx", async (c) => {
  const t = target(c, c.req.param("week"), c.req.param("template"));
  if (t instanceof Response) return t;
  const lang = exportLang(c);
  if (!lang) return invalidLang(c);
  const built = await sheetsOf(c, t, lang, LABELS[lang]);
  if (!built) return invalidWeek(c);
  const xlsx = await renderXlsx(built.sheets);
  await recordDownload(c.env.DB, t.week, t.key);
  return c.body(xlsx, 200, {
    "Content-Type": XLSX_TYPE,
    "Content-Disposition": `attachment; filename="${t.week}-${lang}.xlsx"`,
  });
});

// The grid follows the data, so an edit is not checked against the current rows and columns: a
// cell may be edited before the row it names is built, and a row may come and go between requests.
reports.put("/:week/:template/cells", async (c) => {
  const t = target(c, c.req.param("week"), c.req.param("template"));
  if (t instanceof Response) return t;
  if (!weekRange(t.week)) return invalidWeek(c);
  const parsed = OverridePut.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const cell = parsed.data;
  const updated_at = await putOverride(c.env.DB, t.week, t.key, cell);
  translateSoon(c, "report_override", overrideId(t.week, t.key, cell.sheet, cell.row_key, cell.column));
  return c.json({ ok: true, updated_at });
});

reports.delete("/:week/:template/cells", async (c) => {
  const t = target(c, c.req.param("week"), c.req.param("template"));
  if (t instanceof Response) return t;
  if (!weekRange(t.week)) return invalidWeek(c);
  const parsed = OverrideDelete.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error);
  if (!(await deleteOverride(c.env.DB, t.week, t.key, parsed.data))) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ ok: true });
});
