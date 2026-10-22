-- Files a session wrote through the agent's own file tools (a JSON array of absolute paths),
-- offered in the 案件 drawer as deliverable candidates. Written only by the collector.
ALTER TABLE sessions ADD COLUMN files_written TEXT NOT NULL DEFAULT '[]';
