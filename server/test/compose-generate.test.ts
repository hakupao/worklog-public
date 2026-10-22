import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL } from "../src/i18n/translator";
import { COMPOSE_SYSTEM, FIT_CAP, LINE_CAP, checkRetranslated, namedIn, splitSentences, OTHER_HEAD, assembleText, bodyLimits, checkReply, composePrompt, composeSchema, fitToCap, longLine, fromMarkdown, rewriteHeads, toMarkdown, withoutHidden, withoutHiddenCtx } from "../src/report/compose/generate";
import { TRANSLATE_MS } from "../src/report/compose/store";
import { digestInputs, loadInputs } from "../src/report/digests";
import { reports } from "../src/routes/reports";
import { composeDeps, retranslate } from "../src/routes/pdf-compose";
import { fakeAnthropic } from "./fake-anthropic";
import { api, resetDb } from "./helpers";

const WEEK = "2026-W40";
const db = () => (env as any).DB as D1Database;
const real = composeDeps.client, realNow = composeDeps.now;
const gen = (DB: D1Database = db()) => reports.request(`/${WEEK}/pdf/compose/generate`, { method: "POST" }, { DB, ANTHROPIC_API_KEY: "k" } as any);
const task = (id: string, title: string) => api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({
  requester: "田中", title, status: "open", received_at: "2026-09-01", machine: "m", ts: "2026-09-01T09:00:00" }) });
const s = (id: string, at: string, task_id: string | null, minutes: number) => ({
  id, machine: "m", agent: "claude-code", session_id: `${id}-f`, cwd: "/w", started_at: at,
  ended_at: new Date(Date.parse(at) + minutes * 60_000).toISOString(), active_minutes: minutes, turns: 3,
  summary: `did ${id}`, summary_source: "llm", task_id, link_method: task_id ? "manual" : "none", ts: "2026-09-28T12:00:00" });
const ingest = (rows: unknown[]) => api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "m", sessions: rows }) });
const setItems = (items: unknown) => db().prepare("UPDATE pdf_compose SET items = ?2 WHERE week = ?1").bind(WEEK, JSON.stringify(items)).run();
async function seed() {
  await task("A", "帳票修正"); await task("B", "API 確認"); await task("H", "帳票");
  await ingest([s("S1", "2026-09-28T01:00:00Z", "A", 120), s("S2", "2026-09-29T01:00:00Z", "B", 60), s("S3", "2026-09-29T03:00:00Z", "H", 30)]);
  await db().prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES (?1, ?2, 't')").bind(WEEK,
    JSON.stringify([{ id: "B", mode: "show" }, { id: "A", mode: "show" }, { id: "H", mode: "hide" }])).run();
}
type Pair = [id: string, text: string];
/** One language of the model's structured reply: shown bodies in order, folded bodies, one line per worked day. */
const lang = (lines: Pair[], other: Pair[], d28: string, d29: string) => ({
  lines: lines.map(([id, text]) => ({ id, text })), other: other.map(([id, text]) => ({ id, text })),
  days: [{ date: "2026-09-28", lines: [d28] }, { date: "2026-09-29", lines: [d29] }] });
/** B and A shown (in that order), nothing folded; the server writes the heads. */
const GOOD = {
  ja: lang([["B", "済んだ"], ["A", "直した"]], [], "帳票修正を直した", "API 確認を済ませた"),
  zh: lang([["B", "完成"], ["A", "改好"]], [], "改好报表修正", "完成 API 确认"),
  en: lang([["B", "done"], ["A", "fixed"]], [], "Fixed the report fix", "Did the API check"),
};
/** Day lines that use the stored (ja) titles: what zh / en see with no translations stored. */
const AS_SEEN = { ...GOOD,
  zh: lang([["B", "完成"], ["A", "改好"]], [], "改好帳票修正", "完成 API 確認"),
  en: lang([["B", "done"], ["A", "fixed"]], [], "Fixed 帳票修正", "Did API 確認") };
/** AS_SEEN with ja's shown bodies in the wrong order. */
const SWAPPED = { ...AS_SEEN, ja: lang([["A", "直した"], ["B", "済んだ"]], [], "帳票修正を直した", "API 確認を済ませた") };
const tr = (id: string, source: string, zh: string, en: string) => db().prepare(`INSERT INTO translations
  (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at) VALUES ('task', ?1, 'title', ?2, 'ja', ?3, ?2, ?4, 'm', 'now')`)
  .bind(id, source, zh, en).run();
const translate = async () => { await tr("A", "帳票修正", "报表修正", "Report fix"); await tr("B", "API 確認", "API 确认", "API check"); await tr("H", "帳票", "报表", "Report"); };
const row = () => db().prepare("SELECT * FROM pdf_compose WHERE week = ?1").bind(WEEK).first<any>();

