import type { ReactNode } from "react";
import { ValidationError } from "../../api/client";
import type { Grid, GridCell, GridRow } from "../../api/types";
import { InlineEdit } from "../../components/InlineEdit";
import { isCellEditable } from "./ReportCell";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { overridePolishId, PolishMark } from "../../ui/PolishMark";
import { reportWriteError } from "../timeline/SessionDrawer";
import type { ReportWrite } from "./write";

export const cellText = (cell: GridCell) => (cell.value === null ? "" : String(cell.value));

/** The old ReportSheet's aria-label: the column's header, or — on サマリー, which has no header row — the row's own
 *  `label` cell (what the editable `value` beside it is a figure for). */
export function cellLabel(grid: Grid, row: GridRow, column: string): string {
  if (grid.key === "summary") {
    const label = row.cells.find((c) => c.column === "label");
    if (label && label.value !== null) return String(label.value);
  }
  return grid.columns.find((c) => c.key === column)?.header ?? column;
}

/** One report cell in place on a sheet view (the old ReportCell's rules, brief assumptions 5 / 6): editable unless
 *  `isCellEditable` says no; a date picker for a date cell; multiline for a text cell that already has a newline or
 *  runs past 40 characters; ↺ 恢复自动值 only while edited; the amber ✎ after an edited cell's content. The write goes
 *  through the page's queue on the preview on screen (`week` is that preview's); `write` is null while that
 *  preview is a kept one (another week loading) — then nothing edits. A failure is said in the interface language and the field keeps the draft
 *  (the error InlineEdit gets back is a ValidationError, so it shows that text beside the field instead of its own
 *  Chinese toast). `display` is the resting content (LED or type). */
export function EditCell({ grid, row, cell, week, write, display, className }: {
  grid: Grid; row: GridRow; cell: GridCell; week: string; write: ReportWrite | null;
  display: ReactNode; className?: string;
}) {
  const { lang } = useV2();
  const content = (
    <>
      {display}
      {cell.overridden && <span className="pen" title={t(lang, "rp.t.ov", { a: cell.auto === null || cell.auto === undefined ? "" : String(cell.auto) })}>✎</span>}
    </>
  );
  const cls = ["rp-ed", className].filter(Boolean).join(" ");
  if (!write || !isCellEditable(grid.key, row.row_key, cell.column)) return <span className={`${cls} ro`}>{content}</span>;
  const text = cellText(cell);
  const ref = { week, sheet: grid.key, row_key: row.row_key, column: cell.column };
  const fail = (err: unknown): never => {
    if (err instanceof ValidationError) throw err;
    reportWriteError(lang, err);
    throw new ValidationError([{ path: cell.column, message: t(lang, "tl.p.saveFailed") }]);
  };
  const editor = (
    <InlineEdit
      ariaLabel={cellLabel(grid, row, cell.column)}
      className={cls}
      value={text}
      type={cell.kind === "date" ? "date" : "text"}
      multiline={cell.kind === "text" && (text.includes("\n") || text.length > 40)}
      onSave={async (draft) => { await write.save(ref, draft, { rethrow: true }).catch(fail); }}
      restore={cell.overridden
        ? { label: `↺ ${t(lang, "rp.e.restore")}`, onRestore: async () => { await write.restore(ref, { rethrow: true }).catch(fail); } }
        : undefined}
      display={content}
    />
  );
  // the mark is a sibling of the editor; with none the editor stays the slot's direct child, as before
  if (!cell.polish) return editor;
  return (
    <span className="pm-w">
      {editor}
      <PolishMark meta={cell.polish} entity="report_override" entityId={overridePolishId(week, grid.key, row.row_key, cell.column)} field="value" />
    </span>
  );
}
