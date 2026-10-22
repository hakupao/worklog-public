// The PDF composer's text (spec 2026-10-09 §6): one model call writes, in ja / zh / en, a body per shown 案件 and per
// folded 案件 (structured by id) and one line per worked day. The server writes every summary head and the その他 line
// from the canonical names (assembleText), so names cannot drift. Hidden 案件 are removed from the input; the reply is
// checked (structurally) before it is stored.
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { LANGS, type Lang } from "../../i18n/langs";
import { MODEL } from "../../i18n/translator";
import type { DigestContext } from "../digest-context";
import { PLAIN, type digestInputs } from "../digests";
import type { WeekData } from "../types";
import { MAX_SUMMARY_LINES, UNASSIGNED, type ComposeItem } from "./selection";
import type { ComposeText, LangText } from "./store";

export const OTHER_HEAD: Record<Lang, string> = { ja: "■ その他", zh: "■ 其他", en: "■ Other" };
export interface Names { [id: string]: Record<Lang, string> }

/** The reply schema for one request: per language `lines` (shown 案件, in order) and `other` (folded 案件) as
 *  { id, text } with ids limited to this selection's. No day lines: the PDF's 日別 row lists each day's 案件 and
 *  hours itself (pdf/data.ts dayLines, user feedback 10/9). */
