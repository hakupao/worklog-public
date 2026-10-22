import type { ReactNode } from "react";
import type { Grid, GridCell, GridRow } from "../../api/types";
import { STRINGS, type StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { LedLines } from "../../ui/LedLines";
import { C } from "../../ui/palette";
import { cellText, EditCell } from "./EditCell";
import type { ReportWrite } from "./write";

const SUM = "#d9c6a2", WARN = "#ff8a5c";

/** A figure as the xlsx shows it: a float with two decimals, anything else (an int, typed-over text) as is. */
const figure = (cell: GridCell) => (cell.kind === "float" && typeof cell.value === "number" ? cell.value.toFixed(2) : cellText(cell) || "--");

/** サマリー (brief assumption 6, prototype page-report.html buildSum()): the labelled figures on the left — the label
 *  a row header in the interface language, the figure in big LED — and 依頼元 | 件数 on the right, one row per
 *  `req:<name>` row. Rows go by row_key, never by position; `blank` is the xlsx's spacer and has no place here,
 *  `req_header` is the right column's header. Figures edit in place (labels never: isCellEditable). */
export function SummaryView({ grid, week, write }: { grid: Grid; week: string; write: ReportWrite | null }) {
  const { lang } = useV2();
  const kv = grid.rows.filter((r) => r.row_key !== "blank" && r.row_key !== "req_header" && !r.row_key.startsWith("req:"));
  const req = grid.rows.filter((r) => r.row_key.startsWith("req:"));
  const at = (r: GridRow, col: string) => r.cells.find((c) => c.column === col);
  /** The figure of a row, in place: `show` is its resting LED. */
  const value = (r: GridRow, show: (cell: GridCell) => ReactNode) => {
    const cell = at(r, "value");
    return cell ? <EditCell grid={grid} row={r} cell={cell} week={week} write={write} display={show(cell)} /> : null;
  };
  const own = (r: GridRow) => { const c = at(r, "label"); return c ? cellText(c) : ""; };
  /** A row's label in the interface language; a row this page does not know keeps the server's label. */
  const label = (r: GridRow) => { const k = `rp.s.${r.row_key}`; return k in STRINGS ? t(lang, k as StrKey) : own(r); };
  return (
    <div className="rp-sum">
      <section role="table" aria-label={t(lang, "rp.sh.summary")}>
        {kv.map((r) => {
          const small = r.row_key === "week";
          return (
            <div key={r.row_key} className={`kv${small ? " sm" : ""}`} role="row">
              <span role="rowheader"><Led ui tier={2} fit color={C.DIM} text={label(r)} /></span>
              <span role="cell">
                {value(r, (c) => {
                  if (small) return <Led tier={1} fit color={C.WARM} text={cellText(c) || "--"} />;
                  const warn = r.row_key === "unassigned_hours" && Number(c.value) > 0;
                  return <Led size={8} scale={2} tier={1} fit color={warn ? WARN : C.AMBER} text={figure(c)} />;
                })}
              </span>
            </div>
          );
        })}
      </section>
      <span className="vr" />
      <section role="table" aria-label={t(lang, "rp.s.req")}>
        <div className="rq" role="row">
          <span role="columnheader"><Led ui tier={3} fit text={t(lang, "rp.s.req")} /></span>
          <span role="columnheader" className="r"><Led ui tier={3} fit text={t(lang, "rp.s.cnt")} /></span>
        </div>
        {req.map((r) => (
          <div key={r.row_key} className="rq" role="row">
            <span role="rowheader" className="nm"><LedLines tier={1} className="fill" color={SUM} text={[{ t: own(r) || r.row_key.slice(4), glyph: "ja" }]} /></span>
            <span role="cell" className="r">{value(r, (c) => <Led tier={1} fit color={C.AMBER} text={figure(c)} />)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
