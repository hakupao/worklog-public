import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { CellKind, CellValue, Grid, GridCell } from "../src/report/types";
import { renderXlsx } from "../src/report/xlsx";

// Task 1 spike (plan 3, docs/projects/web-service/evidence/sdd_3/task-1-brief.md): prove ExcelJS can build
// a workbook inside workerd (the @cloudflare/vitest-plugin runtime) before committing to path A
// (server-side xlsx generation). Question 1 of 3.
describe("xlsx spike", () => {
  it("builds a workbook with a bold header, a formatted date cell, a frozen header row, and a set column width inside workerd", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    ws.getCell("A1").value = "Header";
    ws.getCell("A1").font = { bold: true };

    ws.getCell("A2").value = new Date("2026-09-23");
    ws.getCell("A2").numFmt = "yyyy-mm-dd";

    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.getColumn(1).width = 12;

    const buf = await wb.xlsx.writeBuffer();

    expect(buf.byteLength).toBeGreaterThan(0);
    const bytes = new Uint8Array(buf as ArrayBuffer);
    // xlsx is a zip archive; the first two bytes of a zip's local file header are "PK".
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });
});

// ---------------------------------------------------------------------------
// renderXlsx: the "drawing" half of src/worklog/report/xlsx.py (_write_header, _autosize_columns,
// _format_dates). Every case below is read back out of the generated file with ExcelJS, so the
// assertions are about the workbook a person downloads, not about our in-memory objects.

const cell = (column: string, value: CellValue, kind: CellKind, bold = false): GridCell =>
  bold ? { column, value, kind, bold: true } : { column, value, kind };

// Shaped like the sheets layoutSheets emits: summary carries its labels down column A with no
// header row, the other two have a header row and a frozen pane.
const SUMMARY: Grid = {
  key: "summary", title: "サマリー", freeze_header: false,
  columns: [{ key: "label", header: null }, { key: "value", header: null }, { key: "spare", header: null }],
  rows: [
    { row_key: "week", cells: [cell("label", "週", "text", true), cell("value", "2026-W39", "text"), cell("spare", null, "text")] },
    { row_key: "unassigned_hours", cells: [cell("label", "未割当工数(h)", "text", true), cell("value", 0.5, "float"), cell("spare", null, "text")] },
    { row_key: "blank", cells: [cell("label", null, "text"), cell("value", null, "text"), cell("spare", null, "text")] },
  ],
};
const HOURS: Grid = {
  key: "hours", title: "稼働", freeze_header: true,
  columns: [{ key: "date", header: "日付" }, { key: "hours", header: "h" }],
  rows: [
    { row_key: "2026-09-22", cells: [cell("date", "2026-09-22", "date"), cell("hours", 2, "float")] },
    { row_key: "total", cells: [cell("date", "合計", "text", true), cell("hours", 2, "float")] },
  ],
};
const LONG_TEXT = "x".repeat(61);
const TASKS: Grid = {
  key: "tasks", title: "案件一覧", freeze_header: true,
  columns: [{ key: "title", header: "案件名" }, { key: "thinking", header: "備考" }, { key: "done_at", header: "完了日" }],
  rows: [{ row_key: "T1", cells: [cell("title", "件名", "text"), cell("thinking", LONG_TEXT, "text"), cell("done_at", null, "date")] }],
};

async function render(grids: Grid[]): Promise<ExcelJS.Workbook> {
  const buf = await renderXlsx(grids);
  expect(buf).toBeInstanceOf(ArrayBuffer);
  return new ExcelJS.Workbook().xlsx.load(buf);
}

