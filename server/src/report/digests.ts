// AI week / day summaries of the 週報 (design 2026-10-08 §3.3, S2c §2): per task, in plain words, against the
// plan goals, with a shorter PDF version alongside. Regenerated only when their inputs changed, never over a hand edit.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Env } from "../env";
import type { Lang } from "../i18n/langs";
import { localize, type PolishMeta } from "../i18n/store";
import { MODEL } from "../i18n/translator";
import { type DigestContext, loadDigestContext } from "./digest-context";
import type { DigestOut, TaskRow, WeekData } from "./types";
import { buildWeek } from "./weekly";

export const PLAIN = `読み手は技術に詳しくない人（例：人事や管理職）。専門用語や略語を説明なしで使わない。ライブラリ名・コマンド・ファイル名・関数名は書かない。「リファクタリング・デプロイ・デバッグ・マイグレーション・最適化」のような開発用語は「作り直した・公開した・不具合を直した・移し替えた・速くした」のような日常の言葉に言い換える。案件名・人名・製品名はそのまま使う。
「成功裏に・順調に・全面的に・さらなる・大幅に」などの決まり文句、飾りの形容詞、まとめの空文は書かない。事実だけを書く。
数字があれば数字で書く（例：20 画面中 8 完了）。ない数字は作らない。
作業の手順・経緯・使った道具は書かない。作業記録の文をなぞらない。
「使えない・止めている・保留」のような状態を書く時は、入力に理由があればその理由も添える。`;

export const SYSTEM_DAY = `あなたは派遣エンジニアの週報の「日別まとめ」を書く。入力は、その日に作業した案件の情報（備考・計画上の目標を含む）、その日の予定と達成判定、作業記録。
案件ごとに 1 行で「その日に何が進んだか（目標に対してどこまで来たか）」を書く。行頭は「■ 案件名：」。進みがあった案件だけを書き、ごく小さな作業だけの案件は「■ その他：」の 1 行にまとめる。止まっている点や次の一手は、はっきりしている時だけ同じ行に短く添える。
lines：画面用。上の通り、必要な行数だけ。
pdf_lines：PDF 用。その日のいちばん大きな成果を 1 行だけ（「■」は付けない、40 字程度まで）。2〜3 件が並ぶ時は読点でつなぐ。lines にない事実は書かない。
${PLAIN}`;

// The oneliner's register (spec §10, user 10/13): a formal written report sentence in every language.
const ONELINER_STYLE = `報告書の書き言葉で書く（例：「〇〇の改修を完了し、△△の確認に着手した。」）。話し言葉・くだけた言い方・感想は使わない。中国語・英語にする時も同じく正式な書き言葉にする（中国語は 40 字以内、英語は 25 語以内）。`;
// The oneliner's 案件名 (user 10/13, Step 13 audit): a full name alone can take most of the 40 字, so a short form is allowed —
// shortened only, never another name. An exception to PLAIN's 「案件名…はそのまま使う」, which follows it in the prompt.
export const ONELINER_NAMES = `一言まとめでは、案件名は短い形にしてよい：登録名の「（」「(」「：」「:」より前の部分、またはその案件の通称。短くするだけで、別の名前に置き換えたり新しく作ったりしない（下の「案件名はそのまま使う」の例外）。`;

export const SYSTEM_WEEK = `あなたは派遣エンジニアの週報の「今週のまとめ」を書く。入力は、先週のまとめ、今週作業した案件の情報（備考・計画上の目標・今週の時間）、日別まとめ。
案件ごとに 1 行で「今週どこまで進んだか（目標に対して／先週からの変化）」を書く。行頭は「■ 案件名：」。今週の時間が多い順。止まっている点や次の一手は、はっきりしている時だけ同じ行に短く添える。小さな案件は「■ その他：」の 1 行にまとめる。
lines：画面用。必要な行数だけ。
pdf_lines：PDF 用。主要な案件を最大 5 行（「■ 案件名：」で始め、各 60 字程度まで）、残りは「■ その他：」1 行。lines に「■ その他：」の行がある時は、pdf_lines の最後にも必ず「■ その他：」の行を置く。lines にない事実は書かない。
oneliner：表紙用の一言。この週に何が進んだかを 1 文で（40 字以内、「■」は付けない）。主な案件名を入れ、経緯・手順は書かない。lines にない事実・数字は書かない。${ONELINER_NAMES}${ONELINER_STYLE}
${PLAIN}`;

