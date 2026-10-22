import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pdfDeps } from "../src/report/pdf/browser";
import { reports } from "../src/routes/reports";
import { api, resetDb } from "./helpers";

const WEEK = "2026-W40", PREV = "2026-W39";   // W40 = Sat 9/26 .. Fri 10/2
const db = () => (env as any).DB as D1Database;
const E = () => ({ DB: db() }) as any;
const req = (path: string, init: RequestInit = {}) =>
  reports.request(path, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } }, E());

const task = (id: string, title: string) => api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({
  requester: "田中", title, status: "open", received_at: "2026-09-01", machine: "m", ts: "2026-09-01T09:00:00" }) });
const s = (id: string, at: string, task_id: string | null, minutes: number) => ({
  id, machine: "m", agent: "claude-code", session_id: `${id}-f`, cwd: "/w", started_at: at,
  ended_at: new Date(Date.parse(at) + minutes * 60_000).toISOString(), active_minutes: minutes, turns: 3,
  summary: `did ${id}`, summary_source: "llm", task_id, link_method: task_id ? "manual" : "none", ts: "2026-09-28T12:00:00" });
const ingest = (rows: unknown[]) => api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "m", sessions: rows }) });

async function seed() {
  await task("A", "帳票修正"); await task("B", "API 確認"); await task("C", "空き");
  await ingest([s("S1", "2026-09-28T01:00:00Z", "A", 120), s("S2", "2026-09-29T01:00:00Z", "B", 60), s("S3", "2026-09-29T05:00:00Z", null, 30)]);
}

describe("GET /:week/pdf/compose", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("no row anywhere: today's PDF order, inherited, nothing written", async () => {
    const r = await req(`/${WEEK}/pdf/compose?lang=ja`);
    expect(r.status).toBe(200);
    const b = await r.json() as any;
    expect(b).toMatchObject({ week: WEEK, inherited: true, updated_at: null, text: null, generating: false, stale: { selection: false, inputs: false } });
    expect(b.items.map((i: any) => [i.id, i.mode])).toEqual([["A", "show"], ["B", "show"], ["__unassigned", "show"]]);
    expect(b.items[0]).toMatchObject({ title: "帳票修正", requester: "田中", minutes: 120 });
    expect(b.items[2].title).toBe("その他・調査");
    expect((await db().prepare("SELECT COUNT(*) AS n FROM pdf_compose").first<{ n: number }>())!.n).toBe(0);
  });

  it("inherits the nearest earlier week within 8 weeks", async () => {
    await db().prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES (?1, ?2, 'x')")
      .bind("2026-W33", JSON.stringify([{ id: "B", mode: "show" }, { id: "A", mode: "other" }])).run();
    const b = await (await req(`/${WEEK}/pdf/compose`)).json() as any;
    expect(b.inherited).toBe(true);
    expect(b.items.map((i: any) => [i.id, i.mode])).toEqual([["B", "show"], ["__unassigned", "show"], ["A", "other"]]);
    // 9 weeks back is too far
    await db().prepare("DELETE FROM pdf_compose").run();
    await db().prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES ('2026-W31', ?1, 'x')")
      .bind(JSON.stringify([{ id: "A", mode: "hide" }])).run();
    const c = await (await req(`/${WEEK}/pdf/compose`)).json() as any;
    expect(c.items.find((i: any) => i.id === "A").mode).toBe("show");
  });

  it("normalizes a saved row: new 案件 appended as show, vanished ones dropped", async () => {
    await db().prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES (?1, ?2, 't1')")
      .bind(WEEK, JSON.stringify([{ id: "C", mode: "show" }, { id: "A", mode: "hide" }, { id: "__unassigned", mode: "other" }])).run();
    const b = await (await req(`/${WEEK}/pdf/compose`)).json() as any;
    expect(b).toMatchObject({ inherited: false, updated_at: "t1" });
    expect(b.items.map((i: any) => [i.id, i.mode])).toEqual([["B", "show"], ["A", "hide"], ["__unassigned", "other"]]);
  });

  it("400 on a bad week or lang", async () => {
    expect((await req(`/2026-99/pdf/compose`)).status).toBe(400);
    expect((await req(`/${WEEK}/pdf/compose?lang=fr`)).status).toBe(400);
  });
});

