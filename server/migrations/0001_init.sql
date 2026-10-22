-- Time convention:
-- - sessions.started_at / ended_at are ISO-8601 instants, normally UTC ("...Z" or "+00:00").
-- - updated_at and machines.last_seen_at are UTC ISO-8601 instants written by the server.
-- - ts is the client's naive local wall-clock time; informational only, never used for
--   day/week grouping.
-- - tasks.received_at / done_at are calendar dates (YYYY-MM-DD) in Asia/Tokyo.
-- - Any grouping of sessions by day or week MUST convert the instant to Asia/Tokyo first and
--   must never slice the stored string. Reference implementation: _local_date in
--   src/worklog/report/weekly.py.

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  requester TEXT NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','done','hold')),
  received_at TEXT NOT NULL,
  done_at TEXT,
  thinking TEXT NOT NULL DEFAULT '',
  deliverables TEXT NOT NULL DEFAULT '[]',
  hours_manual REAL,
  machine TEXT NOT NULL,
  ts TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  machine TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('claude-code','codex')),
  session_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  active_minutes INTEGER NOT NULL,
  turns INTEGER NOT NULL,
  summary TEXT NOT NULL,
  summary_source TEXT NOT NULL CHECK (summary_source IN ('llm','fallback')),
  task_id TEXT,
  link_method TEXT NOT NULL CHECK (link_method IN ('auto-dir','auto-time','manual','none')),
  summary_edited TEXT,
  minutes_override INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_started ON sessions(started_at);
CREATE INDEX idx_sessions_task ON sessions(task_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  task_id TEXT,
  minutes INTEGER,
  machine TEXT NOT NULL,
  ts TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE machines (
  name TEXT PRIMARY KEY,
  last_seen_at TEXT NOT NULL
);
