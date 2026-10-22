-- S2c (design 2026-10-08-s2c §2.6): a separate, tighter digest written for the one-page PDF. NULL = none yet
-- (the PDF then prints `text`); a hand edit of `text` clears it.
ALTER TABLE report_digests ADD COLUMN pdf_text TEXT;
