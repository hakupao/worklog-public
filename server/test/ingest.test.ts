import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;

const session = (over: Record<string, unknown> = {}) => ({
  kind: "session",
  id: "Sabcd1234",
  machine: "macmini",
  agent: "claude-code",
  session_id: "abcd1234-ef56-7890-ab12-cd34ef567890",
  cwd: "/Volumes/Data/Projects/LEDGER",
  started_at: "2026-09-21T09:10:00+09:00",
  ended_at: "2026-09-21T11:40:00+09:00",
  active_minutes: 150,
  turns: 42,
  summary: "auto summary v1",
  summary_source: "llm",
  task_id: "T20260921-01",
  link_method: "auto-dir",
  ts: "2026-09-21T12:00:00",
  ...over,
});

const ingest = (machine: string, sessions: unknown[]) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine, sessions }) });

const row = () => db().prepare("SELECT * FROM sessions WHERE id='Sabcd1234'").first<any>();

describe("ingest", () => {
  beforeEach(resetDb);

  it("inserts then updates, reporting counts", async () => {
    expect(await (await ingest("macmini", [session()])).json()).toEqual({ inserted: 1, updated: 0 });
    const r = await ingest("macmini", [session({ summary: "auto summary v2", active_minutes: 180 })]);
    expect(await r.json()).toEqual({ inserted: 0, updated: 1 });
    const s = await row();
    expect(s.summary).toBe("auto summary v2");
    expect(s.active_minutes).toBe(180);
  });

  it("never overwrites human fields", async () => {
    await ingest("macmini", [session()]);
    await db()
      .prepare("UPDATE sessions SET summary_edited='人が直した', minutes_override=90, hidden=1 WHERE id='Sabcd1234'")
      .run();
    await ingest("macmini", [session({ summary: "auto summary v2" })]);
    const s = await row();
    expect(s.summary).toBe("auto summary v2");
    expect(s.summary_edited).toBe("人が直した");
    expect(s.minutes_override).toBe(90);
    expect(s.hidden).toBe(1);
  });

  it("keeps a manual link when the collector re-reports an auto link", async () => {
    await ingest("macmini", [session()]);
    await db()
      .prepare("UPDATE sessions SET task_id='T20260921-09', link_method='manual' WHERE id='Sabcd1234'")
      .run();
    await ingest("macmini", [session({ task_id: "T20260921-01", link_method: "auto-dir" })]);
    const s = await row();
    expect(s.task_id).toBe("T20260921-09");
    expect(s.link_method).toBe("manual");
  });

  it("keeps the existing manual link even when the collector also reports a manual link", async () => {
    await ingest("macmini", [session()]);
    await db()
      .prepare("UPDATE sessions SET task_id='T20260921-09', link_method='manual' WHERE id='Sabcd1234'")
      .run();
    await ingest("macmini", [session({ task_id: "T20260921-05", link_method: "manual" })]);
    const s = await row();
    expect(s.task_id).toBe("T20260921-09");
    expect(s.link_method).toBe("manual");
  });

  it("applies an incoming manual link over an auto link", async () => {
    await ingest("macmini", [session()]);
    await ingest("macmini", [session({ task_id: "T20260921-05", link_method: "manual" })]);
    const s = await row();
    expect(s.task_id).toBe("T20260921-05");
    expect(s.link_method).toBe("manual");
  });

  it("does not change the owning machine on update", async () => {
    await ingest("macmini", [session()]);
    await ingest("win11", [session({ machine: "win11" })]);
    expect((await row()).machine).toBe("macmini");
    const stats = (await (await api("/api/stats")).json()) as any;
    expect(stats.sessions).toBe(1);
  });

  it("records machine heartbeat", async () => {
    await ingest("macmini", [session(), session({ id: "Sffff0000", session_id: "ffff0000-x" })]);
    const machines = (await (await api("/api/machines")).json()) as any[];
    expect(machines).toHaveLength(1);
    expect(machines[0].name).toBe("macmini");
    expect(machines[0].last_seen_at).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/));
  });

  it("empty batch still records heartbeat", async () => {
    expect((await ingest("win11", [])).status).toBe(200);
    const machines = (await (await api("/api/machines")).json()) as any[];
    expect(machines[0].name).toBe("win11");
  });

  it("rejects invalid session with field path", async () => {
    const r = await ingest("macmini", [session({ agent: "cursor" })]);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).issues[0].path).toBe("sessions.0.agent");
  });

  it("stores files_written, replaces it on re-harvest, and keeps it when a client omits it", async () => {
    await ingest("macmini", [session({ files_written: ["/p/成果物/a.md", "/p/b.py"] })]);
    expect(JSON.parse((await row()).files_written)).toEqual(["/p/成果物/a.md", "/p/b.py"]);

    // A client from before the field (or a parked body) sends nothing: the list must survive.
    await ingest("macmini", [session({ summary: "auto summary v2" })]);
    expect((await row()).summary).toBe("auto summary v2");
    expect(JSON.parse((await row()).files_written)).toEqual(["/p/成果物/a.md", "/p/b.py"]);

    // A current client's list is complete, so it replaces the stored one — [] included.
    await ingest("macmini", [session({ files_written: ["/p/c.md"] })]);
    expect(JSON.parse((await row()).files_written)).toEqual(["/p/c.md"]);
    await ingest("macmini", [session({ files_written: [] })]);
    expect(JSON.parse((await row()).files_written)).toEqual([]);
  });

  it("inserts an empty files_written when an old client omits it", async () => {
    await ingest("macmini", [session()]);
    expect((await row()).files_written).toBe("[]");
  });

  it("files_written does not disturb a manual link", async () => {
    await ingest("macmini", [session()]);
    await db()
      .prepare("UPDATE sessions SET task_id='T20260921-09', link_method='manual' WHERE id='Sabcd1234'")
      .run();
    await ingest("macmini", [session({ files_written: ["/p/a.md"] })]);
    const s = await row();
    expect(s.task_id).toBe("T20260921-09");
    expect(s.link_method).toBe("manual");
    expect(JSON.parse(s.files_written)).toEqual(["/p/a.md"]);
  });

  it("rejects a files_written that is not a list of strings", async () => {
    const r = await ingest("macmini", [session({ files_written: "/p/a.md" })]);
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).issues[0].path).toBe("sessions.0.files_written");
  });
  const tokens = (over: Record<string, unknown> = {}) => ({
    by_model: { "claude-opus-5-5": { input: 10, output: 20, cache_read: 300, cache_write_5m: 40, cache_write_1h: 0, reasoning: 0 } },
    subagent: {},
    cost_usd: 0.001,
    cost_partial: false,
    ...over,
  });

  it("stores tokens, and keeps them when a client omits them or sends null", async () => {
    await ingest("macmini", [session()]);
    // An old client never sends the field: the row reads as "not collected".
    expect((await row()).tokens).toBeNull();

    await ingest("macmini", [session({ tokens: tokens() })]);
    expect(JSON.parse((await row()).tokens)).toEqual(tokens());

    await ingest("macmini", [session({ summary: "v2" })]);
    expect(JSON.parse((await row()).tokens)).toEqual(tokens());
    // null is what the Python client serializes when a log recorded no usage: it must not erase.
    await ingest("macmini", [session({ summary: "v3", tokens: null })]);
    expect(JSON.parse((await row()).tokens)).toEqual(tokens());

    await ingest("macmini", [session({ tokens: tokens({ cost_usd: null, cost_partial: true }) })]);
    expect(JSON.parse((await row()).tokens).cost_usd).toBeNull();
  });

  const intervals = [["2026-09-21T00:10:00Z", "2026-09-21T01:00:00Z"], ["2026-09-21T02:00:00Z", "2026-09-21T02:40:00Z"]];

  it("stores active_intervals, replaces them on re-harvest, and keeps them when a client omits them", async () => {
    await ingest("macmini", [session()]);
    // An old client never sends the field: the row reads as "not collected".
    expect((await row()).active_intervals).toBeNull();

    await ingest("macmini", [session({ active_intervals: intervals })]);
    expect(JSON.parse((await row()).active_intervals)).toEqual(intervals);

    await ingest("macmini", [session({ summary: "v2" })]);
    expect((await row()).summary).toBe("v2");
    expect(JSON.parse((await row()).active_intervals)).toEqual(intervals);

    // A current client's list is the whole log's clusters, so it replaces the stored one.
    await ingest("macmini", [session({ active_intervals: [intervals[0]] })]);
    expect(JSON.parse((await row()).active_intervals)).toEqual([intervals[0]]);

    // null is the Python model's default (a parked body from before the field): it must not erase,
    // and above all it must not be a 400 that takes the whole batch down.
    const r = await ingest("macmini", [session({ summary: "v4", active_intervals: null })]);
    expect(r.status).toBe(200);
    expect((await row()).summary).toBe("v4");
    expect(JSON.parse((await row()).active_intervals)).toEqual([intervals[0]]);
  });

  it("returns active_intervals decoded on a session row, and null for an old row", async () => {
    await ingest("macmini", [session()]);
    let cur = await row();
    let r = await api("/api/sessions/Sabcd1234", { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, hidden: false }) });
    expect(((await r.json()) as any).active_intervals).toBeNull();

    await ingest("macmini", [session({ active_intervals: intervals })]);
    cur = await row();
    r = await api("/api/sessions/Sabcd1234", { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, hidden: false }) });
    expect(((await r.json()) as any).active_intervals).toEqual(intervals);
  });

  it("rejects malformed active_intervals", async () => {
    for (const bad of [[["2026-09-21T00:10:00Z"]], ["2026-09-21T00:10:00Z"], [["", "2026-09-21T00:10:00Z"]], "x"]) {
      const r = await ingest("macmini", [session({ active_intervals: bad })]);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).issues[0].path).toMatch(/^sessions\.0\.active_intervals/);
    }
  });

  const artifacts = [
    { url: "https://claude.ai/artifact/a1", title: "週報", artifact_id: "a1", ts: "2026-09-21T01:00:00Z" },
    { url: "https://claude.ai/code/artifact/0b5e-uuid", title: null, artifact_id: null, ts: "2026-09-21T02:00:00Z" },
  ];

  it("stores artifacts, replaces them on re-harvest, and keeps them when a client omits them or sends null", async () => {
    await ingest("macmini", [session()]);
    // An old client never sends the field: the row reads as "not collected", not as "published none".
    expect((await row()).artifacts).toBeNull();

    await ingest("macmini", [session({ artifacts })]);
    expect(JSON.parse((await row()).artifacts)).toEqual(artifacts);

    await ingest("macmini", [session({ summary: "v2" })]);
    expect(JSON.parse((await row()).artifacts)).toEqual(artifacts);
    const r = await ingest("macmini", [session({ summary: "v3", artifacts: null })]);
    expect(r.status).toBe(200);
    expect(JSON.parse((await row()).artifacts)).toEqual(artifacts);

    // [] from a current client is "published none" and replaces the list.
    await ingest("macmini", [session({ artifacts: [] })]);
    expect(JSON.parse((await row()).artifacts)).toEqual([]);
  });

  it("returns artifacts decoded on a session row, and null for an old row", async () => {
    await ingest("macmini", [session()]);
    let cur = await row();
    let r = await api("/api/sessions/Sabcd1234", { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, hidden: false }) });
    expect(((await r.json()) as any).artifacts).toBeNull();

    await ingest("macmini", [session({ artifacts })]);
    cur = await row();
    r = await api("/api/sessions/Sabcd1234", { method: "PATCH", body: JSON.stringify({ updated_at: cur.updated_at, hidden: false }) });
    expect(((await r.json()) as any).artifacts).toEqual(artifacts);
  });

  it("rejects malformed artifacts", async () => {
    const ok = artifacts[0];
    for (const bad of [[{ ...ok, url: "" }], [{ ...ok, ts: undefined }], [{ title: "x" }], ["https://claude.ai/artifact/a1"], "x"]) {
      const r = await ingest("macmini", [session({ artifacts: bad })]);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).issues[0].path).toMatch(/^sessions\.0\.artifacts/);
    }
  });

  it("rejects malformed tokens", async () => {
    for (const bad of [tokens({ cost_partial: "no" }), tokens({ by_model: { m: { input: -1 } } }), { by_model: {} }]) {
      const r = await ingest("macmini", [session({ tokens: bad })]);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).issues[0].path).toMatch(/^sessions\.0\.tokens/);
    }
  });
});