export function composeSchema(ids: string[]) {
  const item = { type: "object", properties: { id: { type: "string", enum: ids }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: false };
  const one = {
    type: "object",
    properties: {
      lines: { type: "array", items: item },
      other: { type: "array", items: item },
    },
    required: ["lines", "other"], additionalProperties: false,
  };
  return { type: "object", properties: { ja: one, zh: one, en: one }, required: ["ja", "zh", "en"], additionalProperties: false };
}

export const COMPOSE_SYSTEM = `あなたは派遣エンジニアの週報 PDF の文章を書く。入力は「編成」（PDF に単独行で載せる案件とその順番、「その他」にまとめる案件。各案件に id がある）、今週の案件の情報、日ごとの作業記録。
lines：単独行の案件ごとに 1 つ、「編成」の順番どおりに { id, text }。text はその案件が今週どこまで進んだかを 1 文で書く。「■」や案件名の見出しは付けない（見出しはサーバーが付ける）。text は「■ <案件名>：」の後ろに続く：ja は「■ <案件名>：<text>」、zh は「■ <案件名>：<text>」、en は「■ <name>: <text>」。
other：「その他にまとめる」の案件ごとに 1 つずつ { id, text }（小さな作業でも全部）。「その他にまとめる」が「なし」の時は空の配列。サーバーが 1 行の「その他」にまとめ、text は次の形に入る：ja は「<案件名>では<text>。」、zh は「<案件名>：<text>」、en は「In <name>, <text>.」。en の text はこの文の続きなので小文字で始める（固有名詞・略語で始まる時はそのまま）。
lines・other とも、text の頭に案件名を繰り返さない（名前はサーバーが前に付ける）。入力にない案件は書かない。
text は入力の「# 文字数の上限」にあるその言語の字数以内で、途中で切れない完結した文で書く（長い時は文の数を減らす）。
ただし「名前だけ表示」の言語では、その他の text は数語でよい（完結した文でなくてよい）。表示されない。
別々の記録にあるコードや ID を同じものと見なさない。先週の成果を今週の作業として書かない。
ja・zh・en の 3 言語で同じ内容・同じ順番・同じ id。
${PLAIN}`;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The line is a summary line about `name`: 「■ name：…」 (either colon, spaces allowed) — 「■ 帳票修正：」 is not about 帳票. */
const headed = (line: string, name: string) => headRe(name).test(line);
/** 「■ name：」 or, as zh writes a name holding a colon, 「■ 「name」：」 (spaces allowed, either colon). */
const headRe = (name: string, flags = "") => new RegExp(`^■\\s*(?:「${escapeRe(name)}」|${escapeRe(name)})\\s*[：:]`, flags);

/** The week with hidden 案件 removed: their day rows and 案件 rows; hiding 未関連 removes the rows no 案件 holds. */
export function withoutHidden(data: WeekData, items: ComposeItem[]): WeekData {
  const hidden = new Set(items.filter((i) => i.mode === "hide").map((i) => i.id));
  const keepRow = (id: string | null) => (id === null ? !hidden.has(UNASSIGNED) : !hidden.has(id));
  return { ...data, tasks: data.tasks.filter((r) => !hidden.has(r.task.id)), days: data.days.filter((r) => keepRow(r.task_id)) };
}

/** The first hidden name `text` mentions, or null. Allowed names (shown / folded, every language) are blanked first,
 *  longest first, so a hidden name inside one (帳票 in 帳票修正) is not a mention. */
export function mentionsHidden(text: string, hiddenNames: string[], allowedNames: string[]): string | null {
  const allowed = [...new Set(allowedNames.filter(Boolean))].sort((a, b) => b.length - a.length);
  const blanked = allowed.reduce((acc, n) => acc.split(n).join("\u0000"), text);
  return hiddenNames.find((n) => n && blanked.includes(n)) ?? null;
}

/** The digest context without hidden 案件: their plan goals, the day plans linked only to them, and every line of last
 *  week's summary that mentions one of their names in any language (`hiddenNames`; `allowedNames` as mentionsHidden). */
export function withoutHiddenCtx(ctx: DigestContext, hidden: Set<string>, hiddenNames: string[], allowedNames: string[]): DigestContext {
  const kept = ctx.lastWeek?.split("\n").filter((l) => mentionsHidden(l, hiddenNames, allowedNames) === null).join("\n") ?? null;
  return {
    plans: ctx.plans.filter((p) => !hidden.has(p.task_id)),
    dayPlans: ctx.dayPlans.filter((p) => p.task_ids.length === 0 || !p.task_ids.every((id) => hidden.has(id))),
    lastWeek: kept?.trim() ? kept : null,
  };
}

/** The prompt parts no shown / folded 案件 owns, as the guard scans them: last week's summary and the day plans (of
 *  the worked days in `dates`) linked to none of `owned`. A shown / folded 案件's own blocks — its notes, its work
 *  rows, its plan goals (taskBlock only renders goals of worked, non-hidden 案件, i.e. owned ones), its day plans —
 *  may use a word equal to a hidden name and are not scanned. */
export function unownedText(ctx: DigestContext, owned: Set<string>, dates: string[]): string {
  const plans = ctx.dayPlans.filter((p) => dates.includes(p.date) && !p.task_ids.some((id) => owned.has(id)))
    .map((p) => `${p.text}\n${p.detail}\n${p.progress ?? ""}`);
  return [ctx.lastWeek ?? "", ...plans].join("\n");
}

/** The user text: the selection (names in all three languages), the week's 案件, each worked day's input. */
export function composePrompt(inputs: ReturnType<typeof digestInputs>, items: ComposeItem[], names: Names): string {
  const nm = (id: string) => `${names[id] ? `${names[id].ja}（zh：${names[id].zh}／en：${names[id].en}）` : id}［id：${id}］`;
  const shown = items.filter((i) => i.mode === "show" && i.id !== UNASSIGNED);
  const other = items.filter((i) => i.mode === "other" && i.id !== UNASSIGNED);
  // weekOf({}) ends with an empty 日別まとめ section: the days follow on their own here.
  const week = inputs.weekOf({}).replace(/\n*## 日別まとめ\n*$/, "");
  return [
    `# 編成\n単独行（この順で）：${shown.map((i, k) => `${k + 1}. ${nm(i.id)}`).join(" ") || "なし"}\nその他にまとめる：${other.map((i) => nm(i.id)).join("、") || "なし"}`,
    limitsBlock(items, names),
    `# 今週\n${week}`,
    ...Object.entries(inputs.days).map(([date, input]) => `# ${date}\n${input}`),
  ].join("\n\n");
}

const Body = z.object({ id: z.string(), text: z.string() });
const LangReply = z.object({ lines: z.array(Body), other: z.array(Body) });
const Reply = z.object({ ja: LangReply, zh: LangReply, en: LangReply });

/** One language of the model's reply: shown bodies (in order), folded bodies, the day lines. */
export interface LangDraft { lines: { id: string; text: string }[]; other: { id: string; text: string }[]; days: Record<string, string[]> }
export type ComposeDraft = Record<Lang, LangDraft>;

/** The model's JSON as a draft (no day lines: `days` stays empty); throws when the shape is wrong. */
export function parseReply(raw: string): ComposeDraft {
  const r = Reply.parse(JSON.parse(raw));
  const out = {} as ComposeDraft;
  for (const l of LANGS) {
    const body = (b: { id: string; text: string }) => ({ id: b.id, text: b.text.trim() });
    out[l] = { lines: r[l].lines.map(body), other: r[l].other.map(body), days: {} };
  }
  return out;
}

/** ja first: it is the source language, so its reasons are the ones a reader can act on. */
const CHECK_ORDER: Lang[] = ["ja", "zh", "en"];

/** `name` is in `text` — case-insensitively in en (Report fix / report fix), exactly in ja / zh. */
const hasName = (text: string, name: string, l: Lang) => (l === "en" ? text.toLowerCase().includes(name.toLowerCase()) : text.includes(name));

/** null = the draft follows the selection; else the first reason it does not (ja first). Per language: `lines` ids are
 *  exactly the shown 案件 in order, `other` ids exactly the folded set, no hidden id anywhere, no empty body, no hidden
 *  name (any language; shown / folded names blanked first) in a body or day line, and the summary it makes stays
 *  within the lines the PDF shows. Names are not compared: the server writes them (assembleText). */
export function checkReply(d: ComposeDraft, items: ComposeItem[], names: Names): string | null {
  const real = (mode: string) => items.filter((i) => i.mode === mode && i.id !== UNASSIGNED).map((i) => i.id);
  const shown = real("show"), folded = new Set(real("other")), hidden = real("hide");
  const allowed = [...shown, ...folded].flatMap((id) => (names[id] ? LANGS.map((l) => names[id][l]) : []));
  for (const l of CHECK_ORDER) {
    const { lines, other } = d[l];
    const ids = [...lines, ...other].map((b) => b.id);
    const hid = ids.find((id) => hidden.includes(id));
    if (hid) return `hidden-id:${hid}`;
    for (const b of lines) if (!shown.includes(b.id)) return `unexpected:${l}:${b.id}`;
    for (const id of shown) if (!lines.some((b) => b.id === id)) return `missing:${l}:${id}`;
    if (lines.length !== shown.length || lines.some((b, k) => b.id !== shown[k])) return `order:${l}`;
    const seen = new Set<string>();
    for (const b of other) {
      if (!folded.has(b.id)) return `other-unexpected:${l}:${b.id}`;
      if (seen.has(b.id)) return `other-duplicate:${l}:${b.id}`;
      seen.add(b.id);
    }
    for (const id of folded) if (!seen.has(id)) return `other-missing:${l}:${id}`;
    // a names-only その他 (namesOnlyFrom) never shows its bodies: they are not checked for emptiness or hidden names
    const shownOther = namesOnlyFrom(l, [...folded].map((id) => names[id]?.[l] ?? id)) ? [] : other;
    const empty = [...lines, ...shownOther].find((b) => !b.text.trim());
    if (empty) return `empty:${l}:${empty.id}`;
    if (lines.length + (other.length ? 1 : 0) > MAX_SUMMARY_LINES) return `too-many-lines:${l}`;
    const text = [...lines, ...shownOther].map((b) => b.text).join("\n");
    for (const id of hidden) if (names[id] && mentionsHidden(text, LANGS.map((lx) => names[id][lx]), allowed)) return `hidden-mentioned:${id}`;
  }
  return null;
}

/** Characters per assembled summary line, its 「■ head：」 included. Measured (docs/projects/2026-10-09-pdf-composer/
 *  evidence/step_09_fit_measure.md): under the clamp step a summary line shows 3 rendered lines, i.e. ja 144 / zh 144 /
 *  en 294 characters at p10; these caps keep ~5% margin. Every line within them stays whole on the sheet. */
export const LINE_CAP: Record<Lang, number> = { ja: 136, zh: 136, en: 280 };
/** The check / degrade threshold: the measured p10 itself (same file). LINE_CAP is what the prompt asks for (~5% under,
 *  for the model's counting error); a line up to FIT_CAP passes with no retry and no degrade. */
export const FIT_CAP: Record<Lang, number> = { ja: 144, zh: 144, en: 294 };

/** A body without its trailing sentence punctuation (。．.！？；!?;) — the その他 line adds its own. Case is never
 *  changed (the model writes en bodies to continue "In <name>, …"). */
const stripEnd = (s: string) => s.trim().replace(/[。．.！？；!?;]+$/, "");

/** zh: a name holding a colon is wrapped in 「」, so 「A：B」：x never stacks colons (heads and その他 alike). */
const zhName = (n: string) => (/[：:]/.test(n) ? `「${n}」` : n);
const shownHead = (l: Lang, name: string) => (l === "en" ? `■ ${name}: ` : `■ ${l === "zh" ? zhName(name) : name}：`);
const shownLine = (l: Lang, name: string, body: string) => `${shownHead(l, name)}${body}`;
/** The その他 line from [name, body] pairs: ja 「■ その他：Aでは、a。Bでは、b。」, zh 「■ 其他：A：a；B：b。」,
 *  en "■ Other: In A, a. In B, b.". */
function otherLine(l: Lang, parts: Array<[string, string]>): string {
  const b = (x: string) => stripEnd(x);
  return l === "ja" ? `${OTHER_HEAD.ja}：${parts.map(([n, x]) => `${n}では、${b(x)}。`).join("")}`
    : l === "zh" ? `${OTHER_HEAD.zh}：${parts.map(([n, x]) => `${zhName(n)}：${b(x)}`).join("；")}。`
    : `${OTHER_HEAD.en}: ${parts.map(([n, x]) => `In ${n}, ${b(x)}.`).join(" ")}`;
}
/** The その他 line with names only — every folded name, never elided (zh wraps a colon name in 「」):
 *  ja 「■ その他：A、B」, zh 「■ 其他：A、B」, en "■ Other: A, B". */
function namesOnly(l: Lang, ns: string[]): string {
  return l === "en" ? `${OTHER_HEAD.en}: ${ns.join(", ")}` : `${OTHER_HEAD[l]}：${(l === "zh" ? ns.map(zhName) : ns).join("、")}`;
}
/** The その他 line in `l` is names only from the start: its frame alone (head, every folded name, the joins, empty
 *  bodies) is over FIT_CAP, or leaves no room for a body under LINE_CAP (the prompt never asks for ≤ 0 characters). */
// Deliberately also true when the frame fits FIT_CAP but leaves < 1 character per body at LINE_CAP: the prompt would
// otherwise have to ask for 0 characters, so that line is names only too.
function namesOnlyFrom(l: Lang, folded: string[]): boolean {
  if (folded.length === 0) return false;
  const frame = otherLine(l, folded.map((n) => [n, ""])).length;
  return frame > FIT_CAP[l] || Math.floor((LINE_CAP[l] - frame) / folded.length) < 1;
}

/** The stored text from a checked draft: per shown body 「■ <name in that language>：<text>」 (en "■ <name>: <text>"),
 *  then, when anything is folded, one その他 line (otherLine) in `foldedOrder` (the selection's order). */
export function assembleText(d: ComposeDraft, foldedOrder: string[], names: Names): ComposeText {
  const out = {} as ComposeText;
  for (const l of LANGS) {
    const nm = (id: string) => names[id]?.[l] ?? id;
    const summary = d[l].lines.map((b) => shownLine(l, nm(b.id), b.text.trim()));
    const body = new Map(d[l].other.map((b) => [b.id, b.text]));
    const fold = foldedOrder.filter((id) => body.has(id));
    if (fold.length) {
      summary.push(namesOnlyFrom(l, fold.map(nm)) ? namesOnly(l, fold.map(nm)) : otherLine(l, fold.map((id) => [nm(id), body.get(id)!])));
    }
    out[l] = { summary, days: d[l].days };
  }
  return out;
}

/** The first summary line over FIT_CAP as `too-long:<lang>:<index>` (ja first), or null. A その他 line that is names
 *  only from the start (namesOnlyFrom; give `foldedOrder` and `names`) is never too long: nothing a retry could fix. */
export function longLine(t: ComposeText, foldedOrder: string[] = [], names: Names = {}): string | null {
  for (const l of CHECK_ORDER) {
    const fixed = namesOnlyFrom(l, foldedOrder.map((id) => names[id]?.[l] ?? id));
    const last = t[l].summary.length - 1;
    const k = t[l].summary.findIndex((x, i) => x.length > FIT_CAP[l] && !(fixed && i === last));
    if (k >= 0) return `too-long:${l}:${k}`;
  }
  return null;
}

/** The longest body each 案件 may have, per language, under LINE_CAP: shown = cap − its head; folded = what the その他
 *  frame (head, every folded name, the joins) leaves of the cap, shared evenly (floor) — or "names" when that line is
 *  names only from the start (namesOnlyFrom: its bodies are not shown). other = null with nothing folded. */
export function bodyLimits(items: ComposeItem[], names: Names): Record<Lang, { shown: Record<string, number>; other: number | "names" | null }> {
  const ids = (mode: string) => items.filter((i) => i.mode === mode && i.id !== UNASSIGNED && names[i.id]).map((i) => i.id);
  const shown = ids("show"), folded = ids("other");
  const out = {} as Record<Lang, { shown: Record<string, number>; other: number | "names" | null }>;
  for (const l of LANGS) {
    const frame = otherLine(l, folded.map((id) => [names[id][l], ""]));
    out[l] = {
      shown: Object.fromEntries(shown.map((id) => [id, LINE_CAP[l] - shownLine(l, names[id][l], "").length])),
      other: folded.length === 0 ? null : namesOnlyFrom(l, folded.map((id) => names[id][l])) ? "names"
        : Math.floor((LINE_CAP[l] - frame.length) / folded.length),
    };
  }
  return out;
}

/** The prompt's 「# 文字数の上限」 block (bodyLimits, characters of text only). */
function limitsBlock(items: ComposeItem[], names: Names): string {
  const lim = bodyLimits(items, names);
  const per = (f: (l: Lang) => number | "names" | null) =>
    CHECK_ORDER.map((l) => { const v = f(l); return v === "names" ? `${l} 名前だけ表示（text は数語でよい）` : `${l} ${v} 字`; }).join("／");
  const shown = items.filter((i) => i.mode === "show" && i.id !== UNASSIGNED && names[i.id])
    .map((i) => `- ${names[i.id].ja}［id：${i.id}］：${per((l) => lim[l].shown[i.id])}`);
  const other = lim.ja.other === null ? [] : [`- その他にまとめる各案件：${per((l) => lim[l].other)}`];
  return [`# 文字数の上限（text だけの字数。見出しや名前はサーバーが付ける）`, ...shown, ...other].join("\n");
}

const ABBR = /\b(?:e\.g|i\.e|vs|etc|cf|approx|incl|Mr|Ms|Dr|No)\.$/i;
/** Whole sentences of `body` from the start. ja / zh end at a full-width 。．！？ (ASCII ?! stay inside), with any
 *  closing 」』）) kept on the sentence they close; en ends at . ! ? before a space, but not after e.g. / i.e. / vs. /
 *  etc. and similar abbreviations. */
export function splitSentences(l: Lang, body: string): string[] {
  const t = body.trim();
  if (l !== "en") return (t.match(/[^。．！？]*[。．！？]+[」』）)]*|[^。．！？]+$/g) ?? []).filter((x) => x.trim());
  const out: string[] = [];
  for (const p of t.split(/(?<=[.!?])\s+/)) {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  return out.filter((x) => x.trim());
}

/** The text with every line within FIT_CAP, for when the one retry could not get it there (attempt-4 rulings):
 *  - a long その他 line becomes names only, every name (namesOnly); one that is names only from the start stays so;
 *  - a long shown line keeps the same number of whole sentences from the start in all three languages — the fewest
 *    that fit in every language, at least 1 — and a language whose kept sentences still do not fit is cut at the cap
 *    on a character boundary, ending "…".
 *  `notes` = one per changed line, for the log. Lines within the cap are as assembleText writes them. */
export function fitToCap(d: ComposeDraft, foldedOrder: string[], names: Names): { text: ComposeText; notes: string[] } {
  const text = assembleText(d, foldedOrder, names), notes: string[] = [];
  const nm = (l: Lang) => (id: string) => names[id]?.[l] ?? id;
  // その他: over the threshold → names only (every name); a line that is names only from the start stays as it is
  for (const l of CHECK_ORDER) {
    const k = d[l].lines.length, line = text[l].summary[k];
    const ids = foldedOrder.filter((id) => d[l].other.some((b) => b.id === id));
    if (line === undefined || line.length <= FIT_CAP[l] || namesOnlyFrom(l, ids.map(nm(l)))) continue;
    notes.push(`${l}: その他 → names only (${line.length} > ${FIT_CAP[l]})`);
    text[l].summary[k] = namesOnly(l, ids.map(nm(l)));
  }
  // shown lines: the same number of whole sentences in every language — the fewest that fit everywhere (at least 1)
  const shown = d.ja.lines.length;
  for (let k = 0; k < shown; k++) {
    if (!CHECK_ORDER.some((l) => text[l].summary[k].length > FIT_CAP[l])) continue;
    const parts = Object.fromEntries(CHECK_ORDER.map((l) => {
      const b = d[l].lines[k];
      return [l, { head: shownHead(l, nm(l)(b.id)), body: b.text.trim(), sents: splitSentences(l, b.text) }];
    })) as Record<Lang, { head: string; body: string; sents: string[] }>;
    const join = (l: Lang, n: number) => parts[l].sents.slice(0, n).map((x) => x.trim()).join(l === "en" ? " " : "");
    const fits = (l: Lang) => {
      let n = 0;
      while (n < parts[l].sents.length && (parts[l].head + join(l, n + 1)).length <= FIT_CAP[l]) n++;
      return n;
    };
    const m = Math.max(1, Math.min(...CHECK_ORDER.map(fits)));
    for (const l of CHECK_ORDER) {
      const { head, body, sents } = parts[l], before = text[l].summary[k].length;
      if (sents.length <= m && before <= FIT_CAP[l]) continue;
      const kept = join(l, m);
      if ((head + kept).length <= FIT_CAP[l]) {
        text[l].summary[k] = head + kept;
        notes.push(`${l}: shown line ${k} kept ${m} sentence(s) (${before} → ${(head + kept).length})`);
        continue;
      }
      let cut = "";
      for (const ch of Array.from(body)) {
        if ((head + cut + ch).length > FIT_CAP[l] - 1) break;
        cut += ch;
      }
      text[l].summary[k] = `${head}${cut}…`;
      notes.push(`${l}: shown line ${k} cut at the cap (${before} → ${FIT_CAP[l]})`);
    }
  }
  return { text, notes };
}

export async function generateText(client: Anthropic, prompt: string, dates: string[], ids: string[]): Promise<ComposeDraft> {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 8000, system: COMPOSE_SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: composeSchema(ids) } },
    messages: [{ role: "user", content: prompt }],
  }, { timeout: 120_000 });
  const block = res.content.find((b) => b.type === "text");
  return parseReply(block && block.type === "text" ? block.text : "");
}

