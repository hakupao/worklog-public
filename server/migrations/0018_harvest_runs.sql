-- One row per collector run (POST /api/ingest/heartbeat). Rows older than 8 days are deleted on insert.
CREATE TABLE harvest_runs (
  machine TEXT NOT NULL,
  at TEXT NOT NULL,          -- UTC ISO-8601 instant written by the server
  new INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (machine, at)
);