describe("generate", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  afterEach(() => { composeDeps.client = real; composeDeps.now = realNow; });

  it("hidden 案件 never reach the model; writes text, hashes, model; releases the lock", async () => {
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN, calls);
    const r = await gen();
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("did S3");
    expect(calls[0]).not.toMatch(/帳票（依頼元/);   // H's 案件 block is gone (帳票修正's stays)
    expect(calls[0]).toContain("1. API 確認");
    expect(calls[0].match(/## 今週の案件/g)).toHaveLength(1);
    const x = await row();
    expect(JSON.parse(x.text).ja.summary[0]).toBe("■ API 確認：済んだ");
    expect(JSON.parse(x.text).en.days).toEqual({});   // day lines are not asked for nor kept (the PDF builds its 日別 row)
    expect(x).toMatchObject({ gen_model: MODEL, generating_at: null, edited: 0 });
    expect(x.gen_selection_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(x.gen_inputs_hash).toMatch(/^[0-9a-f]{64}$/);
    const view = await (await reports.request(`/${WEEK}/pdf/compose?lang=ja`, {}, { DB: db() } as any)).json() as any;
    expect(view.stale).toEqual({ selection: false, inputs: false });
  });

  it("zh / en names come from the 案件 translations", async () => {
    await translate();
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => GOOD, calls);
    expect((await gen()).status).toBe(200);
    expect(calls[0]).toContain("1. API 確認（zh：API 确认／en：API check）");
    expect(JSON.parse((await row()).text).zh.summary[1]).toBe("■ 报表修正：改好");
  });

  it("hidden 案件's day plans and last week's lines never reach the model", async () => {
    await db().batch([
      db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-09-29', 'x', 'u')"),
      db().prepare(`INSERT INTO day_plan_items (id, date, text, detail, sort, ai_evidence, updated_at) VALUES
        ('P1', '2026-09-29', '隠し予定', '', 0, '[]', 'u'), ('P2', '2026-09-29', '見せ予定', '', 1, '[]', 'u'),
        ('P3', '2026-09-29', '混在予定', '', 2, '[]', 'u'), ('P4', '2026-09-29', '無関係予定', '', 3, '[]', 'u')`),
      db().prepare(`INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES ('P1', 'H'), ('P2', 'B'), ('P3', 'H'), ('P3', 'A')`),
      db().prepare(`INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at)
        VALUES ('2026-W39', '', ?1, NULL, 'h', 0, 'm', 'n', 'n')`).bind("■ 帳票：先週の隠し\n■ 帳票修正：先週の続き\n■ 帳票 : 別書式の隠し"),
    ]);
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN, calls);
    expect((await gen()).status).toBe(200);
    expect(calls[0]).not.toContain("隠し");
    expect(calls[0]).toContain("■ 帳票修正：先週の続き");
    for (const p of ["見せ予定", "混在予定", "無関係予定"]) expect(calls[0]).toContain(p);
  });

  it("a last-week line that mentions a hidden 案件 anywhere (その他 mid-line, zh / en name) never reaches the model", async () => {
    await translate();
    await db().prepare(`INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at)
      VALUES ('2026-W39', '', ?1, NULL, 'h', 0, 'm', 'n', 'n')`)
      .bind("■ 帳票修正：先週の続き\n■ その他：API 確認では準備。帳票では隠しの作業\n■ メモ：Report の隠し\n■ メモ2：报表の隠し").run();
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => GOOD, calls);
    expect((await gen()).status).toBe(200);
    expect(calls[0]).not.toContain("隠し");
    expect(calls[0]).toContain("■ 帳票修正：先週の続き");
  });

  it("a shown 案件's own notes may use a word equal to a hidden name: generates fine", async () => {
    await ingest([{ ...s("S4", "2026-09-29T06:00:00Z", "B", 20), summary: "API 確認のついでに 帳票 も見た" }]);
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN, calls);
    expect((await gen()).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("guard: a hidden name left in a part no shown / folded 案件 owns (an unlinked day plan) is never sent — 500 hidden leak, lock freed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await db().batch([
      db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-09-29', 'x', 'u')"),
      db().prepare(`INSERT INTO day_plan_items (id, date, text, detail, sort, ai_evidence, updated_at) VALUES ('P1', '2026-09-29', '帳票の件を確認', '', 0, '[]', 'u')`),
    ]);
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN, calls);
    const r = await gen();
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "hidden leak" });
    expect(calls).toHaveLength(0);
    expect(err).toHaveBeenCalled();
    const x = await row();
    expect(x.generating_at).toBeNull();
    expect(x.text).toBeNull();
    err.mockRestore();
  });

  it("a day plan linked to a shown 案件 may mention the hidden name (owned by it)", async () => {
    await db().batch([
      db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-09-29', 'x', 'u')"),
      db().prepare(`INSERT INTO day_plan_items (id, date, text, detail, sort, ai_evidence, updated_at) VALUES ('P1', '2026-09-29', 'API 確認と 帳票 の突合', '', 0, '[]', 'u')`),
      db().prepare(`INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES ('P1', 'B')`),
    ]);
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN);
    expect((await gen()).status).toBe(200);
  });

  it("the request carries the structured schema for this selection's ids", async () => {
    let body: any;
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN, [], (b) => { body = b; });
    expect((await gen()).status).toBe(200);
    expect(body.system).toContain("「■ <案件名>：」");
    expect(body.system).toContain("text の頭に案件名を繰り返さない");
    expect(body.output_config.format.schema.properties.ja.properties.lines.items.properties.id.enum).toEqual(["B", "A"]);
  });

  it("a reply that fails the check is logged and retried once: bad then good → 200", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    let n = 0;
    composeDeps.client = () => fakeAnthropic(() => (n++ === 0 ? SWAPPED : AS_SEEN), calls);
    expect((await gen()).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(calls[0]);
    const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("order:ja");
    expect(logged).toMatch(/reply length \d+/);   // reason + length only: the reply text stays out of the persistent Worker logs
    expect(logged).not.toContain("直した");
    expect((await row()).generating_at).toBeNull();
    err.mockRestore();
  });

  it("no retry when the first failed reply took 50 s or more: 502 at once, 1 call, lock freed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const t0 = Date.now();
    let clock = t0;
    composeDeps.now = () => clock;
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => { clock = t0 + 50_000; return SWAPPED; }, calls);
    const r = await gen();
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ reason: "order:ja" });
    expect(calls).toHaveLength(1);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("order:ja");
    expect((await row()).generating_at).toBeNull();
    err.mockRestore();
  });

  it("a request whose lock was taken over meanwhile writes nothing and answers 409 generating", async () => {
    const other = "2099-01-01T00:00:00.000Z";
    composeDeps.client = () => fakeAnthropic(async () => {
      await db().prepare("UPDATE pdf_compose SET generating_at = ?1").bind(other).run();   // another request took over
      return AS_SEEN;
    });
    const r = await gen();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "generating" });
    const x = await row();
    expect(x.text).toBeNull();
    expect(x.generating_at).toBe(other);   // the newer holder's lock is untouched
  });

  it("a line over the cap counts as a failed check: retried; still long → degraded and stored (200), 2 calls, logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    const long = `${"長".repeat(80)}。${"長".repeat(80)}。`;
    composeDeps.client = () => fakeAnthropic(() => ({ ...AS_SEEN, ja: lang([["B", long], ["A", "直した"]], [], "帳票修正を直した", "API 確認を済ませた") }), calls);
    const r = await gen();
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(2);
    const ja = JSON.parse((await row()).text).ja.summary;
    expect(ja[0]).toBe(`■ API 確認：${"長".repeat(80)}。`);
    expect(ja[1]).toBe("■ 帳票修正：直した");
    const logged = err.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("too-long:ja:0");
    expect(logged).toContain("degraded");
    err.mockRestore();
  });

  it("long first reply, retry throws (bad JSON) → the first reply is degraded and stored (200)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const long = lang([["B", `${"長".repeat(80)}。${"長".repeat(80)}。`], ["A", "直した"]], [], "帳票修正を直した", "API 確認を済ませた");
    composeDeps.client = () => fakeAnthropic(() => (n++ === 0 ? { ...AS_SEEN, ja: long } : { ja: "not the shape" }));
    const r = await gen();
    expect(r.status).toBe(200);
    expect(n).toBe(2);
    expect(JSON.parse((await row()).text).ja.summary[0]).toBe(`■ API 確認：${"長".repeat(80)}。`);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("retry threw");
    err.mockRestore();
  });

  it("a long reply at 50 s or later: no retry, degraded and stored, exactly 1 call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t0 = Date.now();
    let clock = t0;
    composeDeps.now = () => clock;
    const calls: string[] = [];
    const long = lang([["B", `${"長".repeat(80)}。${"長".repeat(80)}。`], ["A", "直した"]], [], "帳票修正を直した", "API 確認を済ませた");
    composeDeps.client = () => fakeAnthropic(() => { clock = t0 + 50_000; return { ...AS_SEEN, ja: long }; }, calls);
    expect((await gen()).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((await row()).text).ja.summary[0]).toBe(`■ API 確認：${"長".repeat(80)}。`);
  });

  it("long first reply, good retry → the retry is stored as written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const long = lang([["B", "長".repeat(200)], ["A", "直した"]], [], "帳票修正を直した", "API 確認を済ませた");
    composeDeps.client = () => fakeAnthropic(() => (n++ === 0 ? { ...AS_SEEN, ja: long } : AS_SEEN));
    expect((await gen()).status).toBe(200);
    expect(JSON.parse((await row()).text).ja.summary[0]).toBe("■ API 確認：済んだ");
  });

  it("long first reply, retry structurally wrong → the first reply is degraded and stored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    const long = lang([["B", `${"長".repeat(80)}。${"長".repeat(80)}。`], ["A", "直した"]], [], "帳票修正を直した", "API 確認を済ませた");
    composeDeps.client = () => fakeAnthropic(() => (n++ === 0 ? { ...AS_SEEN, ja: long } : SWAPPED));
    expect((await gen()).status).toBe(200);
    expect(JSON.parse((await row()).text).ja.summary[0]).toBe(`■ API 確認：${"長".repeat(80)}。`);
  });

  it("both replies fail the check → 502, exactly 2 model calls, lock freed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => SWAPPED, calls);
    const r = await gen();
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: "generate failed", reason: "order:ja" });
    expect(calls).toHaveLength(2);
    const x = await row();
    expect(x.generating_at).toBeNull();
    expect(x.text).toBeNull();
    err.mockRestore();
  });

  it("409 while another generation holds the lock; takes over an expired lock and generates", async () => {
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN);
    await db().prepare("UPDATE pdf_compose SET generating_at = ?1").bind(new Date().toISOString()).run();
    expect(await (await gen()).json()).toEqual({ error: "generating" });
    expect((await row()).text).toBeNull();
    await db().prepare("UPDATE pdf_compose SET generating_at = ?1").bind(new Date(Date.now() - 181_000).toISOString()).run();
    const r = await gen();
    expect(r.status).toBe(200);
    const x = await row();
    expect(x.generating_at).toBeNull();
    expect(JSON.parse(x.text).ja.summary).toEqual(["■ API 確認：済んだ", "■ 帳票修正：直した"]);
  });

  it("releases the lock when the model throws; old text untouched; 502", async () => {
    await db().prepare("UPDATE pdf_compose SET text = ?1").bind(JSON.stringify({ ja: { summary: ["old"], days: {} }, zh: { summary: ["old"], days: {} }, en: { summary: ["old"], days: {} } })).run();
    composeDeps.client = () => fakeAnthropic(() => new Response("boom", { status: 500 }));
    const r = await gen();
    expect(r.status).toBe(502);
    expect(await r.json()).toMatchObject({ error: "generate failed" });
    const x = await row();
    expect(x.generating_at).toBeNull();
    expect(JSON.parse(x.text).ja.summary).toEqual(["old"]);
  });

  it("502 with a reason when the reply mentions a hidden 案件, breaks the order or the shape", async () => {
    composeDeps.client = () => fakeAnthropic(() => SWAPPED);
    expect(await (await gen()).json()).toMatchObject({ error: "generate failed", reason: "order:ja" });
    composeDeps.client = () => fakeAnthropic(() => ({ ...AS_SEEN, zh: lang([["B", "完成，帳票也看了"], ["A", "改好"]], [], "改好帳票修正", "完成 API 確認") }));
    expect(await (await gen()).json()).toMatchObject({ error: "generate failed", reason: "hidden-mentioned:H" });
    composeDeps.client = () => fakeAnthropic(() => ({ ja: AS_SEEN.ja }));
    expect((await gen()).status).toBe(502);
    const x = await row();
    expect(x.text).toBeNull();
    expect(x.generating_at).toBeNull();
  });

  it("503 without an API key", async () => {
    composeDeps.client = () => null;
    expect((await gen()).status).toBe(503);
    expect((await row()).generating_at).toBeNull();
  });

  describe("nothing to generate: 422, no model call, no lock left behind", () => {
    const expect422 = async () => {
      const calls: string[] = [];
      composeDeps.client = () => fakeAnthropic(() => AS_SEEN, calls);
      const r = await gen();
      expect(r.status).toBe(422);
      expect(await r.json()).toEqual({ error: "nothing to generate" });
      expect(calls).toHaveLength(0);
      expect((await row())?.generating_at ?? null).toBeNull();
    };
    it("no work at all", async () => { await db().prepare("DELETE FROM sessions").run(); await expect422(); });
    it("every 案件 hidden", async () => {
      await setItems([{ id: "B", mode: "hide" }, { id: "A", mode: "hide" }, { id: "H", mode: "hide" }]);
      await expect422();
    });
    it("only 未関連 work", async () => {
      await db().prepare("DELETE FROM sessions").run();
      await ingest([s("U1", "2026-09-29T05:00:00Z", null, 30)]);
      await expect422();
    });
  });

  it("folded 案件 only: generates; the server writes the その他 line from the canonical names", async () => {
    await setItems([{ id: "B", mode: "other" }, { id: "A", mode: "other" }, { id: "H", mode: "hide" }]);
    await translate();
    const calls: string[] = [];
    composeDeps.client = () => fakeAnthropic(() => ({
      ja: lang([], [["A", "直した。"], ["B", "確認した"]], "x", "y"), zh: lang([], [["A", "改好了"], ["B", "确认了。"]], "x", "y"),
      en: lang([], [["A", "fixed the layout."], ["B", "checked it"]], "x", "y") }), calls);
    expect((await gen()).status).toBe(200);
    expect(calls[0]).toContain("単独行（この順で）：なし");
    // folded rows in the selection's order (B has fewer minutes than A: A first)
    expect(JSON.parse((await row()).text)).toMatchObject({
      ja: { summary: ["■ その他：帳票修正では、直した。API 確認では、確認した。"] },
      zh: { summary: ["■ 其他：报表修正：改好了；API 确认：确认了。"] },
      en: { summary: ["■ Other: In Report fix, fixed the layout. In API check, checked it."] } });
  });

  it("counts D1 statements for a generation (model faked)", async () => {
    const d = db(); let n = 0;
    const prepare = d.prepare.bind(d), batch = d.batch.bind(d);
    const counted = new Proxy(d, { get: (_t, k) =>
      k === "prepare" ? (q: string) => { n++; return prepare(q); }
      : k === "batch" ? (st: any[]) => { n += st.length; return batch(st); } : (d as any)[k] });
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN);
    expect((await gen(counted)).status).toBe(200);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(40);
  });
});

