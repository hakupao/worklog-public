import { env } from "cloudflare:workers";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { GridCell, ReportPreview } from "../src/report/types";
import { api, resetDb } from "./helpers";

// /api/reports is the whole report feature seen from the outside: preview a week, edit a cell,
// take the edit back out, and download the workbook the edits went into.

const WEEK = "2026-W39";   // report week Sat 2026-09-19 .. Fri 2026-09-25 (05:00 JST days)

const ingest = (sessions: unknown[]) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions }) });

const session = (id: string, over: Record<string, unknown> = {}) => ({
  id, machine: "macmini", agent: "claude-code", session_id: `${id}-full`, cwd: "/w",
  started_at: "2026-09-22T01:00:00Z", ended_at: "2026-09-22T02:00:00Z", active_minutes: 60, turns: 5,
  summary: `auto ${id}`, summary_source: "llm", task_id: null, link_method: "none",
  ts: "2026-09-22T12:00:00", ...over,
});

async function seed(): Promise<void> {
  await api("/api/tasks/T1", { method: "PUT", body: JSON.stringify({
    requester: "田中", title: "件名 T1", project: "社内", status: "open", received_at: "2026-09-22",
    machine: "macmini", ts: "2026-09-22T09:00:00" }) });
  await ingest([
    session("S1", { task_id: "T1", link_method: "auto-dir" }),
    session("S2"),   // unassigned, so the preview carries a non-zero warning count
  ]);
}

const preview = async (week = WEEK, template = "weekly"): Promise<ReportPreview> => {
  const r = await api(`/api/reports/${week}/${template}`);
  expect(r.status).toBe(200);
  return (await r.json()) as ReportPreview;
};

const cellOf = (p: ReportPreview, sheet: string, row_key: string, column: string): GridCell =>
  p.sheets.find((g) => g.key === sheet)!.rows.find((r) => r.row_key === row_key)!.cells
    .find((c) => c.column === column)!;

const putCell = (body: unknown, week = WEEK, template = "weekly") =>
  api(`/api/reports/${week}/${template}/cells`, { method: "PUT", body: JSON.stringify(body) });

const deleteCell = (query: string, week = WEEK, template = "weekly") =>
  api(`/api/reports/${week}/${template}/cells?${query}`, { method: "DELETE" });

const TITLE_CELL = { sheet: "tasks", row_key: "T1", column: "title" };

describe("GET /api/reports/:week/:template", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("returns the week's sheets and the unassigned-session warning", async () => {
    const p = await preview();
    expect(p.week).toBe(WEEK);
    expect(p.template).toBe("weekly");
    expect(p.sheets.map((g) => g.key)).toEqual(["summary", "tasks", "days", "deliverables", "hours"]);
    expect(p.unassigned_sessions).toBe(1);
    expect(p.unassigned_minutes).toBe(30);   // S2 runs alongside S1 (T1): the wall clock halves its hour
    expect(cellOf(p, "tasks", "T1", "title")).toEqual({ column: "title", value: "件名 T1", kind: "text" });
  });

  it("carries the report week's Sat→Fri range", async () => {
    expect((await preview()).range).toEqual({
      from: "2026-09-19", to: "2026-09-25",
      dates: ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"],
    });
  });

  it("answers the retired agency / site names with the one template, unchanged", async () => {
    const weekly = await preview(WEEK, "weekly");
    expect(await preview(WEEK, "agency")).toEqual(weekly);
    expect(await preview(WEEK, "site")).toEqual(weekly);
  });

  it("rejects a week that is not an ISO week", async () => {
    const r = await api("/api/reports/2026-39/weekly");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid week" });
  });

  it("has nothing to serve for a template that does not exist", async () => {
    // "toString" is a property of every object, so the lookup has to ask about own properties.
    for (const template of ["kaisha", "toString", "constructor"]) {
      const r = await api(`/api/reports/${WEEK}/${template}`);
      expect(r.status, template).toBe(404);
      expect(await r.json()).toEqual({ error: "not found" });
    }
  });
});

