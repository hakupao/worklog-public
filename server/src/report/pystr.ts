import type { CellKind, CellValue } from "./types";

/**
 * Length of `str(value)` as CPython would print it for one cell.
 *
 * xlsx.py sizes a column by `max(len(str(cell.value)))`, so reproducing that width in xlsx.ts
 * means reproducing Python's string forms, which differ from JavaScript's in two places:
 * a whole float prints a trailing `.0` (`str(2.0) == "2.0"`, while `String(2) === "2"`), and
 * `len()` counts code points, not UTF-16 units.
 */
export function pyLen(value: CellValue, kind: CellKind): number {
  if (value === null) return 0; // _autosize_columns skips a None cell entirely.
  switch (kind) {
    case "date":
      // Dates are ISO strings here and `datetime.date` objects there; both print as YYYY-MM-DD.
      return 10;
    case "float": {
      const n = Number(value);
      return Number.isInteger(n) ? String(n).length + 2 : String(n).length;
    }
    case "int":
      return String(value).length;
    case "text":
      return [...String(value)].length;
  }
}
