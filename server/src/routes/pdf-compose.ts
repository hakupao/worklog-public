// The PDF composer's routes (spec 2026-10-09 §5). registerCompose runs before reports' /:week/:template, which would
// otherwise read "pdf" as a template.
import Anthropic from "@anthropic-ai/sdk";
import type { Context, Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { LANGS, isLang, type Lang } from "../i18n/langs";
import { localize } from "../i18n/store";
import { MODEL, translate } from "../i18n/translator";
import { loadDigestContext } from "../report/digest-context";
import { digestInputs, digestsOf, hashOf, loadInputs } from "../report/digests";
import { parseStoredPrefs } from "../prefs/schema";
import { jstNow } from "../jst";
import { pdfDataComposed, pdfDataOf, type PdfData } from "../report/pdf/data";
import { renderReportHtml } from "../report/pdf/html";
import { LABELS } from "../report/labels";
import { assembleText, checkReply, fitToCap, longLine, checkRetranslated, composePrompt, fromMarkdown, generateText, mentionsHidden, namedIn, rewriteHeads, toMarkdown, unownedText, withoutHidden, withoutHiddenCtx, type ComposeDraft, type Names } from "../report/compose/generate";
import { UNASSIGNED, fitItems, selectionHash, validateItems, workedOf, type ComposeItem, type Mode, type Worked } from "../report/compose/selection";
import { LOCK_MS, TRANSLATE_MS, loadRow, previousItems, putItems, releaseLock, takeLock, writeEdit, writeGenerated, writeTranslated, type ComposeText, type LangText } from "../report/compose/store";
import { reportWeekRange } from "../report/week";
import type { WeekData } from "../report/types";
import { buildWeek } from "../report/weekly";

export interface ComposeOut {
  week: string; inherited: boolean; updated_at: string | null;
  items: { id: string; mode: Mode; title: string; requester: string; minutes: number }[];
  text: LangText | null; edited: boolean; generated_at: string | null; generating: boolean; translating: boolean; translate_failed: boolean;
  stale: { selection: boolean; inputs: boolean };
}

/** A retry after a failed check only starts this soon after the lock was taken: two model calls stay well inside the
 *  lock (LOCK_MS) and the response inside Cloudflare's ~100 s edge timeout. */
const RETRY_BEFORE_MS = 50_000;

export const composeDeps = {
  /** The clock the generate route reads (tests move it). */
  now: (): number => Date.now(),
  /** The model client; tests replace it. null = no API key (generation unavailable). */
  client: (env: Env): Anthropic | null => (env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 0 }) : null),
};

const langQ = (c: Context<AppEnv>): Lang | null => { const v = c.req.query("lang") ?? "ja"; return isLang(v) ? v : null; };
const live = (at: string | null, ttl = LOCK_MS, now = Date.now()) => at !== null && now - Date.parse(at) < ttl;
/** The retranslation's own timeout: the hand-edit PUT waits for it, inside Cloudflare's ~100 s edge timeout. */
const RETRANSLATE_TIMEOUT_MS = 60_000;

/** The hash of the week's digest inputs (all 案件, before any are hidden): a change means the text may be out of date. */
export const inputsHashOf = (inputs: { days: Record<string, string>; weekOf: (t: Record<string, string>) => string }) =>
  hashOf(JSON.stringify({ days: inputs.days, week: inputs.weekOf({}) }));

/** The composer as the page shows it, in `lang`; null for a week that is not an ISO week. `inputsHash` = the week's
 *  current inputsHashOf, when the caller already has it (saves rebuilding the week's inputs). */
