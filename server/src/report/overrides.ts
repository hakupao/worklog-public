import { parseDay } from "./day";
import type { CellKind, CellValue, Grid, GridCell, OverrideRow, TemplateKey } from "./types";

/**
 * Human edits to generated cells. A report is rebuilt from the data on every request, so an edit
 * cannot be stored as a new value in place; it is stored against the cell's stable coordinates
 * (sheet, row_key, column) and re-applied to a freshly computed Grid each time.
 *
 * `column` is in SQLite's fallback keyword list, so every statement below quotes it.
 */

/** One cell of a week's report: the override primary key minus the week and the template. */
export type OverrideCell = Pick<OverrideRow, "sheet" | "row_key" | "column">;

const FIELDS = `sheet, row_key, "column", value, updated_at`;

export async function loadOverrides(
  db: D1Database, week: string, template: TemplateKey,
): Promise<OverrideRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${FIELDS} FROM report_overrides
       WHERE week = ?1 AND template = ?2
       ORDER BY sheet, row_key, "column"`,
    )
    .bind(week, template)
    .all<OverrideRow>();
  return results;
}

/** Writes the edit and returns the timestamp stored with it. */
export async function putOverride(
  db: D1Database, week: string, template: TemplateKey, cell: OverrideCell & { value: string },
): Promise<string> {
  const updated_at = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO report_overrides (week, template, ${FIELDS})
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(week, template, sheet, row_key, "column")
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(week, template, cell.sheet, cell.row_key, cell.column, cell.value, updated_at)
    .run();
  return updated_at;
}

/** Removes the edit, and says whether there was one to remove. */
export async function deleteOverride(
  db: D1Database, week: string, template: TemplateKey, cell: OverrideCell,
): Promise<boolean> {
  const res = await db
    .prepare(
      `DELETE FROM report_overrides
       WHERE week = ?1 AND template = ?2 AND sheet = ?3 AND row_key = ?4 AND "column" = ?5`,
    )
    .bind(week, template, cell.sheet, cell.row_key, cell.column)
    .run();
  return res.meta.changes > 0;
}

const INT = /^-?\d+$/;
const FLOAT = /^-?\d+(\.\d+)?$/;

/**
 * Read a typed cell back out of the text a person typed.
 *
 * Text that no longer reads as the column's kind keeps its kind as `text` rather than being
 * rejected: "未定" in a 完了日 column is a useful thing to write, and downgrading the kind is what
 * keeps the workbook writer from putting an Invalid Date in the file. A date is held to the
 * calendar, not just to the shape (see day.ts): 2026-02-31 is text, because the alternative is a
 * workbook quietly holding 2026-03-03 while the page shows what was typed.
 */
function coerce(value: string, kind: CellKind): { value: CellValue; kind: CellKind } {
  switch (kind) {
    case "int": return INT.test(value) ? { value: Number(value), kind } : { value, kind: "text" };
    case "float": return FLOAT.test(value) ? { value: Number(value), kind } : { value, kind: "text" };
    case "date": return parseDay(value) ? { value, kind } : { value, kind: "text" };
    case "text": return { value, kind };
  }
}

// row_key holds "|" (the days sheet) and ":" (the summary sheet), so the separator is a NUL.
const coord = (sheet: string, row_key: string, column: string) => `${sheet}\u0000${row_key}\u0000${column}`;

/**
 * Re-apply stored edits to freshly computed grids, keeping the computed value under `auto` so the
 * page can show what an edit replaced. Returns new objects; the grids passed in are left alone.
 *
 * An edit that names a row or column the grid no longer has is skipped rather than dropped: the
 * grid follows the data, and a row that is missing this minute may be back the next.
 */
export function applyOverrides(grids: Grid[], rows: OverrideRow[]): Grid[] {
  const edits = new Map(rows.map((r) => [coord(r.sheet, r.row_key, r.column), r]));
  return grids.map((grid) => ({
    ...grid,
    rows: grid.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell): GridCell => {
        const edit = edits.get(coord(grid.key, row.row_key, cell.column));
        if (edit === undefined) return { ...cell };
        const polish = edit._polish?.value;
        return { ...cell, ...coerce(edit.value, cell.kind), auto: cell.value, overridden: true, ...(polish ? { polish } : {}) };
      }),
    })),
  }));
}