/** The 案件 an edited text names (in `srcLang`): per summary line the id whose name heads it (or undefined), and the
 *  ids named in its その他 line. Longer names are matched first, and blanked inside その他, so 帳票修正 does not also
 *  count as 帳票. */
export function namedIn(src: LangText, srcLang: Lang, names: Names): { heads: (string | undefined)[]; folded: string[] } {
  const ids = Object.keys(names).filter((id) => names[id][srcLang]).sort((a, b) => names[b][srcLang].length - names[a][srcLang].length);
  const heads = src.summary.map((x) => ids.find((id) => headed(x, names[id][srcLang])));
  const folded: string[] = [];
  let rest = src.summary.find((x) => x.startsWith(OTHER_HEAD[srcLang])) ?? "";
  for (const id of ids) {
    const n = names[id][srcLang];
    if (!rest.includes(n)) continue;
    rest = rest.split(n).join("\u0000");
    folded.push(id);
  }
  return { heads, folded };
}

const COLON = /[：:]/g;
/** A retranslation into `l` with each summary line's head put back to the canonical name in `l` of the 案件 that heads
 *  the same line of the edited text (fromMarkdown already matched the line counts): a translator's 研究 → 試験 on a
 *  head is undone. Which colon ends the translated head: right after the canonical name when the line already starts
 *  with it; otherwise the one that leaves the body as many colons as the edited line's body has (so a colon inside a
 *  translated name — 「■ A: B：本文」 — leaves no fragment, and a colon in the body stays there). A line that is not
 *  headed in the edited text, or has no 「■ …：」 in the translation, is left as it is (the check then reports it). */
