import { env } from "cloudflare:workers";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { digestId } from "../src/report/digests";
import { overrideId } from "../src/i18n/registry";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const zh = { "X-Lang": "zh" };
const putTr = (entity: string, id: string, field: string, source: string, zhText: string) =>
  db().prepare(`INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
    VALUES (?1, ?2, ?3, ?4, 'ja', ?5, ?4, ?4, 'm', 'now')`).bind(entity, id, field, source, zhText).run();

async function seed() {
  await db().batch([
    db().prepare(`INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
      VALUES ('T20261001-01', 'r', 'プロジェクト', '帳票修正', 'open', '2026-10-01', '', '[]', 'm', 'x', 'u')`),
    db().prepare(`INSERT INTO sessions (id, machine, agent, session_id, cwd, started_at, ended_at, active_minutes, turns, summary,
      summary_source, task_id, link_method, ts, updated_at) VALUES ('S1', 'm', 'claude-code', 'sid', '/x', '2026-10-01T01:00:00Z',
      '2026-10-01T02:00:00Z', 60, 3, '検証した', 'llm', 'T20261001-01', 'manual', 'x', 'u')`),
  ]);
  await putTr("task", "T20261001-01", "title", "帳票修正", "报表修改");
  await putTr("task", "T20261001-01", "project", "プロジェクト", "项目");
  await putTr("session", "S1", "summary", "検証した", "已验证");
}

describe("routes localize with X-Lang", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("tasks list: translated with the header, source without it", async () => {
    const withH = (await (await api("/api/tasks", { headers: zh })).json()) as any[];
    expect([withH[0].title, withH[0].project]).toEqual(["报表修改", "项目"]);
    const raw = (await (await api("/api/tasks")).json()) as any[];
    expect(raw[0].title).toBe("帳票修正");
  });

  it("timeline sessions: summary_effective is the translation", async () => {
    const t = (await (await api("/api/weeks/2026-W40/timeline", { headers: zh })).json()) as any;
    const s = t.days.flatMap((d: any) => d.sessions)[0];
    expect([s.summary, s.summary_effective]).toEqual(["已验证", "已验证"]);
  });

  it("task detail: task and its sessions", async () => {
    const d = (await (await api("/api/tasks/T20261001-01", { headers: zh })).json()) as any;
    expect([d.task.title, d.sessions[0].summary_effective]).toEqual(["报表修改", "已验证"]);
  });

  it("report preview localizes; xlsx route ignores the header (always ja)", async () => {
    const p = (await (await api("/api/reports/2026-W40/weekly", { headers: zh })).json()) as any;
    expect(JSON.stringify(p.sheets)).toContain("报表修改");
    const x = await api("/api/reports/2026-W40/weekly/xlsx", { headers: zh });
    expect(x.status).toBe(200);
    const wb = await new ExcelJS.Workbook().xlsx.load(await x.arrayBuffer());
    const cells: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { cells.push(String(cell.value)); })));
    expect(cells.join("\n")).toContain("帳票修正");
    expect(cells.join("\n")).not.toContain("报表修改");
  });

  it("report preview: a stored override is translated by its overrideId", async () => {
    const cell = { sheet: "tasks", row_key: "T20261001-01", column: "title" };
    await api("/api/reports/2026-W40/weekly/cells", { method: "PUT", body: JSON.stringify({ ...cell, value: "手書き件名" }) });
    await putTr("report_override", overrideId("2026-W40", "weekly", cell.sheet, cell.row_key, cell.column), "value", "手書き件名", "手写标题");
    const p = (await (await api("/api/reports/2026-W40/weekly", { headers: zh })).json()) as any;
    const json = JSON.stringify(p.sheets);
    expect(json).toContain("手写标题");
    expect(json).not.toContain("手書き件名");
    const raw = (await (await api("/api/reports/2026-W40/weekly")).json()) as any;
    expect(JSON.stringify(raw.sheets)).toContain("手書き件名");
  });

  it("day plan: item text, linked task titles and evidence summaries", async () => {
    await db().batch([
      db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-10-01', 'x', 'u')"),
      db().prepare(`INSERT INTO day_plan_items (id, date, text, detail, sort, ai_evidence, updated_at)
        VALUES ('D1', '2026-10-01', '帳票を直す', '', 0, '["S1"]', 'u')`),
      db().prepare("INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES ('D1', 'T20261001-01')"),
    ]);
    await putTr("day_plan_item", "D1", "text", "帳票を直す", "修报表");
    const p = (await (await api("/api/day-plans/2026-10-01", { headers: zh })).json()) as any;
    const item = p.items[0];
    expect([item.text, item.tasks[0].title]).toEqual(["修报表", "报表修改"]);
    expect(item.ai_evidence_sessions).toEqual([{ id: "S1", summary: "已验证", started_at: "2026-10-01T01:00:00Z" }]);
  });

  it("a 409's current is localized like a 200", async () => {
    const r = await api("/api/tasks/T20261001-01", { method: "PATCH", headers: zh, body: JSON.stringify({ title: "x", updated_at: "stale" }) });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).current.title).toBe("报表修改");
  });

  it("dashboard: tasks sharing a source project stay one bucket under X-Lang", async () => {
    const task = (id: string) => db().prepare(`INSERT INTO tasks (id, requester, project, title, status, received_at, thinking,
      deliverables, machine, ts, updated_at) VALUES (?1, 'r', '共通', ?1, 'open', '2026-10-01', '', '[]', 'm', 'x', 'u')`).bind(id);
    const sess = (id: string, task: string, minutes: number) => db().prepare(`INSERT INTO sessions (id, machine, agent, session_id, cwd,
      started_at, ended_at, active_minutes, turns, summary, summary_source, task_id, link_method, ts, updated_at)
      VALUES (?1, 'm', 'claude-code', ?1, '/x', '2026-10-01T03:00:00Z', '2026-10-01T04:00:00Z', ?3, 1, 's', 'llm', ?2, 'manual', 'x', 'u')`)
      .bind(id, task, minutes);
    await db().batch([task("T20261001-02"), task("T20261001-03"), task("T20261001-04"),
      sess("S2", "T20261001-02", 30), sess("S3", "T20261001-03", 45), sess("S4", "T20261001-04", 20)]);
    await putTr("task", "T20261001-02", "project", "共通（旧）", "旧公共");   // stale: skipped
    await putTr("task", "T20261001-03", "project", "共通", "通用");
    await putTr("task", "T20261001-04", "project", "共通", "公共");          // fresh, but a higher id
    const q = "/api/dashboard?from=2026-10-01&to=2026-10-01";
    const raw = ((await (await api(q)).json()) as any).time.by_project;
    const withH = ((await (await api(q, { headers: zh })).json()) as any).time.by_project;
    expect(withH.map((r: any) => r.minutes)).toEqual(raw.map((r: any) => r.minutes));
    expect(withH.find((r: any) => r.key === "通用")?.minutes).toBe(95);
    expect(withH.some((r: any) => ["公共", "旧公共", "共通"].includes(r.key))).toBe(false);
    expect(raw.find((r: any) => r.key === "共通")?.minutes).toBe(95);
  });

  it("stats sessions: the summary is localized before the 80-character cut", async () => {
    const long = "译".repeat(100);
    await db().prepare("UPDATE translations SET zh = ?1 WHERE entity = 'session' AND entity_id = 'S1'").bind(long).run();
    const b = (await (await api("/api/stats/sessions?from=2026-10-01&to=2026-10-01", { headers: zh })).json()) as any;
    expect(b.sessions.find((s: any) => s.id === "S1").summary).toBe("译".repeat(80));
  });

  it("a stale translation falls back to the source", async () => {
    await db().prepare("UPDATE tasks SET title = '帳票修正（改）' WHERE id = 'T20261001-01'").run();
    const withH = (await (await api("/api/tasks", { headers: zh })).json()) as any[];
    expect(withH[0].title).toBe("帳票修正（改）");
  });
});