describe("checkReply (structural)", () => {
  const names = { A: { ja: "帳票修正", zh: "报表修正", en: "Report fix" }, B: { ja: "API 確認", zh: "API 确认", en: "API check" },
    H: { ja: "帳票", zh: "报表", en: "Report" }, O: { ja: "雑務", zh: "杂务", en: "Chores" } };
  const items = [{ id: "B", mode: "show" as const }, { id: "A", mode: "show" as const }, { id: "H", mode: "hide" as const }];
  const withOther = [...items, { id: "O", mode: "other" as const }];
  const one = (lines: Pair[], other: Pair[] = [], days: Record<string, string[]> = {}) => ({
    lines: lines.map(([id, text]) => ({ id, text })), other: other.map(([id, text]) => ({ id, text })), days });
  const all = (lines: Pair[], other: Pair[] = []) => ({ ja: one(lines, other), zh: one(lines, other), en: one(lines, other) });

  it("shown ids in order and folded ids as a set → null; a hidden name inside a shown name is no mention", () => {
    expect(checkReply(all([["B", "x"], ["A", "帳票修正を直した"]]), items, names)).toBeNull();
    expect(checkReply(all([["B", "x"], ["A", "y"]], [["O", "z"]]), withOther, names)).toBeNull();
  });
  it("a hidden name inside a folded name is not a mention", () => {
    const n = { ...names, O: { ja: "帳票の整理", zh: "报表整理", en: "Report cleanup" } };
    expect(checkReply(all([["B", "x"], ["A", "y"]], [["O", "帳票の整理を少し"]]), withOther, n)).toBeNull();
  });
  it("order, missing and unexpected shown ids", () => {
    expect(checkReply(all([["A", "y"], ["B", "x"]]), items, names)).toBe("order:ja");
    expect(checkReply(all([["B", "x"]]), items, names)).toBe("missing:ja:A");
    expect(checkReply(all([["B", "x"], ["A", "y"], ["O", "z"]]), items, names)).toBe("unexpected:ja:O");
  });
  it("folded ids must be exactly the folded set", () => {
    expect(checkReply(all([["B", "x"], ["A", "y"]]), withOther, names)).toBe("other-missing:ja:O");
    expect(checkReply(all([["B", "x"], ["A", "y"]], [["O", "z"]]), items, names)).toBe("other-unexpected:ja:O");
    expect(checkReply(all([["B", "x"], ["A", "y"]], [["O", "z"], ["O", "w"]]), withOther, names)).toBe("other-duplicate:ja:O");
  });
  it("a hidden id anywhere, or a hidden name (any language) in a body, is caught; day lines are not checked (never printed)", () => {
    expect(checkReply(all([["B", "x"], ["A", "y"], ["H", "z"]]), items, names)).toBe("hidden-id:H");
    expect(checkReply(all([["B", "帳票も見た"], ["A", "y"]]), items, names)).toBe("hidden-mentioned:H");
    const r = all([["B", "x"], ["A", "y"]]);
    r.en = one([["B", "x"], ["A", "y"]], [], { "2026-09-29": ["Looked at the Report"] });
    expect(checkReply(r, items, names)).toBeNull();
  });
  it("an empty body fails; zh is checked like ja", () => {
    expect(checkReply(all([["B", " "], ["A", "y"]]), items, names)).toBe("empty:ja:B");
    const r = all([["B", "x"], ["A", "y"]]);
    r.zh = one([["A", "y"], ["B", "x"]]);
    expect(checkReply(r, items, names)).toBe("order:zh");
  });
  it("more summary lines than the PDF shows (6) → too-many-lines", () => {
    const ids = ["S1", "S2", "S3", "S4", "S5", "S6"];
    const n = Object.fromEntries([...ids, "O"].map((id) => [id, { ja: id, zh: id, en: id }]));
    const it6 = [...ids.map((id) => ({ id, mode: "show" as const })), { id: "O", mode: "other" as const }];
    expect(checkReply(all(ids.map((id) => [id, "x"] as Pair), [["O", "z"]]), it6, n)).toBe("too-many-lines:ja");
    // exactly 6: five shown + その他, or six shown alone
    const it5 = [...ids.slice(0, 5).map((id) => ({ id, mode: "show" as const })), { id: "S6", mode: "hide" as const }, { id: "O", mode: "other" as const }];
    expect(checkReply(all(ids.slice(0, 5).map((id) => [id, "x"] as Pair), [["O", "z"]]), it5, n)).toBeNull();
    expect(checkReply(all(ids.map((id) => [id, "x"] as Pair)), it6.slice(0, 6), n)).toBeNull();
  });
});