/** The local backfill of a week's missing oneliner, from its stored week text (hand-edited or not). */
export const SYSTEM_ONELINER = `あなたは派遣エンジニアの週報の「一言まとめ」を書く。入力は、その週の「今週のまとめ」（人が手で直したものを含む）。
この週に何が進んだかを 1 文で書く（40 字以内、「■」は付けない）。主な案件名を入れ、経緯・手順は書かない。入力にない事実・数字は書かない。数字は入力のまま使う。${ONELINER_NAMES}${ONELINER_STYLE}
${PLAIN}`;

export const DIGEST_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } }, pdf_lines: { type: "array", items: { type: "string" } } },
  required: ["lines", "pdf_lines"], additionalProperties: false,
} as const;

/** The week call's schema: the lines plus the cover oneliner. */
export const DIGEST_SCHEMA_WEEK = {
  type: "object",
  properties: { ...DIGEST_SCHEMA.properties, oneliner: { type: "string" } },
  required: ["lines", "pdf_lines", "oneliner"], additionalProperties: false,
} as const;

export const ONELINER_CAP = 120;   // code points, as the PATCH allows

export const LIMITS = { day: { text: 800, pdf: 120 }, week: { text: 1600, pdf: 700 } } as const;

export const autoDigests = (env: Env) => env.DIGESTS_AUTO === "on";

export const digestId = (week: string, day: string) => `${week}\u001f${day}`;

export async function hashOf(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whole lines while they fit `limit` code points (newlines count); a first line alone too long is hard-cut with …. */
export function capLines(lines: string[], limit: number): string {
  const out: string[] = [];
  for (const l of lines.map((x) => x.trim()).filter(Boolean)) {
    const next = [...out, l].join("\n");
    if (Array.from(next).length <= limit) { out.push(l); continue; }
    if (out.length === 0) out.push(Array.from(l).slice(0, limit - 1).join("") + "…");
    break;
  }
  return out.join("\n");
}

const STATUS_JA = { open: "対応中", done: "完了", hold: "保留" } as const;
const HORIZON_JA = { daily: "毎日", week: "今週", near: "近いうち", far: "長期" } as const;
const JUDGE_JA = { done: "達成", partial: "一部", none: "未着手" } as const;
const NOTE_MAX = 300;   // a task's 備考 / a day plan's detail is cut here in the input (context, not the subject)
const cut = (s: string) => Array.from(s.trim()).slice(0, NOTE_MAX).join("");

/** A task as of the week's end (`end` = its last day): done later reads as 対応中; no 累計 (it moves after the week). */
function taskBlock(r: TaskRow, ctx: DigestContext, end: string, withWeek: boolean): string {
  const t = r.task, h = (m: number) => (m / 60).toFixed(1);
  const status = t.status === "done" && t.done_at !== null && t.done_at > end ? "open" : t.status;
  const head = `- ${t.title}（依頼元：${t.requester || "—"}／受領：${t.received_at}／状態：${STATUS_JA[status]}${withWeek ? `／今週 ${h(r.week_minutes)}h` : ""}）`;
  const note = t.thinking.trim() ? [`  備考：${cut(t.thinking)}`] : [];
  const goals = ctx.plans.filter((p) => p.task_id === t.id)
    .map((p) => `  計画（${HORIZON_JA[p.horizon]}）：${p.text}${p.status === "done" ? "（完了）" : ""}`);
  return [head, ...note, ...goals].join("\n");
}

/** One input text per worked day (stable order, minutes rounded) and the week input from day texts, each with the
 *  tasks worked, their plan goals, the day plans and last week's summary (sections with nothing are left out). */
export function digestInputs(data: WeekData, ctx: DigestContext) {
  const byId = new Map(data.tasks.map((r) => [r.task.id, r])), end = data.dates[6];
  const days: Record<string, string> = {};
  for (const date of data.dates) {
    const rows = data.days.filter((r) => r.date === date);
    if (rows.length === 0) continue;
    const ids = [...new Set(rows.map((r) => r.task_id).filter((x): x is string => x !== null))];
    const tasks = ids.map((id) => byId.get(id)).filter((r): r is TaskRow => !!r).map((r) => taskBlock(r, ctx, end, false));
    const plans = ctx.dayPlans.filter((p) => p.date === date)
      .map((p) => `- ${p.text}${p.detail.trim() ? `（${cut(p.detail)}）` : ""}${p.status ? `：${JUDGE_JA[p.status]}` : ""}${p.progress ? `（${p.progress}）` : ""}`);
    const work = rows.map((r) => `- ${r.task_title}：${r.text}（${Math.round(r.minutes)}分）`);
    days[date] = [
      tasks.length ? `## 案件\n${tasks.join("\n")}` : "",
      plans.length ? `## その日の予定と判定\n${plans.join("\n")}` : "",
      `## 作業記録\n${work.join("\n")}`,
    ].filter(Boolean).join("\n");
  }
  const worked = data.tasks.filter((r) => r.week_minutes > 0).sort((a, b) => b.week_minutes - a.week_minutes);
  const weekOf = (dayTexts: Record<string, string>) => [
    ctx.lastWeek ? `## 先週のまとめ\n${ctx.lastWeek}` : "",
    `## 今週の案件（時間の多い順）\n${worked.map((r) => taskBlock(r, ctx, end, true)).join("\n")}`,
    `## 日別まとめ\n${data.dates.filter((d) => dayTexts[d]).map((d) => `${d}：${dayTexts[d]}`).join("\n")}`,
  ].filter(Boolean).join("\n");
  return { days, weekOf };
}

/** The week's source-text data (the week alone: the inputs read no 累計), its digest context and the inputs from both.
 *  null only for a week that is not an ISO week. */
export async function loadInputs(db: D1Database, week: string) {
  const data = await buildWeek(db, week, null, { history: false });
  if (!data) return null;
  const ctx = await loadDigestContext(db, week, data.dates);
  return { data, ctx, inputs: digestInputs(data, ctx) };
}

type Generated = { text: string; pdf: string; oneliner: string | null };

/** One call: the web lines and the PDF lines, each capped by whole lines, and on the week the oneliner (a reply
 *  without one gives null). Empty web text throws (counted as failed). */
async function generate(client: Anthropic, kind: keyof typeof LIMITS, input: string): Promise<Generated> {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 4000, system: kind === "day" ? SYSTEM_DAY : SYSTEM_WEEK,
    output_config: { effort: "low", format: { type: "json_schema", schema: kind === "day" ? DIGEST_SCHEMA : DIGEST_SCHEMA_WEEK } },
    messages: [{ role: "user", content: input }],
  }, { timeout: 60_000 });
  const block = res.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : "";
  const out = z.object({ lines: z.array(z.string()), pdf_lines: z.array(z.string()), oneliner: z.string().optional() }).parse(JSON.parse(raw));
  const text = capLines(out.lines, LIMITS[kind].text);
  const pdf = capLines(out.pdf_lines, LIMITS[kind].pdf);
  if (!text) throw new Error("empty digest text");
  if (!pdf) throw new Error("empty digest pdf_lines");   // R13: a generated line always carries its PDF version
  const oneliner = kind === "week" && out.oneliner ? capLines([out.oneliner], ONELINER_CAP) || null : null;
  return { text, pdf, oneliner };
}

