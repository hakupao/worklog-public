import type { ReactNode } from "react";
import type { Grid, GridCell, GridRow } from "../../api/types";
import { t } from "../../i18n/t";
import { weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C } from "../../ui/palette";
import { isDate } from "../plan/state";
import { DayBar } from "./DayBar";
import { cellText, EditCell } from "./EditCell";
import type { ReportWrite } from "./write";

const hoursText = (cell: GridCell) => (typeof cell.value === "number" ? cell.value.toFixed(2) : cellText(cell) || "--");
/** The hours a row's bar stands for: the figure on screen (an edit included) when it is a number, else none. */
const barHours = (cell: GridCell | undefined) => (cell && typeof cell.value === "number" ? Math.max(0, cell.value) : 0);

/** 稼働 (brief assumption 6, prototype page-report.html buildHours()): one row per day of the grid — date,
 *  weekday, a 3-row bar scaled to the week's busiest day, hours — then 合計 in big figures. The date and the hours
 *  edit in place; the total is the server's sum and never does (isCellEditable). The weekday and the bar follow the
 *  row's own date (row_key), not text typed over the date cell. */
export function HoursView({ grid, week, write }: { grid: Grid; week: string; write: ReportWrite | null }) {
  const { lang } = useV2();
  const at = (r: GridRow, col: string) => r.cells.find((c) => c.column === col);
  const days = grid.rows.filter((r) => r.row_key !== "total");
  const total = grid.rows.find((r) => r.row_key === "total");
  const max = Math.max(0, ...days.map((r) => barHours(at(r, "hours"))));
  const edit = (r: GridRow, col: string, show: (cell: GridCell) => ReactNode) => {
    const cell = at(r, col);
    return cell ? <EditCell grid={grid} row={r} cell={cell} week={week} write={write} display={show(cell)} /> : null;
  };
  const totalHours = total && at(total, "hours");
  return (
    <div className="rp-hours">
      <div className="hr hh" aria-hidden="true">
        <span><Led ui tier={3} fit text={t(lang, "rp.h.date")} /></span>
        <span /><span />
        <span className="r"><Led ui tier={3} fit text={t(lang, "rp.h.h")} /></span>
      </div>
      {days.map((r) => (
        <div key={r.row_key} className="hr">
          <span>{edit(r, "date", (c) => <Led tier={1} fit color={C.AMBER} text={cellText(c) || "--"} />)}</span>
          <span>
            {isDate(r.row_key) && <Led ui tier={2} fit color={C.DIM} text={t(lang, "rp.h.dow", { d: t(lang, `tl.dow.${weekdayOfDate(r.row_key)}` as "tl.dow.1") })} />}
          </span>
          <DayBar frac={max > 0 ? barHours(at(r, "hours")) / max : 0} rows={3} />
          <span className="r">{edit(r, "hours", (c) => <Led tier={1} fit color={C.AMBER} text={hoursText(c)} />)}</span>
        </div>
      ))}
      {total && (
        <div className="hr total">
          <span><Led ui tier={1} fit color={C.WARM} text={t(lang, "rp.h.total")} /></span>
          <span /><span />
          <span className="r">{totalHours && <Led size={8} scale={2} tier={1} fit color={C.AMBER} text={hoursText(totalHours)} />}</span>
        </div>
      )}
    </div>
  );
}
