import type { CellValue, Grid, GridCell, GridRow, Note, ReportPreview, Session, Task, Timeline } from "../../api/types";
import { reportWeekDates } from "../../lib/jst";
import { weekdayOfDate } from "../../predict/time";

/**
 * The 日別作業 sheet as a task × day matrix (brief assumption 3). The server's days grid is one row per
 * session / note (row_key `S:<session id>` / `N:<note id>`, user ruling U1: the task comes from the week's
 * timeline). Pure: `today` comes in, so the matrix is the same under any host time zone.
 */

/** A timeline item behind a cell: a session's minutes are its share on that day. */
export type MxSource =
  | { kind: "session"; id: string; minutes: number; session: Session }
  | { kind: "note"; id: string; minutes: number; note: Note };

/** One days-grid row inside a cell: what the drawer edits (its `minutes` and `text` cells). */
export interface MxEntry {
  rowKey: string;
  text: string;
  minutes: number;
  /** The minutes cell's value when it is not a number (text typed over it on the old page — the server keeps it
   *  as text): shown as it is; `minutes` counts it as 0. null = a number. */
  minutesText: string | null;
  /** Any of its cells holds a hand edit — `date` / `task` too (preflight R2: the old page could edit those). */
  overridden: boolean;
  textCell: GridCell;
  minutesCell: GridCell;
  /** The row's 日付 / 案件 cells. Not editable here; the row stays where their computed values put it, and an
   *  edit of either is shown in the drawer with its own 恢复自动值. */
  dateCell: GridCell;
  taskCell: GridCell;
  /** The timeline session / note the row was made from (null when the timeline does not have it). */
  source: MxSource | null;
}

export interface MxCell {
  taskId: string | null;
  date: string;
  /** The sum of the entries' minutes (overrides included). */
  minutes: number;
  /** The entries' minutes that are not numbers (`MxEntry.minutesText`), joined — shown instead of the hours; null
   *  when every one is a number. */
  raw: string | null;
  entries: MxEntry[];
  overridden: boolean;
  sourceRowKeys: string[];
  /** The timeline's sessions (not hidden) and notes on that day with this cell's task. */
  sources: MxSource[];
}

export interface MxColumn { date: string; /** 1 = Monday … 7 = Sunday */ dow: number; weekend: boolean; today: boolean }

export interface MxRow {
  /** null = 未割当 */
  taskId: string | null;
  /** The 案件's title (null for 未割当). */
  title: string | null;
  task: Task | null;
  /** 考え方, from the 案件一覧 sheet's `thinking` cell (its override when it has one). */
  thinking: string;
  thinkingCell: GridCell | null;
  /** The week's minutes on this row. */
  minutes: number;
  /** One per column, same order. */
  cells: MxCell[];
}

