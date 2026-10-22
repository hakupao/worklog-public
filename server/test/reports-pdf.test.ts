// server/test/reports-pdf.test.ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PdfBusy, busyAfter, pdfDeps } from "../src/report/pdf/browser";
import { reports } from "../src/routes/reports";
import { api, rawFetch, resetDb } from "./helpers";

const WEEK = "2026-W40";   // Sat 2026-09-26 .. Fri 2026-10-02
const real = pdfDeps.htmlToPdf;
let seen: string[] = [];
// The route reads only DB and BROWSER; spreading `env` from cloudflare:workers is not relied on anywhere in this repo.
const ENV = () => ({ DB: (env as any).DB as D1Database, BROWSER: {} as Fetcher });
const get = (path: string, e = ENV()) => reports.request(path, {}, e);

async function seed() {
  await api("/api/tasks/T1", { method: "PUT", body: JSON.stringify({ requester: "田中", title: "帳票修正", project: "社内",
    status: "open", received_at: "2026-09-28", machine: "macmini", ts: "2026-09-28T09:00:00" }) });
  await api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: [{
    id: "S1", machine: "macmini", agent: "claude-code", session_id: "S1-full", cwd: "/w",
    started_at: "2026-09-28T01:00:00Z", ended_at: "2026-09-28T03:00:00Z", active_minutes: 120, turns: 5,
    summary: "帳票を直した", summary_source: "llm", task_id: "T1", link_method: "auto-dir", ts: "2026-09-28T12:00:00" }] }) });
  await (env as any).DB.prepare(`INSERT INTO report_digests (week, day, text, inputs_hash, edited, model, generated_at, updated_at)
    VALUES (?1, '', '今週は帳票を直した。', 'h', 0, 'm', 'now', 'now'), (?1, '2026-09-28', '帳票を修正。', 'h', 0, 'm', 'now', 'now')`).bind(WEEK).run();
}

describe("GET /api/reports/:week/pdf", () => {
  beforeEach(async () => {
    await resetDb(); await seed(); seen = [];
    pdfDeps.htmlToPdf = async (_b, html) => {
      seen.push(html);
      return { pdf: new TextEncoder().encode("%PDF-1.7 fake"), fit: { over: false, steps: [], fonts: ["Noto Serif JP"] } };
    };
  });
  afterEach(() => { pdfDeps.htmlToPdf = real; });

  it("renders the week in Japanese by default, names the file, records the download", async () => {
    const r = await get(`/${WEEK}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toBe(`attachment; filename="${WEEK}-ja.pdf"`);
    expect(new TextDecoder().decode(await r.arrayBuffer())).toBe("%PDF-1.7 fake");
    const html = seen[0];
    expect(html).toContain("週次作業報告書");
    expect(html).toContain("帳票修正");          // the task row
    expect(html).toContain("今週は帳票を直した。"); // week digest
    expect(html).not.toContain("帳票を修正。");    // the day digest is not the day line …
    expect(html).toMatch(/社内[\s\u2009]+2\.0h/);           // … the day's 案件 (プロジェクト) and hours are
    expect(html).toContain("Taro Yamada");     // default 氏名
    const dl = await (await api(`/api/report-downloads?week=${WEEK}`)).json() as any[];
    expect(dl.map((d) => d.template)).toEqual(["pdf"]);
  });

  it("?lang=en prints English labels; the 氏名 comes from prefs", async () => {
    await api("/api/prefs", { method: "PUT", body: JSON.stringify({ report: { name: "Taro Yamada" } }) });
    const r = await get(`/${WEEK}/pdf?lang=en`);
    expect(r.headers.get("Content-Disposition")).toBe(`attachment; filename="${WEEK}-en.pdf"`);
    expect(seen[0]).toContain("Weekly Work Report");
    expect(seen[0]).toContain("Taro Yamada");
  });

  it("is not swallowed by /:week/:template", async () => {
    expect((await get(`/${WEEK}/pdf`)).headers.get("Content-Type")).toBe("application/pdf");
  });

  it("400 on a bad week or language; nothing rendered", async () => {
    expect((await get(`/2026-40/pdf`)).status).toBe(400);
    expect(await (await get(`/${WEEK}/pdf?lang=de`)).json()).toEqual({ error: "invalid lang" });
    expect(seen).toEqual([]);
  });

  it("Browser Run busy → 503 with Retry-After, no download recorded", async () => {
    pdfDeps.htmlToPdf = async () => { throw new PdfBusy(20); };
    const r = await get(`/${WEEK}/pdf`);
    expect(r.status).toBe(503);
    expect(r.headers.get("Retry-After")).toBe("20");
    expect(await r.json()).toEqual({ error: "pdf busy", retry_after: 20 });
    expect(await (await api(`/api/report-downloads?week=${WEEK}`)).json()).toEqual([]);
  });

  it("no browser binding → 503 pdf unavailable; any other failure → 502", async () => {
    const { BROWSER: _b, ...noBrowser } = ENV();
    expect(await (await get(`/${WEEK}/pdf`, noBrowser as any)).json()).toEqual({ error: "pdf unavailable" });
    pdfDeps.htmlToPdf = async () => { throw new Error("boom"); };
    const r = await get(`/${WEEK}/pdf`);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "pdf failed" });
  });

  // Never lets the app render: inside vitest env.BROWSER is a real local Chrome. A bad lang is rejected before that.
  it("through the app: auth applies and the route is reached", async () => {
    expect((await rawFetch(`/api/reports/${WEEK}/pdf`)).status).toBe(401);
    const r = await api(`/api/reports/${WEEK}/pdf?lang=de`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid lang" });
  });
});

describe("busyAfter", () => {
  it("classifies a refused launch: rate 20 s, daily limit 1 h, anything else null", () => {
    expect(busyAfter("Unable to create new browser: code: 429: message: Rate limit exceeded")).toBe(20);
    expect(busyAfter("Unable to create new browser: code: 429: message: Browser time limit exceeded for today")).toBe(3600);
    expect(busyAfter("boom")).toBeNull();
  });
});