export async function composeView(db: D1Database, week: string, lang: Lang, inputsHash?: string): Promise<ComposeOut | null> {
  const data = await buildWeek(db, week, lang, { history: false });
  if (!data) return null;
  const worked = workedOf(data, LABELS[lang].unassigned);
  const row = await loadRow(db, week);
  const items = fitItems(row ? row.items : await previousItems(db, week), worked);
  const byId = new Map(worked.map((x) => [x.id, x]));
  let inputs = false;
  if (row?.text && row.gen_inputs_hash) {
    const loaded = inputsHash === undefined ? await loadInputs(db, week) : null;
    const current = inputsHash ?? (loaded ? await inputsHashOf(loaded.inputs) : null);
    inputs = current !== null && row.gen_inputs_hash !== current;
  }
  return {
    week, inherited: row === null, updated_at: row?.updated_at ?? null,
    items: items.map((i) => { const x = byId.get(i.id)!; return { id: i.id, mode: i.mode, title: x.title, requester: x.requester, minutes: x.minutes }; }),
    text: row?.text ? row.text[lang] : null, edited: row?.edited ?? false, generated_at: row?.generated_at ?? null,
    generating: live(row?.generating_at ?? null), translating: live(row?.translating_at ?? null, TRANSLATE_MS),
    // a translating_at past TRANSLATE_MS was left by a request that died before writing its outcome
    translate_failed: (row?.translate_failed ?? false) || (!!row?.translating_at && !live(row.translating_at, TRANSLATE_MS)),
    stale: { selection: !!row?.text && row.gen_selection_hash !== await selectionHash(items), inputs },
  };
}

/** What the PDF of `week` shows in `lang`: the composition when its row has text (or a draft selection is given),
 *  else exactly today's data. A draft without generated text uses the digests' PDF lines (spec §3.3, decision 7).
 *  `raw` = the week built without a language (the caller may already have it). Items are deduplicated (first wins) and fitted to the week's current worked set, so the table reconciles with the total. */
export async function composedPdfData(db: D1Database, week: string, lang: Lang, draft?: ComposeItem[], raw?: WeekData): Promise<PdfData> {
  const data = (await buildWeek(db, week, lang, { history: false }))!;
  const prefs = parseStoredPrefs((await db.prepare("SELECT json FROM prefs WHERE id = 1").first<{ json: string }>())?.json);
  const o = { lang, issued: jstNow().date, name: prefs.report.name };
  // A deploy that precedes the migration has no pdf_compose table yet: print today's PDF.
  const row = await loadRow(db, week).catch((e) => { console.error("[pdf] could not read the composition", e); return null; });
  const base = draft ?? (row?.text ? row.items : null);
  const seen = new Set<string>();
  const items = base && fitItems(base.filter((i) => !seen.has(i.id) && !!seen.add(i.id)), workedOf(data, LABELS[lang].unassigned));
  const digests = () => digestsOf(db, week, lang, async () => {
    const w = raw ?? (await buildWeek(db, week, null, { history: false }))!;   // the source-text data, built at most once
    return digestInputs(w, await loadDigestContext(db, week, w.dates));
  }).catch((e) => {
    console.error("[pdf] could not read the digests", e);
    return { week: null, days: {} };
  });
  if (!items) return pdfDataOf(data, await digests(), o);
  const text = row?.text?.[lang] ?? null;
  if (text) return pdfDataComposed(data, items, text, o);
  const plain = pdfDataOf(data, await digests(), o);
  return pdfDataComposed(data, items, { summary: plain.summary, days: Object.fromEntries(plain.days.map((x) => [x.date, x.text])) }, o);
}

/** The worked 案件's names in the three languages (zh / en from the 案件 translations; the stored title when none). */
async function namesOf(db: D1Database, worked: Worked[]): Promise<Names> {
  const refs = worked.filter((x) => x.id !== UNASSIGNED).map((x) => ({ id: x.id, title: x.title }));
  const [zh, en] = await Promise.all([localize(db, "zh", "task", refs, ["title"]), localize(db, "en", "task", refs, ["title"])]);
  return Object.fromEntries(refs.map((x, i) => [x.id, { ja: x.title, zh: zh[i].title, en: en[i].title }]));
}