export function rewriteHeads(src: LangText, srcLang: Lang, t: LangText, l: Lang, names: Names): LangText {
  const { heads } = namedIn(src, srcLang, names);
  const rewrite = (x: string, i: number): string => {
    const id = heads[i];
    if (!id || !x.startsWith("■")) return x;
    const canon = names[id][l];
    if (headed(x, canon)) return shownHead(l, canon) + x.replace(headRe(canon), "").trimStart();
    const srcBody = src.summary[i].replace(headRe(names[id][srcLang]), "");
    const colons = [...x.matchAll(COLON)].map((m) => m.index!);
    if (colons.length === 0) return x;
    const k = colons.length - 1 - (srcBody.match(COLON)?.length ?? 0);
    const end = colons[Math.max(0, Math.min(k, colons.length - 1))];
    return shownHead(l, canon) + x.slice(end + 1).trimStart();
  };
  return { ...t, summary: t.summary.map(rewrite) };
}

/** A retranslation into `l` against the edited text it came from (`src`, in `srcLang`), not against the selection
 *  (which may have changed since): every 案件 whose name heads a line of `src` heads one in `l`, in the same order,
 *  and every 案件 named in `src`'s その他 line is named in `l`'s (names as seen in each language; en ignores case).
 *  null, or the first reason it does not. */
