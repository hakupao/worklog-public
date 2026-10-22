import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { applyOverrides, deleteOverride, loadOverrides, putOverride } from "../src/report/overrides";
import type { Grid, GridCell, OverrideRow } from "../src/report/types";
import { resetDb } from "./helpers";

// overrides.ts is the human-edit layer that sits between layoutSheets and both consumers of a Grid
// (the preview JSON and the workbook): a stored cell edit replaces the computed value and keeps the
// computed one under `auto` so the page can show what it replaced.

const db = () => (env as any).DB as D1Database;

const ov = (over: Partial<OverrideRow> = {}): OverrideRow => ({
  sheet: "tasks", row_key: "T1", column: "title", value: "手入力",
  updated_at: "2026-09-23T00:00:00.000Z", ...over,
});

// One column per CellKind, so a single grid exercises every coerce branch.
const row = (row_key: string) => ({
  row_key,
  cells: [
    { column: "title", value: `件名 ${row_key}`, kind: "text" as const },
    { column: "hours", value: 1.5, kind: "float" as const },
    { column: "received_at", value: "2026-09-21", kind: "date" as const },
    { column: "count", value: 2, kind: "int" as const },
  ],
});

const grids = (): Grid[] => [
  {
    key: "tasks", title: "案件一覧", freeze_header: true,
    columns: [
      { key: "title", header: "案件名" }, { key: "hours", header: "工数(h)" },
      { key: "received_at", header: "受領日" }, { key: "count", header: "件数" },
    ],
    rows: [row("T1"), row("T2")],
  },
  {
    key: "hours", title: "稼働", freeze_header: true,
    columns: [{ key: "date", header: "日付" }, { key: "hours", header: "稼働時間(h)" }],
    rows: [{ row_key: "2026-09-22", cells: [
      { column: "date", value: "2026-09-22", kind: "date" },
      { column: "hours", value: 0.5, kind: "float" },
    ] }],
  },
];

const cellOf = (gs: Grid[], sheet: string, row_key: string, column: string): GridCell =>
  gs.find((g) => g.key === sheet)!.rows.find((r) => r.row_key === row_key)!.cells
    .find((c) => c.column === column)!;

/** Apply one override to the single-row fixture and hand back the cell it aimed at. */
const applyOne = (column: string, value: string): GridCell =>
  cellOf(applyOverrides(grids(), [ov({ column, value })]), "tasks", "T1", column);

describe("applyOverrides", () => {
  it("replaces the value of the cell it names and keeps the computed one under auto", () => {
    const out = applyOverrides(grids(), [ov()]);
    expect(cellOf(out, "tasks", "T1", "title")).toEqual({
      column: "title", value: "手入力", kind: "text", auto: "件名 T1", overridden: true,
    });
  });

  it("leaves every other cell, row and sheet untouched", () => {
    const out = applyOverrides(grids(), [ov()]);
    expect(cellOf(out, "tasks", "T1", "count")).toEqual({ column: "count", value: 2, kind: "int" });
    expect(cellOf(out, "tasks", "T2", "title")).toEqual({ column: "title", value: "件名 T2", kind: "text" });
    expect(out.find((g) => g.key === "hours")).toEqual(grids().find((g) => g.key === "hours"));
  });

  it("does not mutate the grids it was given", () => {
    const input = grids();
    const before = structuredClone(input);
    const out = applyOverrides(input, [ov()]);
    expect(input).toEqual(before);
    // Every level is rebuilt, so a caller that edits the result cannot reach back into the input.
    expect(out[0]).not.toBe(input[0]);
    expect(out[0].rows[1]).not.toBe(input[0].rows[1]);
    // rows[1] is T2, which no override names: even an untouched cell comes back as a new object.
    expect(out[0].rows[1].cells[0]).not.toBe(input[0].rows[1].cells[0]);
  });

  it("ignores an override whose sheet, row or column is not in the grid", () => {
    const out = applyOverrides(grids(), [
      ov({ sheet: "days" }),                 // sheet not among the grids
      ov({ row_key: "T404" }),               // row not in the tasks sheet
      ov({ column: "nope" }),                // column not in the row
    ]);
    expect(out).toEqual(grids());
  });

  it("keeps an int cell numeric only when the text is a whole number", () => {
    expect(applyOne("count", "7")).toMatchObject({ value: 7, kind: "int" });
    expect(applyOne("count", "-7")).toMatchObject({ value: -7, kind: "int" });
    expect(applyOne("count", "7.5")).toMatchObject({ value: "7.5", kind: "text" });
    expect(applyOne("count", "七")).toMatchObject({ value: "七", kind: "text" });
    expect(applyOne("count", "")).toMatchObject({ value: "", kind: "text" });
  });

  it("keeps a float cell numeric only when the text is a decimal number", () => {
    expect(applyOne("hours", "2.50")).toMatchObject({ value: 2.5, kind: "float" });
    expect(applyOne("hours", "-2")).toMatchObject({ value: -2, kind: "float" });
    expect(applyOne("hours", "2.")).toMatchObject({ value: "2.", kind: "text" });
    expect(applyOne("hours", "約2")).toMatchObject({ value: "約2", kind: "text" });
  });

  it("keeps a date cell a date only when the text is YYYY-MM-DD", () => {
    expect(applyOne("received_at", "2026-10-01")).toMatchObject({ value: "2026-10-01", kind: "date" });
    expect(applyOne("received_at", "2026-9-1")).toMatchObject({ value: "2026-9-1", kind: "text" });
    expect(applyOne("received_at", "未定")).toMatchObject({ value: "未定", kind: "text" });
  });

  // Phase A review, S1: the shape alone is not enough — a well-formed YYYY-MM-DD naming a day the
  // calendar does not have used to stay `kind: "date"`, and the workbook writer then turned it into
  // a rolled-over real date (2026-02-31 -> 2026-03-03) while the page kept showing what was typed.
  it("downgrades a well-formed date that names no real day to text", () => {
    expect(applyOne("received_at", "2026-02-31")).toMatchObject({ value: "2026-02-31", kind: "text" });
    expect(applyOne("received_at", "2026-13-45")).toMatchObject({ value: "2026-13-45", kind: "text" });
    expect(applyOne("received_at", "2026-00-10")).toMatchObject({ value: "2026-00-10", kind: "text" });
    expect(applyOne("received_at", "2026-04-31")).toMatchObject({ value: "2026-04-31", kind: "text" });
    expect(applyOne("received_at", "2026-02-29")).toMatchObject({ value: "2026-02-29", kind: "text" });
  });

  it("keeps the last day of a month, and a leap day of a leap year, a date", () => {
    expect(applyOne("received_at", "2026-01-31")).toMatchObject({ value: "2026-01-31", kind: "date" });
    expect(applyOne("received_at", "2026-04-30")).toMatchObject({ value: "2026-04-30", kind: "date" });
    expect(applyOne("received_at", "2024-02-29")).toMatchObject({ value: "2024-02-29", kind: "date" });
    expect(applyOne("received_at", "2026-12-31")).toMatchObject({ value: "2026-12-31", kind: "date" });
  });

  it("takes a text cell exactly as typed", () => {
    expect(applyOne("title", "123")).toMatchObject({ value: "123", kind: "text" });
    expect(applyOne("title", "")).toMatchObject({ value: "", kind: "text" });
  });
});

