import { useState, type CSSProperties, type KeyboardEvent } from "react";
import { t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { LedLines } from "../../ui/LedLines";
import { C, lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { taskCode } from "../now/format";
import { DayBar } from "./DayBar";
import { type Matrix, type MxCell, type MxColumn, type MxRow } from "./matrix";
import { cellParam, type RpCell } from "./state";
import type { ReportData } from "./useReportData";

const UN_INK = "#a89f8e", EMPTY = "#4a3a22";
/** Minutes as the xlsx's hours, one decimal: 90 → "1.5". */
const h1 = (m: number) => (Math.round(m / 6) / 10).toFixed(1);
const cellHours = (m: number) => (m ? `${h1(m)}H` : "--");
/** A day cell's figure: its hours, or the text typed over a minutes cell (group review B3) as it is. */
const cellFigure = (c: MxCell) => c.raw ?? cellHours(c.minutes);

/** 日別作業 (brief assumption 3, prototype page-report.html buildDays()): one block per 案件 — an LED row of the
 *  day figures over a prose row of 考え方 and each day's 作業内容 on the same columns — then the per-day 合計 with
 *  a bar per day, and the footer. Each day cell (both halves) opens the cell drawer (`?cell=`). The matrix comes
 *  from the preview on screen (ReportPage), even one kept while another week loads, and with that
 *  preview's own week's timeline (useReportData, preflight R6), so a switch never blanks it — whichever arrives first.
 *  Under the header, the 当日案件 row (DayTasks). Every cell shows its text in full — the rows grow to fit. */
/** `sums`: the preview's 累計 per day (each session's own minutes, parallel ones in full) — a row under 稼働 when it
 *  differs (user 10/9: both 工作时间 and 累计耗时); null from a server without it. */
export function DaysView({ m, data, setCell, sums }: {
  m: Matrix | null; data: ReportData; setCell: ((c: RpCell) => void) | null; sums: Record<string, number> | null;
}) {
  const { lang } = useV2();
  if (!m) return null;
  // without the week's timeline no row's 案件 is known — a wrong matrix would be worse than none
  if (m.pending) {
    return data.timelineError
      ? <div className="rp-wait" role="alert">
          <Led ui tier={2} fit text={t(lang, "rp.d.tlFailed")} />
          <button type="button" className="key dim" onClick={data.refetchTimeline}><Led ui tier={1} fit text={t(lang, "tl.retry")} /></button>
        </div>
      : <div className="rp-wait" role="status"><Led ui tier={2} fit text={t(lang, "now.loading")} /></div>;
  }
  if (!m.rows.length) return <div className="rp-wait"><Led ui tier={2} fit text={t(lang, "rp.d.empty")} /></div>;
  return (
    <div className="rp-days" style={{ "--nd": m.columns.length } as CSSProperties}>
      <Head columns={m.columns} />
      <DayTasks m={m} />
      {m.rows.map((r) => <Block key={r.taskId ?? "-"} r={r} setCell={setCell} />)}
      <Totals m={m} sums={sums} />
      <div className="rp-foot">
        <Led ui tier={2} fit text={t(lang, "rp.d.foot", { n: m.taskCount, h: h1(m.total), s: h1(sums ? m.columns.reduce((a, c) => a + (sums[c.date] ?? 0), 0) : m.total) })} />
        <span className="grow" />
        <Led ui tier={3} fit text={t(lang, "rp.d.ov")} />
      </div>
    </div>
  );
}

function Head({ columns }: { columns: MxColumn[] }) {
  const { lang } = useV2();
  return (
    <div className="mx-h" aria-hidden="true">
      <span><Led ui tier={3} fit text={t(lang, "rp.d.task")} /></span>
      <span />
      {columns.map((c) => (
        <span key={c.date} className={`td${c.today ? " today" : ""}`}>
          <Led ui tier={c.today ? 1 : 3} fit color={c.today ? C.WARM : undefined}
            text={t(lang, "rp.d.dow", { d: t(lang, `tl.dow.${c.dow}` as "tl.dow.1"), md: mdOf(c.date) })} />
        </span>
      ))}
      <span className="r"><Led ui tier={3} fit text={t(lang, "rp.d.total")} /></span>
    </div>
  );
}

/** 当日案件 (user feedback 10/9: the AI day line repeated the cells below): each day just names the 案件 worked
 *  that day, most minutes first, each with its line colour; 未割当 is left out (it is no 案件); -- for a day with none.
 *  The stored day digests still feed the week line and the PDF — they are only no longer shown here. */
function DayTasks({ m }: { m: Matrix }) {
  const { lang } = useV2();
  return (
    <div className="dgr">
      <span className="lb"><Led ui tier={3} fit text={t(lang, "rp.dg.day")} /></span>
      {m.columns.map((c, i) => {
        const worked = m.rows
          .filter((r) => r.taskId !== null && (r.cells[i].minutes > 0 || r.cells[i].raw !== null))
          .sort((a, b) => b.cells[i].minutes - a.cells[i].minutes);
        return (
          <div key={c.date} className="dg">
            {worked.length
              ? <ul className="dt">{worked.map((r) => <li key={r.taskId} style={{ "--lc": lineColor(r.taskId) } as CSSProperties}><TaskBadge id={r.taskId!} height={BADGE_H.chip} /><span className="tt" title={r.title ?? undefined}>{r.title}</span></li>)}</ul>
              : "--"}
          </div>
        );
      })}
      <span />
    </div>
  );
}

/** One 案件 (or 未割当): the LED row and the prose row; a day's two halves light together on hover. The code and
 *  the title share one slot over the code and name tracks (`.id`), the title right after the code, so a long title
 *  wraps in the whole width instead of a narrow name track beside an empty code track. */
/** `setCell` is null while the matrix on screen is a kept one (another week loading): its cells are not
 *  buttons then — a click would put a cell of the old week into the new week's address (final review). */
function Block({ r, setCell }: { r: MxRow; setCell: ((c: RpCell) => void) | null }) {
  const { lang } = useV2();
  const [hot, setHot] = useState<string | null>(null);
  const k = r.taskId, lc = lineColor(k), un = k === null;
  const code = un ? t(lang, "rp.d.un") : taskCode(k);
  const open = (c: MxCell) => setCell?.({ taskId: c.taskId, date: c.date });
  const half = (c: MxCell) => ({
    onClick: setCell ? () => open(c) : undefined,
    onMouseEnter: () => setHot(c.date),
    onMouseLeave: () => setHot((d) => (d === c.date ? null : d)),
  });
  const cls = (c: MxCell) => `cell${hot === c.date ? " hov" : ""}`;
  const key = (c: MxCell) => (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(c); } };
  return (
    <div className={`blk${un ? " un" : ""}`} data-task={k ?? undefined} style={{ "--lc": lc } as CSSProperties}>
      <div className="lr">
        <span className="id">
          <span className="cd">{un
            ? <Led tier={2} fit color={lc} text={[{ t: taskCode(k), kind: "code", color: lc }]} />
            : <TaskBadge id={k!} height={BADGE_H.row} />}</span>
          <span className="nm">
            {un
              ? <LedLines ui tier={2} className="fill" color={UN_INK} text={t(lang, "rp.d.un")} />
              : <LedLines tier={1} className="fill" task={k} text={r.title ?? ""} />}
          </span>
        </span>
        {r.cells.map((c) => (
          <span key={c.date} className={cls(c)} role={setCell ? "button" : undefined} tabIndex={setCell ? 0 : undefined}
            data-cell={cellParam(c)} aria-label={`${code} ${mdOf(c.date)} ${cellFigure(c)}`}
            onKeyDown={setCell ? key(c) : undefined} {...half(c)}>
            <Led tier={c.minutes || c.raw ? 1 : 3} fit color={c.minutes || c.raw ? (un ? UN_INK : C.AMBER) : EMPTY} text={cellFigure(c)} />
            {c.overridden && <span className="ov" />}
          </span>
        ))}
        <span className="r"><Led tier={1} fit color={un ? UN_INK : C.WARM} text={`${h1(r.minutes)}H`} /></span>
      </div>
      <div className="pr">
        <div className="think">{r.thinking}</div>
        {r.cells.map((c) => (
          <div key={c.date} className={cls(c)} {...half(c)}><Prose c={c} /></div>
        ))}
        <span />
      </div>
    </div>
  );
}

/** A day's 作業内容: one line per source with its minutes (✎ first when edited). */
function Prose({ c }: { c: MxCell }) {
  if (!c.entries.length) return null;
  return (
    <div className="txt">
      <ul>
        {c.entries.map((e, i) => (
          <li key={`${e.rowKey}|${i}`}>{e.overridden && <span className="pen">✎</span>}{e.text}{e.minutesText !== null ? <span className="m">{e.minutesText}</span> : e.minutes ? <span className="m">{e.minutes}′</span> : null}</li>
        ))}
      </ul>
    </div>
  );
}

/** 稼働: each day's minutes over every row (未割当 included), the week in big figures, then 累計 (when it differs
 *  anywhere), then a bar per day. */
function Totals({ m, sums }: { m: Matrix; sums: Record<string, number> | null }) {
  const { lang } = useV2();
  const max = Math.max(0, ...m.dayTotals);
  const cum = sums ? m.columns.map((c) => sums[c.date] ?? 0) : null;
  const showCum = cum !== null && cum.some((n, i) => h1(n) !== h1(m.dayTotals[i]));
  return (
    <>
      <div className="tot">
        <span><Led ui tier={1} fit color={C.WARM} text={t(lang, "rp.d.day")} /></span>
        <span />
        {m.dayTotals.map((n, i) => <span key={m.columns[i].date} className="cell"><Led tier={1} fit text={`${h1(n)}H`} /></span>)}
        <span className="r"><Led size={8} scale={2} tier={1} fit text={h1(m.total)} /></span>
      </div>
      {showCum && (
        <div className="tot cum">
          <span><Led ui tier={3} fit text={t(lang, "rp.d.cum")} /></span>
          <span />
          {cum!.map((n, i) => <span key={m.columns[i].date} className="cell"><Led tier={3} fit text={`${h1(n)}H`} /></span>)}
          <span className="r"><Led tier={3} fit text={`${h1(cum!.reduce((a, b) => a + b, 0))}H`} /></span>
        </div>
      )}
      <div className="tot bar" aria-hidden="true">
        <span /><span />
        {m.dayTotals.map((n, i) => <DayBar key={m.columns[i].date} frac={max > 0 ? n / max : 0} />)}
        <span />
      </div>
    </>
  );
}