export function checkRetranslated(src: LangText, srcLang: Lang, t: LangText, l: Lang, names: Names): string | null {
  const { heads, folded } = namedIn(src, srcLang, names);
  let at = -1;
  for (const id of heads.filter((x): x is string => !!x)) {
    const k = t.summary.findIndex((x) => headed(x, names[id][l]));
    if (k < 0) return `missing:${l}:${id}`;
    if (k < at) return `order:${l}`;
    at = k;
  }
  if (!src.summary.some((x) => x.startsWith(OTHER_HEAD[srcLang]))) return null;
  const other = t.summary.find((x) => x.startsWith(OTHER_HEAD[l]));
  if (other === undefined) return `other-missing:${l}`;
  for (const id of folded) if (!hasName(other, names[id][l], l)) return `other-name:${l}:${names[id][l]}`;
  return null;
}

/** One language's text as the translator sees it: summary lines, then a "## <date>" heading per day. */
export const toMarkdown = (t: LangText) =>
  [t.summary.join("\n"), ...Object.entries(t.days).map(([d, lines]) => `## ${d}\n${lines.join("\n")}`)].join("\n\n");

/** The translator's Markdown back into text shaped like `like`; null when the headings or line counts moved. A reply
 *  trimmed of its leading / trailing newlines (empty summary, empty last day) still reads; an empty day stays []. */
export function fromMarkdown(md: string, like: LangText): LangText | null {
  const parts = `\n${md}`.split(/\n(?=## \d{4}-\d{2}-\d{2}[ \t]*(?:\n|$))/);
  const summary = parts[0].split("\n").map((s) => s.trim()).filter(Boolean);
  if (summary.length !== like.summary.length) return null;
  const days: Record<string, string[]> = {};
  for (const p of parts.slice(1)) {
    const [head, ...lines] = p.trim().split("\n");
    days[head.replace(/^## /, "").trim()] = lines.map((s) => s.trim()).filter(Boolean);
  }
  // day lines are no longer printed (pdf/data.ts dayLines): a moved or dropped day never fails the retranslation
  return { summary, days: Object.fromEntries(Object.keys(like.days).map((d) => [d, days[d] ?? []])) };
}
