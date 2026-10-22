import type { CSSProperties, ReactNode } from "react";
import type { Grid, GridCell, GridRow } from "../../api/types";
import { t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { LedLines } from "../../ui/LedLines";
import { C, lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { cellText, EditCell } from "./EditCell";
import type { ReportWrite } from "./write";

const EMPTY = "#4a3a22", NAME = "#ffc46a";
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
/** A row_key is `<taskId>|<i>` (hand-picked) or `<taskId>|d:<hash>` (automatic; server/src/report/layout.ts deliverablesSheet):
 *  the 案件 is what comes before the last `|`. */
const taskOf = (rowKey: string) => { const i = rowKey.lastIndexOf("|"); return i > 0 ? rowKey.slice(0, i) : rowKey; };

/** 成果物 (brief assumption 6, prototype page-report.html buildDeliv()): one row per deliverable of the grid —
 *  the 案件's code in its line colour, its title, the path (monospace, wrapped in full),
 *  the done date. Title, path and date edit in place. */
export function DeliverablesView({ grid, week, write }: { grid: Grid; week: string; write: ReportWrite | null }) {
  const { lang } = useV2();
  if (!grid.rows.length) return <div className="rp-wait"><Led ui tier={2} fit text={t(lang, "rp.v.empty")} /></div>;
  return (
    <div className="rp-dlv">
      <div className="dv" aria-hidden="true">
        <span><Led ui tier={3} fit text={t(lang, "rp.v.task")} /></span>
        <span />
        <span><Led ui tier={3} fit text={t(lang, "rp.v.path")} /></span>
        <span><Led ui tier={3} fit text={t(lang, "rp.v.done")} /></span>
      </div>
      {grid.rows.map((r) => <Row key={r.row_key} grid={grid} row={r} week={week} write={write} />)}
    </div>
  );
}

function Row({ grid, row, week, write }: { grid: Grid; row: GridRow; week: string; write: ReportWrite | null }) {
  const k = taskOf(row.row_key), lc = lineColor(k);
  const edit = (col: string, show: (cell: GridCell, text: string) => ReactNode, className?: string) => {
    const cell = row.cells.find((c) => c.column === col);
    return cell ? <EditCell grid={grid} row={row} cell={cell} week={week} write={write} display={show(cell, cellText(cell))} className={className} /> : null;
  };
  return (
    <div className="dv" data-task={k} style={{ "--lc": lc } as CSSProperties}>
      <span><TaskBadge id={k} height={BADGE_H.row} /></span>
      <span className="nm">{edit("title", (_, v) => <LedLines tier={1} className="fill" task={k} color={NAME} text={v} />, "nm")}</span>
      <span className="pc">{edit("path", (_, v) => <div className="path" lang="ja" title={v}><bdi dir="ltr">{v}</bdi></div>, "nm")}</span>
      <span>{edit("done_at", (_, v) => <Led tier={v ? 1 : 3} fit color={v ? C.GREEN : EMPTY} text={v === "" ? "--" : isYmd(v) ? mdOf(v) : v} />)}</span>
    </div>
  );
}