describe("renderXlsx", () => {
  it("writes one sheet per grid, named and ordered like the grids", async () => {
    const wb = await render([SUMMARY, HOURS, TASKS]);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(["サマリー", "稼働", "案件一覧"]);
  });

  it("gives a sheet with headers a bold header row, a frozen pane and its data from row 2", async () => {
    const ws = (await render([HOURS])).getWorksheet("稼働")!;
    expect([ws.getCell("A1").value, ws.getCell("B1").value]).toEqual(["日付", "h"]);
    expect([ws.getCell("A1").font?.bold, ws.getCell("B1").font?.bold]).toEqual([true, true]);
    expect(ws.views?.[0]).toMatchObject({ state: "frozen", xSplit: 0, ySplit: 1 });
    expect(ws.getCell("B2").value).toBe(2);
    expect(ws.getCell("A3").value).toBe("合計");
    expect(ws.getCell("A3").font?.bold).toBe(true);
    expect(ws.getCell("B3").font?.bold).toBeFalsy();
  });

  it("starts a headerless sheet at row 1 and leaves its pane unfrozen", async () => {
    const ws = (await render([SUMMARY])).getWorksheet("サマリー")!;
    expect(ws.getCell("A1").value).toBe("週");
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("B1").value).toBe("2026-W39");
    expect(ws.getCell("B1").font?.bold).toBeFalsy();
    expect((ws.views ?? []).some((v) => v.state === "frozen")).toBe(false);
  });

  it("writes a date cell as a real date formatted yyyy-mm-dd and skips a null one", async () => {
    const wb = await render([HOURS, TASKS]);
    const a2 = wb.getWorksheet("稼働")!.getCell("A2");
    expect(a2.value).toBeInstanceOf(Date);
    expect((a2.value as Date).toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(a2.numFmt).toBe("yyyy-mm-dd");
    expect(wb.getWorksheet("案件一覧")!.getCell("C2").value).toBeNull();
  });

  it("writes a date-kind cell that does not hold a date as plain text", async () => {
    // Neither layoutSheets nor an override coercion can produce this, but writing `new Date("未定")`
    // would put an Invalid Date in the file, so the writer falls back to the text instead.
    const grid: Grid = {
      key: "tasks", title: "案件一覧", freeze_header: true,
      columns: [{ key: "done_at", header: "完了日" }],
      rows: [{ row_key: "T1", cells: [cell("done_at", "未定", "date")] }],
    };
    const ws = (await render([grid])).getWorksheet("案件一覧")!;
    expect(ws.getCell("A2").value).toBe("未定");
    expect(ws.getCell("A2").numFmt).toBeFalsy();
  });

  // Phase A review, S1: `Date.UTC(2026, 1, 31)` is not an error, it is 2026-03-03 — so a date-kind
  // cell holding a day the calendar does not have must fall through to the text branch here too,
  // independently of overrides.ts's own coercion, or the download silently disagrees with the page.
  it("writes a date-kind cell holding a day the calendar has no room for as plain text, never a rolled-over date", async () => {
    const gridOf = (value: string): Grid => ({
      key: "tasks", title: "案件一覧", freeze_header: true,
      columns: [{ key: "done_at", header: "完了日" }],
      rows: [{ row_key: "T1", cells: [cell("done_at", value, "date")] }],
    });

    for (const value of ["2026-02-31", "2026-13-45", "2026-00-10", "2026-02-29"]) {
      const ws = (await render([gridOf(value)])).getWorksheet("案件一覧")!;
      expect(ws.getCell("A2").value).toBe(value);
      expect(ws.getCell("A2").numFmt).toBeFalsy();
    }

    // The real leap day of a real leap year is still written as a date.
    const leap = (await render([gridOf("2024-02-29")])).getWorksheet("案件一覧")!;
    expect(leap.getCell("A2").value).toBeInstanceOf(Date);
    expect((leap.getCell("A2").value as Date).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(leap.getCell("A2").numFmt).toBe("yyyy-mm-dd");
  });

  it("sizes each column to its widest printed value plus 2, header included, capped at 60", async () => {
    const wb = await render([SUMMARY, HOURS, TASKS]);
    const summary = wb.getWorksheet("サマリー")!;
    // "未割当工数(h)" and "2026-W39" are both 8 printed characters.
    expect(summary.getColumn(1).width).toBe(10);
    expect(summary.getColumn(2).width).toBe(10);
    // A column with no header and nothing but null cells is never sized.
    expect(summary.getColumn(3).width).toBeUndefined();

    const hours = wb.getWorksheet("稼働")!;
    expect(hours.getColumn(1).width).toBe(12);   // a date prints as 10 characters
    // Python prints a whole float as "2.0", so this column is 5 wide, not 3.
    expect(hours.getColumn(2).width).toBe(5);

    const tasks = wb.getWorksheet("案件一覧")!;
    expect(tasks.getColumn(1).width).toBe(5);    // header "案件名" is wider than the cell
    expect(tasks.getColumn(2).width).toBe(60);   // 61 characters would be 63, capped at 60
    expect(tasks.getColumn(3).width).toBe(5);    // header only; every cell is null
  });

  it("leaves a cell holding an empty string blank, the way openpyxl does", async () => {
    // A task with no deliverables, no project or no 備考 reaches the writer as "", and openpyxl
    // writes no value for it. Writing "" instead would read back as '' and fail a parity check.
    const grid: Grid = {
      key: "tasks", title: "案件一覧", freeze_header: true,
      columns: [{ key: "title", header: "案件名" }, { key: "deliverables", header: "成果物" }],
      rows: [{ row_key: "T1", cells: [cell("title", "件名", "text"), cell("deliverables", "", "text")] }],
    };
    const ws = (await render([grid])).getWorksheet("案件一覧")!;
    expect(ws.getCell("B2").value).toBeNull();
    expect(ws.getRow(2).actualCellCount).toBe(1);
    // pyLen("") is 0, so the empty cell never sized the column; the header still does.
    expect(ws.getColumn(2).width).toBe(5);
  });

  it("merges no cells", async () => {
    const wb = await render([SUMMARY, HOURS, TASKS]);
    for (const ws of wb.worksheets) expect(ws.model.merges).toEqual([]);
  });
});

describe("multi-line text cells", () => {
  it("wraps a cell whose text has line breaks, and leaves single-line cells unstyled", async () => {
    const MULTI: Grid = {
      key: "tasks", title: "案件一覧", freeze_header: true,
      columns: [{ key: "title", header: "案件名" }, { key: "thinking", header: "備考" }],
      rows: [{ row_key: "T1", cells: [cell("title", "一行", "text"), cell("thinking", "- 甲\n- 乙", "text")] }],
    };
    const ws = (await render([MULTI])).worksheets[0];
    expect(ws.getCell("B2").value).toBe("- 甲\n- 乙");
    expect(ws.getCell("B2").alignment?.wrapText).toBe(true);
    expect(ws.getCell("A2").alignment?.wrapText).toBeFalsy();
  });
});