describe("PUT /api/reports/:week/:template/cells", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("stores the edit and shows it in the preview with the computed value kept under auto", async () => {
    const r = await putCell({ ...TITLE_CELL, value: "手入力の件名" });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; updated_at: string };
    expect(body.ok).toBe(true);
    expect(typeof body.updated_at).toBe("string");

    expect(cellOf(await preview(), "tasks", "T1", "title")).toEqual({
      column: "title", value: "手入力の件名", kind: "text", auto: "件名 T1", overridden: true,
    });
  });

  it("replaces an earlier edit of the same cell", async () => {
    await putCell({ ...TITLE_CELL, value: "一回目" });
    await putCell({ ...TITLE_CELL, value: "二回目" });
    expect(cellOf(await preview(), "tasks", "T1", "title").value).toBe("二回目");
  });

  it("accepts an empty string, which is an edit and not a reset", async () => {
    expect((await putCell({ ...TITLE_CELL, value: "" })).status).toBe(200);
    expect(cellOf(await preview(), "tasks", "T1", "title")).toMatchObject({ value: "", overridden: true });
  });

  it("stores an edit made under a retired template name as the one template's", async () => {
    await putCell({ ...TITLE_CELL, value: "手入力の件名" }, WEEK, "site");
    expect(cellOf(await preview(WEEK, "weekly"), "tasks", "T1", "title").value).toBe("手入力の件名");
    const rows = (await (env as any).DB.prepare("SELECT DISTINCT template FROM report_overrides").all()).results;
    expect(rows).toEqual([{ template: "weekly" }]);
    expect((await deleteCell(new URLSearchParams(TITLE_CELL).toString(), WEEK, "agency")).status).toBe(200);
    expect(cellOf(await preview(), "tasks", "T1", "title").overridden).toBeUndefined();
  });

  it("stores an edit for a cell the grid does not have today without changing the preview", async () => {
    // The grid follows the data, so an edit may be written before the row it names exists.
    expect((await putCell({ sheet: "tasks", row_key: "T404", column: "title", value: "先回り" })).status).toBe(200);
    const p = await preview();
    expect(p.sheets.flatMap((g) => g.rows).flatMap((r) => r.cells).some((c) => c.overridden)).toBe(false);
  });

  it("rejects a body that names no known sheet, or leaves a field out, or adds one", async () => {
    for (const body of [
      { ...TITLE_CELL, sheet: "invoices", value: "x" },
      { sheet: "tasks", row_key: "T1", value: "x" },
      { ...TITLE_CELL },
      { ...TITLE_CELL, value: "x", extra: 1 },
      { ...TITLE_CELL, row_key: "", value: "x" },
      { ...TITLE_CELL, value: 7 },
    ]) {
      const r = await putCell(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect((await r.json()) as { error: string }).toMatchObject({ error: "invalid" });
    }
  });

  it("rejects a malformed week and an unknown template", async () => {
    expect((await putCell({ ...TITLE_CELL, value: "x" }, "2026-39")).status).toBe(400);
    expect((await putCell({ ...TITLE_CELL, value: "x" }, WEEK, "kaisha")).status).toBe(404);
  });
});

describe("DELETE /api/reports/:week/:template/cells", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("removes the edit and puts the computed value back", async () => {
    await putCell({ ...TITLE_CELL, value: "手入力の件名" });
    const r = await deleteCell("sheet=tasks&row_key=T1&column=title");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(cellOf(await preview(), "tasks", "T1", "title")).toEqual({ column: "title", value: "件名 T1", kind: "text" });
  });

  it("has nothing to remove twice", async () => {
    await putCell({ ...TITLE_CELL, value: "手入力の件名" });
    expect((await deleteCell("sheet=tasks&row_key=T1&column=title")).status).toBe(200);
    const r = await deleteCell("sheet=tasks&row_key=T1&column=title");
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
  });

  it("rejects a malformed week and an unknown template", async () => {
    expect((await deleteCell("sheet=tasks&row_key=T1&column=title", "2026-39")).status).toBe(400);
    expect((await deleteCell("sheet=tasks&row_key=T1&column=title", WEEK, "kaisha")).status).toBe(404);
  });

  it("rejects a query that does not name one cell", async () => {
    for (const query of ["sheet=tasks&row_key=T1", "sheet=invoices&row_key=T1&column=title", "sheet=tasks&row_key=T1&column=title&extra=1"]) {
      const r = await deleteCell(query);
      expect(r.status, query).toBe(400);
      expect((await r.json()) as { error: string }).toMatchObject({ error: "invalid" });
    }
  });
});

