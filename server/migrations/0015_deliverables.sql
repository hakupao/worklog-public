-- 成果物自动关联 (docs/projects/2026-10-09-deliverables/PLAN.md §3).
-- The Artifact pages a session published, as JSON: [{ "url", "title", "artifact_id", "ts" }], one per url (the
-- latest title), in publish order. NULL = never collected (harvested before this column, or by an older collector);
-- [] = collected, published nothing. Written only by the collector.
ALTER TABLE sessions ADD COLUMN artifacts TEXT;

-- What a written file or a published Artifact is, as a 成果物: in or out, and who said so. key = the file's absolute
-- path (normalised) or the Artifact's url. A task's automatic 成果物 are derived on read from its sessions' files and
-- Artifacts; this table only records the verdicts the rule cannot give (model) and the user's × / ＋ (user).
-- Precedence on read: user > model > rule. The collector's model verdicts insert with ON CONFLICT DO NOTHING, so two
-- machines racing is harmless and a user verdict is never overwritten.
CREATE TABLE deliverable_verdicts (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'artifact')),
  verdict TEXT NOT NULL CHECK (verdict IN ('in', 'out')),
  source TEXT NOT NULL CHECK (source IN ('rule', 'model', 'user')),
  reason TEXT,
  judged_at TEXT NOT NULL
);