describe("override storage", () => {
  beforeEach(resetDb);

  const cell = { sheet: "tasks" as const, row_key: "T1", column: "title" };

  it("round-trips a stored override and reports when it was written", async () => {
    const updated_at = await putOverride(db(), "2026-W39", "weekly", { ...cell, value: "手入力" });
    expect(await loadOverrides(db(), "2026-W39", "weekly")).toEqual([
      { sheet: "tasks", row_key: "T1", column: "title", value: "手入力", updated_at },
    ]);
  });

  it("returns only the overrides of the week and template it was asked for", async () => {
    await putOverride(db(), "2026-W39", "weekly", { ...cell, value: "A" });
    await putOverride(db(), "2026-W40", "weekly", { ...cell, value: "B" });
    // a row from before the templates merged is not the one template's
    await db().prepare(
      `INSERT INTO report_overrides (week, template, sheet, row_key, "column", value, updated_at) VALUES ('2026-W39', 'site', 'tasks', 'T1', 'title', 'C', 'x')`,
    ).run();
    expect((await loadOverrides(db(), "2026-W39", "weekly")).map((r) => r.value)).toEqual(["A"]);
    expect((await loadOverrides(db(), "2026-W40", "weekly")).map((r) => r.value)).toEqual(["B"]);
  });

  it("overwrites the same cell instead of storing it twice", async () => {
    const first = await putOverride(db(), "2026-W39", "weekly", { ...cell, value: "一回目" });
    await new Promise((resolve) => setTimeout(resolve, 2));   // the timestamps are milliseconds
    const updated_at = await putOverride(db(), "2026-W39", "weekly", { ...cell, value: "二回目" });
    expect(updated_at).not.toBe(first);
    expect(await loadOverrides(db(), "2026-W39", "weekly")).toEqual([
      { sheet: "tasks", row_key: "T1", column: "title", value: "二回目", updated_at },
    ]);
  });

  it("orders the overrides by sheet, row and column so a preview is reproducible", async () => {
    await putOverride(db(), "2026-W39", "weekly", { sheet: "tasks", row_key: "T2", column: "title", value: "b" });
    await putOverride(db(), "2026-W39", "weekly", { sheet: "tasks", row_key: "T1", column: "hours", value: "1" });
    await putOverride(db(), "2026-W39", "weekly", { sheet: "hours", row_key: "total", column: "hours", value: "9" });
    expect((await loadOverrides(db(), "2026-W39", "weekly")).map((r) => [r.sheet, r.row_key, r.column])).toEqual([
      ["hours", "total", "hours"], ["tasks", "T1", "hours"], ["tasks", "T2", "title"],
    ]);
  });

  it("says whether a delete removed anything", async () => {
    await putOverride(db(), "2026-W39", "weekly", { ...cell, value: "手入力" });
    expect(await deleteOverride(db(), "2026-W39", "weekly", cell)).toBe(true);
    expect(await deleteOverride(db(), "2026-W39", "weekly", cell)).toBe(false);
    expect(await loadOverrides(db(), "2026-W39", "weekly")).toEqual([]);
  });

  it("does not delete the same cell of another week", async () => {
    await putOverride(db(), "2026-W39", "weekly", { ...cell, value: "手入力" });
    expect(await deleteOverride(db(), "2026-W40", "weekly", cell)).toBe(false);
    expect((await loadOverrides(db(), "2026-W39", "weekly")).length).toBe(1);
  });
});