describe("GET /api/reports/:week/:template/xlsx", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("serves a workbook as a download named after the week and language", async () => {
    const r = await api(`/api/reports/${WEEK}/weekly/xlsx`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type"))
      .toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.headers.get("content-disposition"))
      .toBe(`attachment; filename="${WEEK}-ja.xlsx"`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    // xlsx is a zip archive; a zip's first local file header starts with "PK".
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("writes the edited value into the workbook, not the computed one", async () => {
    await putCell({ ...TITLE_CELL, value: "手入力の件名" });
    const r = await api(`/api/reports/${WEEK}/weekly/xlsx`);
    const wb = await new ExcelJS.Workbook().xlsx.load(await r.arrayBuffer());
    // 案件一覧 column B is 案件名 (the task title) and row 2 is the first task.
    expect(wb.getWorksheet("案件一覧")!.getCell("B2").value).toBe("手入力の件名");
  });

  it("rejects a malformed week and an unknown template", async () => {
    expect((await api("/api/reports/2026-39/weekly/xlsx")).status).toBe(400);
    expect((await api(`/api/reports/${WEEK}/kaisha/xlsx`)).status).toBe(404);
  });
});

describe("xlsx language", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  const sheetNames = async (url: string) => {
    const r = await api(url);
    expect(r.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await r.arrayBuffer());
    return { names: wb.worksheets.map((w) => w.name), disposition: r.headers.get("Content-Disposition") };
  };

  it("defaults to Japanese; ?lang=en writes English sheet names; the file name carries the language", async () => {
    expect(await sheetNames(`/api/reports/${WEEK}/weekly/xlsx`)).toEqual({
      names: ["サマリー", "案件一覧", "日別作業", "成果物", "稼働"], disposition: `attachment; filename="${WEEK}-ja.xlsx"` });
    expect(await sheetNames(`/api/reports/${WEEK}/weekly/xlsx?lang=en`)).toEqual({
      names: ["Summary", "Tasks", "Daily work", "Deliverables", "Hours"], disposition: `attachment; filename="${WEEK}-en.xlsx"` });
  });

  it("an unknown language is a 400", async () => {
    const r = await api(`/api/reports/${WEEK}/weekly/xlsx?lang=fr`);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid lang" });
  });

  it("the preview is unchanged by the dictionary (still Japanese labels under X-Lang: en)", async () => {
    const p = (await (await api(`/api/reports/${WEEK}/weekly`, { headers: { "X-Lang": "en" } })).json()) as ReportPreview;
    expect(p.sheets.map((g) => g.title)).toEqual(["サマリー", "案件一覧", "日別作業", "成果物", "稼働"]);
  });
});

describe("digest PATCH with pdf_text", () => {
  beforeEach(async () => {
    await resetDb(); await seed();
    await (env as any).DB.prepare(`INSERT INTO report_digests (week, day, text, pdf_text, inputs_hash, edited, model, generated_at, updated_at)
      VALUES ('2026-W39', '', '■ A：進んだ', '進んだ', 'h', 0, 'm', 'now', 'now')`).run();
  });

  it("a hand edit of text clears pdf_text; the preview carries pdf_text", async () => {
    let p = (await (await api(`/api/reports/2026-W39/weekly`)).json()) as ReportPreview;
    expect(p.digests.week!.pdf_text).toBe("進んだ");
    await api(`/api/reports/2026-W39/digests/week`, { method: "PATCH", body: JSON.stringify({ text: "手で直した" }) });
    p = (await (await api(`/api/reports/2026-W39/weekly`)).json()) as ReportPreview;
    expect(p.digests.week).toMatchObject({ text: "手で直した", pdf_text: null, edited: true });
  });

  // The worker is called directly so the env carries an API key and a stubbed fetch sees every model call.
  const regenerate = async (auto: string) => {
    const fetched: unknown[] = [];
    vi.stubGlobal("fetch", async (u: unknown) => {
      fetched.push(u);
      return new Response(JSON.stringify({
        id: "m", type: "message", role: "assistant", model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify({ lines: ["■ 件名 T1：進んだ"], pdf_lines: ["進んだ"] }) }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const ps: Promise<unknown>[] = [];
    try {
      const r = await worker.fetch(new Request("http://worklog.test/api/reports/2026-W39/digests/week", {
        method: "PATCH", body: JSON.stringify({ regenerate: true }),
        headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
      }), { ...(env as any), DIGESTS_AUTO: auto, ANTHROPIC_API_KEY: "k" }, { waitUntil: (p: Promise<unknown>) => ps.push(p) } as any);
      expect(r.status).toBe(200);
      const body = await r.json();
      await Promise.all(ps);
      return { fetched, waited: ps.length, body };
    } finally { vi.unstubAllGlobals(); }
  };

  it("regenerate with DIGESTS_AUTO off only marks the line: no model call, answers auto:false (R12)", async () => {
    const { fetched, waited, body } = await regenerate("off");
    expect(body).toMatchObject({ auto: false, edited: false, stale: true });
    expect(waited).toBe(0);
    expect(fetched).toEqual([]);
    const row = await (env as any).DB.prepare("SELECT edited, inputs_hash FROM report_digests WHERE week='2026-W39' AND day=''").first();
    expect(row).toEqual({ edited: 0, inputs_hash: "" });
  });

  it("regenerate with DIGESTS_AUTO on reaches generation, answers auto:true (R12)", async () => {
    const { fetched, waited, body } = await regenerate("on");
    expect(body).toMatchObject({ auto: true, edited: false });
    expect(waited).toBe(1);
    expect(fetched.length).toBe(2);   // the worked day 2026-09-22, then the week
    const row = await (env as any).DB.prepare("SELECT text, pdf_text, edited FROM report_digests WHERE week='2026-W39' AND day=''").first();
    expect(row).toEqual({ text: "■ 件名 T1：進んだ", pdf_text: "進んだ", edited: 0 });
  });
});

describe("digest text limit", () => {
  beforeEach(async () => {
    await resetDb(); await seed();
    await (env as any).DB.prepare(`INSERT INTO report_digests (week, day, text, inputs_hash, edited, model, generated_at, updated_at)
      VALUES ('2026-W39', '', 'x', 'h', 0, 'm', 'now', 'now')`).run();
  });
  it("accepts 1600 characters, rejects 1601", async () => {
    const patch = (n: number) => api(`/api/reports/2026-W39/digests/week`, { method: "PATCH", body: JSON.stringify({ text: "あ".repeat(n) }) });
    expect((await patch(1600)).status).toBe(200);
    expect((await patch(1601)).status).toBe(400);
  });
});
