-- AI week / day summaries of the 週報 (design 2026-10-08 §3.3). day = '' is the week's own line.
-- text is the latest source (Japanese when generated, the editor's language after a hand edit); its
-- other languages live in translations (entity 'digest', id week || char(31) || day).
CREATE TABLE report_digests (
  week TEXT NOT NULL,
  day  TEXT NOT NULL,
  text TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (week, day)
);
