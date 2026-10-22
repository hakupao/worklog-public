import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { findStale } from "../src/i18n/sweep";
import { api, resetDb } from "./helpers";

const WEEK = "2026-W39";   // Sat 2026-09-19 .. Fri 2026-09-25
const DB = () => (env as any).DB as D1Database;
const put = (day: string, body: unknown) => api(`/api/reports/${WEEK}/digests/${day}/generated`, { method: "PUT", body: JSON.stringify(body) });
const tr = { zh: { text: "推进了", pdf_text: "推进" }, en: { text: "Moved on", pdf_text: "Moved" } };

async function seed() {
  await api("/api/tasks/T1", { method: "PUT", body: JSON.stringify({ requester: "田中", title: "件名 T1", project: "社内",
    status: "open", received_at: "2026-09-22", machine: "macmini", ts: "2026-09-22T09:00:00" }) });
  await api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: [{
    id: "S1", machine: "macmini", agent: "claude-code", session_id: "S1-full", cwd: "/w",
    started_at: "2026-09-22T01:00:00Z", ended_at: "2026-09-22T02:00:00Z", active_minutes: 60, turns: 5,
    summary: "帳票を直した", summary_source: "llm", task_id: "T1", link_method: "auto-dir", ts: "2026-09-22T12:00:00" }] }) });
}
const inputs = async () => (await (await api(`/api/reports/${WEEK}/digest-inputs`)).json()) as any;