describe("assembleText: the server writes heads and the その他 line from canonical names", () => {
  const names = { A: { ja: "帳票修正", zh: "报表修正", en: "Report fix" }, B: { ja: "API 確認", zh: "API 确认", en: "API check" },
    S: { ja: "Data Wiki：規格 RAG 検索サービス開発", zh: "Data Wiki：规格 RAG 检索服务开发", en: "Data Wiki: standard RAG search" } };
  const one = (lines: Pair[], other: Pair[]) => ({ lines: lines.map(([id, text]) => ({ id, text })), other: other.map(([id, text]) => ({ id, text })), days: { "2026-09-28": ["d"] } });
  it("shown lines in reply order, その他 from the folded bodies in the given order; trailing 。/. stripped", () => {
    const out = assembleText({ ja: one([["S", "公開した。"]], [["A", "直した。"], ["B", "確認した"]]),
      zh: one([["S", "上线了。"]], [["A", "改好了"], ["B", "确认了。"]]),
      en: one([["S", "Released it."]], [["A", "Windows builds fixed."], ["B", "GitHub runners moved"]]) }, ["A", "B"], names);
    expect(out.ja).toEqual({ summary: ["■ Data Wiki：規格 RAG 検索サービス開発：公開した。", "■ その他：帳票修正では、直した。API 確認では、確認した。"], days: { "2026-09-28": ["d"] } });
    expect(out.zh.summary).toEqual(["■ 「Data Wiki：规格 RAG 检索服务开发」：上线了。", "■ 其他：报表修正：改好了；API 确认：确认了。"]);
    expect(out.en.summary).toEqual(["■ Data Wiki: standard RAG search: Released it.", "■ Other: In Report fix, Windows builds fixed. In API check, GitHub runners moved."]);
  });
  it("bodies pass through with no case change; trailing ！？；!?; are stripped like 。/. before joining", () => {
    const out = assembleText({ ja: one([], [["A", "直した！"], ["B", "確認した？"]]), zh: one([], [["A", "改好了！"], ["B", "确认了；"]]),
      en: one([], [["A", "Fixed it!"], ["B", "done?"]]) }, ["A", "B"], names);
    expect(out.ja.summary).toEqual(["■ その他：帳票修正では、直した。API 確認では、確認した。"]);
    expect(out.zh.summary).toEqual(["■ 其他：报表修正：改好了；API 确认：确认了。"]);
    expect(out.en.summary).toEqual(["■ Other: In Report fix, Fixed it. In API check, done."]);
  });
  it("nothing folded → no その他 line", () => {
    const out = assembleText({ ja: one([["A", "x"]], []), zh: one([["A", "x"]], []), en: one([["A", "x"]], []) }, [], names);
    expect(out.ja.summary).toEqual(["■ 帳票修正：x"]);
  });
});