describe("ingest session-files", () => {
  beforeEach(resetDb);

  const refresh = (sessions: unknown[]) =>
    api("/api/ingest/session-files", { method: "POST", body: JSON.stringify({ sessions }) });
  const ref = (over: Record<string, unknown> = {}) => ({
    agent: "claude-code", session_id: "abcd1234-ef56-7890-ab12-cd34ef567890", files_written: ["/p/a.md"], ...over,
  });

  it("updates only files_written, matched by agent and session_id, and leaves updated_at alone", async () => {
    await ingest("macmini", [session()]);
    await db()
      .prepare("UPDATE sessions SET summary_edited='人', task_id='T20260921-09', link_method='manual' WHERE id='Sabcd1234'")
      .run();
    const before = await row();

    const r = await refresh([ref(), ref({ session_id: "unknown" }), ref({ agent: "codex" })]);
    expect(await r.json()).toEqual({ updated: 1 });

    const after = await row();
    expect(JSON.parse(after.files_written)).toEqual(["/p/a.md"]);
    expect({ ...after, files_written: before.files_written }).toEqual(before);
  });

  it("counts only rows whose list actually changed", async () => {
    await ingest("macmini", [session({ files_written: ["/p/a.md"] })]);
    expect(await (await refresh([ref()])).json()).toEqual({ updated: 0 });
    expect(await (await refresh([])).json()).toEqual({ updated: 0 });
  });

  it("rejects a malformed body", async () => {
    expect((await refresh([ref({ files_written: undefined })])).status).toBe(400);
    expect((await refresh([ref({ agent: "cursor" })])).status).toBe(400);
  });
});