describe("PUT /:week/pdf/compose", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  const body = (items: unknown, updated_at: string | null) => ({ method: "PUT", body: JSON.stringify({ items, updated_at }) });
  const items = [{ id: "B", mode: "show" }, { id: "A", mode: "other" }, { id: "__unassigned", mode: "hide" }];

  it("first write with updated_at null, then guarded by the returned token", async () => {
    const r = await req(`/${WEEK}/pdf/compose`, body(items, null));
    expect(r.status).toBe(200);
    const b = await r.json() as any;
    expect(b.inherited).toBe(false);
    expect(b.items.map((i: any) => i.id)).toEqual(["B", "A", "__unassigned"]);
    const again = await req(`/${WEEK}/pdf/compose`, body(items, null));
    expect(again.status).toBe(409);
    expect((await again.json() as any)).toMatchObject({ error: "conflict", current: { updated_at: b.updated_at } });
    expect((await req(`/${WEEK}/pdf/compose`, body(items, b.updated_at))).status).toBe(200);
  });

  it("rejects an id that is not worked, duplicates and bad modes with 400", async () => {
    const r = await req(`/${WEEK}/pdf/compose`, body([...items, { id: "C", mode: "show" }], null));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "unknown id C" });
    expect((await req(`/${WEEK}/pdf/compose`, body([items[0], items[0], items[2]], null))).status).toBe(400);
    expect((await req(`/${WEEK}/pdf/compose`, body("x", null))).status).toBe(400);
  });

  it("never touches report_digests", async () => {
    await req(`/${WEEK}/pdf/compose`, body(items, null));
    expect((await db().prepare("SELECT COUNT(*) AS n FROM report_digests").first<{ n: number }>())!.n).toBe(0);
  });
});

describe("shown cap through the routes", () => {
  // eight worked 案件, K1 the most minutes
  beforeEach(async () => {
    await resetDb();
    for (let i = 1; i <= 8; i++) await task(`K${i}`, `案件${i}`);
    await ingest(Array.from({ length: 8 }, (_, i) => s(`Q${i + 1}`, `2026-09-28T0${i}:00:00Z`, `K${i + 1}`, 50 - i)));
  });
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `K${i + 1}`);

  it("a new week shows the five biggest and folds the rest", async () => {
    const b = await (await req(`/${WEEK}/pdf/compose`)).json() as any;
    expect(b.items.map((i: any) => [i.id, i.mode])).toEqual([...ids(5).map((id) => [id, "show"]), ["K6", "other"], ["K7", "other"], ["K8", "other"]]);
  });

  it("PUT and preview reject a selection over the cap with 400; within the cap is fine", async () => {
    const over = ids(8).map((id, i) => ({ id, mode: i < 6 ? "show" : "other" }));
    const put = await req(`/${WEEK}/pdf/compose`, { method: "PUT", body: JSON.stringify({ items: over, updated_at: null }) });
    expect(put.status).toBe(400);
    expect(((await put.json()) as any).error).toMatch(/too many shown/);
    expect((await req(`/${WEEK}/pdf/preview`, { method: "POST", body: JSON.stringify({ items: over }) })).status).toBe(400);
    const ok = ids(8).map((id, i) => ({ id, mode: i < 5 ? "show" : i < 7 ? "other" : "hide" }));
    expect((await req(`/${WEEK}/pdf/compose`, { method: "PUT", body: JSON.stringify({ items: ok, updated_at: null }) })).status).toBe(200);
  });

  it("an inherited selection with 6 shown and a newly worked 案件 folds the last shown ones", async () => {
    await db().prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES (?1, ?2, 'x')")
      .bind(PREV, JSON.stringify([...["K6", "K5", "K4", "K3", "K2", "K1"].map((id) => ({ id, mode: "show" })), { id: "K7", mode: "hide" }])).run();
    const b = await (await req(`/${WEEK}/pdf/compose`)).json() as any;
    // K8 is new (appended last); folding makes the cap 5, so K1 (the user's last shown) folds too
    expect(b.items.map((i: any) => [i.id, i.mode])).toEqual([
      ["K6", "show"], ["K5", "show"], ["K4", "show"], ["K3", "show"], ["K2", "show"], ["K1", "other"], ["K7", "hide"], ["K8", "other"]]);   // other / hide rows by minutes, as fitItems
  });
});

const TXT = { ja: { summary: ["■ API 確認：済んだ"], days: { "2026-09-29": ["API を確認"] } },
  zh: { summary: ["■ API 确认：完成"], days: { "2026-09-29": ["确认了 API"] } },
  en: { summary: ["■ API check: done"], days: { "2026-09-29": ["Checked the API"] } } };

