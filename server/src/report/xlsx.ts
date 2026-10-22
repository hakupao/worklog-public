import ExcelJS from "exceljs";
import { parseDay } from "./day";
import { pyLen } from "./pystr";
import type { Grid, GridCell } from "./types";

/**
 * The drawing half of src/worklog/report/xlsx.py: _write_header, _autosize_columns and
 * _format_dates. layoutSheets has already decided what every cell holds, so this file only decides
 * how it is drawn, and it draws exactly what openpyxl drew — no merged cells, no extra styling.
 */

const MAX_COL_WIDTH = 60;

export async function renderXlsx(grids: Grid[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const grid of grids) drawSheet(wb.addWorksheet(grid.title), grid);
  // Under nodejs_compat this is a Node Buffer, a view on a shared pool; the Uint8Array constructor
  // copies a typed array's elements into a buffer of exactly this length.
  const out = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array;
  return new Uint8Array(out).buffer as ArrayBuffer;
}

function drawSheet(ws: ExcelJS.Worksheet, grid: Grid): void {
  // _autosize_columns measures every cell openpyxl wrote, which includes the header row.
  const widths = grid.columns.map((col) => pyLen(col.header, "text"));
  let r = 1;

  if (grid.freeze_header) {
    grid.columns.forEach((col, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = col.header;
      cell.font = { bold: true };
    });
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];   // openpyxl's freeze_panes = "A2"
    r = 2;
  }

  for (const row of grid.rows) {
    grid.columns.forEach((col, i) => {
      const cell = row.cells.find((c) => c.column === col.key);
      if (!cell) return;
      widths[i] = Math.max(widths[i], pyLen(cell.value, cell.kind));
      write(ws.getCell(r, i + 1), cell);
    });
    r += 1;
  }

  // A column that held nothing printable keeps Excel's default width, as openpyxl left it.
  widths.forEach((width, i) => {
    if (width > 0) ws.getColumn(i + 1).width = Math.min(width + 2, MAX_COL_WIDTH);
  });
}

function write(target: ExcelJS.Cell, cell: GridCell): void {
  // openpyxl's writer treats "" exactly like None ("if value == '' or value is None"): it emits a
  // cell with no value at all. Assigning "" here would instead put an empty shared string in the
  // file, which reads back as '' rather than as an empty cell. A task with no deliverables, no
  // project or no 備考 produces one of these on every report, so the two have to agree.
  const blank = cell.value === null || cell.value === "";
  // `parseDay` (day.ts) answers "is this a real day?", not merely "is this shaped like one?" — a
  // typed 2026-02-31 would otherwise be written here as 2026-03-03, a day nobody chose.
  const day = !blank && cell.kind === "date" ? parseDay(String(cell.value)) : null;
  if (day) {
    // openpyxl wrote a datetime.date and _format_dates gave it this format.
    target.value = day;
    target.numFmt = "yyyy-mm-dd";
  } else if (!blank) {
    // A date-kind cell that does not hold a date (only an override can make one) stays text.
    target.value = cell.value;
  }
  if (cell.bold) target.font = { bold: true };
  // A 考え方 / 備考 written as several lines keeps them: Excel shows "\n" only in a wrapping cell.
  // Single-line cells stay unstyled, exactly like openpyxl's output.
  if (typeof cell.value === "string" && cell.value.includes("\n")) target.alignment = { wrapText: true, vertical: "top" };
}