describe("ingest session-meta", () => {
  beforeEach(resetDb);

  const tokens = { by_model: { "gpt-6-sol": { input: 1, output: 2, cache_read: 3, cache_write_5m: 0, cache_write_1h: 0, reasoning: 1 } },
    subagent: {}, cost_usd: null, cost_partial: true };
  const meta = (sessions: unknown[]) =>
    api("/api/ingest/session-meta", { method: "POST", body: JSON.stringify({ sessions }) });
  const ref = (over: Record<string, unknown> = {}) => ({
    agent: "claude-code", session_id: "abcd1234-ef56-7890-ab12-cd34ef567890", files_written: [], tokens, ...over,
  });
  const files = (sessions: unknown[]) =>
    api("/api/ingest/session-files", { method: "POST", body: JSON.stringify({ sessions }) });

  it("fills tokens and files_written without touching anything else, updated_at included", async () => {
    await ingest("macmini", [session()]);
    await db().prepare("UPDATE sessions SET summary_edited='人', task_id='T20260921-09', link_method='manual' WHERE id='Sabcd1234'").run();
    const before = await row();

    expect(await (await meta([ref({ files_written: ["/p/a.md"] }), ref({ session_id: "nope" }), ref({ agent: "codex" })])).json())
      .toEqual({ updated: 1 });
    const after = await row();
    expect(JSON.parse(after.tokens)).toEqual(tokens);
    expect(JSON.parse(after.files_written)).toEqual(["/p/a.md"]);
    expect({ ...after, tokens: null, files_written: before.files_written }).toEqual(before);
  });

  it("counts a row as updated when only its tokens changed, and not when nothing did", async () => {
    await ingest("macmini", [session()]);
    expect(await (await meta([ref()])).json()).toEqual({ updated: 1 });
    expect(await (await meta([ref()])).json()).toEqual({ updated: 0 });
    const more = { ...tokens, cost_partial: false };
    expect(await (await meta([ref({ tokens: more })])).json()).toEqual({ updated: 1 });
    expect(JSON.parse((await row()).tokens)).toEqual(more);
  });

  it("null tokens keep what is stored", async () => {
    await ingest("macmini", [session()]);
    await meta([ref()]);
    expect(await (await meta([ref({ tokens: null, files_written: ["/p/b.md"] })])).json()).toEqual({ updated: 1 });
    const s = await row();
    expect(JSON.parse(s.tokens)).toEqual(tokens);
    expect(JSON.parse(s.files_written)).toEqual(["/p/b.md"]);
  });

  it("backfills active_intervals, counts the change, and keeps them when absent or null", async () => {
    await ingest("macmini", [session()]);
    await meta([ref()]);
    const intervals = [["2026-09-21T00:10:00Z", "2026-09-21T01:00:00Z"]];
    expect(await (await meta([ref({ active_intervals: intervals })])).json()).toEqual({ updated: 1 });
    expect(JSON.parse((await row()).active_intervals)).toEqual(intervals);
    // The same values again change nothing.
    expect(await (await meta([ref({ active_intervals: intervals })])).json()).toEqual({ updated: 0 });
    // An older client (absent) or a log that yields none (null) leaves the stored clusters alone.
    expect(await (await meta([ref()])).json()).toEqual({ updated: 0 });
    expect(await (await meta([ref({ active_intervals: null })])).json()).toEqual({ updated: 0 });
    expect(JSON.parse((await row()).active_intervals)).toEqual(intervals);
    expect((await meta([ref({ active_intervals: [["x"]] })])).status).toBe(400);
  });

  it("backfills artifacts, counts the change, and keeps them when absent or null", async () => {
    await ingest("macmini", [session()]);
    await meta([ref()]);
    const artifacts = [{ url: "https://claude.ai/artifact/a1", title: "週報", artifact_id: "a1", ts: "2026-09-21T01:00:00Z" }];
    expect(await (await meta([ref({ artifacts })])).json()).toEqual({ updated: 1 });
    expect(JSON.parse((await row()).artifacts)).toEqual(artifacts);
    expect(await (await meta([ref({ artifacts })])).json()).toEqual({ updated: 0 });
    expect(await (await meta([ref()])).json()).toEqual({ updated: 0 });
    expect(await (await meta([ref({ artifacts: null })])).json()).toEqual({ updated: 0 });
    expect(JSON.parse((await row()).artifacts)).toEqual(artifacts);
    // [] (published none) is a change from a non-empty list.
    expect(await (await meta([ref({ artifacts: [] })])).json()).toEqual({ updated: 1 });
    expect(JSON.parse((await row()).artifacts)).toEqual([]);
    expect((await meta([ref({ artifacts: [{ url: "u" }] })])).status).toBe(400);
  });

  it("the older session-files body still works and leaves tokens alone", async () => {
    await ingest("macmini", [session()]);
    await meta([ref()]);
    const r = await files([{ agent: "claude-code", session_id: "abcd1234-ef56-7890-ab12-cd34ef567890", files_written: ["/p/c.md"] }]);
    expect(await r.json()).toEqual({ updated: 1 });
    const s = await row();
    expect(JSON.parse(s.tokens)).toEqual(tokens);
    expect(JSON.parse(s.files_written)).toEqual(["/p/c.md"]);
  });

  it("rejects a malformed body", async () => {
    expect((await meta([ref({ tokens: undefined })])).status).toBe(400);
    expect((await meta([ref({ tokens: { by_model: {} } })])).status).toBe(400);
    expect((await meta([ref({ files_written: undefined })])).status).toBe(400);
  });
});

