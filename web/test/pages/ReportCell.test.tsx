import { describe, expect, it } from "vitest";
import { autoText, isCellEditable } from "../../src/pages/report/ReportCell";
import type { GridCell } from "../../src/api/types";

describe("isCellEditable (contract 6)", () => {
  it("summary sheet's label column is not editable; its value column is", () => {
    expect(isCellEditable("summary", "week", "label")).toBe(false);
    expect(isCellEditable("summary", "week", "value")).toBe(true);
  });

  it("blank and req_header rows are never editable, on any sheet", () => {
    expect(isCellEditable("summary", "blank", "value")).toBe(false);
    expect(isCellEditable("summary", "req_header", "value")).toBe(false);
    expect(isCellEditable("days", "blank", "hours")).toBe(false);
  });

  it("the hours sheet's total row is not editable; other hours rows are", () => {
    expect(isCellEditable("hours", "total", "hours")).toBe(false);
    expect(isCellEditable("hours", "2026-09-14", "hours")).toBe(true);
  });

  it("everything else is editable", () => {
    expect(isCellEditable("tasks", "T1", "title")).toBe(true);
    expect(isCellEditable("days", "d1", "text")).toBe(true);
    expect(isCellEditable("deliverables", "row1", "name")).toBe(true);
  });
});

describe("autoText (contract 3)", () => {
  const cell = (c: Partial<GridCell>) => ({ value: null, kind: "text", ...c }) as GridCell;
  it("an overridden cell compares against its auto value, a still-auto one against its value, null as empty", () => {
    expect(autoText(cell({ value: "手改", auto: "自动", overridden: true }))).toBe("自动");
    expect(autoText(cell({ value: 2.5 }))).toBe("2.5");
    expect(autoText(cell({ value: null }))).toBe("");
  });
});