/** The week input from the day inputs and the stored day lines (days with input and a stored line, nothing else):
 *  the one way every hash of a week input is made, so a line written elsewhere is fresh to the cron and the preview. */
export const weekInputOf = (inputs: ReturnType<typeof digestInputs>, texts: Record<string, string>) =>
  inputs.weekOf(Object.fromEntries(Object.keys(inputs.days).filter((d) => d in texts).map((d) => [d, texts[d]])));

type Row = { week: string; day: string; text: string; pdf_text: string | null; inputs_hash: string; edited: number; updated_at: string;
  oneliner: string | null; oneliner_edited: number };

const ROW_COLS = "week, day, text, pdf_text, inputs_hash, edited, updated_at, oneliner, oneliner_edited";
const loadRows = async (db: D1Database, week: string) =>
  (await db.prepare(`SELECT ${ROW_COLS} FROM report_digests WHERE week = ?1`).bind(week).all<Row>()).results;

/** Generate the digests whose inputs changed. Budget: buildWeek (4) + context (1 batch) + 1 read + ≤ 8 upserts D1 queries.
 *  One failed generation is logged and counted; the other lines still go ahead. */
export async function refreshDigests(env: Env, week: string, opts: { client?: Anthropic; now?: Date; force?: boolean } = {}) {
  if (!autoDigests(env) && !opts.force) return { generated: 0, skipped: 0, failed: 0 };
  if (!env.ANTHROPIC_API_KEY && !opts.client) return { generated: 0, skipped: 0, failed: 0 };
  const client = opts.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const db = env.DB, now = (opts.now ?? new Date()).toISOString();
  const loaded = await loadInputs(db, week);   // source text, never localized
  if (!loaded) return { generated: 0, skipped: 0, failed: 0 };
  const { days } = loaded.inputs;
  const existing = new Map((await loadRows(db, week)).map((r) => [r.day, r]));
  let generated = 0, skipped = 0, failed = 0;
  // a hand-edited oneliner survives a regenerated week; an AI one is replaced (or cleared by a reply without one)
  const upsert = (day: string, g: Generated, hash: string) => db.prepare(
    `INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at, oneliner)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?7, ?8)
     ON CONFLICT(week, day) DO UPDATE SET text = excluded.text, pdf_text = excluded.pdf_text, inputs_hash = excluded.inputs_hash,
       edited = 0, model = excluded.model, generated_at = excluded.generated_at, updated_at = excluded.updated_at,
       oneliner = CASE WHEN report_digests.oneliner_edited = 1 THEN report_digests.oneliner ELSE excluded.oneliner END
       WHERE report_digests.edited = 0 OR report_digests.day != ''`,
  ).bind(week, day, g.text, g.pdf || null, hash, MODEL, now, g.oneliner).run();

  const dayTexts: Record<string, string> = {};
  for (const [date, input] of Object.entries(days)) {
    const cur = existing.get(date), hash = await hashOf(input);
    // a day line is no longer shown or edited on the page (10/9: 当日案件 replaced it), so an old hand edit is not
    // kept over new inputs — it would feed the week line with no way to see or reset it
    if (cur && cur.inputs_hash === hash) { dayTexts[date] = cur.text; skipped++; continue; }
    try {
      const g = await generate(client, "day", input);
      await upsert(date, g, hash); dayTexts[date] = g.text; generated++;
    } catch (e) {
      // The old line (if any) still feeds the week; its hash stays stale, so the next run retries.
      console.error("[digest] day failed", week, date, e); failed++;
      if (cur) dayTexts[date] = cur.text;
    }
  }
  if (Object.keys(dayTexts).length > 0) {
    const input = weekInputOf(loaded.inputs, dayTexts), cur = existing.get(""), hash = await hashOf(input);
    if (cur && (cur.edited || cur.inputs_hash === hash)) skipped++;
    else {
      try { await upsert("", await generate(client, "week", input), hash); generated++; }
      catch (e) { console.error("[digest] week failed", week, e); failed++; }
    }
  }
  return { generated, skipped, failed };
}

