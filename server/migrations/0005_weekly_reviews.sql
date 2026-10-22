-- Weekly AI reviews shown on the dashboard. Written by the collector (wl harvest / wl review);
-- the first write for a week wins unless the writer forces a regeneration.
CREATE TABLE weekly_reviews (
  week TEXT PRIMARY KEY,          -- "2026-W39", Asia/Tokyo ISO week
  text TEXT NOT NULL,             -- markdown
  model TEXT NOT NULL,
  stats_json TEXT NOT NULL,       -- the statistics the model was given, kept so its claims can be checked
  generated_at TEXT NOT NULL,     -- UTC ISO-8601, server clock
  machine TEXT NOT NULL
);