describe("line cap (pdf fit, evidence/step_09_fit_measure.md)", () => {
  const names = { A: { ja: "帳票修正", zh: "报表修正", en: "Report fix" }, B: { ja: "API 確認", zh: "API 确认", en: "API check" },
    S: { ja: "Data Wiki：検索", zh: "Data Wiki：检索", en: "Data Wiki: search" } };
  const one = (lines: Pair[], other: Pair[] = []) => ({ lines: lines.map(([id, text]) => ({ id, text })), other: other.map(([id, text]) => ({ id, text })), days: {} });
  const same = (lines: Pair[], other: Pair[] = []) => ({ ja: one(lines, other), zh: one(lines, other), en: one(lines, other) });
  const pad = (n: number) => "あ".repeat(n);

  it("two caps: the prompt aims ~5% under (136 / 136 / 280); the check and degrade use the measured p10 (144 / 144 / 294)", () => {
    expect(LINE_CAP).toEqual({ ja: 136, zh: 136, en: 280 });
    expect(FIT_CAP).toEqual({ ja: 144, zh: 144, en: 294 });
  });
  it("joins: ja 「Aでは、x。」; zh wraps a name holding a colon in 「」 (no stacked colons); en unchanged", () => {
    const out = assembleText(same([], [["S", "x"], ["A", "y"]]), ["S", "A"], names);
    expect(out.ja.summary).toEqual(["■ その他：Data Wiki：検索では、x。帳票修正では、y。"]);
    expect(out.zh.summary).toEqual(["■ 其他：「Data Wiki：检索」：x；报表修正：y。"]);
    expect(out.en.summary).toEqual(["■ Other: In Data Wiki: search, x. In Report fix, y."]);
  });
  it("the check threshold is FIT_CAP: over the prompt cap but within 144 passes; 145 is too long (en 294 / 295)", () => {
    const head = "■ 帳票修正：".length, enHead = "■ Report fix: ".length;
    expect(longLine(assembleText(same([["A", pad(137 - head)]]), [], names))).toBeNull();
    expect(longLine(assembleText(same([["A", pad(144 - head)]]), [], names))).toBeNull();
    expect(longLine(assembleText(same([["A", pad(145 - head)]]), [], names))).toBe("too-long:ja:0");
    const en = (n: number) => ({ ...same([["A", "x"]]), en: one([["A", "a".repeat(n - enHead)]]) });
    expect(longLine(assembleText(en(294), [], names))).toBeNull();
    expect(longLine(assembleText(en(295), [], names))).toBe("too-long:en:0");
    const d = same([["A", pad(140 - head)]]);
    expect(fitToCap(d, [], names)).toEqual({ text: assembleText(d, [], names), notes: [] });   // no degrade either
  });
  it("per-body limits: shown = cap − its head; folded = (cap − その他 frame with names) / n", () => {
    const lim = bodyLimits([{ id: "A", mode: "show" }, { id: "B", mode: "other" }, { id: "S", mode: "other" }], names);
    expect(lim.ja.shown.A).toBe(136 - "■ 帳票修正：".length);
    expect(lim.en.shown.A).toBe(280 - "■ Report fix: ".length);
    expect(lim.ja.other).toBe(Math.floor((136 - "■ その他：API 確認では、。Data Wiki：検索では、。".length) / 2));
    expect(lim.zh.other).toBe(Math.floor((136 - "■ 其他：API 确认：；「Data Wiki：检索」：。".length) / 2));
    expect(lim.en.other).toBe(Math.floor((280 - "■ Other: In API check, . In Data Wiki: search, .".length) / 2));
    expect(bodyLimits([{ id: "A", mode: "show" }], names).ja.other).toBeNull();
  });
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`N${i}`, { ja: `長い案件名その${i}${"あ".repeat(10)}`, zh: `很长的案件名${i}${"あ".repeat(10)}`, en: `A rather long project name number ${i}` }]));
  const manyIds = Object.keys(many);
  it("an その他 frame (names + joins, no bodies) over the threshold: no body limit, names only assembled directly, no retry", () => {
    const items = manyIds.map((id) => ({ id, mode: "other" as const }));
    const lim = bodyLimits(items, many);
    expect(lim.ja.other).toBe("names");
    expect(lim.en.other).toBe("names");
    const p = composePrompt({ days: {}, weekOf: () => "w" } as any, items, many);
    expect(p).toContain("その他にまとめる各案件：ja 名前だけ表示（text は数語でよい）／zh 名前だけ表示（text は数語でよい）／en 名前だけ表示（text は数語でよい）");
    expect(p).not.toMatch(/各案件：ja -?\d/);
    const out = assembleText(same([], manyIds.map((id) => [id, "少し"] as Pair)), manyIds, many);
    expect(out.ja.summary).toEqual([`■ その他：${manyIds.map((id) => many[id].ja).join("、")}`]);
    expect(out.en.summary).toEqual([`■ Other: ${manyIds.map((id) => many[id].en).join(", ")}`]);
    expect(longLine(out, manyIds, many)).toBeNull();   // names only is never "too long": nothing to retry
  });
  it("names-only その他 bodies are never shown: an empty body or a hidden name there is no failure (elsewhere it still is)", () => {
    const n = { ...many, H: { ja: "隠し", zh: "隐藏", en: "Secret" } };
    const items = [...manyIds.map((id) => ({ id, mode: "other" as const })), { id: "H", mode: "hide" as const }];
    const body = (t: string) => ({ lines: [], other: manyIds.map((id) => ({ id, text: t })), days: {} });
    expect(checkReply({ ja: body(""), zh: body("隐藏的事"), en: body("Secret stuff") }, items, n)).toBeNull();
    // a selection whose その他 carries bodies still checks them
    const few = { A: names.A, B: names.B, H: n.H };
    const it2 = [{ id: "A", mode: "other" as const }, { id: "B", mode: "other" as const }, { id: "H", mode: "hide" as const }];
    const b2 = (a: string) => ({ lines: [], other: [{ id: "A", text: a }, { id: "B", text: "x" }], days: {} });
    expect(checkReply({ ja: b2(""), zh: b2("x"), en: b2("x") }, it2, few)).toBe("empty:ja:A");
    expect(checkReply({ ja: b2("隠しも見た"), zh: b2("x"), en: b2("x") }, it2, few)).toBe("hidden-mentioned:H");
    expect(COMPOSE_SYSTEM).toContain("「名前だけ表示」の言語では、その他の text は数語でよい（完結した文でなくてよい）");
  });
  it("a frame between the prompt cap and the threshold still gets no impossible (≤ 0) limit", () => {
    const n2 = { X: { ja: "あ".repeat(60), zh: "あ".repeat(60), en: "x" }, Y: { ja: "い".repeat(62), zh: "い".repeat(62), en: "y" } };
    const lim = bodyLimits([{ id: "X", mode: "other" }, { id: "Y", mode: "other" }], n2);
    expect(lim.ja.other).toBe("names");
    expect(typeof lim.en.other).toBe("number");
    expect(lim.en.other as number).toBeGreaterThan(0);
  });
  it("prompt: per-body limits per language, complete sentences, no code conflation, last week is not this week", async () => {
    const p = composePrompt({ days: {}, weekOf: () => "w" } as any, [{ id: "A", mode: "show" }, { id: "B", mode: "other" }], names);
    const lim = bodyLimits([{ id: "A", mode: "show" }, { id: "B", mode: "other" }], names);
    expect(p).toContain(`帳票修正［id：A］：ja ${lim.ja.shown.A} 字／zh ${lim.zh.shown.A} 字／en ${lim.en.shown.A} 字`);
    expect(p).toContain(`その他にまとめる各案件：ja ${lim.ja.other} 字／zh ${lim.zh.other} 字／en ${lim.en.other} 字`);
    expect(COMPOSE_SYSTEM).toContain("字数以内");
    expect(COMPOSE_SYSTEM).toContain("完結した文");
    expect(COMPOSE_SYSTEM).toContain("別々の記録にあるコードや ID を同じものと見なさない");
    expect(COMPOSE_SYSTEM).toContain("先週の成果を今週の作業として書かない");
  });

  it("splitSentences: ja / zh only on full-width 。．！？ with closers kept attached; en not after e.g. / i.e. / vs. / etc.", () => {
    expect(splitSentences("ja", "「A」を直した。」次に?B を見た！最後")).toEqual(["「A」を直した。」", "次に?B を見た！", "最後"]);
    expect(splitSentences("zh", "完成了（第一版）。）接着做 B？好")).toEqual(["完成了（第一版）。）", "接着做 B？", "好"]);
    expect(splitSentences("en", "Fixed e.g. the parser, i.e. the lexer vs. the old one etc. and more. Then shipped it! Done")).toEqual(
      ["Fixed e.g. the parser, i.e. the lexer vs. the old one etc. and more.", "Then shipped it!", "Done"]);
  });
  it("zh shown head wraps a colon-holding name in 「」 too; namedIn / checkRetranslated / rewriteHeads recognise it", () => {
    const out = assembleText(same([["S", "上线了"]]), [], names);
    expect(out.zh.summary).toEqual(["■ 「Data Wiki：检索」：上线了"]);
    expect(out.ja.summary).toEqual(["■ Data Wiki：検索：上线了"]);
    expect(bodyLimits([{ id: "S", mode: "show" }], names).zh.shown.S).toBe(136 - "■ 「Data Wiki：检索」：".length);
    const zh = { summary: out.zh.summary, days: {} };
    expect(namedIn(zh, "zh", names).heads).toEqual(["S"]);
    // zh edit → en / ja retranslations
    expect(checkRetranslated(zh, "zh", { summary: ["■ Data Wiki: search: launched"], days: {} }, "en", names)).toBeNull();
    expect(rewriteHeads(zh, "zh", { summary: ["■ Data Wiki: RAG search: launched"], days: {} }, "en", names).summary).toEqual(["■ Data Wiki: search: launched"]);
    // ja edit → zh: the translated head is put back wrapped, unwrapped or not
    const ja = { summary: ["■ Data Wiki：検索：公開した"], days: {} };
    expect(rewriteHeads(ja, "ja", { summary: ["■ Data Wiki：检索服务：上线了"], days: {} }, "zh", names).summary).toEqual(["■ 「Data Wiki：检索」：上线了"]);
    expect(rewriteHeads(ja, "ja", { summary: ["■ 「Data Wiki：检索」：上线了"], days: {} }, "zh", names).summary).toEqual(["■ 「Data Wiki：检索」：上线了"]);
    expect(checkRetranslated(ja, "ja", { summary: ["■ 「Data Wiki：检索」：上线了"], days: {} }, "zh", names)).toBeNull();
  });

  describe("fitToCap (after the retry): degrade instead of 502", () => {
    it("a long shown line keeps whole sentences from the start (ja / zh on 。, en on . )", () => {
      const ja = `${pad(60)}。${pad(60)}。${pad(60)}。`, en = `${"a".repeat(130)}. ${"b".repeat(130)}. ${"c".repeat(130)}.`;
      const { text, notes } = fitToCap({ ja: one([["A", ja]]), zh: one([["A", ja]]), en: one([["A", en]]) }, [], names);
      expect(text.ja.summary).toEqual([`■ 帳票修正：${pad(60)}。${pad(60)}。`]);
      expect(text.zh.summary).toEqual([`■ 报表修正：${pad(60)}。${pad(60)}。`]);
      expect(text.en.summary).toEqual([`■ Report fix: ${"a".repeat(130)}. ${"b".repeat(130)}.`]);
      expect(notes).toHaveLength(3);
      expect(notes[0]).toMatch(/^ja: shown line 0/);
    });
    it("a first sentence that does not fit is cut at the cap and ends with …", () => {
      const { text } = fitToCap(same([["A", pad(300)]]), [], names);
      expect(text.ja.summary[0].length).toBe(144);
      expect(text.ja.summary[0].endsWith("…")).toBe(true);
      expect(text.ja.summary[0].startsWith("■ 帳票修正：あ")).toBe(true);
    });
    it("a long その他 line becomes names only, in all three languages", () => {
      const { text, notes } = fitToCap(same([["B", "x"]], [["A", pad(300)], ["S", "y"]]), ["A", "S"], names);
      expect(text.ja.summary).toEqual(["■ API 確認：x", "■ その他：帳票修正、Data Wiki：検索"]);
      expect(text.zh.summary).toEqual(["■ API 确认：x", "■ 其他：报表修正、「Data Wiki：检索」"]);
      expect(text.en.summary).toEqual(["■ API check: x", "■ Other: Report fix, Data Wiki: search"]);
      expect(notes.some((n) => /^ja: その他 → names only/.test(n))).toBe(true);
    });
    it("names only lists every folded name, however long (no elision), in all three languages", () => {
      const d = same([], manyIds.map((id) => [id, pad(30)] as Pair));
      const { text } = fitToCap(d, manyIds, many);
      expect(text.ja.summary[0]).toBe(`■ その他：${manyIds.map((id) => many[id].ja).join("、")}`);
      expect(text.zh.summary[0]).toBe(`■ 其他：${manyIds.map((id) => many[id].zh).join("、")}`);
      expect(text.en.summary[0]).toBe(`■ Other: ${manyIds.map((id) => many[id].en).join(", ")}`);
      for (const l of ["ja", "zh", "en"] as const) expect(text[l].summary[0]).not.toMatch(/ほか|等 \d|more/);
    });
    it("ja and zh keep 1 sentence while en, whose first sentence alone is too long, is cut at the cap with …", () => {
      const d = {
        ja: one([["A", `${pad(60)}。${pad(60)}。${pad(60)}。`]]),
        zh: one([["A", `${pad(50)}。${pad(50)}。${pad(50)}。`]]),
        en: one([["A", `${"a".repeat(300)}. ${"b".repeat(20)}.`]]),
      };
      const { text, notes } = fitToCap(d, [], names);
      expect(text.ja.summary).toEqual([`■ 帳票修正：${pad(60)}。`]);
      expect(text.zh.summary).toEqual([`■ 报表修正：${pad(50)}。`]);
      expect(text.en.summary[0]).toHaveLength(294);
      expect(text.en.summary[0]).toMatch(/^■ Report fix: a+…$/);
      expect(notes.some((n) => /^en: shown line 0 cut at the cap/.test(n))).toBe(true);
    });
    it("a degraded shown line keeps the same number of sentences in every language (the fewest that fit everywhere)", () => {
      // ja fits 2 sentences, zh fits 3 (short), en fits 1 → all keep 1
      const d = {
        ja: one([["A", `${pad(60)}。${pad(60)}。${pad(60)}。`]]),
        zh: one([["A", "短。短。短。"]]),
        en: one([["A", `${"a".repeat(200)}. ${"b".repeat(200)}.`]]),
      };
      const { text } = fitToCap(d, [], names);
      expect(text.ja.summary).toEqual([`■ 帳票修正：${pad(60)}。`]);
      expect(text.zh.summary).toEqual(["■ 报表修正：短。"]);
      expect(text.en.summary).toEqual([`■ Report fix: ${"a".repeat(200)}.`]);
    });
    it("lines within the cap are untouched, with no notes", () => {
      const d = same([["A", "x"]], [["B", "y"]]);
      expect(fitToCap(d, ["B"], names)).toEqual({ text: assembleText(d, ["B"], names), notes: [] });
    });
  });
});

