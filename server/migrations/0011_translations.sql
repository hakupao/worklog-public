-- One row per translated field. The base table keeps the latest source text (any language);
-- a row is fresh while source_text equals that text, stale otherwise (S1, design 2026-10-08 §2).
CREATE TABLE translations (
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  field       TEXT NOT NULL,
  source_text TEXT NOT NULL DEFAULT '',  -- the text zh/ja/en were made from; '' = never succeeded
  source_lang TEXT CHECK (source_lang IN ('zh','ja','en')),
  zh TEXT, ja TEXT, en TEXT,
  model       TEXT,                      -- 'identity' for text that is not translated (numbers, dates)
  failed_text TEXT,                      -- the source text of the last failed attempt
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT,
  last_error  TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (entity, entity_id, field)
);
