import type { GridCell, SheetKey } from "../../api/types";

/** row_keys that are structural, not data, on every sheet — see server/src/report/layout.ts:
 *  `blank` is a spacer row (summary sheet) and `req_header` is the by-requester table's own
 *  header row (also summary), both written as plain caption cells rather than real data. */
const STRUCTURAL_ROW_KEYS = new Set(["blank", "req_header"]);

/** Whether a cell can become an override: everything except summary's `label` column (the row's
 *  own caption, e.g. "週"/"新規"/a requester name — never itself an editable figure), every
 *  sheet's structural rows above, and the hours sheet's `total` row (a computed sum, not
 *  something a single day's override could sensibly replace). `GridCell` carries no `editable`
 *  field of its own — the server doesn't send one — so this is the one place that rule lives. */
export function isCellEditable(sheetKey: SheetKey, rowKey: string, column: string): boolean {
  if (STRUCTURAL_ROW_KEYS.has(rowKey)) return false;
  if (sheetKey === "summary" && column === "label") return false;
  if (sheetKey === "hours" && rowKey === "total") return false;
  return true;
}

/** What a saved draft is compared against to detect "no real change" (contract 3): the cell's
 *  already-known auto value if it has one (already overridden), else its current — still-auto —
 *  value. `null` reads as "". */
export function autoText(cell: GridCell): string {
  const auto = cell.auto ?? cell.value;
  return auto === null ? "" : String(auto);
}
