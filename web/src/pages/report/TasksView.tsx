import { useState, type CSSProperties, type ReactNode } from "react";
import type { Grid, GridCell, GridRow, SessionLite } from "../../api/types";
import { jstDateOf } from "../../lib/jst";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { mdOf, weekdayOfDate } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { LedLines } from "../../ui/LedLines";
import { C, lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { cellText, EditCell } from "./EditCell";
import type { ReportWrite } from "./write";

const EMPTY = "#4a3a22", NAME = "#ffc46a", SUM = "#d9c6a2";
/** server/src/report/layout.ts's STATUS_LABELS, read backwards. */
const STATUS: Record<string, "open" | "hold" | "done"> = { 対応中: "open", 保留: "hold", 完了: "done" };
const LAMP = { open: "live", hold: "amber", done: "dim" } as const;
const ST_COLOR = { open: C.GREEN, hold: C.AMBER, done: "#8a8275" } as const;
/** The LED row's slots, left to right (prototype buildTasks); `code` is the row's own (row_key), every other slot
 *  is the grid column of that key — absent from the grid, the slot stays empty (the tracks keep their places). */
const SLOTS = ["status", "code", "title", "requester", "project", "received_at", "done_at", "hours"] as const;
const SLOT_HEAD = {
  status: "rp.t.st", code: "rp.t.code", title: "rp.t.title", requester: "rp.t.req", project: "rp.t.proj",
  received_at: "rp.t.recv", done_at: "rp.t.done", hours: "rp.t.h",
} as const;

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const dateText = (cell: GridCell) => { const s = cellText(cell); return s === "" ? "--" : isYmd(s) ? mdOf(s) : s; };
const hoursText = (cell: GridCell) => (typeof cell.value === "number" ? cell.value.toFixed(2) : cellText(cell) || "--");
/** 備考 / 成果物 as the server writes them (deliverables joined with ", "), or as typed over. */
const paths = (s: string) => s.split(/\n|, /).map((x) => x.trim()).filter(Boolean);
const dayOf = (lang: Lang, date: string) => t(lang, "rp.d.dow", { d: t(lang, `tl.dow.${weekdayOfDate(date)}` as "tl.dow.1"), md: mdOf(date) });

/** 案件一覧 (brief assumption 5, prototype page-report.html buildTasks()): one block per row of the grid — an LED row
 *  (status lamp, code, 案件名, 依頼元, プロジェクト, 受領日, 完了日, 工数) over a prose row (備考, 成果物 paths) — each
 *  cell editable in place; ▸ opens the row's sessions of the week (the old page's expand). */
export function TasksView({ grid, week, write }: { grid: Grid; week: string; write: ReportWrite | null }) {
  const { lang } = useV2();
  const has = new Set(grid.columns.map((c) => c.key));
  return (
    <div className="rp-tasks">
      <div className="th" aria-hidden="true">
        {SLOTS.map((s) => (
          <span key={s} data-col={s} className={s === "hours" ? "r" : undefined}>
            {(s === "code" || has.has(s)) && <Led ui tier={3} fit text={t(lang, SLOT_HEAD[s])} />}
          </span>
        ))}
      </div>
      {grid.rows.map((r) => <Row key={r.row_key} grid={grid} row={r} week={week} write={write} />)}
    </div>
  );
}

function Row({ grid, row, week, write }: { grid: Grid; row: GridRow; week: string; write: ReportWrite | null }) {
  const { lang } = useV2();
  const [open, setOpen] = useState(false);
  const k = row.row_key, lc = lineColor(k);
  const at = (col: string) => row.cells.find((c) => c.column === col);
  const stCell = at("status");
  // the lamp is the 案件's own state (the computed label); the text is what the xlsx will say, edits included
  const st = stCell ? STATUS[cellText({ ...stCell, value: stCell.auto ?? stCell.value })] ?? null : null;
  const done = st === "done";
  /** The slot of column `col` (nothing when the grid has no such column): `show` is its resting content. */
  const edit = (col: string, show: (cell: GridCell, text: string) => ReactNode, className?: string) => {
    const cell = at(col);
    return cell ? <EditCell grid={grid} row={row} cell={cell} week={week} write={write} display={show(cell, cellText(cell))} className={className} /> : null;
  };
  const titleText = at("title") ? cellText(at("title")!) : "";
  const slot: Record<(typeof SLOTS)[number], ReactNode> = {
    status: stCell && (
      <span className="st">
        <span className={`lamp ${st ? LAMP[st] : "dim"}`} />
        {/* the word in the interface language; text typed over it is the xlsx's own (Japanese glyphs) */}
        {edit("status", (c, v) => {
          const word = st !== null && !c.overridden;
          return <Led ui={word} tier={1} fit color={st ? ST_COLOR[st] : SUM} text={word ? t(lang, `rp.t.st.${st}`) : v || "--"} />;
        })}
      </span>
    ),
    code: <TaskBadge id={k} height={BADGE_H.row} />,
    title: edit("title", (_, v) => <LedLines tier={1} className="fill" task={k} color={done ? "#9c8a6a" : NAME} text={v} />, "nm"),
    requester: edit("requester", (_, v) => <LedLines tier={1} className="fill" color={SUM} text={[{ t: v, glyph: "ja" }]} />, "nm"),
    project: edit("project", (_, v) => <LedLines tier={1} className="fill" color={C.WARM} text={v} />, "nm"),
    received_at: edit("received_at", (c) => <Led tier={1} fit color={C.AMBER} text={dateText(c)} />),
    done_at: edit("done_at", (c, v) => <Led tier={v ? 1 : 3} fit color={v ? C.GREEN : EMPTY} text={dateText(c)} />),
    hours: edit("hours", (c) => <Led tier={1} fit color={C.AMBER} text={hoursText(c)} />),
  };
  return (
    <div className={`trw${done ? " done" : ""}`} data-task={k} style={{ "--lc": lc } as CSSProperties}>
      <div className="tr">
        {SLOTS.map((s) => <span key={s} data-col={s} className={s === "hours" ? "r" : undefined}>{slot[s]}</span>)}
      </div>
      <div className="tp">
        <span>
          {row.sessions !== undefined && (
            <button type="button" className="rp-xp" aria-expanded={open} aria-label={t(lang, "rp.t.expand", { t: titleText || k })} onClick={() => setOpen((v) => !v)}>
              {open ? "▾" : "▸"}
            </button>
          )}
        </span>
        <span />
        <div className="think">{edit("thinking", (_, v) => v)}</div>
        <div className="dl" lang="ja">
          {edit("deliverables", (_, v) => paths(v).map((p, i) => <div key={i} title={p}>{p}</div>))}
        </div>
      </div>
      {open && <Sessions lang={lang} list={row.sessions ?? []} />}
    </div>
  );
}

/** The row's sessions of the week (the old page's expand): day, summary, hours. */
function Sessions({ lang, list }: { lang: Lang; list: SessionLite[] }) {
  return (
    <div className="tp rp-ss">
      {list.length === 0
        ? <p className="none">{t(lang, "rp.t.noSess")}</p>
        : (
          <ul>
            {list.map((s) => (
              <li key={s.id}>
                <span className="d">{dayOf(lang, jstDateOf(s.started_at))}</span>
                <span className="sm">{s.summary}</span>
                <span className="h">{(s.minutes / 60).toFixed(2)}h</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
