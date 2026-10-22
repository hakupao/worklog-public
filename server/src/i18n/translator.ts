import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LANGS, type Lang } from "./langs";
import { SOURCES, type Entity } from "./registry";

export const MODEL = "claude-opus-5-5";

export type Translated = { source: Lang; zh: string; ja: string; en: string };
export class TranslateFormatError extends Error {}

const SYSTEM = `You translate short work-log text for a bilingual (Chinese/Japanese) software engineer's work tracker.
Return the text in Simplified Chinese (zh), Japanese (ja) and English (en), and name the language the input is written in (source).
Rules:
- Keep person names, company names, product and project names, file paths, code, identifiers, IDs, version numbers, commit hashes, URLs, numbers and units exactly as written.
- Keep quoted folder names, file names and 案件 names (in 「…」, 『…』, "…") exactly as in the original; a translation may follow in parentheses.
- Keep domain abbreviations as they are (SDTM, ADaM, SEND, CDISC, WBS, UI, API, CI, PR ...).
- Keep Markdown structure (headings, lists, emphasis, line breaks) exactly.
- Translate meaning, do not add or drop facts, do not explain.
- For the source language, return the input unchanged.`;

const SCHEMA = {
  type: "object",
  properties: {
    source: { type: "string", enum: [...LANGS] },
    zh: { type: "string" }, ja: { type: "string" }, en: { type: "string" },
  },
  required: ["source", "zh", "ja", "en"],
  additionalProperties: false,
} as const;

const Reply = z.object({ source: z.enum(LANGS), zh: z.string(), ja: z.string(), en: z.string() });

const KIND: Record<Entity, string> = {
  task: "a task (案件) field", note: "a progress note", plan_item: "a plan item", day_plan_item: "a daily plan entry",
  session: "a one-line summary of an AI coding session", weekly_review: "a weekly review in Markdown", report_override: "a cell of a weekly report",
  digest: "a one-sentence summary of a work day or week",
};

/** The user message's head: the kind, plus the field's style note when the registry gives one (other fields unchanged).
 *  A field outside the registry (e.g. pdf_compose) has none. */
const head = (entity: Entity, field: string) => {
  const style = SOURCES.find((s) => s.entity === entity && s.field === field)?.style;
  return `Kind: ${KIND[entity]} (${field}).${style ? `\nStyle: ${style}` : ""}`;
};

/** One 案件's name in the three languages: an optional glossary entry for translate(). */
export type NameGlossary = Array<Record<Lang, string>>;

/** `names` (optional): a glossary of 案件 names, one {ja, zh, en} per 案件, added to the user message so the model uses
 *  exactly these names in each language. Without it the request is exactly as before. `timeoutMs` (optional) replaces
 *  the per-kind request timeout (a caller that waits for the answer inside a request keeps it short). */
export async function translate(client: Anthropic, text: string, entity: Entity, field: string, names?: NameGlossary, timeoutMs?: number): Promise<Translated> {
  const glossary = names?.length
    ? `\nNames: use exactly these names for these 案件 in each language:\n${names.map((n) => `- ja: ${n.ja} / zh: ${n.zh} / en: ${n.en}`).join("\n")}`
    : "";
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: entity === "weekly_review" || entity === "digest" ? 8000 : 2000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: `${head(entity, field)}\n<text>\n${text}\n</text>${glossary}` }],
  }, { timeout: timeoutMs ?? (entity === "weekly_review" || entity === "digest" ? 180_000 : 60_000) });
  const block = res.content.find((b) => b.type === "text");
  let parsed: z.infer<typeof Reply>;
  try {
    parsed = Reply.parse(JSON.parse(block && block.type === "text" ? block.text : ""));
  } catch (e) {
    throw new TranslateFormatError(`bad translation reply (stop_reason ${res.stop_reason}): ${String(e).slice(0, 200)}`);
  }
  const out: Translated = { ...parsed, zh: parsed.zh.trim(), ja: parsed.ja.trim(), en: parsed.en.trim() };
  out[parsed.source] = text;   // source slot stays the verbatim input
  return out;
}

export type Polished = Translated & { polished: string };

/** The polish may not grow past this many code points (n = the trimmed input's length): a guard against padding.
 *  Checked on the rule-A sample before it was trusted (input polish §10). */
export const polishLimit = (n: number) => Math.max(2 * n, n + 40);
const cps = (s: string) => [...s].length;

const POLISH_SYSTEM = `You polish, then translate, short text a software engineer typed in a hurry into a work tracker.
Step 1 — polish the input in its own language: rewrite it into concise, plain work language (書き言葉 for Japanese, 书面语 for Chinese, plain business English for English).
Polish rules:
- Fix typos and broken grammar. Expand obvious shorthand only when it is unambiguous.
- Keep it as short as the input or shorter; a title stays a title-length noun phrase, a goal stays a goal.
- Never add facts, goals, numbers, reasons or politeness that are not in the input. Never drop a fact.
- If the input is already clear work language, return it unchanged.
Step 2 — translate the polished text under these rules:
${SYSTEM.split("\n").slice(2).join("\n").replace("- For the source language, return the input unchanged.", "- For the source language, return the polished text.")}
Return "polished" (the Step 1 result), the three languages, and the language the input is written in (source).`;

const POLISH_SCHEMA = {
  type: "object",
  properties: {
    source: { type: "string", enum: [...LANGS] },
    polished: { type: "string" },
    zh: { type: "string" }, ja: { type: "string" }, en: { type: "string" },
  },
  required: ["source", "polished", "zh", "ja", "en"],
  additionalProperties: false,
} as const;

const PolishReply = Reply.extend({ polished: z.string() });

/** One call: polish `text` in its own language, then zh / ja / en made from the polish (input polish §10).
 *  The source slot is the polished text. Throws TranslateFormatError on a bad reply, an empty slot or a polish
 *  past polishLimit, so the sweep's backoff (and, after 3 tries, its translate-only fallback) applies. */
export async function polishAndTranslate(client: Anthropic, text: string, entity: Entity, field: string): Promise<Polished> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: entity === "digest" ? 8000 : 2000,
    system: POLISH_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: POLISH_SCHEMA } },
    messages: [{ role: "user", content: `${head(entity, field)}\n<text>\n${text}\n</text>` }],
  }, { timeout: entity === "digest" ? 180_000 : 60_000 });
  const block = res.content.find((b) => b.type === "text");
  let parsed: z.infer<typeof PolishReply>;
  try {
    parsed = PolishReply.parse(JSON.parse(block && block.type === "text" ? block.text : ""));
  } catch (e) {
    throw new TranslateFormatError(`bad polish reply (stop_reason ${res.stop_reason}): ${String(e).slice(0, 200)}`);
  }
  const polished = parsed.polished.trim();
  const out: Polished = { source: parsed.source, polished, zh: parsed.zh.trim(), ja: parsed.ja.trim(), en: parsed.en.trim() };
  out[parsed.source] = polished;
  if (!polished || !out.zh || !out.ja || !out.en) throw new TranslateFormatError("empty slot in polish reply");
  if (cps(polished) > polishLimit(cps(text.trim()))) throw new TranslateFormatError(`polish too long: ${cps(polished)} > ${polishLimit(cps(text.trim()))}`);
  return out;
}
