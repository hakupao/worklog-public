-- The PDF composer (docs/design/2026-10-09-pdf-composer-design.md): one row per report week. `items` is
-- the selection, `text` the generated week summary + day lines in ja / zh / en; report_digests are never touched.
CREATE TABLE pdf_compose (
  week TEXT PRIMARY KEY,
  items TEXT NOT NULL,            -- JSON [{ "id": "<task id>|__unassigned", "mode": "show"|"other"|"hide" }], show rows in order
  text TEXT,                      -- JSON { ja|zh|en: { summary: string[], days: { "<date>": string[] } } }; NULL = never generated
  source_lang TEXT,               -- the language last hand-edited (NULL = as generated)
  edited INTEGER NOT NULL DEFAULT 0,
  gen_selection_hash TEXT,        -- selectionHash(items) the text was generated for
  gen_inputs_hash TEXT,           -- hash of the week's digest inputs the text was generated from
  gen_model TEXT,
  generated_at TEXT,
  generating_at TEXT,             -- the generation lock (UTC ISO); NULL = idle; older than 3 min = expired
  translating_at TEXT,            -- set while a hand edit's other two languages are retranslated; NULL = done
  updated_at TEXT NOT NULL        -- optimistic lock of the selection
);
