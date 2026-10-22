-- UI preferences, one row for the single user, shared by every machine and browser.
-- See docs/design/2026-10-05-ui-redesign-design.md §9. json is the normalized Prefs object.
CREATE TABLE prefs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