/** After a hand edit in `lang`: the other two languages from the translator, written only while that edit is still
 *  the latest (writeTranslated checks translating_at). Any failure keeps their old text, clears the flag and marks
 *  the row translate_failed. The translator is given the names of the 案件 the edit names; each summary head is then
 *  put back to its 案件's canonical name (rewriteHeads). A reply whose detected source is not `lang` is a failure, and so
 *  is one that still loses a 案件 name of the edit (checkRetranslated: a folded name cut in その他, a head missing). */
export async function retranslate(db: D1Database, client: Anthropic, week: string, lang: Lang, editedAt: string): Promise<void> {
  let out: ComposeText | null = null;
  try {
    const row = await loadRow(db, week);
    if (!row?.text || row.translating_at !== editedAt) return;
    const src = row.text[lang];
    const names = await namesOf(db, workedOf((await buildWeek(db, week, null, { history: false }))!, LABELS.ja.unassigned));
    // the translator gets the names of every 案件 the edit names (heads and その他) as a glossary
    const { heads, folded } = namedIn(src, lang, names);
    const glossary = [...new Set([...heads.filter((x): x is string => !!x), ...folded])].map((id) => names[id]);
    const tr = await translate(client, toMarkdown(src), "digest", "pdf_compose", glossary, RETRANSLATE_TIMEOUT_MS);
    if (tr.source !== lang) throw new Error(`translator read the text as ${tr.source}, not ${lang}`);
    const next = { ...row.text } as ComposeText;
    for (const l of LANGS) {
      if (l === lang) continue;
      const parsed = fromMarkdown(tr[l], src);
      if (!parsed) throw new Error(`structure changed in ${l}`);
      const t = rewriteHeads(src, lang, parsed, l, names);
      const reason = checkRetranslated(src, lang, t, l, names);
      if (reason) throw new Error(`retranslation lost a 案件 name of the edit: ${reason}`);
      next[l] = t;
    }
    out = next;
  } catch (e) {
    console.error("[compose] retranslate failed", week, e);
  }
  await writeTranslated(db, week, editedAt, out);
}