describe("local digest generation API", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("digest-inputs lists the worked day with its input and hash, prompts and schema; no week item before any day line", async () => {
    const r = await inputs();
    expect(r.system.day).toContain("■ 案件名：");
    expect(r.schema.day.required).toEqual(["lines", "pdf_lines"]);
    expect(r.schema.week.required).toEqual(["lines", "pdf_lines", "oneliner"]);
    expect(r.items.map((i: any) => i.day)).toEqual(["2026-09-22"]);
    expect(r.items[0]).toMatchObject({ text: null, edited: false, fresh: false, pdf_missing: false });
    expect(r.items[0].input).toContain("件名 T1");
  });

  it("names: each worked task's title in ja/zh/en from its fresh translation, the original where untranslated (R15)", async () => {
    await api("/api/tasks/T2", { method: "PUT", body: JSON.stringify({ requester: "田中", title: "件名 T2", project: "社内",
      status: "open", received_at: "2026-09-22", machine: "macmini", ts: "2026-09-22T09:00:00" }) });
    await api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: [{
      id: "S2", machine: "macmini", agent: "claude-code", session_id: "S2-full", cwd: "/w",
      started_at: "2026-09-22T03:00:00Z", ended_at: "2026-09-22T04:00:00Z", active_minutes: 30, turns: 3,
      summary: "確認した", summary_source: "llm", task_id: "T2", link_method: "auto-dir", ts: "2026-09-22T13:00:00" }] }) });
    await DB().prepare(`INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
      VALUES ('task', 'T1', 'title', '件名 T1', 'ja', '任务 T1', '件名 T1', 'Task T1', 'm', '2026-09-22T00:00:00Z')`).run();
    const names = (await inputs()).names as { ja: string; zh: string; en: string }[];
    expect(names).toHaveLength(2);
    expect(names).toContainEqual({ ja: "件名 T1", zh: "任务 T1", en: "Task T1" });
    expect(names).toContainEqual({ ja: "件名 T2", zh: "件名 T2", en: "件名 T2" });
  });

  it("a generated day is stored with both texts and fresh translations; the week item then appears", async () => {
    const day = (await inputs()).items[0];
    const r = await put("2026-09-22", { text: "■ 件名 T1：進んだ", pdf_text: "進んだ", inputs_hash: day.hash, model: "opus-local", ...tr });
    expect(r.status).toBe(200);
    const row = await DB().prepare("SELECT text, pdf_text, edited, inputs_hash FROM report_digests WHERE week=?1 AND day='2026-09-22'").bind(WEEK).first();
    expect(row).toEqual({ text: "■ 件名 T1：進んだ", pdf_text: "進んだ", edited: 0, inputs_hash: day.hash });
    expect((await findStale(DB(), new Date().toISOString(), 50)).filter((s) => s.entity === "digest")).toEqual([]);
    const after = await inputs();
    expect(after.items.map((i: any) => i.day)).toEqual(["2026-09-22", ""]);
    expect(after.items[0].fresh).toBe(true);
  });

  it("a 650-char week pdf_text is stored uncut (week pdf cap 700, R18)", async () => {
    const day = (await inputs()).items[0];
    await put("2026-09-22", { text: "■ 件名 T1：進んだ", pdf_text: "進んだ", inputs_hash: day.hash, model: "opus-local", ...tr });
    const wk = (await inputs()).items.find((i: any) => i.day === "");
    const pdf = [...Array(5)].map((_, i) => `${i}${"あ".repeat(126)}`).join("\n") + "\n■ その他：" + "い".repeat(4);
    expect([...pdf].length).toBe(650);
    expect((await put("week", { text: "■ 件名 T1：進んだ", pdf_text: pdf, inputs_hash: wk.hash, model: "opus-local", ...tr })).status).toBe(200);
    const row = await DB().prepare("SELECT pdf_text FROM report_digests WHERE week=?1 AND day=''").bind(WEEK).first<{ pdf_text: string }>();
    expect(row!.pdf_text).toBe(pdf);
  });

  it("409 stale when the input changed since it was read; 409 edited over a hand edit", async () => {
    const day = (await inputs()).items[0];
    expect((await put("2026-09-22", { text: "x", pdf_text: "x", inputs_hash: "nope", model: "m", ...tr })).status).toBe(409);
    await put("2026-09-22", { text: "■ A", pdf_text: "A", inputs_hash: day.hash, model: "m", ...tr });
    await api(`/api/reports/${WEEK}/digests/2026-09-22`, { method: "PATCH", body: JSON.stringify({ text: "手で直した" }) });
    const r = await put("2026-09-22", { text: "■ B", pdf_text: "B", inputs_hash: day.hash, model: "m", ...tr });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "edited" });
  });

  it("pdf_only fills the PDF line of a hand-edited digest, and refuses when the text moved on", async () => {
    const day = (await inputs()).items[0];
    await put("2026-09-22", { text: "■ A", pdf_text: "A", inputs_hash: day.hash, model: "m", ...tr });
    await api(`/api/reports/${WEEK}/digests/2026-09-22`, { method: "PATCH", body: JSON.stringify({ text: "手で直した" }) });
    expect((await inputs()).items[0].pdf_missing).toBe(true);
    const stale = await put("2026-09-22", { pdf_only: true, source_text: "古い", pdf_text: "P", model: "m", zh: { pdf_text: "P" }, en: { pdf_text: "P" } });
    expect(stale.status).toBe(409);
    const ok = await put("2026-09-22", { pdf_only: true, source_text: "手で直した", pdf_text: "直した", model: "m", zh: { pdf_text: "改了" }, en: { pdf_text: "Fixed" } });
    expect(ok.status).toBe(200);
    const row = await DB().prepare("SELECT text, pdf_text, edited FROM report_digests WHERE week=?1 AND day='2026-09-22'").bind(WEEK).first();
    expect(row).toEqual({ text: "手で直した", pdf_text: "直した", edited: 1 });
  });

  it("caps over-long text to the limits and rejects bad bodies", async () => {
    const day = (await inputs()).items[0];
    const long = Array.from({ length: 60 }, (_, i) => `■ 行${i}：${"あ".repeat(20)}`).join("\n");
    await put("2026-09-22", { text: long, pdf_text: "P", inputs_hash: day.hash, model: "m", ...tr });
    const row: any = await DB().prepare("SELECT text FROM report_digests WHERE week=?1 AND day='2026-09-22'").bind(WEEK).first();
    expect(Array.from(row.text).length).toBeLessThanOrEqual(800);
    expect((await put("2026-09-22", { text: "" })).status).toBe(400);
    expect((await put("2026-09-30", { text: "x", pdf_text: "x", inputs_hash: "h", model: "m", ...tr })).status).toBe(400);
  });

  it("a 1590-char week text with 5000-char en and zh translations is accepted and stored uncut (R14)", async () => {
    const dayHash = (await inputs()).items[0].hash;
    await put("2026-09-22", { text: "■ A", pdf_text: "A", inputs_hash: dayHash, model: "m", ...tr });
    const wk = (await inputs()).items.find((i: any) => i.day === "");
    const text = Array.from({ length: 10 }, (_, i) => `■ ${i}${"あ".repeat(156)}`).join("\n").slice(0, 1590);
    expect(text.length).toBe(1590);
    const zh = "中".repeat(5000), en = "e".repeat(5000);
    const r = await put("week", { text, pdf_text: "P", inputs_hash: wk.hash, model: "m", zh: { text: zh, pdf_text: "p" }, en: { text: en, pdf_text: "p" } });
    expect(r.status).toBe(200);
    const row: any = await DB().prepare("SELECT text FROM report_digests WHERE week=?1 AND day=''").bind(WEEK).first();
    expect(row.text).toBe(text);
  });

  it("needs auth", async () => {
    const { rawFetch } = await import("./helpers");
    expect((await rawFetch(`/api/reports/${WEEK}/digest-inputs`)).status).toBe(401);
  });
});

