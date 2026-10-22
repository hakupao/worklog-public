-- Human edits to a generated report cell, keyed by the cell's stable coordinates.
-- `value` is always the rendered text; the renderer coerces it back to the column's kind.
CREATE TABLE report_overrides (
  week TEXT NOT NULL,
  template TEXT NOT NULL,
  sheet TEXT NOT NULL,
  row_key TEXT NOT NULL,
  column TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (week, template, sheet, row_key, column)
);