describe("compose prompt and schema", () => {
  it("the system prompt describes lines / other bodies without heads; the schema limits ids to the selection", () => {
    expect(COMPOSE_SYSTEM).toContain("lines");
    expect(COMPOSE_SYSTEM).toContain("other");
    expect(COMPOSE_SYSTEM).toContain("サーバーが付ける");
    // the frame each body goes into, per language, and no repeated name
    for (const f of ["ja は「■ <案件名>：<text>」", "en は「■ <name>: <text>」", "ja は「<案件名>では<text>。」", "zh は「<案件名>：<text>」", "en は「In <name>, <text>.」"]) expect(COMPOSE_SYSTEM).toContain(f);
    expect(COMPOSE_SYSTEM).toContain("text の頭に案件名を繰り返さない");
    expect(COMPOSE_SYSTEM).toContain("小文字で始める");
    expect(COMPOSE_SYSTEM).not.toContain("本文で案件に触れる時は");
    const sc = composeSchema(["B", "A"]) as any;
    expect(sc.properties.ja.properties.lines.items.properties.id.enum).toEqual(["B", "A"]);
    expect(sc.properties.en.properties.other.items.properties.id.enum).toEqual(["B", "A"]);
  });
});

describe("rewriteHeads", () => {
  const names = { R: { ja: "研究", zh: "研究项目", en: "Research" }, B: { ja: "API 確認", zh: "API 确认", en: "API check" } };
  const lt = (summary: string[]) => ({ summary, days: {} });
  it("a translated head with a colon inside is replaced whole, no fragment left", () => {
    expect(rewriteHeads(lt(["■ 研究：本文"]), "ja", lt(["■ A: B：正文"]), "zh", names).summary).toEqual(["■ 研究项目：正文"]);
    expect(rewriteHeads(lt(["■ 研究：本文"]), "ja", lt(["■ Phase 2: Study: progress made"]), "en", names).summary).toEqual(["■ Research: progress made"]);
  });
  it("a colon in the body (as in the edited body) stays in the body", () => {
    expect(rewriteHeads(lt(["■ 研究：方針：決定"]), "ja", lt(["■ Study: policy: decided"]), "en", names).summary).toEqual(["■ Research: policy: decided"]);
  });
  it("a head already the canonical name is kept as it is", () => {
    expect(rewriteHeads(lt(["■ 研究：本文"]), "ja", lt(["■ Research: body"]), "en", names).summary).toEqual(["■ Research: body"]);
  });
  it("a name holding a full-width colon survives (Data Wiki：…)", () => {
    const n = { S: { ja: "Data Wiki：規格 RAG 検索サービス開発", zh: "Data Wiki：规格 RAG 检索服务开发", en: "Data Wiki: standard RAG search" } };
    const src = lt(["■ Data Wiki：規格 RAG 検索サービス開発：公開した"]);
    expect(rewriteHeads(src, "ja", lt(["■ Data Wiki：规格 RAG 检索服务开发：上线了"]), "zh", n).summary).toEqual(["■ 「Data Wiki：规格 RAG 检索服务开发」：上线了"]);   // zh heads wrap a colon name
    expect(rewriteHeads(src, "ja", lt(["■ Data Wiki: RAG search service for standards: Released"]), "en", n).summary).toEqual(["■ Data Wiki: standard RAG search: Released"]);
  });
  it("a plain (headless) edited line among headed lines stays unchanged", () => {
    const out = rewriteHeads(lt(["■ API 確認：済", "今週は順調：特になし", "■ 研究：進めた"]), "ja",
      lt(["■ API test: done", "A smooth week: nothing special", "■ Study: moved on"]), "en", names);
    expect(out.summary).toEqual(["■ API check: done", "A smooth week: nothing special", "■ Research: moved on"]);
  });
});

describe("withoutHidden / withoutHiddenCtx / composePrompt", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  it("drops hidden 案件 rows and blocks; hiding 未関連 drops task_id null rows", async () => {
    await ingest([s("U1", "2026-09-29T05:00:00Z", null, 30)]);
    const { data } = (await loadInputs(db(), WEEK))!;
    const w = withoutHidden(data, [{ id: "B", mode: "show" }, { id: "A", mode: "other" }, { id: "H", mode: "hide" }]);
    expect(w.tasks.map((r) => r.task.id).sort()).toEqual(["A", "B"]);
    expect(w.days.some((r) => r.task_id === "H")).toBe(false);
    expect(w.days.some((r) => r.task_id === null)).toBe(true);
    const u = withoutHidden(data, [{ id: "B", mode: "show" }, { id: "__unassigned", mode: "hide" }]);
    expect(u.days.some((r) => r.task_id === null)).toBe(false);
    expect(u.days.some((r) => r.task_id === "H")).toBe(true);
  });
  it("withoutHiddenCtx keeps unlinked plans and lines of other 案件", () => {
    const ctx = { plans: [], lastWeek: "■ 帳票：a\n■ 帳票修正：b\n■ その他：c", dayPlans: [
      { date: "d", text: "h", detail: "", status: null, progress: null, task_ids: ["H"] },
      { date: "d", text: "free", detail: "", status: null, progress: null, task_ids: [] }] };
    const out = withoutHiddenCtx(ctx, new Set(["H"]), ["帳票"], ["帳票修正"]);
    expect(out.dayPlans.map((p) => p.text)).toEqual(["free"]);
    expect(out.lastWeek).toBe("■ 帳票修正：b\n■ その他：c");
    expect(withoutHiddenCtx({ ...ctx, lastWeek: "■ 帳票：a" }, new Set(["H"]), ["帳票"], ["帳票修正"]).lastWeek).toBeNull();
  });
  it("withoutHiddenCtx drops any last-week line containing a hidden name in any language, not only lines headed by it", () => {
    const ctx = { plans: [], dayPlans: [], lastWeek: "■ 帳票修正：b\n■ その他：API では x。帳票 では y\n■ API：Report z\n■ API：报表 w\n■ 雑務：帳票修正の続き" };
    expect(withoutHiddenCtx(ctx, new Set(["H"]), ["帳票", "报表", "Report"], ["帳票修正", "报表修正", "Report fix"]).lastWeek)
      .toBe("■ 帳票修正：b\n■ 雑務：帳票修正の続き");
  });
  it("composePrompt lists the selection in order with the three names", async () => {
    const { data, ctx } = (await loadInputs(db(), WEEK))!;
    const names = { A: { ja: "帳票修正", zh: "报表修正", en: "Report fix" }, B: { ja: "API 確認", zh: "API 确认", en: "API check" } };
    const p = composePrompt(digestInputs(data, ctx), [{ id: "B", mode: "show" }, { id: "A", mode: "other" }], names);
    expect(p).toContain("単独行（この順で）：1. API 確認（zh：API 确认／en：API check）［id：B］");
    expect(p).toContain("その他にまとめる：帳票修正（zh：报表修正／en：Report fix）［id：A］");
    expect(p).not.toContain("## 日別まとめ");
  });
});