export function registerCompose(r: Hono<AppEnv>): void {
  r.get("/:week/pdf/compose", async (c) => {
    const week = c.req.param("week"), lang = langQ(c);
    if (!lang) return c.json({ error: "invalid lang" }, 400);
    if (!reportWeekRange(week)) return c.json({ error: "invalid week" }, 400);
    return c.json((await composeView(c.env.DB, week, lang))!);
  });

  r.put("/:week/pdf/compose", async (c) => {
    const week = c.req.param("week"), lang = langQ(c), db = c.env.DB;
    if (!lang) return c.json({ error: "invalid lang" }, 400);
    if (!reportWeekRange(week)) return c.json({ error: "invalid week" }, 400);
    const body = await c.req.json().catch(() => null) as { items?: unknown; updated_at?: unknown } | null;
    const token = typeof body?.updated_at === "string" ? body.updated_at : null;
    const data = (await buildWeek(db, week, null, { history: false }))!;
    const v = validateItems(body?.items, workedOf(data, LABELS.ja.unassigned));
    if (!v.ok) return c.json({ error: v.error }, 400);
    if (!(await putItems(db, week, v.items, token, new Date().toISOString()))) {
      return c.json({ error: "conflict", current: await composeView(db, week, lang) }, 409);
    }
    return c.json((await composeView(db, week, lang))!);
  });

  // One model call writes the text for the current selection (spec §5.3). Hidden 案件 never reach the model; the reply
  // is checked (checkReply) before it is stored. The lock is freed on every exit but success (writeGenerated frees it).
  r.post("/:week/pdf/compose/generate", async (c) => {
    const week = c.req.param("week"), lang = langQ(c), db = c.env.DB;
    if (!lang) return c.json({ error: "invalid lang" }, 400);
    if (!reportWeekRange(week)) return c.json({ error: "invalid week" }, 400);
    const client = composeDeps.client(c.env);
    if (!client) return c.json({ error: "generation unavailable" }, 503);
    const loaded = (await loadInputs(db, week))!;
    const worked = workedOf(loaded.data, LABELS.ja.unassigned);
    const row = await loadRow(db, week);
    const items = fitItems(row ? row.items : await previousItems(db, week), worked);
    // Nothing to write about: no 案件 left once hidden ones and 未関連 are set aside.
    if (!items.some((i) => i.mode !== "hide" && i.id !== UNASSIGNED)) return c.json({ error: "nothing to generate" }, 422);
    const lockedAt = new Date(composeDeps.now());
    if (!(await takeLock(db, week, items, lockedAt))) return c.json({ error: "generating" }, 409);
    let written = false;
    try {
      const names = await namesOf(db, worked);
      const hidden = new Set(items.filter((i) => i.mode === "hide").map((i) => i.id));
      const nm = (ids: Iterable<string>) => [...ids].flatMap((id) => (names[id] ? Object.values(names[id]) : []));
      const hiddenNames = nm(hidden), allowedNames = nm(items.filter((i) => i.mode !== "hide").map((i) => i.id));
      const ctx = withoutHiddenCtx(loaded.ctx, hidden, hiddenNames, allowedNames);
      const inputs = digestInputs(withoutHidden(loaded.data, items), ctx);
      const dates = Object.keys(inputs.days);
      const prompt = composePrompt(inputs, items, names);
      // Spec decision 6 as a check, not a convention: a hidden name (any language) left in a prompt part no shown /
      // folded 案件 owns (unownedText) means the model is not called at all. Their own blocks may use the same word.
      const owned = new Set(items.filter((i) => i.mode !== "hide" && i.id !== UNASSIGNED).map((i) => i.id));
      const leak = mentionsHidden(unownedText(ctx, owned, dates), hiddenNames, allowedNames);
      if (leak !== null) {
        console.error("[compose] hidden leak: a hidden 案件's name is in the prompt; not sent", week, leak);
        return c.json({ error: "hidden leak" }, 500);
      }
      // A reply that does not follow the selection, or whose assembled summary has a line over FIT_CAP, is logged
      // (reason + reply) and asked for once more with the same prompt — only within RETRY_BEFORE_MS of the lock. A
      // structurally wrong reply is a 502; one that is only too long is degraded to fit (fitToCap) and stored.
      const ids = items.filter((i) => (i.mode === "show" || i.mode === "other") && i.id !== UNASSIGNED).map((i) => i.id);
      const folded = items.filter((i) => i.mode === "other" && i.id !== UNASSIGNED).map((i) => i.id);
      const attempt = async () => {
        const draft = await generateText(client, prompt, dates, ids);
        const bad = checkReply(draft, items, names);
        if (bad) return { draft, reason: bad, valid: false };
        const long = longLine(assembleText(draft, folded, names), folded, names);
        return { draft, reason: long, valid: true };
      };
      const replyLen = (d: ComposeDraft) => JSON.stringify(d).length;
      let a = await attempt();
      if (a.reason) {
        if (composeDeps.now() - lockedAt.getTime() < RETRY_BEFORE_MS) {
          console.error("[compose] reply failed the check; retrying once", week, a.reason, "reply length", replyLen(a.draft));
          // A retry that throws (bad JSON, a missing day, a timeout) must not lose a first reply that was only too long.
          let b: Awaited<ReturnType<typeof attempt>> | null = null;
          try {
            b = await attempt();
          } catch (e) {
            if (!a.valid) throw e;
            console.error("[compose] the retry threw; degrading the first reply", week, String(e).slice(0, 200));
          }
          if (b?.reason) console.error("[compose] the retry failed the check too", week, b.reason, "reply length", replyLen(b.draft));
          if (b && (b.valid || !a.valid)) a = b;   // the retry, unless it broke a reply that was only too long
        } else {
          console.error("[compose] reply failed the check; too late to retry", week, a.reason, "reply length", replyLen(a.draft));
        }
      }
      if (!a.valid) return c.json({ error: "generate failed", reason: a.reason }, 502);
      const fitted = fitToCap(a.draft, folded, names);
      for (const n of fitted.notes) console.error("[compose] degraded to fit the PDF", week, n);
      const text = fitted.text;
      // Hashed before hiding: composeView compares against the full week's inputs.
      const inputsHash = await inputsHashOf(loaded.inputs);
      // A lock taken over meanwhile (this request outlived LOCK_MS) is the newer request's: write nothing.
      if (!(await writeGenerated(db, week, { text, selHash: await selectionHash(items), inputsHash, model: MODEL },
        new Date().toISOString(), lockedAt.toISOString()))) return c.json({ error: "generating" }, 409);
      written = true;
      return c.json((await composeView(db, week, lang, inputsHash))!);
    } catch (e) {
      console.error("[compose] generate failed", week, e);
      return c.json({ error: "generate failed", reason: String(e).slice(0, 200) }, 502);
    } finally {
      if (!written) await releaseLock(db, week, lockedAt.toISOString());
    }
  });

  // A hand edit of one language; the other two are retranslated (retranslate) before the answer, which is the view
  // with the outcome (translating false; translate_failed when it failed). Waiting here, not in waitUntil: a background
  // job can be cut ~30 s after the response, leaving the other two languages silently stale. Meanwhile translating_at
  // is set, so another tab's GET shows 翻译中. Refused (409) while a generation holds the lock: it would overwrite the edit.
  r.put("/:week/pdf/compose/text", async (c) => {
    const week = c.req.param("week"), db = c.env.DB;
    const range = reportWeekRange(week);
    if (!range) return c.json({ error: "invalid week" }, 400);
    const b = await c.req.json().catch(() => null) as { lang?: unknown; summary?: unknown; days?: unknown } | null;
    const okLines = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");
    const days = b?.days && typeof b.days === "object" && !Array.isArray(b.days) ? b.days as Record<string, unknown> : null;
    if (!b || !isLang(b.lang) || !okLines(b.summary) || !days || !Object.entries(days).every(([d, v]) => range.days.includes(d) && okLines(v))) {
      return c.json({ error: "invalid text" }, 400);
    }
    const row = await loadRow(db, week);
    if (!row?.text) return c.json({ error: "not found" }, 404);
    if (live(row.generating_at)) return c.json({ error: "generating" }, 409);
    const clean = (l: string[]) => l.map((s) => s.trim()).filter(Boolean);
    const now = new Date().toISOString();
    await writeEdit(db, week, b.lang, { summary: clean(b.summary), days: Object.fromEntries(Object.entries(days).map(([d, v]) => [d, clean(v as string[])])) }, now);
    const client = composeDeps.client(c.env);
    if (client) await retranslate(db, client, week, b.lang, now);
    else await writeTranslated(db, week, now, null);
    return c.json((await composeView(db, week, b.lang))!);
  });

  r.post("/:week/pdf/preview", async (c) => {
    const week = c.req.param("week"), lang = langQ(c), db = c.env.DB;
    if (!lang) return c.json({ error: "invalid lang" }, 400);
    if (!reportWeekRange(week)) return c.json({ error: "invalid week" }, 400);
    const body = await c.req.json().catch(() => null) as { items?: unknown } | null;
    const data = (await buildWeek(db, week, null, { history: false }))!;
    const v = validateItems(body?.items, workedOf(data, LABELS.ja.unassigned));
    if (!v.ok) return c.json({ error: v.error }, 400);
    return c.html(renderReportHtml(await composedPdfData(db, week, lang, v.items, data)));
  });
}