const outOf = (r: Row & { _polish?: Record<string, PolishMeta> }, stale: boolean): DigestOut => ({
  text: r.text, pdf_text: r.pdf_text ?? null, edited: r.edited === 1, stale, updated_at: r.updated_at,
  oneliner: r.oneliner ?? null, oneliner_edited: r.oneliner_edited === 1,
  ...(r._polish ? { polish: r._polish } : {}),
});

/** The week's stored digests for the preview, text in `lang`. `inputs` yields the week's digest inputs from source text
 *  (asked only when rows exist): stale = not hand-edited and its inputs no longer hash to what it was generated from. */
export async function digestsOf(db: D1Database, week: string, lang: Lang | null,
                                inputs: () => Promise<ReturnType<typeof digestInputs>>) {
  const rows = await loadRows(db, week);
  const out: { week: DigestOut | null; days: Record<string, DigestOut> } = { week: null, days: {} };
  if (rows.length === 0) return out;
  const built = await inputs(), { days } = built;
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const dayTexts = Object.fromEntries(rows.filter((r) => r.day !== "").map((r) => [r.day, r.text]));
  const shown = await localize(db, lang, "digest", rows, ["text", "pdf_text", "oneliner"], (r) => digestId(r.week, r.day), { meta: true });
  for (const r of shown) {
    const src = byDay.get(r.day)!;
    const input = r.day === "" ? weekInputOf(built, dayTexts) : days[r.day] ?? "";
    const o = outOf(r, !src.edited && src.inputs_hash !== await hashOf(input));
    if (r.day === "") out.week = o; else out.days[r.day] = o;
  }
  return out;
}

/** One digest row as the PATCH answers it, without rebuilding the week: stale only marks a pending
 *  regenerate (inputs_hash ''), which is all a PATCH can change. */
export async function digestOne(db: D1Database, week: string, day: string, lang: Lang | null): Promise<DigestOut | null> {
  const r = await db.prepare(`SELECT ${ROW_COLS} FROM report_digests WHERE week = ?1 AND day = ?2`)
    .bind(week, day).first<Row>();
  if (!r) return null;
  const [shown] = await localize(db, lang, "digest", [r], ["text", "pdf_text", "oneliner"], (x) => digestId(x.week, x.day), { meta: true });
  return outOf(shown, r.edited === 0 && r.inputs_hash === "");
}
