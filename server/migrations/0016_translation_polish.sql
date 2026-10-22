-- Input polish (design docs/design/2026-10-09-input-polish-design.md §6).
-- polished_from: the raw base text this row's source slot was polished from; NULL = not a polish.
-- pinned_raw: 还原 — this exact raw text is shown as typed and never polished; a different text is polished again.
ALTER TABLE translations ADD COLUMN polished_from TEXT;
ALTER TABLE translations ADD COLUMN pinned_raw TEXT;
