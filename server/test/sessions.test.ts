import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const row = () => db().prepare("SELECT * FROM sessions WHERE id='Sabcd1234'").first<any>();

const session = (over: Record<string, unknown> = {}) => ({
  id: "Sabcd1234", machine: "macmini", agent: "claude-code", session_id: "abcd1234-x", cwd: "/w",
  started_at: "2026-09-21T01:00:00Z", ended_at: "2026-09-21T02:00:00Z", active_minutes: 60, turns: 5,
  summary: "auto v1", summary_source: "llm", task_id: "T20260921-01", link_method: "auto-dir",
  ts: "2026-09-21T12:00:00", ...over,
});
const ingest = (s: unknown) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions: [s] }) });
const patch = (body: unknown, id = "Sabcd1234") =>
  api(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) });
const putTask = (id: string) => api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({
  requester: "田中さん", title: "t", status: "open", received_at: "2026-09-21", machine: "macmini", ts: "2026-09-21T09:00:00" }) });

describe("PATCH sessions", () => {
  beforeEach(async () => { await resetDb(); await ingest(session()); });

  it("edits summary and minutes, returning effective values", async () => {
    const before = await row();
    const r = await patch({ updated_at: before.updated_at, summary_edited: "人が直した", minutes_override: 45 });
    expect(r.status).toBe(200);
    const body = (await r.json()) as any;
    expect(body.summary_effective).toBe("人が直した");
    expect(body.minutes_effective).toBe(45);
    expect(body.summary).toBe("auto v1");
    expect(body.files_written).toEqual([]);
    expect(body.tokens).toBeNull();
    expect(body.updated_at).not.toBe(before.updated_at);
  });

  it("null and empty string both restore the automatic value", async () => {
    let cur = await row();
    await patch({ updated_at: cur.updated_at, summary_edited: "x", minutes_override: 5 });
    cur = await row();
    const r = await patch({ updated_at: cur.updated_at, summary_edited: "", minutes_override: null });
    const body = (await r.json()) as any;
    expect(body.summary_edited).toBeNull();
    expect(body.minutes_override).toBeNull();
    expect(body.summary_effective).toBe("auto v1");
    expect(body.minutes_effective).toBe(60);
  });

  it("assigning a task makes the link manual and survives the next ingest", async () => {
    await putTask("T20260921-09");
    const cur = await row();
    expect((await patch({ updated_at: cur.updated_at, task_id: "T20260921-09" })).status).toBe(200);
    await ingest(session({ summary: "auto v2" }));
    const after = await row();
    expect(after.task_id).toBe("T20260921-09");
    expect(after.link_method).toBe("manual");
    expect(after.summary).toBe("auto v2");
  });

  it("unassigning is also a manual decision the collector must not undo", async () => {
    const cur = await row();
    await patch({ updated_at: cur.updated_at, task_id: null });
    await ingest(session());
    const after = await row();
    expect(after.task_id).toBeNull();
    expect(after.link_method).toBe("manual");
  });

  it("hide and unhide", async () => {
    let cur = await row();
    await patch({ updated_at: cur.updated_at, hidden: true });
    expect((await row()).hidden).toBe(1);
    cur = await row();
    await patch({ updated_at: cur.updated_at, hidden: false });
    expect((await row()).hidden).toBe(0);
  });

  it("minutes_override of 0 is stored and effective (not treated as falsy)", async () => {
    const cur = await row();
    const r = await patch({ updated_at: cur.updated_at, minutes_override: 0 });
    const body = (await r.json()) as any;
    expect(body.minutes_override).toBe(0);
    expect(body.minutes_effective).toBe(0);
  });

  it("rejects an empty string task_id, but null still unassigns", async () => {
    const cur = await row();
    expect((await patch({ updated_at: cur.updated_at, task_id: "" })).status).toBe(400);
    expect((await patch({ updated_at: cur.updated_at, task_id: null })).status).toBe(200);
  });

  it("rejects an unknown task", async () => {
    const cur = await row();
    const r = await patch({ updated_at: cur.updated_at, task_id: "T19990101-01" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).issues[0]).toEqual({ path: "task_id", message: "unknown task" });
  });

  it("stale updated_at -> 409 with the current row, nothing changed", async () => {
    const r = await patch({ updated_at: "2000-01-01T00:00:00.000Z", summary_edited: "lost update" });
    expect(r.status).toBe(409);
    const body = (await r.json()) as any;
    expect(body.error).toBe("conflict");
    expect(body.current.id).toBe("Sabcd1234");
    // Decoded like every 200 for a session, not the raw JSON string the column stores.
    expect(body.current.files_written).toEqual([]);
    expect(body.current.tokens).toBeNull();
    expect((await row()).summary_edited).toBeNull();
  });

  it("unknown id -> 404", async () => {
    expect((await patch({ updated_at: "x", hidden: true }, "Snope0000")).status).toBe(404);
  });

  it("rejects unknown fields, and a patch with nothing to update", async () => {
    const cur = await row();
    expect((await patch({ updated_at: cur.updated_at, summary: "cannot set the auto field" })).status).toBe(400);
    expect((await patch({ updated_at: cur.updated_at })).status).toBe(400);
  });
});