describe("heartbeat", () => {
  beforeEach(resetDb);
  const beat = (body: unknown) => api("/api/ingest/heartbeat", { method: "POST", body: JSON.stringify(body) });

  it("records the run and counts as being seen", async () => {
    const r = await beat({ machine: "win11", new: 2, updated: 1 });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const run = await db().prepare("SELECT * FROM harvest_runs").first<any>();
    expect(run).toMatchObject({ machine: "win11", new: 2, updated: 1 });
    const m = await db().prepare("SELECT last_seen_at FROM machines WHERE name='win11'").first<any>();
    expect(m.last_seen_at).toBe(run.at);
  });
  it("prunes that machine's rows older than 8 days, and only that machine's", async () => {
    const old = new Date(Date.now() - 9 * 86400_000).toISOString();
    await db().batch([
      db().prepare("INSERT INTO harvest_runs VALUES ('win11', ?1, 0, 0)").bind(old),
      db().prepare("INSERT INTO harvest_runs VALUES ('mac', ?1, 0, 0)").bind(old),
    ]);
    await beat({ machine: "win11", new: 0, updated: 0 });
    const { results } = await db().prepare("SELECT machine FROM harvest_runs ORDER BY machine, at").all<any>();
    expect(results.map((x) => x.machine)).toEqual(["mac", "win11"]);
  });
  it("refuses a bad body", async () => {
    expect((await beat({ machine: "", new: 0, updated: 0 })).status).toBe(400);
    expect((await beat({ machine: "m", new: -1, updated: 0 })).status).toBe(400);
    expect((await beat({ machine: "m", new: 1.5, updated: 0 })).status).toBe(400);
  });
  it("GET /api/machines/runs: lit current hour, last run, and machines without runs", async () => {
    await db().prepare("INSERT INTO machines VALUES ('mac', '2026-10-01T00:00:00.000Z')").run();
    await beat({ machine: "win11", new: 0, updated: 0 });
    const rows = await (await api("/api/machines/runs")).json<any[]>();
    expect(rows.map((r) => r.name)).toEqual(["mac", "win11"]);
    expect(rows[0]).toEqual({ name: "mac", hours: Array(24).fill(false), last_run_at: null });
    expect(rows[1].hours).toHaveLength(24);
    expect(rows[1].hours[23]).toBe(true);
    expect(typeof rows[1].last_run_at).toBe("string");
  });
});