export interface Matrix {
  week: string;
  columns: MxColumn[];
  rows: MxRow[];
  /** Per column: every row's minutes that day, 未割当 included (the xlsx 稼働 sheet's figure). */
  dayTotals: number[];
  total: number;
  /** Rows that are a 案件 (not 未割当). */
  taskCount: number;
  /** Without the week's timeline yet the task of each row is not known — show 读取中, not this matrix. */
  pending: boolean;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const num = (v: CellValue | undefined) => { const n = typeof v === "number" ? v : Number(v ?? NaN); return Number.isFinite(n) ? n : 0; };
const str = (v: CellValue | undefined) => (v === null || v === undefined ? "" : String(v));
const nonNumber = (v: CellValue | undefined) => (typeof v === "string" && v.trim() !== "" && !Number.isFinite(Number(v)) ? v : null);
/** server/src/report/weekly.ts's UNASSIGNED_LABEL: the 案件 title the server gives a row linked to none. */
const UNASSIGNED_LABEL = "その他・調査";
const cellOf = (row: GridRow, column: string) => row.cells.find((c) => c.column === column);
/** The computed value: an edited cell keeps it under `auto`. Row identity (date, task) follows the data, not edits. */
const autoOf = (c: GridCell | undefined) => (c ? (c.overridden ? c.auto ?? c.value : c.value) : null);
const blank = (column: string, kind: GridCell["kind"]): GridCell => ({ column, value: null, kind });

// The report's 05:00 JST days (server/src/report/wall.ts): an instant's day, and a session's minutes per day.
const DAY = 86_400_000, MIN = 60_000, SHIFT = 4 * 3_600_000;   // +9h to Tokyo, −5h to the day's start
const day5Of = (ms: number) => new Date(Math.floor((ms + SHIFT) / DAY) * DAY).toISOString().slice(0, 10);
/** notes.ts is a naive JST wall clock; one that already carries Z or an offset is read as is (wall.ts noteMs). */
const noteMs = (ts: string) => (/(Z|[+-]\d{2}:?\d{2})$/.test(ts) ? Date.parse(ts) : Date.parse(`${ts}Z`) - 9 * 3_600_000);
/** A session's minutes on each 05:00 day: its effective minutes in proportion to its activity there (an override
 *  all on its start day; no intervals = from its start for its minutes). Days whose share rounds to 0 are left out. */
function day5Shares(s: Session): [string, number][] {
  const t0 = Date.parse(s.started_at), ok0 = Number.isFinite(t0);
  // An unparsable start or interval is skipped, never placed (wall.ts does the same): day5Of(NaN) would throw.
  if (s.minutes_override !== null) return ok0 ? [[day5Of(t0), s.minutes_effective]] : [];
  const ivs = s.active_intervals?.length ? s.active_intervals.map(([a, b]) => [Date.parse(a), Date.parse(b)]) : [[t0, t0 + s.minutes_effective * MIN]];
  const on = new Map<string, number>();
  let all = 0;
  for (const [a, b] of ivs) {
    if (!(Number.isFinite(a) && Number.isFinite(b))) continue;
    for (let x = a; x < b;) {
      const end = Math.min(b, (Math.floor((x + SHIFT) / DAY) + 1) * DAY - SHIFT);
      on.set(day5Of(x), (on.get(day5Of(x)) ?? 0) + (end - x));
      all += end - x;
      x = end;
    }
  }
  if (all <= 0) return ok0 ? [[day5Of(t0), s.minutes_effective]] : [];
  return [...on].map(([d, ms]): [string, number] => [d, Math.round((s.minutes_effective * ms) / all)])
    .filter(([, m]) => m > 0 || s.minutes_effective === 0);
}

export interface MatrixInput {
  week: string;
  days: Grid;
  /** The 案件一覧 sheet (for 考え方); null falls back to the task list's own `thinking`. */
  tasksGrid: Grid | null;
  timeline: Timeline | null | undefined;
  tasks: Task[] | null;
  /** Tokyo today, "YYYY-MM-DD". */
  today: string;
}

export function buildMatrix(i: MatrixInput): Matrix {
  const week = reportWeekDates(i.week);   // Saturday → Friday
  // a kept-previous timeline of another week has none of this week's ids (useReportData keys the merged one by the report week)
  const tl = i.timeline && i.timeline.week === i.week ? i.timeline : null;
  const byId = new Map((i.tasks ?? []).map((t) => [t.id, t]));

  // U1: row → session / note by id, on the report's 05:00 days (the timeline's are midnight days, so its
  // items are re-placed here: a session at Sat 01:00 is Friday's); a session over 05:00 is listed under each day
  const onDay = new Map<string, MxSource>(), anyDay = new Map<string, MxSource>();
  const sourcesOn = new Map<string, MxSource[]>();
  const put = (date: string, src: MxSource, listed: boolean) => {
    const key = `${src.kind === "session" ? "S" : "N"}:${src.id}`;
    onDay.set(`${date}|${key}`, src);
    if (!anyDay.has(key)) anyDay.set(key, src);
    if (!listed) return;
    const list = sourcesOn.get(date);
    if (list) list.push(src); else sourcesOn.set(date, [src]);
  };
  const seen = new Set<string>();
  for (const d of tl?.days ?? []) for (const s of d.sessions) {
    if (seen.has(s.id)) continue;   // a session over midnight is on each of its timeline days
    seen.add(s.id);
    for (const [date, minutes] of day5Shares(s)) put(date, { kind: "session", id: s.id, minutes, session: s }, !s.hidden);
  }
  for (const d of tl?.days ?? []) for (const n of d.notes) {
    const t = noteMs(n.ts);
    if (Number.isFinite(t)) put(day5Of(t), { kind: "note", id: n.id, minutes: n.minutes ?? 0, note: n }, true);
  }
  const taskIdOfSource = (s: MxSource) => (s.kind === "session" ? s.session.task_id : s.note.task_id);
  /** A row the timeline cannot place (hidden since, timeline not loaded): its title, when exactly one 案件 has it. */
  const byTitle = (title: string): string | null => {
    // a row the server titled 未割当 is 未割当, even when some 案件 happens to bear that name (group review A5)
    if (title === UNASSIGNED_LABEL) return null;
    const hit = (i.tasks ?? []).filter((t) => t.title === title);
    return hit.length === 1 ? hit[0].id : null;
  };

  type Placed = { taskId: string | null; date: string; title: string; entry: MxEntry };
  const placed: Placed[] = [];
  const rowDates = new Set<string>();
  // by index, never by row_key: a session over midnight is two rows with the same key
  for (const row of i.days.rows) {
    const date = str(autoOf(cellOf(row, "date"))), title = str(autoOf(cellOf(row, "task")));
    if (!week.includes(date)) continue;
    rowDates.add(date);
    const source = onDay.get(`${date}|${row.row_key}`) ?? anyDay.get(row.row_key) ?? null;
    const taskId = source ? taskIdOfSource(source) : byTitle(title);
    const textCell = cellOf(row, "text") ?? blank("text", "text");
    const minutesCell = cellOf(row, "minutes") ?? blank("minutes", "int");
    const dateCell = cellOf(row, "date") ?? blank("date", "date"), taskCell = cellOf(row, "task") ?? blank("task", "text");
    placed.push({
      taskId, date, title,
      entry: {
        rowKey: row.row_key, text: str(textCell.value), minutes: num(minutesCell.value), minutesText: nonNumber(minutesCell.value),
        overridden: [textCell, minutesCell, dateCell, taskCell].some((x) => !!x.overridden),
        textCell, minutesCell, dateCell, taskCell, source,
      },
    });
  }

  const columns: MxColumn[] = week
    // Monday–Friday always; Saturday / Sunday (first, in date order) only with records
    .filter((d) => weekdayOfDate(d) <= 5 || rowDates.has(d))
    .map((date) => { const dow = weekdayOfDate(date); return { date, dow, weekend: dow > 5, today: date === i.today }; });

  const thinkingOf = (id: string): [string, GridCell | null] => {
    const c = i.tasksGrid?.rows.find((r) => r.row_key === id)?.cells.find((x) => x.column === "thinking");
    return c ? [str(c.value), c] : [byId.get(id)?.thinking ?? "", null];
  };

  const keyOf = (id: string | null) => id ?? "\u0000";
  const groups = new Map<string, Placed[]>();
  for (const p of placed) { const k = keyOf(p.taskId); const g = groups.get(k); if (g) g.push(p); else groups.set(k, [p]); }

  const rows: MxRow[] = [...groups.entries()].map(([, list]) => {
    const taskId = list[0].taskId;
    const cells = columns.map((col): MxCell => {
      const entries = list.filter((p) => p.date === col.date).map((p) => p.entry);
      return {
        taskId, date: col.date,
        minutes: entries.reduce((n, e) => n + e.minutes, 0),
        raw: entries.some((e) => e.minutesText !== null) ? entries.flatMap((e) => (e.minutesText === null ? [] : [e.minutesText])).join(" ") : null,
        entries,
        overridden: entries.some((e) => e.overridden),
        sourceRowKeys: entries.map((e) => e.rowKey),
        sources: (sourcesOn.get(col.date) ?? []).filter((s) => taskIdOfSource(s) === taskId),
      };
    });
    const task = taskId ? byId.get(taskId) ?? null : null;
    const [thinking, thinkingCell] = taskId ? thinkingOf(taskId) : ["", null];
    return {
      taskId, task, thinking, thinkingCell,
      title: taskId ? task?.title ?? list[0].title : null,
      minutes: cells.reduce((n, c) => n + c.minutes, 0),
      cells,
    };
  });
  rows.sort((a, b) =>
    (a.taskId === null ? 1 : 0) - (b.taskId === null ? 1 : 0) || b.minutes - a.minutes || cmp(a.taskId ?? "", b.taskId ?? ""));

  const dayTotals = columns.map((_, k) => rows.reduce((n, r) => n + r.cells[k].minutes, 0));
  return {
    week: i.week, columns, rows, dayTotals,
    total: dayTotals.reduce((a, b) => a + b, 0),
    taskCount: rows.filter((r) => r.taskId !== null).length,
    pending: !tl,
  };
}

/** The matrix of a preview (its own week, so a kept-previous preview stays consistent), or null
 *  when the preview has no 日別作業 sheet. */
export function matrixOf(preview: ReportPreview, timeline: Timeline | null | undefined, tasks: Task[] | null, today: string): Matrix | null {
  const days = preview.sheets.find((g) => g.key === "days");
  if (!days) return null;
  const tasksGrid = preview.sheets.find((g) => g.key === "tasks") ?? null;
  return buildMatrix({ week: preview.week, days, tasksGrid, timeline, tasks, today });
}

/** A cell of the matrix (`?cell=`), or null when no row / column has it. */
export function findCell(m: Matrix, taskId: string | null, date: string): MxCell | null {
  const k = m.columns.findIndex((c) => c.date === date);
  const row = m.rows.find((r) => r.taskId === taskId);
  return k < 0 || !row ? null : row.cells[k];
}

/** What the drawer can write for a cell: each entry's `minutes` and `text` cells on the days sheet (one entry per
 *  source). `cell` is the cached cell now. */
export interface EditTarget { sheet: "days"; row_key: string; column: "minutes" | "text"; cell: GridCell }
export function editTargets(cell: MxCell): EditTarget[] {
  return cell.entries.flatMap((e): EditTarget[] => [
    { sheet: "days", row_key: e.rowKey, column: "minutes", cell: e.minutesCell },
    { sheet: "days", row_key: e.rowKey, column: "text", cell: e.textCell },
  ]);
}
