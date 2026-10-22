import { Hono } from "hono";
import type { Env } from "../env";
import type { Context } from "hono";
import { HeartbeatIn, IngestIn, SessionFilesIn, SessionMetaIn, invalid } from "../schemas";

export const ingest = new Hono<{ Bindings: Env }>();

// Invariant: this statement must never mention summary_edited, minutes_override or hidden,
// and must not move a row off a manual link. The collector is not trusted to honor this.
// ?16 is files_written as JSON, or NULL when the client did not send it: NULL keeps what is stored
// (an old client, or a parked body from before the field) and inserts an empty list.
// ?17 is tokens as JSON, or NULL when the client did not send it (or sent null): NULL keeps what is
// stored, and a new row starts NULL, which reads as "not collected".
// ?18 is active_intervals as JSON, or NULL when the client did not send it: the same rule as tokens.
// ?19 is artifacts as JSON, the same rule again (NULL = not collected).
const UPSERT = `
INSERT INTO sessions (id, machine, agent, session_id, cwd, started_at, ended_at, active_minutes,
                      turns, summary, summary_source, task_id, link_method, ts, updated_at, files_written, tokens,
                      active_intervals, artifacts)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, COALESCE(?16, '[]'), ?17, ?18, ?19)
ON CONFLICT(id) DO UPDATE SET
  files_written = COALESCE(?16, sessions.files_written),
  tokens = COALESCE(?17, sessions.tokens),
  active_intervals = COALESCE(?18, sessions.active_intervals),
  artifacts = COALESCE(?19, sessions.artifacts),
  cwd=excluded.cwd, started_at=excluded.started_at, ended_at=excluded.ended_at,
  active_minutes=excluded.active_minutes, turns=excluded.turns,
  summary=excluded.summary, summary_source=excluded.summary_source,
  task_id = CASE WHEN sessions.link_method='manual' THEN sessions.task_id ELSE excluded.task_id END,
  link_method = CASE WHEN sessions.link_method='manual' THEN 'manual' ELSE excluded.link_method END,
  ts=excluded.ts, updated_at=excluded.updated_at`;

ingest.post("/sessions", async (c) => {
  const parsed = IngestIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { machine, sessions } = parsed.data;
  const db = c.env.DB;
  const now = new Date().toISOString();

  const count = async () =>
    (await db.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>())!.n;
  const before = await count();

  const stmts = sessions.map((s) =>
    db.prepare(UPSERT).bind(
      s.id, s.machine, s.agent, s.session_id, s.cwd, s.started_at, s.ended_at, s.active_minutes,
      s.turns, s.summary, s.summary_source, s.task_id, s.link_method, s.ts, now,
      s.files_written === undefined ? null : JSON.stringify(s.files_written),
      s.tokens == null ? null : JSON.stringify(s.tokens),
      s.active_intervals == null ? null : JSON.stringify(s.active_intervals),
      s.artifacts == null ? null : JSON.stringify(s.artifacts),
    ),
  );
  stmts.push(
    db.prepare(
      `INSERT INTO machines (name, last_seen_at) VALUES (?1, ?2)
       ON CONFLICT(name) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
    ).bind(machine, now),
  );
  await db.batch(stmts);

  const inserted = (await count()) - before;
  return c.json({ inserted, updated: sessions.length - inserted });
});

// Backfill for `wl harvest --refresh-meta` (and its older spelling --files-only): replaces
// files_written, and tokens, active_intervals and artifacts when sent, on sessions already stored, and touches
// nothing else. updated_at is left alone on purpose: all four are collector-only data that no
// human edit races with, so a web tab holding the row's token must not get a 409 because of them.
async function refreshMeta(
  c: Context<{ Bindings: Env }>,
  sessions: {
    agent: string; session_id: string; files_written: string[]; tokens?: unknown; active_intervals?: unknown; artifacts?: unknown;
  }[],
) {
  const db = c.env.DB;
  if (sessions.length === 0) return c.json({ updated: 0 });
  const results = await db.batch(
    sessions.map((s) =>
      db
        // The id is derived exactly as the collector derives it (harvest/run.py: "S" + session_id[:8]),
        // so the primary key finds the row; agent and session_id then confirm it is the right one.
        // ?4 NULL (an old client, or a log with no usage) keeps the stored tokens; ?5 NULL likewise
        // keeps the stored active_intervals, and ?6 NULL the stored artifacts.
        .prepare(
          `UPDATE sessions SET files_written = ?1, tokens = COALESCE(?4, tokens),
                               active_intervals = COALESCE(?5, active_intervals),
                               artifacts = COALESCE(?6, artifacts)
           WHERE id = 'S' || substr(?3, 1, 8) AND agent = ?2 AND session_id = ?3
             AND (files_written <> ?1 OR tokens IS NOT COALESCE(?4, tokens)
                  OR active_intervals IS NOT COALESCE(?5, active_intervals)
                  OR artifacts IS NOT COALESCE(?6, artifacts))`,
        )
        .bind(
          JSON.stringify(s.files_written), s.agent, s.session_id,
          s.tokens == null ? null : JSON.stringify(s.tokens),
          s.active_intervals == null ? null : JSON.stringify(s.active_intervals),
          s.artifacts == null ? null : JSON.stringify(s.artifacts),
        ),
    ),
  );
  return c.json({ updated: results.reduce((n, r) => n + r.meta.changes, 0) });
}

// One per collector run, sent after a successful harvest and never parked (a late beat would light the wrong hour).
// Also counts as being seen: a run that found nothing new still proves the collector is alive.
ingest.post("/heartbeat", async (c) => {
  const parsed = HeartbeatIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { machine, new: added, updated } = parsed.data;
  const db = c.env.DB;
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 8 * 86_400_000).toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO harvest_runs (machine, at, new, updated) VALUES (?1, ?2, ?3, ?4)").bind(machine, now, added, updated),
    db.prepare(
      `INSERT INTO machines (name, last_seen_at) VALUES (?1, ?2)
       ON CONFLICT(name) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
    ).bind(machine, now),
    db.prepare("DELETE FROM harvest_runs WHERE machine = ?1 AND at < ?2").bind(machine, cutoff),
  ]);
  return c.json({ ok: true });
});

// The pre-tokens body, still sent by machines that have not pulled: files_written only.
ingest.post("/session-files", async (c) => {
  const parsed = SessionFilesIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  return refreshMeta(c, parsed.data.sessions);
});

ingest.post("/session-meta", async (c) => {
  const parsed = SessionMetaIn.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  return refreshMeta(c, parsed.data.sessions);
});