describe("POST /:week/pdf/preview", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("renders a draft selection without saving it or calling Browser Run", async () => {
    const r = await req(`/${WEEK}/pdf/preview?lang=ja`, { method: "POST", body: JSON.stringify({ items: [
      { id: "B", mode: "show" }, { id: "A", mode: "other" }, { id: "__unassigned", mode: "hide" }] }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/html");
    const html = await r.text();
    expect(html.indexOf("API 確認")).toBeGreaterThan(0);
    expect(html).toContain("その他 2 件");
    expect((await db().prepare("SELECT COUNT(*) AS n FROM pdf_compose").first<{ n: number }>())!.n).toBe(0);
  });

  it("400 on an invalid draft", async () => {
    expect((await req(`/${WEEK}/pdf/preview`, { method: "POST", body: JSON.stringify({ items: [{ id: "Z", mode: "show" }] }) })).status).toBe(400);
  });
});

describe("GET /:week/pdf with a composition", () => {
  const real = pdfDeps.htmlToPdf;
  let seen: string[] = [];
  beforeEach(async () => {
    await resetDb(); await seed(); seen = [];
    pdfDeps.htmlToPdf = async (_b, html) => { seen.push(html); return { pdf: new TextEncoder().encode("%PDF"), fit: { over: false, steps: [], fonts: [] } }; };
  });
  afterEach(() => { pdfDeps.htmlToPdf = real; });
  const getPdf = (lang = "ja") => reports.request(`/${WEEK}/pdf?lang=${lang}`, {}, { DB: db(), BROWSER: {} as Fetcher } as any);

  it("uses the composed text and order when the row has text", async () => {
    await db().prepare("INSERT INTO pdf_compose (week, items, text, updated_at) VALUES (?1, ?2, ?3, 'x')").bind(WEEK,
      JSON.stringify([{ id: "B", mode: "show" }, { id: "A", mode: "hide" }, { id: "__unassigned", mode: "other" }]), JSON.stringify(TXT)).run();
    expect((await getPdf("en")).status).toBe(200);
    expect(seen[0]).toContain("API check: done");
    expect(seen[0]).toContain("2 others");
  });

  it("a row without text (selection only) still prints today's PDF", async () => {
    await db().prepare("INSERT INTO pdf_compose (week, items, updated_at) VALUES (?1, ?2, 'x')").bind(WEEK,
      JSON.stringify([{ id: "B", mode: "show" }, { id: "A", mode: "hide" }, { id: "__unassigned", mode: "other" }])).run();
    await getPdf();
    const withRow = seen[0];
    await db().prepare("DELETE FROM pdf_compose").run();
    await getPdf();
    expect(withRow).toBe(seen[1]);
  });

  it("a stored selection missing a newly worked 案件 still lists it (show, last) and the table reconciles with the total", async () => {
    await db().prepare("INSERT INTO pdf_compose (week, items, text, updated_at) VALUES (?1, ?2, ?3, 'x')").bind(WEEK,
      JSON.stringify([{ id: "B", mode: "show" }, { id: "__unassigned", mode: "show" }]), JSON.stringify(TXT)).run();
    expect((await getPdf("ja")).status).toBe(200);
    expect(seen[0]).toContain("帳票修正");
    const { composedPdfData } = await import("../src/routes/pdf-compose");
    const data = await composedPdfData(db(), WEEK, "ja");
    expect(data.tasks.map((x) => x.title)).toEqual(["API 確認", "その他・調査", "帳票修正"]);
    const tableMin = data.tasks.reduce((a, x) => a + x.minutes, 0);
    expect(tableMin).toBe(data.totalMinutes);
  });
});

describe("composedPdfData robustness and budget", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  const items = [{ id: "B", mode: "show" }, { id: "A", mode: "other" }, { id: "__unassigned", mode: "hide" }];

  it("counts D1 statements for a draft preview with digests and no composed text (worst case)", async () => {
    const now = "2026-10-01T00:00:00Z";
    await db().prepare("INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at) VALUES (?1, '', 'w', 'w', 'h', 1, 'm', ?2, ?2)").bind(WEEK, now).run();
    await db().prepare("INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at) VALUES (?1, '2026-09-29', 'd', 'd', 'h', 0, 'm', ?2, ?2)").bind(WEEK, now).run();
    const d = db(); let n = 0;
    const prepare = d.prepare.bind(d), batch = d.batch.bind(d);
    const counted = new Proxy(d, { get: (_t, k) =>
      k === "prepare" ? (q: string) => { n++; return prepare(q); }
      : k === "batch" ? (s: any[]) => { n += s.length; return batch(s); } : (d as any)[k] });
    const r = await reports.request(`/${WEEK}/pdf/preview?lang=zh`, { method: "POST", body: JSON.stringify({ items }),
      headers: { "Content-Type": "application/json" } }, { DB: counted } as any);
    expect(r.status).toBe(200);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(40);
  });

  it("a missing pdf_compose table (code deployed before the migration) prints today's PDF", async () => {
    const before = await (await req(`/${WEEK}/pdf/preview`, { method: "POST", body: JSON.stringify({ items }) })).text();
    expect(before).toContain("API 確認");
    const { composedPdfData } = await import("../src/routes/pdf-compose");
    const sql = (await db().prepare("SELECT sql FROM sqlite_master WHERE name = 'pdf_compose'").first<{ sql: string }>())!.sql;
    await db().prepare("DROP TABLE pdf_compose").run();
    try {
      const data = await composedPdfData(db(), WEEK, "ja");
      expect(data.tasks.map((x) => x.title)).toEqual(["帳票修正", "API 確認", "その他・調査"]);
    } finally { await db().prepare(sql).run(); }
  });
});