describe("hand edit", () => {
  let jobs: Promise<unknown>[];
  beforeEach(async () => {
    await resetDb(); await seed(); jobs = [];
    await db().prepare("UPDATE pdf_compose SET text = ?1").bind(JSON.stringify({ ja: { summary: ["a"], days: { "2026-09-28": ["d"] } },
      zh: { summary: ["甲"], days: { "2026-09-28": ["丁"] } }, en: { summary: ["A"], days: { "2026-09-28": ["D"] } } })).run();
  });
  afterEach(() => { composeDeps.client = real; vi.restoreAllMocks(); });
  const put = (body: unknown, key = "k") => reports.request(`/${WEEK}/pdf/compose/text`, { method: "PUT", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" } }, { DB: db(), ANTHROPIC_API_KEY: key } as any, { waitUntil: (p: Promise<unknown>) => { jobs.push(p); }, passThroughOnException() {} } as any);
  const view_ = async (l: string) => await (await reports.request(`/${WEEK}/pdf/compose?lang=${l}`, {}, { DB: db() } as any)).json() as any;
  const texts = async () => JSON.parse((await row()).text);
  const ZH_EDIT = { lang: "zh", summary: ["改过的"], days: { "2026-09-28": ["改过的日"] } };
  const FROM_ZH = { source: "zh", zh: "x", ja: "直した\n\n## 2026-09-28\n直した日", en: "Fixed\n\n## 2026-09-28\nFixed day" };

  it("markdown round trip keeps the structure; a changed structure is null", () => {
    const t = { summary: ["■ x：y", "■ その他：z"], days: { "2026-09-28": ["d1"], "2026-09-29": ["d2"] } };
    expect(fromMarkdown(toMarkdown(t), t)).toEqual(t);
    expect(fromMarkdown("■ x：y", t)).toBeNull();
  });
  it("fromMarkdown keeps an empty day as [] (the key stays)", () => {
    const t = { summary: ["■ x：y"], days: { "2026-09-28": [], "2026-09-29": ["d2"] } };
    expect(fromMarkdown(toMarkdown(t), t)).toEqual(t);
    expect(fromMarkdown("■ x：y\n\n## 2026-09-29\nd2", t)).toEqual(t);   // the translator left the empty day's heading out
  });
  it("fromMarkdown tolerates a reply with leading / trailing newlines trimmed (empty summary, empty last day)", () => {
    const t = { summary: [], days: { "2026-09-28": ["d1"], "2026-09-29": [] } };
    expect(fromMarkdown(toMarkdown(t).trim(), t)).toEqual(t);
    const u = { summary: ["■ x：y"], days: { "2026-09-28": ["d1"], "2026-09-29": [] as string[] } };
    expect(fromMarkdown(toMarkdown(u).trim(), u)).toEqual(u);
  });

  it("waits for the retranslation: a GET meanwhile says translating; the PUT answers with the other two languages written", async () => {
    let open!: () => void, reached!: () => void;
    const gate = new Promise<void>((r) => { open = r; }), called = new Promise<void>((r) => { reached = r; });
    composeDeps.client = () => fakeAnthropic(async () => { reached(); await gate; return FROM_ZH; });
    const pending = put(ZH_EDIT);
    await called;
    let x = await row();
    expect(x).toMatchObject({ edited: 1, source_lang: "zh" });
    expect(x.translating_at).not.toBeNull();
    expect((await texts()).en.summary).toEqual(["A"]);   // not yet retranslated
    expect(await view_("zh")).toMatchObject({ translating: true, translate_failed: false, text: { summary: ["改过的"] } });
    open();
    const r = await pending;
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ translating: false, translate_failed: false, edited: true, text: { summary: ["改过的"] } });
    expect(jobs).toHaveLength(0);   // nothing left to the background
    x = await row();
    expect(x.translating_at).toBeNull();
    expect(await texts()).toMatchObject({ ja: { summary: ["直した"], days: { "2026-09-28": ["直した日"] } }, en: { days: { "2026-09-28": ["Fixed day"] } }, zh: { summary: ["改过的"] } });
    expect(await texts()).not.toHaveProperty("translate_failed");
  });

  it("a failed retranslation keeps the other languages, clears translating, and the PUT answers translate_failed until the next edit", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    composeDeps.client = () => fakeAnthropic(() => new Response("x", { status: 500 }));
    const r = await put({ lang: "ja", summary: ["b"], days: { "2026-09-28": ["e"] } });
    expect(await r.json()).toMatchObject({ translating: false, translate_failed: true, text: { summary: ["b"] } });
    expect(err).toHaveBeenCalledOnce();
    const x = await row();
    expect(x.translating_at).toBeNull();
    expect((await texts()).en.summary).toEqual(["A"]);
    expect(await view_("en")).toMatchObject({ translating: false, translate_failed: true, text: { summary: ["A"] } });
    const ok = "x\n\n## 2026-09-28\nx";
    composeDeps.client = () => fakeAnthropic(() => ({ source: "ja", zh: ok, ja: "", en: ok }));
    const again = await (await put({ lang: "ja", summary: ["c"], days: { "2026-09-28": ["f"] } })).json() as any;
    expect(again).toMatchObject({ translating: false, translate_failed: false });   // a new edit clears it
    expect((await texts()).en.summary).toEqual(["x"]);
  });

  it("the retranslation is asked with a 60 s timeout", async () => {
    const client = fakeAnthropic(() => FROM_ZH);
    const create = vi.spyOn(client.messages, "create");
    composeDeps.client = () => client;
    await put(ZH_EDIT);
    expect((create.mock.calls[0][1] as { timeout: number }).timeout).toBe(60_000);
  });

  it("a translating_at left over for 90 s or more (a killed request) reads as failed, not translating", async () => {
    await db().prepare("UPDATE pdf_compose SET translating_at = ?1").bind(new Date(Date.now() - TRANSLATE_MS - 1000).toISOString()).run();
    expect(await view_("ja")).toMatchObject({ translating: false, translate_failed: true });
    await db().prepare("UPDATE pdf_compose SET translating_at = ?1").bind(new Date(Date.now() - TRANSLATE_MS + 5000).toISOString()).run();
    expect(await view_("ja")).toMatchObject({ translating: true, translate_failed: false });
  });

  it("a stale retranslation (a newer edit happened) writes nothing, because translating_at no longer matches", async () => {
    const at = new Date(Date.now() - 10_000).toISOString();   // an older edit's time, whose retranslation runs late
    let open!: () => void, reached!: () => void;
    const gate = new Promise<void>((r) => { open = r; }), called = new Promise<void>((r) => { reached = r; });
    composeDeps.client = () => fakeAnthropic(async () => { reached(); await gate; return { source: "ja", zh: "新\n\n## 2026-09-28\n新", ja: "", en: "new\n\n## 2026-09-28\nnew" }; });
    const newer = put({ lang: "ja", summary: ["c"], days: { "2026-09-28": ["f"] } });   // the newer edit's call is still under way
    await called;
    const mid = await row();
    expect(mid.translating_at).not.toBeNull();
    expect(mid.translating_at).not.toBe(at);
    const calls: string[] = [];
    await retranslate(db(), fakeAnthropic(() => ({ source: "ja", zh: "旧\n\n## 2026-09-28\n旧", ja: "", en: "old\n\n## 2026-09-28\nold" }), calls), WEEK, "ja", at);
    expect(calls).toHaveLength(0);   // skipped before calling the model
    const x = await row();
    expect(x.text).toBe(mid.text);
    expect(x.translating_at).toBe(mid.translating_at);   // the newer edit's flag is untouched
    open(); await newer;
    expect((await texts()).en.summary).toEqual(["new"]);
  });

  it("a stale write is also refused when the model call was already under way", async () => {
    let open!: () => void, reached!: () => void;
    const gate = new Promise<void>((r) => { open = r; }), called = new Promise<void>((r) => { reached = r; });
    composeDeps.client = () => fakeAnthropic(async () => { reached(); await gate; return FROM_ZH; });
    const pending = put(ZH_EDIT);
    await called;
    await db().prepare("UPDATE pdf_compose SET translating_at = '2099-01-01T00:00:00.000Z'").run();   // a newer edit took over
    open();
    expect((await pending).status).toBe(200);
    const x = await row();
    expect(x.translating_at).toBe("2099-01-01T00:00:00.000Z");
    expect((await texts()).en.summary).toEqual(["A"]);
    expect(await texts()).not.toHaveProperty("translate_failed");
  });

  it("a translator that reads the edit as another language writes nothing and counts as a failure", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    composeDeps.client = () => fakeAnthropic(() => ({ ...FROM_ZH, source: "ja" }));
    await put(ZH_EDIT);
    expect(err).toHaveBeenCalledOnce();
    expect((await texts())).toMatchObject({ en: { summary: ["A"] }, ja: { summary: ["a"] }, translate_failed: true });
    expect((await row()).translating_at).toBeNull();
    const view = await (await reports.request(`/${WEEK}/pdf/compose?lang=zh`, {}, { DB: db() } as any)).json() as any;
    expect(view.translate_failed).toBe(true);
  });

  describe("a retranslation must keep the selection's names", () => {
    // B shown, A folded, H hidden; no 案件 translations stored, so every language sees the ja titles
    beforeEach(async () => {
      await setItems([{ id: "B", mode: "show" }, { id: "A", mode: "other" }, { id: "H", mode: "hide" }]);
      await db().prepare("UPDATE pdf_compose SET text = ?1").bind(JSON.stringify({
        ja: { summary: ["■ API 確認：済", "■ その他：帳票修正を少し"], days: { "2026-09-28": ["d"] } },
        zh: { summary: ["■ API 確認：完", "■ 其他：帳票修正"], days: { "2026-09-28": ["丁"] } },
        en: { summary: ["■ API 確認: ok", "■ Other: 帳票修正"], days: { "2026-09-28": ["D"] } } })).run();
    });
    const EDIT = { lang: "ja", summary: ["■ API 確認：済んだ", "■ その他：帳票修正を少し進めた"], days: { "2026-09-28": ["直した"] } };
    const reply = (zhSum: string, enSum: string) => ({ source: "ja", ja: "",
      zh: `${zhSum}\n\n## 2026-09-28\n修了`, en: `${enSum}\n\n## 2026-09-28\nFixed` });

    it("names kept → written", async () => {
      composeDeps.client = () => fakeAnthropic(() => reply("■ API 確認：完成\n■ 其他：帳票修正 推进了一点", "■ API 確認: done\n■ Other: moved 帳票修正 on a bit"));
      await put(EDIT);
      expect(await texts()).toMatchObject({ en: { summary: ["■ API 確認: done", "■ Other: moved 帳票修正 on a bit"] } });
      expect(await texts()).not.toHaveProperty("translate_failed");
    });
    it("a head the translator renamed (確認 → 試験) is put back to the 案件's name; the edit succeeds", async () => {
      composeDeps.client = () => fakeAnthropic(() => reply("■ API 確認：完成\n■ 其他：帳票修正", "■ API 試験: done\n■ Other: 帳票修正"));
      await put(EDIT);
      expect(await texts()).toMatchObject({ en: { summary: ["■ API 確認: done", "■ Other: 帳票修正"] } });
      expect(await texts()).not.toHaveProperty("translate_failed");
    });
    it("the translator is given the names of the 案件 the edit names (heads and その他)", async () => {
      const calls: string[] = [];
      composeDeps.client = () => fakeAnthropic(() => reply("■ API 確認：完成\n■ 其他：帳票修正", "■ API 確認: done\n■ Other: 帳票修正"), calls);
      await put(EDIT);
      expect(calls[0]).toContain("ja: API 確認 / zh: API 確認 / en: API 確認");
      expect(calls[0]).toContain("ja: 帳票修正 / zh: 帳票修正 / en: 帳票修正");
      expect(calls[0]).not.toContain("ja: 帳票 /");
    });
    it("en その他 names match case-insensitively", async () => {
      await tr("A", "帳票修正", "报表修正", "Report fix");
      composeDeps.client = () => fakeAnthropic(() => reply("■ API 確認：完成\n■ 其他：报表修正", "■ API 確認: done\n■ Other: the report fix moved"));
      await put(EDIT);
      expect(await texts()).not.toHaveProperty("translate_failed");
    });
    it("the names expected come from the edited text, not the selection: a selection changed since is no failure", async () => {
      await setItems([{ id: "A", mode: "show" }, { id: "B", mode: "hide" }, { id: "H", mode: "hide" }]);   // changed after generating
      composeDeps.client = () => fakeAnthropic(() => reply("■ API 確認：完成\n■ 其他：帳票修正 推进了", "■ API 確認: done\n■ Other: 帳票修正 moved"));
      await put(EDIT);
      expect(await texts()).toMatchObject({ en: { summary: ["■ API 確認: done", "■ Other: 帳票修正 moved"] } });
      expect(await texts()).not.toHaveProperty("translate_failed");
    });
    it("a hand edit that removed a ■ head: the retranslation need not have it", async () => {
      composeDeps.client = () => fakeAnthropic(() => reply("今周顺利\n■ 其他：帳票修正 推进了", "A smooth week\n■ Other: 帳票修正 moved"));
      await put({ ...EDIT, summary: ["今週は順調", "■ その他：帳票修正を少し進めた"] });
      expect(await texts()).toMatchObject({ zh: { summary: ["今周顺利", "■ 其他：帳票修正 推进了"] } });
      expect(await texts()).not.toHaveProperty("translate_failed");
    });
    it("a folded 案件 shortened inside その他 → translate_failed", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      composeDeps.client = () => fakeAnthropic(() => reply("■ API 確認：完成\n■ 其他：帳票 推进了", "■ API 確認: done\n■ Other: 帳票修正"));
      await put(EDIT);
      expect(await texts()).toMatchObject({ zh: { summary: ["■ API 確認：完", "■ 其他：帳票修正"] }, translate_failed: true });
    });
  });

  it("a generation clears translate_failed", async () => {
    await db().prepare("UPDATE pdf_compose SET text = json_set(text, '$.translate_failed', json('true'))").run();
    composeDeps.client = () => fakeAnthropic(() => AS_SEEN);
    expect((await gen()).status).toBe(200);
    expect(await texts()).not.toHaveProperty("translate_failed");
  });

  it("without an API key the edit is stored and the translation is marked failed at once", async () => {
    composeDeps.client = real;
    const r = await put(ZH_EDIT, "");
    expect(await r.json()).toMatchObject({ translating: false, translate_failed: true, edited: true });
    expect((await texts()).en.summary).toEqual(["A"]);
  });

  it("409 generating while a generation holds the lock (nothing stored); an expired lock does not block", async () => {
    await db().prepare("UPDATE pdf_compose SET generating_at = ?1").bind(new Date().toISOString()).run();
    composeDeps.client = () => fakeAnthropic(() => FROM_ZH);
    const r = await put(ZH_EDIT);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "generating" });
    expect((await texts()).zh.summary).toEqual(["甲"]);
    await db().prepare("UPDATE pdf_compose SET generating_at = ?1").bind(new Date(Date.now() - 181_000).toISOString()).run();
    expect((await put(ZH_EDIT)).status).toBe(200);
    expect((await texts()).zh.summary).toEqual(["改过的"]);
  });

  it("counts D1 statements for a hand edit including its retranslation (model faked)", async () => {
    const d = db(); let n = 0;
    const prepare = d.prepare.bind(d), batch = d.batch.bind(d);
    const counted = new Proxy(d, { get: (_t, k) =>
      k === "prepare" ? (q: string) => { n++; return prepare(q); }
      : k === "batch" ? (st: any[]) => { n += st.length; return batch(st); } : (d as any)[k] });
    composeDeps.client = () => fakeAnthropic(() => FROM_ZH);
    const r = await reports.request(`/${WEEK}/pdf/compose/text`, { method: "PUT", body: JSON.stringify(ZH_EDIT),
      headers: { "Content-Type": "application/json" } }, { DB: counted, ANTHROPIC_API_KEY: "k" } as any);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ translating: false, translate_failed: false });
    // measured 21 on 2026-10-09 (this seed: 3 案件, 2 worked days)
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(40);
  });

  it("400 on a bad body; 404 when nothing was generated yet", async () => {
    expect((await put({ lang: "fr", summary: [], days: {} })).status).toBe(400);
    expect((await put({ lang: "ja", summary: ["x"], days: { "2026-10-30": ["y"] } })).status).toBe(400);
    await db().prepare("UPDATE pdf_compose SET text = NULL").run();
    expect((await put({ lang: "ja", summary: ["x"], days: {} })).status).toBe(404);
  });
});
