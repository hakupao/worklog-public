-- Range xlsx (spec docs/design/2026-10-13-xlsx-range-report-design.md §4): a one-line summary of the week,
-- used only on the week row (day = ''). NULL = none yet (the xlsx then names the week's main 案件).
-- oneliner_edited: 1 = typed by a person — never overwritten by a generation, polished before it is translated.
ALTER TABLE report_digests ADD COLUMN oneliner TEXT;
ALTER TABLE report_digests ADD COLUMN oneliner_edited INTEGER NOT NULL DEFAULT 0;
