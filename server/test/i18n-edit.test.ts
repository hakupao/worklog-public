import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const ID = "T20261001-01";

describe("edits under X-Lang", () => {
  beforeEach(async () => {
    await resetDb();
    await db().prepare(`INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
      VALUES (?1, 'r', '', '帳票修正', 'open', '2026-10-01', '考え', '[]', 'm', 'x', 'u0')`).bind(ID).run();
    await db().prepare(`INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
      VALUES ('task', ?1, 'title', '帳票修正', 'ja', '报表修改', '帳票修正', 'Report fix', 'm', 'now')`).bind(ID).run();
  });

  const patch = (body: object, lang = "zh") =>
    api(`/api/tasks/${ID}`, { method: "PATCH", headers: { "X-Lang": lang }, body: JSON.stringify(body) });

  it("re-sending the displayed translation changes nothing in the base row", async () => {
    const r = await patch({ updated_at: "u0", title: "报表修改" });
    expect(r.status).toBe(200);
    const row = await db().prepare("SELECT title, updated_at FROM tasks WHERE id = ?1").bind(ID).first<any>();
    expect(row).toEqual({ title: "帳票修正", updated_at: "u0" });
    expect(((await r.json()) as any).title).toBe("报表修改");
  });

  it("a real edit in zh becomes the new source", async () => {
    const r = await patch({ updated_at: "u0", title: "报表修改（第二版）" });
    expect(r.status).toBe(200);
    expect((await db().prepare("SELECT title FROM tasks WHERE id = ?1").bind(ID).first<any>()).title).toBe("报表修改（第二版）");
  });

  it("mixed patch: unchanged field dropped, changed field written", async () => {
    await patch({ updated_at: "u0", title: "报表修改", thinking: "新的想法" });
    expect(await db().prepare("SELECT title, thinking FROM tasks WHERE id = ?1").bind(ID).first<any>())
      .toEqual({ title: "帳票修正", thinking: "新的想法" });
  });

  it("without X-Lang the value is written as is (CLI / old UI)", async () => {
    await api(`/api/tasks/${ID}`, { method: "PATCH", body: JSON.stringify({ updated_at: "u0", title: "报表修改" }) });
    expect((await db().prepare("SELECT title FROM tasks WHERE id = ?1").bind(ID).first<any>()).title).toBe("报表修改");
  });

  it("an all-dropped patch from a stale tab is still a 409", async () => {
    const r = await patch({ updated_at: "stale", title: "报表修改" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as any).current.title).toBe("报表修改");
  });

  it("a patch that was empty from the start is still a 400", async () => {
    expect((await patch({ updated_at: "u0" })).status).toBe(400);
  });

  it("a dropped title next to a status change still writes the status", async () => {
    const r = await patch({ updated_at: "u0", title: "报表修改", status: "hold" });
    expect(r.status).toBe(200);
    expect(await db().prepare("SELECT title, status FROM tasks WHERE id = ?1").bind(ID).first<any>())
      .toEqual({ title: "帳票修正", status: "hold" });
  });

  it("sessions: the displayed translation re-sent as summary_edited does not become an edit; '' still restores", async () => {
    await db().prepare(`INSERT INTO sessions (id, machine, agent, session_id, cwd, started_at, ended_at, active_minutes, turns, summary, summary_source, link_method, ts, updated_at)
      VALUES ('s1', 'm', 'claude-code', 'x', '/', '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z', 60, 1, '要約', 'llm', 'none', 'x', 'u0')`).run();
    await db().prepare(`INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
      VALUES ('session', 's1', 'summary', '要約', 'ja', '摘要', '要約', 'Summary', 'm', 'now')`).run();
    const send = (body: object) => api("/api/sessions/s1", { method: "PATCH", headers: { "X-Lang": "zh" }, body: JSON.stringify(body) });
    const r = await send({ updated_at: "u0", summary_edited: "摘要" });
    expect(r.status).toBe(200);
    expect(await db().prepare("SELECT summary_edited, updated_at FROM sessions WHERE id = 's1'").first<any>())
      .toEqual({ summary_edited: null, updated_at: "u0" });
    expect((await send({ updated_at: "u0", summary_edited: "" })).status).toBe(200);
  });

  it("day plan items: unchanged detail dropped, task_ids still written", async () => {
    await db().batch([
      db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES ('2026-10-01', 'x', 'x')"),
      db().prepare(`INSERT INTO day_plan_items (id, date, text, detail, sort, updated_at)
        VALUES ('D1', '2026-10-01', '作業', '詳細', 0, 'u0')`),
      db().prepare(`INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
        VALUES ('day_plan_item', 'D1', 'detail', '詳細', 'ja', '详情', '詳細', 'Detail', 'm', 'now')`),
    ]);
    const r = await api("/api/day-plan-items/D1", {
      method: "PATCH", headers: { "X-Lang": "zh" }, body: JSON.stringify({ updated_at: "u0", detail: "详情", task_ids: [ID] }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body.detail).toBe("详情");
    expect(body.tasks.map((t: any) => t.id)).toEqual([ID]);
    expect((await db().prepare("SELECT detail FROM day_plan_items WHERE id = 'D1'").first<any>()).detail).toBe("詳細");
  });
});