describe("GET sessions?unlinked=1", () => {
  const list = (q = "?unlinked=1") => api(`/api/sessions${q}`);

  beforeEach(async () => {
    await resetDb();
    await putTask("T20260921-09");
    // Linked to a task that exists: not unlinked.
    await ingest(session({ id: "Slinked01", session_id: "l1", task_id: "T20260921-09", active_minutes: 500 }));
    // task_id null: unlinked, 30 min.
    await ingest(session({ id: "Snull0001", session_id: "n1", task_id: null, link_method: "none", active_minutes: 30 }));
    // task_id pointing at a task that does not exist: unlinked (dashboard 口径), 90 min.
    await ingest(session({ id: "Sdangl001", session_id: "d1", task_id: "T19990101-01", active_minutes: 90 }));
    // Unlinked but hidden: excluded.
    await ingest(session({ id: "Shidden01", session_id: "h1", task_id: null, link_method: "none", active_minutes: 999 }));
    const h = await db().prepare("SELECT updated_at FROM sessions WHERE id='Shidden01'").first<any>();
    await patch({ updated_at: h.updated_at, hidden: true }, "Shidden01");
    // Same effective minutes as Snull0001 via an override, but started earlier: sorts before it.
    await ingest(session({ id: "Searly001", session_id: "e1", task_id: null, link_method: "none", active_minutes: 5,
      started_at: "2026-09-20T01:00:00Z", ended_at: "2026-09-20T02:00:00Z" }));
    const e = await db().prepare("SELECT updated_at FROM sessions WHERE id='Searly001'").first<any>();
    await patch({ updated_at: e.updated_at, minutes_override: 30 }, "Searly001");
  });

  it("returns visible sessions with no task or a missing task, by effective minutes desc then started_at", async () => {
    const r = await list();
    expect(r.status).toBe(200);
    const body = (await r.json()) as any[];
    expect(body.map((s) => s.id)).toEqual(["Sdangl001", "Searly001", "Snull0001"]);
  });

  it("returns the full Session shape with effective fields and decoded JSON columns", async () => {
    const body = (await (await list()).json()) as any[];
    const early = body.find((s) => s.id === "Searly001");
    expect(early.minutes_effective).toBe(30);
    expect(early.summary_effective).toBe("auto v1");
    expect(early.files_written).toEqual([]);
    expect(early.tokens).toBeNull();
    expect(early.active_intervals).toBeNull();
  });

  it("is 400 without unlinked=1 (no full listing)", async () => {
    expect((await list("")).status).toBe(400);
    expect((await list("?unlinked=0")).status).toBe(400);
  });
});