describe("local digest generation API: guards", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  const staleDigests = async () => (await findStale(DB(), new Date().toISOString(), 50)).filter((s) => s.entity === "digest");

  it("writes the week from its input, fresh to the next read; a changed day line makes the old week hash stale", async () => {
    const day = (await inputs()).items[0];
    await put("2026-09-22", { text: "■ A", pdf_text: "A", inputs_hash: day.hash, model: "m", ...tr });
    const wk = (await inputs()).items[1];
    expect(wk.day).toBe("");
    const r = await put("week", { text: "■ 週A\n■ 週B", pdf_text: "週", inputs_hash: wk.hash, model: "m", ...tr });
    expect(r.status).toBe(200);
    expect((await inputs()).items[1]).toMatchObject({ fresh: true, text: "■ 週A\n■ 週B" });
    expect(await staleDigests()).toEqual([]);
    const fields = await DB().prepare("SELECT field FROM translations WHERE entity='digest' AND entity_id=?1 ORDER BY field").bind(`${WEEK}\u001f`).all();
    expect(fields.results).toEqual([{ field: "pdf_text" }, { field: "text" }]);
    await DB().prepare("UPDATE report_digests SET text='■ 変えた' WHERE week=?1 AND day='2026-09-22'").bind(WEEK).run();
    const stale = await put("week", { text: "■ X", pdf_text: "X", inputs_hash: wk.hash, model: "m", ...tr });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "stale" });
  });

  it("409 stale and nothing written when a session arrived after the input was read", async () => {
    const day = (await inputs()).items[0];
    await api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: [{
      id: "S2", machine: "macmini", agent: "claude-code", session_id: "S2-full", cwd: "/w",
      started_at: "2026-09-22T05:00:00Z", ended_at: "2026-09-22T06:00:00Z", active_minutes: 30, turns: 3,
      summary: "別の件を直した", summary_source: "llm", task_id: "T1", link_method: "auto-dir", ts: "2026-09-22T15:00:00" }] }) });
    const r = await put("2026-09-22", { text: "■ A", pdf_text: "A", inputs_hash: day.hash, model: "m", ...tr });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "stale" });
    expect(await DB().prepare("SELECT COUNT(*) AS n FROM report_digests").first()).toEqual({ n: 0 });
  });

  it("a day with no input is 404 no_input", async () => {
    const r = await put("2026-09-23", { text: "x", pdf_text: "x", inputs_hash: "h", model: "m", ...tr });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "no_input" });
    expect((await put("week", { text: "x", pdf_text: "x", inputs_hash: "h", model: "m", ...tr })).status).toBe(404);
  });

  it("pdf_only on a missing row is 404; an extra key is 400", async () => {
    const body = { pdf_only: true, source_text: "a", pdf_text: "P", model: "m", zh: { pdf_text: "P" }, en: { pdf_text: "P" } };
    expect((await put("2026-09-22", body)).status).toBe(404);
    expect((await put("2026-09-22", { ...body, extra: 1 })).status).toBe(400);
  });

  it("translations are cut to the line count of the capped source", async () => {
    const day = (await inputs()).items[0];
    const long = Array.from({ length: 60 }, (_, i) => `■ 行${i}：${"あ".repeat(20)}`).join("\n");
    const zh = Array.from({ length: 60 }, (_, i) => `■ 行${i}`).join("\n");
    await put("2026-09-22", { text: long, pdf_text: "P", inputs_hash: day.hash, model: "m", zh: { text: zh, pdf_text: "P" }, en: { text: zh, pdf_text: "P" } });
    const row: any = await DB().prepare("SELECT text FROM report_digests WHERE week=?1 AND day='2026-09-22'").bind(WEEK).first();
    const tz: any = await DB().prepare("SELECT zh FROM translations WHERE entity='digest' AND entity_id=?1 AND field='text'").bind(`${WEEK}\u001f2026-09-22`).first();
    expect(tz.zh.split("\n").length).toBe(row.text.split("\n").length);
    expect(tz.zh.split("\n").length).toBeLessThan(60);
  });

  it("a hand edit landing between the checks and the write is not overwritten (409 edited, no translations)", async () => {
    const day = (await inputs()).items[0];
    const real = (env as any).DB as D1Database;
    const orig = real.prepare.bind(real);
    let hit = false;
    (real as any).prepare = (sql: string) => {
      if (!hit && sql.startsWith("INSERT INTO report_digests")) {
        hit = true;   // the PATCH lands right before the batch is built
        const s = orig("INSERT INTO report_digests (week, day, text, inputs_hash, edited, model, generated_at, updated_at) VALUES (?1,'2026-09-22','手で直した','',1,'',?2,?2)");
        s.bind(WEEK, "2026-10-01T00:00:00Z").run();
      }
      return orig(sql);
    };
    let r: Response;
    try { r = await put("2026-09-22", { text: "■ B", pdf_text: "B", inputs_hash: day.hash, model: "m", ...tr }); }
    finally { delete (real as any).prepare; }
    expect(hit).toBe(true);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "edited" });
    const row = await DB().prepare("SELECT text, edited FROM report_digests WHERE week=?1 AND day='2026-09-22'").bind(WEEK).first();
    expect(row).toEqual({ text: "手で直した", edited: 1 });
    expect(await DB().prepare("SELECT COUNT(*) AS n FROM translations WHERE entity='digest'").first()).toEqual({ n: 0 });
  });

  it("a generated week line never overwrites a hand-edited oneliner; carries a new AI oneliner otherwise", async () => {
    const day = (await inputs()).items[0];
    await put(day.day, { text: "■ 件名 T1：直した", pdf_text: "直した", inputs_hash: day.hash, model: "m", ...tr });
    const week = (await inputs()).items.find((i: any) => i.day === "");
    expect(week).toMatchObject({ oneliner: null, oneliner_missing: false });   // no week row yet: nothing to backfill
    const body = { text: "■ 件名 T1：直した", pdf_text: "直した", inputs_hash: week.hash, model: "m", oneliner: "帳票を直した",
      zh: { ...tr.zh, oneliner: "修好了" }, en: { ...tr.en, oneliner: "Fixed" } };
    const stored = async () => (await DB().prepare("SELECT oneliner FROM report_digests WHERE week = ?1 AND day = ''").bind(WEEK).first<{ oneliner: string }>())!.oneliner;
    expect((await put("week", body)).status).toBe(200);
    expect(await stored()).toBe("帳票を直した");
    expect(await DB().prepare("SELECT zh, en FROM translations WHERE entity = 'digest' AND field = 'oneliner'").first()).toEqual({ zh: "修好了", en: "Fixed" });
    await api(`/api/reports/${WEEK}/digests/week`, { method: "PATCH", body: JSON.stringify({ oneliner: "手の一言" }) });
    expect((await put("week", { ...body, oneliner: "新しい AI の一言" })).status).toBe(200);   // same hash: text rewritten, oneliner kept
    expect(await stored()).toBe("手の一言");
    expect(await DB().prepare("SELECT COUNT(*) AS n FROM translations WHERE field = 'oneliner' AND source_text = '新しい AI の一言'").first()).toEqual({ n: 0 });
    expect((await inputs()).items.find((i: any) => i.day === "")).toMatchObject({ oneliner: "手の一言", oneliner_missing: false });
    await api(`/api/reports/${WEEK}/digests/week`, { method: "PATCH", body: JSON.stringify({ oneliner: "" }) });     // back to generation
    expect((await put("week", { ...body, oneliner: "AI の二つ目" })).status).toBe(200);
    expect(await stored()).toBe("AI の二つ目");                                                              // an existing AI one is replaced
    const { oneliner: _, zh: { oneliner: __, ...zh }, en: { oneliner: ___, ...en }, ...rest } = body;
    expect((await put("week", { ...rest, zh, en })).status).toBe(200);
    expect(await stored()).toBeNull();                                                                          // a body without one clears it
    const r = await inputs();
    expect(r.system.oneliner).toContain("1 文");
    expect(r.items.find((i: any) => i.day === "")).toMatchObject({ oneliner: null, oneliner_missing: true });
    expect(r.items.find((i: any) => i.day !== "")).toMatchObject({ oneliner: null, oneliner_missing: false });
  });

  it("after a hand edit of the week text the item says oneliner_missing, so the next local run fills it", async () => {
    const day = (await inputs()).items[0];
    await put(day.day, { text: "■ 件名 T1：直した", pdf_text: "直した", inputs_hash: day.hash, model: "m", ...tr });
    const week = (await inputs()).items.find((i: any) => i.day === "");
    await put("week", { text: "■ 件名 T1：直した", pdf_text: "直した", inputs_hash: week.hash, model: "m", oneliner: "AI の一言",
      zh: { ...tr.zh, oneliner: "AI" }, en: { ...tr.en, oneliner: "AI" } });
    await api(`/api/reports/${WEEK}/digests/week`, { method: "PATCH", body: JSON.stringify({ text: "手で書き直した本文" }) });
    expect((await inputs()).items.find((i: any) => i.day === "")).toMatchObject({ text: "手で書き直した本文", oneliner: null, oneliner_missing: true, pdf_missing: true });
  });
});