const putPolish = (entity: string, id: string, field: string, raw: string, polished: string, zhText: string, pinned = false) =>
  db().prepare(`INSERT OR REPLACE INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at, polished_from, pinned_raw)
    VALUES (?1, ?2, ?3, ?4, 'ja', ?6, ?5, ?5, 'm', 'now', ?7, ?8)`)
    .bind(entity, id, field, raw, pinned ? raw : polished, zhText, pinned ? null : raw, pinned ? raw : null).run();

describe("input polish in reads", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("a polished task title is shown polished in every language and carries _polish meta", async () => {
    await putPolish("task", "T20261001-01", "title", "帳票修正", "帳票の修正", "修改报表");
    const ja = (await (await api("/api/tasks/T20261001-01", { headers: { "X-Lang": "ja" } })).json()) as any;
    expect(ja.task.title).toBe("帳票の修正");
    expect(ja.task._polish).toEqual({ title: { raw: "帳票修正", pinned: false } });
    const z = (await (await api("/api/tasks", { headers: zh })).json()) as any[];
    expect(z[0].title).toBe("修改报表");
    expect(z[0]._polish.title.raw).toBe("帳票修正");
    const raw = (await (await api("/api/tasks/T20261001-01")).json()) as any;
    expect(raw.task.title).toBe("帳票修正");
    expect(raw.task._polish).toBeUndefined();
  });

  it("a restored field reports pinned and shows the raw text", async () => {
    await putPolish("task", "T20261001-01", "title", "帳票修正", "", "报表修正", true);
    const ja = (await (await api("/api/tasks/T20261001-01", { headers: { "X-Lang": "ja" } })).json()) as any;
    expect(ja.task.title).toBe("帳票修正");
    expect(ja.task._polish).toEqual({ title: { raw: "帳票修正", pinned: true } });
  });

  it("a polished value sent back under X-Lang is not an edit", async () => {
    await putPolish("task", "T20261001-01", "title", "帳票修正", "帳票の修正", "修改报表");
    const cur = (await (await api("/api/tasks/T20261001-01", { headers: { "X-Lang": "ja" } })).json()) as any;
    const res = await api("/api/tasks/T20261001-01", { method: "PATCH", headers: { "X-Lang": "ja" },
      body: JSON.stringify({ updated_at: cur.task.updated_at, title: "帳票の修正" }) });
    expect(res.status).toBe(200);
    expect((await db().prepare("SELECT title FROM tasks WHERE id='T20261001-01'").first<any>()).title).toBe("帳票修正");
    expect((await db().prepare("SELECT polished_from FROM translations WHERE entity='task' AND field='title'").first<any>()).polished_from).toBe("帳票修正");
  });

  it("a CLI round-trip of the raw task makes no model call and keeps the polish", async () => {
    await putPolish("task", "T20261001-01", "title", "帳票修正", "帳票の修正", "修改报表");
    const raw = (await (await api("/api/tasks/T20261001-01")).json()) as any;
    const res = await api("/api/tasks/T20261001-01", { method: "PUT", body: JSON.stringify({ ...raw.task, status: "done", done_at: "2026-10-09" }) });
    expect(res.status).toBe(200);
    const { findStale } = await import("../src/i18n/sweep");
    const stale = await findStale(db(), new Date().toISOString(), 30, { entity: "task", entity_id: "T20261001-01" });
    expect(stale.filter((s) => s.field === "title")).toEqual([]);
  });

  it("plan items, session summaries and the sessions list carry the meta too", async () => {
    await db().prepare(`INSERT INTO plan_items (id, horizon, text, status, sort, created_at, updated_at)
      VALUES ('P1', 'near', '週報なおす', 'active', 0, 'now', 'u')`).run();
    await putPolish("plan_item", "P1", "text", "週報なおす", "週報を修正", "修改周报");
    const items = (await (await api("/api/plan-items", { headers: { "X-Lang": "ja" } })).json()) as any[];
    expect(items.find((i) => i.id === "P1")).toMatchObject({ text: "週報を修正", _polish: { text: { raw: "週報なおす", pinned: false } } });
    await putPolish("session", "S1", "summary", "検証した", "検証を行った", "已验证");
    await db().prepare("UPDATE sessions SET task_id = NULL WHERE id = 'S1'").run();
    const list = (await (await api("/api/sessions?unlinked=1", { headers: { "X-Lang": "ja" } })).json()) as any[];
    expect(list.find((s) => s.id === "S1")).toMatchObject({ summary_effective: "検証を行った", _polish: { summary: { raw: "検証した", pinned: false } } });
    const t = (await (await api("/api/weeks/2026-W40/timeline", { headers: { "X-Lang": "ja" } })).json()) as any;
    expect(t.days.flatMap((d: any) => d.sessions)[0]._polish.summary.raw).toBe("検証した");
  });

  it("a report preview cell with a polished override carries polish {raw, pinned}", async () => {
    const cell = { sheet: "tasks", row_key: "T20261001-01", column: "title" };
    await api("/api/reports/2026-W40/weekly/cells", { method: "PUT", body: JSON.stringify({ ...cell, value: "てがき件名" }) });
    const id = overrideId("2026-W40", "weekly", cell.sheet, cell.row_key, cell.column);
    await putPolish("report_override", id, "value", "てがき件名", "手書き件名", "手写标题");
    const find = (p: any) => p.sheets.flatMap((g: any) => g.rows).flatMap((r: any) => r.cells).find((c: any) => c.polish);
    expect(find((await (await api("/api/reports/2026-W40/weekly", { headers: zh })).json()) as any)).toMatchObject({ polish: { raw: "てがき件名", pinned: false } });
    await putPolish("report_override", id, "value", "てがき件名", "手書き件名", "手写标题", true);
    expect(find((await (await api("/api/reports/2026-W40/weekly", { headers: zh })).json()) as any)).toMatchObject({ polish: { raw: "てがき件名", pinned: true } });
  });

  it("a digest with a polished hand edit carries polish.text", async () => {
    await db().prepare(`INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at)
      VALUES ('2026-W40', '', 'しゅうほう', 'h', 1, 'u', 'u')`).run();
    await putPolish("digest", digestId("2026-W40", ""), "text", "しゅうほう", "週報", "周报");
    const p = (await (await api("/api/reports/2026-W40/weekly", { headers: zh })).json()) as any;
    expect(p.digests.week).toMatchObject({ text: "周报", polish: { text: { raw: "しゅうほう", pinned: false } } });
  });
});
