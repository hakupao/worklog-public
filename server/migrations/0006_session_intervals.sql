-- The collector's activity clusters of a session, as JSON: [[start_iso, end_iso], ...], UTC instants
-- in the order they happened. A cluster is a run of messages with no gap over 30 minutes, the same
-- rule active_minutes sums; a single message is a zero-length [t, t]. The server splits these at
-- Tokyo midnights (and hours) so a session that runs past midnight is charged to each day it was
-- active on, instead of all to its start day.
-- NULL = never collected (harvested before this column, or by an older collector); such a row is
-- charged to its start day as before. Written only by the collector.
ALTER TABLE sessions ADD COLUMN active_intervals TEXT;
