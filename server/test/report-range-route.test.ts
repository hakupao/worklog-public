import { env } from "cloudflare:workers";
import JSZip from "jszip";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { RANGE_LABELS } from "../src/report/range/labels";
import { api, resetDb } from "./helpers";

const DB = () => (env as any).DB as D1Database;
const xlsx = (q: string) => api(`/api/reports/range/xlsx${q}`);

describe("GET /api/reports/range/xlsx", () => {
  beforeEach(resetDb);

  it("is not read as week 'range' / template 'xlsx': serves a workbook named after the range and language", async () => {
    const r = await xlsx("?from=2026-W39&to=2026-W41&lang=en");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="2026-W39_2026-W41-en.xlsx"');
    const z = await JSZip.loadAsync(await r.arrayBuffer());
    expect(await z.file("xl/workbook.xml")!.async("string")).toContain(`name="${RANGE_LABELS.en.sheet.cover}"`);   // the formal names of Task 8 ("Cover and Summary")
    expect(z.file("xl/charts/chart4.xml")).not.toBeNull();
  });

  it("defaults to Japanese; one week is fine", async () => {
    const r = await xlsx("?from=2026-W41&to=2026-W41");
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="2026-W41_2026-W41-ja.xlsx"');
  });

  it("400s: malformed week, from after to, more than 52 weeks, unknown language", async () => {
    expect(await (await xlsx("?from=2026-41&to=2026-W41")).json()).toEqual({ error: "invalid week" });
    expect(await (await xlsx("?to=2026-W41")).json()).toEqual({ error: "invalid week" });
    expect(await (await xlsx("?from=2026-W41&to=2026-W40")).json()).toEqual({ error: "from after to" });
    expect(await (await xlsx("?from=2025-W40&to=2026-W40")).json()).toEqual({ error: "too many weeks" });   // 53 weeks
    expect((await xlsx("?from=2025-W41&to=2026-W40")).status).toBe(200);                                     // exactly 52
    const t0 = Date.now();                                                                                    // counted, not walked
    expect(await (await xlsx("?from=1000-W01&to=9999-W52")).json()).toEqual({ error: "too many weeks" });
    expect(await (await xlsx("?from=0001-W01&to=9999-W52")).json()).toEqual({ error: "invalid week" });   // Date.UTC reads years 0–99 as 19xx
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(await (await xlsx("?from=2026-W40&to=2026-W41&lang=fr")).json()).toEqual({ error: "invalid lang" });
  });

  it("records every week of the range in one statement, as template 'range'", async () => {
    await xlsx("?from=2026-W39&to=2026-W41");
    const rows = (await DB().prepare("SELECT week, template FROM report_downloads ORDER BY week").all()).results;
    expect(rows).toEqual([{ week: "2026-W39", template: "range" }, { week: "2026-W40", template: "range" }, { week: "2026-W41", template: "range" }]);
    const dl = await (await api("/api/report-downloads?week=2026-W40")).json() as Array<{ template: string }>;
    expect(dl.map((d) => d.template)).toEqual(["range"]);
  });

  it("8 D1 statements per download (batch of 5 + 2 localize + 1 record), whatever the weeks and the language", async () => {
    // a task and a week digest, so both localize reads really run
    expect((await api("/api/tasks/T1", { method: "PUT", body: JSON.stringify({
      requester: "田中", title: "件名", status: "open", received_at: "2026-09-01", machine: "macmini", ts: "2026-09-01T09:00:00" }) })).status).toBe(200);
    await DB().prepare("INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at, oneliner) VALUES ('2026-W40', '', 't', 'h', 0, 'g', 'u', '一言')").run();
    const count = async (q: string) => {
      let n = 0;
      const real = DB();
      const counted = new Proxy(real, { get: (t, k) => (k === "prepare" ? (sql: string) => { n++; return t.prepare(sql); } : (t as any)[k]?.bind?.(t) ?? (t as any)[k]) });
      const r = await app.fetch(new Request(`http://worklog.test/api/reports/range/xlsx${q}`, { headers: { Authorization: "Bearer test-token" } }),
        { ...(env as any), DB: counted }, { waitUntil() {}, passThroughOnException() {} } as any);
      expect(r.status).toBe(200);
      await r.arrayBuffer();
      return n;
    };
    for (const lang of ["ja", "zh", "en"]) {
      expect(await count(`?from=2026-W40&to=2026-W40&lang=${lang}`), lang).toBe(8);
      expect(await count(`?from=2025-W41&to=2026-W40&lang=${lang}`), lang).toBe(8);
    }
  });

  it("the old single-week xlsx still answers", async () => {
    expect((await api("/api/reports/2026-W41/weekly/xlsx")).status).toBe(200);
  });
});

describe("GET /api/reports/range/bounds", () => {
  beforeEach(resetDb);
  it("null first without data; the report week of the earliest session otherwise", async () => {
    expect((await (await api("/api/reports/range/bounds")).json() as any).first).toBeNull();
    await api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: [{
      id: "S1", machine: "macmini", agent: "claude-code", session_id: "S1-full", cwd: "/w", started_at: "2026-09-15T01:00:00Z",
      ended_at: "2026-09-15T02:00:00Z", active_minutes: 60, turns: 1, summary: "x", summary_source: "llm", task_id: null, link_method: "none", ts: "2026-09-15T12:00:00" }] }) });
    const b = await (await api("/api/reports/range/bounds")).json() as { first: string; last: string };
    expect(b.first).toBe("2026-W38");
    expect(b.last).toMatch(/^\d{4}-W\d{2}$/);
    // a note (naive JST) on Sat 2026-09-05 04:30 JST is still Friday's 05:00-day → report week W36
    await api("/api/notes/N1", { method: "PUT", body: JSON.stringify({ text: "x", task_id: null, minutes: 10, machine: "macmini", ts: "2026-09-05T04:30:00" }) });
    expect(((await (await api("/api/reports/range/bounds")).json()) as any).first).toBe("2026-W36");
  });
});
