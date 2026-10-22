-- Task badges B1 (spec docs/design/2026-10-14-task-badges-design.md §3): the object ("<source>:<name>")
-- and LINE_PALETTE index the server assigned at creation. NULL = not assigned yet; server/src/badge/assign.ts fills
-- it (after POST/PUT and on the 1-59/5 cron, which is also the backfill of older 案件). Never overwritten.
ALTER TABLE tasks ADD COLUMN badge_obj TEXT;
ALTER TABLE tasks ADD COLUMN badge_color INTEGER;
