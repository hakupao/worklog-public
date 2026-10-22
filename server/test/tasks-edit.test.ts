import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";
import { jstNow } from "../src/jst";

const db = () => (env as any).DB as D1Database;
const post = (body: unknown) => api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
const patch = (id: string, body: unknown) => api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });

describe("tasks: create / edit / detail", () => {
  beforeEach(resetDb);

  it("allocates sequential ids per received date", async () => {
    const a = (await (await post({ requester: "田中さん", title: "A", received_at: "2026-09-22" })).json()) as any;
    const b = (await (await post({ requester: "田中さん", title: "B", received_at: "2026-09-22" })).json()) as any;
    const c = (await (await post({ requester: "佐藤さん", title: "C", received_at: "2026-09-23" })).json()) as any;
    expect([a.id, b.id, c.id]).toEqual(["T20260922-01", "T20260922-02", "T20260923-01"]);
    expect(a.status).toBe("open");
    expect(a.deliverables).toEqual([]);
    expect(a.machine).toBe("web");
  });

  it("continues after the highest existing suffix, not the row count", async () => {
    await api("/api/tasks/T20260922-05", { method: "PUT", body: JSON.stringify({
      requester: "r", title: "cli", status: "open", received_at: "2026-09-22", machine: "macmini", ts: "2026-09-22T09:00:00" }) });
    const r = (await (await post({ requester: "r", title: "web", received_at: "2026-09-22" })).json()) as any;
    expect(r.id).toBe("T20260922-06");
  });

  it("continues numerically past two digits instead of wedging at -99", async () => {
    await api("/api/tasks/T20260922-99", { method: "PUT", body: JSON.stringify({
      requester: "r", title: "cli", status: "open", received_at: "2026-09-22", machine: "macmini", ts: "2026-09-22T09:00:00" }) });
    const a = (await (await post({ requester: "r", title: "web-a", received_at: "2026-09-22" })).json()) as any;
    const b = (await (await post({ requester: "r", title: "web-b", received_at: "2026-09-22" })).json()) as any;
    expect([a.id, b.id]).toEqual(["T20260922-100", "T20260922-101"]);
  });

  it("defaults received_at to today in JST", async () => {
    const r = await post({ requester: "r", title: "t" });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).received_at).toBe(jstNow().date);
  });

  it("PATCH edits fields and round-trips deliverables", async () => {
    const t = (await (await post({ requester: "r", title: "old", received_at: "2026-09-22" })).json()) as any;
    const r = await patch(t.id, { updated_at: t.updated_at, title: "new", deliverables: ["a.xlsx"], hours_manual: 1.5 });
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect([body.title, body.deliverables, body.hours_manual]).toEqual(["new", ["a.xlsx"], 1.5]);
  });

  it("marking done fills done_at; reopening clears it", async () => {
    const t = (await (await post({ requester: "r", title: "t", received_at: "2026-09-22" })).json()) as any;
    const done = (await (await patch(t.id, { updated_at: t.updated_at, status: "done" })).json()) as any;
    expect(done.done_at).toBe(jstNow().date);
    const reopened = (await (await patch(t.id, { updated_at: done.updated_at, status: "open" })).json()) as any;
    expect(reopened.done_at).toBeNull();
  });

  it("an explicit done_at wins", async () => {
    const t = (await (await post({ requester: "r", title: "t", received_at: "2026-09-22" })).json()) as any;
    const r = (await (await patch(t.id, { updated_at: t.updated_at, status: "done", done_at: "2026-09-20" })).json()) as any;
    expect(r.done_at).toBe("2026-09-20");
  });

  it("stale updated_at -> 409; unknown id -> 404; unknown field -> 400", async () => {
    const t = (await (await post({ requester: "r", title: "t", received_at: "2026-09-22" })).json()) as any;
    const stale = await patch(t.id, { updated_at: "2000-01-01T00:00:00.000Z", title: "lost" });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as any).current.title).toBe("t");
    expect((await patch("T19990101-01", { updated_at: "x", title: "y" })).status).toBe(404);
    expect((await patch(t.id, { updated_at: t.updated_at, id: "T1" })).status).toBe(400);
  });

  // Final review A-C1: conflictOrNotFound is shared by sessions/tasks/notes and (before this fix)
  // never decoded a task's `deliverables` column, unlike every OTHER tasks response (`toJson` in
  // routes/tasks.ts). A 409's `current.deliverables` shipped as a raw JSON-encoded STRING, which
  // crashed TaskDrawer's `task.deliverables.map(...)` on the client for an entirely ordinary
  // two-device conflict.
  it("a stale PATCH's 409 body parses `current.deliverables` as an array, like every other tasks response", async () => {
    const t = (await (await post({ requester: "r", title: "t", received_at: "2026-09-22" })).json()) as any;
    // Give the row a real deliverables list, then use its now-stale `updated_at` for a second PATCH.
    await patch(t.id, { updated_at: t.updated_at, deliverables: ["a.xlsx"] });
    const stale = await patch(t.id, { updated_at: t.updated_at, title: "lost" });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as any;
    expect(Array.isArray(body.current.deliverables)).toBe(true);
    expect(body.current.deliverables).toEqual(["a.xlsx"]);
  });

  it("detail lists sessions and notes with a total", async () => {
    const t = (await (await post({ requester: "r", title: "t", received_at: "2026-09-21" })).json()) as any;
    const s = (id: string, minutes: number) => ({
      id, machine: "macmini", agent: "codex", session_id: id + "-x", cwd: "/w", started_at: "2026-09-21T01:00:00Z",
      ended_at: "2026-09-21T02:00:00Z", active_minutes: minutes, turns: 3, summary: "s", summary_source: "llm",
      task_id: t.id, link_method: "auto-dir", ts: "2026-09-21T12:00:00" });
    const tokens = { by_model: { "claude-opus-5-5": { input: 1, output: 2, cache_read: 3, cache_write_5m: 4, cache_write_1h: 5, reasoning: 0 } },
      subagent: {}, cost_usd: 0.5, cost_partial: false };
    const sa = { ...s("Sa", 60), files_written: ["/w/成果物/a.md"], tokens };
    await api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: [sa, s("Sb", 30)] }) });
    await db().prepare("UPDATE sessions SET hidden=1 WHERE id='Sb'").run();
    await api("/api/notes/N1", { method: "PUT", body: JSON.stringify({ text: "memo", task_id: t.id, minutes: 15, machine: "macmini", ts: "2026-09-21T10:00:00" }) });

    const d = (await (await api(`/api/tasks/${t.id}`)).json()) as any;
    expect(d.task.id).toBe(t.id);
    expect(d.sessions.map((x: any) => x.id)).toEqual(["Sa", "Sb"]);
    expect(d.sessions[0].minutes_effective).toBe(60);
    expect(d.sessions[0].files_written).toEqual(["/w/成果物/a.md"]);
    expect(d.sessions[1].files_written).toEqual([]);
    expect(d.sessions[0].tokens).toEqual(tokens);
    expect(d.sessions[1].tokens).toBeNull();
    expect(d.notes.map((n: any) => n.text)).toEqual(["memo"]);
    expect(d.total_minutes).toBe(75);
    expect((await api("/api/tasks/T19990101-01")).status).toBe(404);
  });

  it("requesters are distinct and sorted", async () => {
    await post({ requester: "田中さん", title: "a", received_at: "2026-09-22" });
    await post({ requester: "佐藤さん", title: "b", received_at: "2026-09-22" });
    await post({ requester: "田中さん", title: "c", received_at: "2026-09-22" });
    const list = (await (await api("/api/requesters")).json()) as string[];
    expect(list).toHaveLength(2);
    expect(new Set(list)).toEqual(new Set(["田中さん", "佐藤さん"]));
    expect([...list].sort()).toEqual(list);
  });

  it("requesters lists each name of a multi-依頼元 task on its own", async () => {
    await post({ requester: "田中さん、佐藤さん", title: "a", received_at: "2026-09-22" });
    await post({ requester: "佐藤さん", title: "b", received_at: "2026-09-22" });
    const list = (await (await api("/api/requesters")).json()) as string[];
    expect(list).toEqual(["佐藤さん", "田中さん"].sort());
  });
});
