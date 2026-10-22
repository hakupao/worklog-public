import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const post = (body: unknown) => api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
const newTask = async (title: string) => (await (await post({ requester: "田中さん", title, received_at: "2026-09-22" })).json()) as any;

const ingest = (sessions: Record<string, unknown>[]) =>
  api("/api/ingest/sessions", {
    method: "POST",
    body: JSON.stringify({
      machine: "macmini",
      sessions: sessions.map((s) => ({
        machine: "macmini", agent: "codex", session_id: `${s.id}-x`, cwd: "/w", turns: 3,
        summary: "s", summary_source: "llm", link_method: "auto-dir", ts: "2026-09-22T12:00:00", ...s,
      })),
    }),
  });
const note = (body: Record<string, unknown>) => api("/api/notes", { method: "POST", body: JSON.stringify(body) });
const totals = async () => (await (await api("/api/tasks/totals")).json()) as any[];

describe("GET /api/tasks/totals", () => {
  beforeEach(resetDb);

  it("one row per task, zero and null when nothing is linked", async () => {
    const t = await newTask("空の案件");
    expect(await totals()).toEqual([{ id: t.id, total_minutes: 0, last_date: null }]);
  });

  it("adds not-hidden sessions' effective minutes and linked notes' minutes — the detail's 合计", async () => {
    const t = await newTask("集計");
    await ingest([
      { id: "S1", task_id: t.id, started_at: "2026-09-22T01:00:00Z", ended_at: "2026-09-22T02:00:00Z", active_minutes: 60 },
      { id: "S2", task_id: t.id, started_at: "2026-09-24T01:00:00Z", ended_at: "2026-09-24T01:30:00Z", active_minutes: 30 },
      { id: "S3", task_id: t.id, started_at: "2026-09-25T01:00:00Z", ended_at: "2026-09-25T01:20:00Z", active_minutes: 20 },
    ]);
    // S2's minutes are overridden, S3 is hidden: 60 + 45 + note 15 = 120
    const s2 = ((await (await api(`/api/tasks/${t.id}`)).json()) as any).sessions.find((s: any) => s.id === "S2");
    await api("/api/sessions/S2", { method: "PATCH", body: JSON.stringify({ updated_at: s2.updated_at, minutes_override: 45 }) });
    const s3 = ((await (await api(`/api/tasks/${t.id}`)).json()) as any).sessions.find((s: any) => s.id === "S3");
    await api("/api/sessions/S3", { method: "PATCH", body: JSON.stringify({ updated_at: s3.updated_at, hidden: true }) });
    expect((await note({ text: "電話", task_id: t.id, minutes: 15, date: "2026-09-23" })).status).toBe(201);
    const detail = (await (await api(`/api/tasks/${t.id}`)).json()) as any;
    const row = (await totals()).find((r) => r.id === t.id);
    expect(row.total_minutes).toBe(120);
    expect(row.total_minutes).toBe(detail.total_minutes);
  });

  it("last_date is the later of the last not-hidden session's Tokyo end date and the last note's date", async () => {
    const a = await newTask("セッションが後");
    const b = await newTask("メモが後");
    await ingest([
      // ends 2026-09-24 23:30 UTC = 09-25 08:30 JST: the Tokyo date, not the stored string's
      { id: "A1", task_id: a.id, started_at: "2026-09-24T23:00:00Z", ended_at: "2026-09-24T23:30:00Z", active_minutes: 30 },
      { id: "B1", task_id: b.id, started_at: "2026-09-22T01:00:00Z", ended_at: "2026-09-22T02:00:00Z", active_minutes: 60 },
      // hidden: does not count as the last activity
      { id: "B2", task_id: b.id, started_at: "2026-09-29T01:00:00Z", ended_at: "2026-09-29T02:00:00Z", active_minutes: 60 },
    ]);
    const b2 = ((await (await api(`/api/tasks/${b.id}`)).json()) as any).sessions.find((s: any) => s.id === "B2");
    await api("/api/sessions/B2", { method: "PATCH", body: JSON.stringify({ updated_at: b2.updated_at, hidden: true }) });
    await note({ text: "a", task_id: a.id, minutes: null, date: "2026-09-23" });
    await note({ text: "b", task_id: b.id, minutes: null, date: "2026-09-26" });
    const rows = await totals();
    expect(rows.find((r) => r.id === a.id).last_date).toBe("2026-09-25");
    expect(rows.find((r) => r.id === b.id).last_date).toBe("2026-09-26");
  });

  it("is not shadowed by GET /api/tasks/:id (a task can't be named 'totals')", async () => {
    const r = await api("/api/tasks/totals");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
  });
});
