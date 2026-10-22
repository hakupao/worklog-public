// The range workbook's sheets (spec §3, §5, §10): what each cell holds and how it looks. Charts are DrawingML specs that
// point at データ; xlsx.ts injects them.
import type ExcelJS from "exceljs";
import type { Lang } from "../../i18n/langs";
import { parseDay } from "../day";
import { countText, fill, periodText, weekText } from "../labels";
import { chartXml, type Anchor, type LineSeries, type Series } from "./charts/chart-xml";
import type { RangeLabels } from "./labels";
import { OTHER, UNLINKED } from "./series";
import type { RangeStyle } from "./style";
import type { RangeData } from "./types";

const argb = (rgb: string) => `FF${rgb}`;
const font = (s: RangeStyle, size: number, color: string, bold = false): Partial<ExcelJS.Font> =>
  ({ name: s.font, size, color: { argb: argb(color) }, bold });
const paint = (cell: ExcelJS.Cell, rgb: string) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(rgb) } }; };
export const PRINT: Partial<ExcelJS.PageSetup> = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
const md = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
export const periodOf = (start: string, end: string) => `${md(start)} – ${md(end)}`;
const widths = (ws: ExcelJS.Worksheet, ws_: number[]) => ws_.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** A oneliner is one line wherever it is shown (a newline in a hand edit would break the row). */
const oneLine = (t: string) => t.trim().replace(/\s*\n\s*/g, " ");
const hair = (s: RangeStyle): Partial<ExcelJS.Borders> => ({ bottom: { style: "hair", color: { argb: argb(s.rule) } } });

/** One table row: [value, numFmt] per column from column 1; top-aligned, the `wrap` columns wrapped, a hair rule under. */
type TableCell = [ExcelJS.CellValue, string | null];
function tableRow(ws: ExcelJS.Worksheet, row: number, cells: TableCell[], wrap: number[], fontOf: (j: number) => Partial<ExcelJS.Font>, s: RangeStyle): void {
  cells.forEach(([v, fmt], j) => {
    const c = ws.getCell(row, j + 1);
    c.value = v; if (fmt) c.numFmt = fmt;
    c.font = fontOf(j); c.alignment = { vertical: "top", wrapText: wrap.includes(j) }; c.border = hair(s);
  });
}

// Excel never grows a merged, wrapped cell's row by itself: the height is estimated from the text. Width in column
// units (≈ one Latin digit); a CJK / full-width character takes two, plus a margin for proportional glyphs and word
// breaks. A last line filled past FULL may still break once more in Excel: it gets a spare line.
const units = (t: string) => sum([...t].map((ch) => (ch.codePointAt(0)! >= 0x2e80 || /[\u1100-\u115f]/.test(ch) ? 2 : 1)));
const MARGIN = 1.25, FULL = 0.85;
export function linesOf(text: string, width: number, size: number): number {
  return sum(text.split("\n").map((l) => {
    const x = (units(l) * MARGIN * size) / 10 / width, n = Math.max(1, Math.ceil(x));
    return x > 0 && x - (n - 1) > FULL ? n + 1 : n;
  }));
}
function fitRow(ws: ExcelJS.Worksheet, row: number, text: string, width: number, size: number): void {
  const lines = linesOf(text, width, size);
  const r = ws.getRow(row), h = Math.round(lines * size * 1.6 + 4);
  if (h > (r.height ?? 0)) r.height = h;
}
/** Text in columns c1..c2 of one row, merged when wider than one column; wrapped (and the row sized) when `width` is given. */
function block(ws: ExcelJS.Worksheet, row: number, c1: number, c2: number, text: string, f: Partial<ExcelJS.Font>, width?: number): ExcelJS.Cell {
  if (c2 > c1) ws.mergeCells(row, c1, row, c2);
  const c = ws.getCell(row, c1);
  c.value = text; c.font = f;
  c.alignment = { vertical: "top", wrapText: width !== undefined };
  if (width !== undefined) fitRow(ws, row, text, width, f.size ?? 10);
  return c;
}
/** A section heading over columns 1..last: bold, a thin rule under the whole width. */
function heading(ws: ExcelJS.Worksheet, row: number, last: number, text: string, s: RangeStyle): void {
  for (let c = 1; c <= last; c++) ws.getCell(row, c).border = { bottom: { style: "thin", color: { argb: argb(s.rule) } } };
  const c = ws.getCell(row, 1); c.value = text; c.font = font(s, s.bodySize + 1, s.ink, true);
  ws.getRow(row).height = 20;
}

function header(ws: ExcelJS.Worksheet, row: number, labels: string[], s: RangeStyle): void {
  labels.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h; c.font = font(s, s.bodySize, s.headerInk, true); paint(c, s.headerFill);
    c.border = { bottom: { style: "thin", color: { argb: argb(s.rule) } } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  ws.getRow(row).height = 30;
}

export interface DataLayout {
  sheet: string; first: number; last: number;
  weekCol: number; seriesCol: number; totalCol: number; sumCol: number; newCol: number; doneCol: number; cumCol: number; costCol: number; tokensCol: number;
  shareFirst: number; shareLast: number;   // requester share block: name in column 1, hours in column 2
  // 本周日别 block: header row, the 7 day rows; date in column 1, then these columns.
  dayHead: number; dayFirst: number; dayLast: number;
  dayLabelCol: number; dayHoursCol: number; daySeriesCol: number; dayTaskCol: number; dayStartCol: number; dayEndCol: number; daySpanCol: number;
}

/** The share block's rows: one stand-in row when the range has no hours, so the doughnut is never empty. */
const shareRows = (data: RangeData, L: RangeLabels): Array<[string, number]> => (data.share.length ? data.share : [[L.data.total, 0]]);

export function drawData(ws: ExcelJS.Worksheet, data: RangeData, L: RangeLabels, s: RangeStyle): DataLayout {
  const S = data.series.length;
  const col = { weekCol: 1, seriesCol: 3, totalCol: 3 + S, sumCol: 4 + S, newCol: 5 + S, doneCol: 6 + S, cumCol: 7 + S, costCol: 8 + S, tokensCol: 9 + S };
  header(ws, 1, [L.data.week, L.data.period, ...data.series, L.data.total, L.data.sum, L.data.new, L.data.done, L.data.cum, L.data.cost, L.data.tokens], s);
  data.weeks.forEach((w, i) => {
    const r = ws.getRow(2 + i);
    const cells: Array<[number, string | number, string | null]> = [
      [1, w.week, null], [2, periodOf(w.start, w.end), null],
      ...w.by_series.map((h, j): [number, number, string] => [col.seriesCol + j, h, "0.0"]),
      [col.totalCol, w.hours, "0.0"], [col.sumCol, w.sum_hours, "0.0"], [col.newCol, w.new, "0"], [col.doneCol, w.done, "0"],
      [col.cumCol, w.done_cum, "0"], [col.costCol, w.cost_usd, "$#,##0.00"], [col.tokensCol, w.tokens, "#,##0"],
    ];
    for (const [c, v, fmt] of cells) { const cell = r.getCell(c); cell.value = v; if (fmt) cell.numFmt = fmt; cell.font = font(s, s.bodySize, s.ink); }
  });
  const last = 1 + data.weeks.length, head = last + 3, rows = shareRows(data, L);
  header(ws, head, [L.data.requester, L.data.hours], s);
  rows.forEach(([name, h], i) => {
    const n = ws.getCell(head + 1 + i, 1), v = ws.getCell(head + 1 + i, 2);
    n.value = name; v.value = h; v.numFmt = "0.0"; n.font = v.font = font(s, s.bodySize, s.ink);
  });
  // 本周日别: the last week day by day; the charts' categories are the M/D (曜) column, clock times fractions of a day.
  const shareLast = head + rows.length, dayHead = shareLast + 4, T = data.day_tasks.length;
  const day = { dayLabelCol: 2, dayHoursCol: 3, daySeriesCol: 4, dayTaskCol: 4 + S, dayStartCol: 4 + S + T, dayEndCol: 5 + S + T, daySpanCol: 6 + S + T };
  const D = L.data;
  ws.getCell(dayHead - 1, 1).value = D.days; ws.getCell(dayHead - 1, 1).font = font(s, s.bodySize + 1, s.ink, true);
  header(ws, dayHead, [D.date, D.day, D.total, ...data.series, ...data.day_tasks.map((t) => dayTaskName(t, L)), D.start, D.end, D.span], s);
  data.days.forEach((d, i) => {
    const r = ws.getRow(dayHead + 1 + i), clock = (h: number | null) => (h === null ? null : h / 24);
    const cells: Array<[number, Date | string | number | null, string | null]> = [
      [1, parseDay(d.date), "yyyy-mm-dd"], [day.dayLabelCol, dayLabel(d.date, L), null], [day.dayHoursCol, d.hours, "0.0"],
      ...d.by_series.map((h, j): [number, number, string] => [day.daySeriesCol + j, h, "0.0"]),
      ...d.by_task.map((h, j): [number, number, string] => [day.dayTaskCol + j, h, "0.0"]),
      [day.dayStartCol, clock(d.start), CLOCK], [day.dayEndCol, clock(d.end), CLOCK],
      [day.daySpanCol, d.start === null || d.end === null ? null : (d.end - d.start) / 24, CLOCK],
    ];
    for (const [c, v, fmt] of cells) { const cell = r.getCell(c); cell.value = v; if (fmt) cell.numFmt = fmt; cell.font = font(s, s.bodySize, s.ink); }
  });
  widths(ws, [15, 20, ...Array(Math.max(S + 9, S + T + 4)).fill(20)]);
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1, showGridLines: false }];
  ws.pageSetup = PRINT;
  return { sheet: ws.name, first: 2, last, ...col, shareFirst: head + 1, shareLast,
    dayHead, dayFirst: dayHead + 1, dayLast: dayHead + data.days.length, ...day };
}

/** A 案件 column's name in the day block (the legend reads it): 未紐付 marked as the 案件 one; a title over 16 characters
 *  cut with … (the whole title is in 案件一覧). */
const TITLE_MAX = 16;
const dayTaskName = (t: { key: string; label: string }, L: RangeLabels) => {
  if (t.key === UNLINKED) return `${t.label}${L.taskSuffix}`;
  const cs = [...t.label];
  return t.key !== OTHER && cs.length > TITLE_MAX ? `${cs.slice(0, TITLE_MAX).join("")}…` : t.label;
};
/** Clock time of hours stored as a fraction of a day; [h] runs past 24 (25:30 = 01:30 the next morning). */
const CLOCK = "[h]:mm";
/** A day's category label: M/D (weekday) in the export language. */
const dayLabel = (date: string, L: RangeLabels) =>
  `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} (${L.weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;

/** 0-based rows where the two chart bands of 表紙・概要 start (two charts side by side in each). */
export interface CoverLayout { bands: [number, number] }
const CHART_ROWS = 18;
const COVER_COLS = 15, COVER_WIDTH = 150;            // 15 columns of 10
const CHART_SPLIT = 7;                               // left chart: columns A–G, right: I–O (equal widths, H between)

// 表紙・概要 (spec §10): the document, what it covers and how to read it, the key figures with units and definitions,
// and only then the charts, each with a basis note under it.
export function drawCover(ws: ExcelJS.Worksheet, data: RangeData, L: RangeLabels, s: RangeStyle, lang: Lang): CoverLayout {
  if (data.weeks.length === 0) throw new Error("range has no weeks");   // the weekly average divides by it
  const C = L.cover, body = font(s, s.bodySize, s.ink), label = font(s, s.bodySize, s.muted);
  widths(ws, Array(COVER_COLS).fill(COVER_WIDTH / COVER_COLS));
  block(ws, 1, 1, COVER_COLS, C.title, font(s, s.titleSize, s.ink, true));
  ws.getRow(1).height = s.titleSize * 1.8;

  let r = 3;
  const dates = periodText(lang, data.weeks[0].start, data.weeks.at(-1)!.end);
  const meta: Array<[string, string]> = [
    [C.period, fill(C.periodValue, {   // one week: the week once, not "W41 – W41"
      span: data.from === data.to ? weekText(lang, data.from) : fill(C.span, { from: weekText(lang, data.from), to: weekText(lang, data.to) }),
      dates, weeks: countText(C.weeks, data.weeks.length) })],
    [C.generated, data.generated], [C.subject, C.subjectValue], [C.unit, C.unitValue],
  ];
  for (const [l, v] of meta) { block(ws, r, 1, 3, l, label); block(ws, r, 4, COVER_COLS, v, body, COVER_WIDTH - 30); r++; }

  r++; heading(ws, r++, COVER_COLS, C.about, s);
  block(ws, r++, 1, COVER_COLS, C.purpose, body, COVER_WIDTH);
  r++; heading(ws, r++, COVER_COLS, C.guide, s);
  for (const k of ["cover", "week", "weekly", "tasks", "data"] as const) {
    block(ws, r, 1, 3, L.sheet[k], font(s, s.bodySize, s.ink, true));
    block(ws, r, 4, COVER_COLS, C.guideRows[k], body, COVER_WIDTH - 30);
    r++;
  }

  r++; heading(ws, r++, COVER_COLS, C.kpiHead, s);
  const spans: Array<[number, number]> = [[1, 3], [4, 5], [6, 6], [7, COVER_COLS]];   // item / value / unit / definition
  C.kpiCols.forEach((h, i) => {
    const c = block(ws, r, spans[i][0], spans[i][1], h, font(s, s.bodySize, s.headerInk, true));
    for (let x = spans[i][0]; x <= spans[i][1]; x++) { paint(ws.getCell(r, x), s.headerFill); ws.getCell(r, x).border = { bottom: { style: "thin", color: { argb: argb(s.rule) } } }; }
    c.alignment = { vertical: "middle" };
  });
  ws.getRow(r++).height = 22;
  const T = data.totals, K = L.kpi;
  // Both hour figures (user 10/13): 稼働 = wall clock, 累計 = each session's own minutes summed. 週平均 over every week
  // of the range, idle ones included.
  const kpis: Array<[typeof K.hours, number, string]> = [
    [K.hours, T.hours, "0.0"], [K.sum, T.sum_hours, "0.0"], [K.avg, Math.round((T.hours / data.weeks.length) * 10) / 10, "0.0"],
    [K.done, T.done, "0"], [K.cost, T.cost_usd, "$#,##0.00"],
  ];
  for (const [k, value, fmt] of kpis) {
    block(ws, r, 1, 3, k.label, font(s, s.bodySize, s.ink, true));
    const v = block(ws, r, 4, 5, "", font(s, s.bodySize + 2, s.ink, true));
    v.value = value; v.numFmt = fmt; v.alignment = { horizontal: "right", vertical: "top" };
    block(ws, r, 6, 6, k.unit, body);
    block(ws, r, 7, COVER_COLS, k.def, body, COVER_WIDTH - 60);
    for (let x = 1; x <= COVER_COLS; x++) ws.getCell(r, x).border = hair(s);
    r++;
  }
  if (T.cost_partial) block(ws, r, 1, COVER_COLS, L.costPartial, font(s, s.kpiLabelSize, s.muted));

  r += 2; heading(ws, r, COVER_COLS, C.chartsHead, s);
  // Anchors are 0-based: a band starting at 0-based row `top` begins on the 1-based row after the heading, its notes
  // go on the row right under the charts, one blank row before the next band.
  const top1 = r, top2 = top1 + CHART_ROWS + 2;
  const notes = [[L.chart.hours, L.chart.tasks], [L.chart.share, L.chart.cost]];
  [top1, top2].forEach((top, i) => {
    const row = top + CHART_ROWS + 1, note = (c: { basis: string }) => fill(C.note, { text: fill(c.basis, { other: L.other, unlinked: L.unassigned }) });
    block(ws, row, 1, CHART_SPLIT, note(notes[i][0]), font(s, s.kpiLabelSize, s.muted), CHART_SPLIT * 10);
    block(ws, row, CHART_SPLIT + 2, COVER_COLS, note(notes[i][1]), font(s, s.kpiLabelSize, s.muted), (COVER_COLS - CHART_SPLIT - 1) * 10);
  });
  ws.views = [{ state: "normal", showGridLines: false }];
  ws.pageSetup = PRINT;
  return { bands: [top1, top2] };
}

/** 0-based rows where the two chart bands of 当週業務内容's 本周日别 start. */
export interface WeekLayout { bands: [number, number] }
// 当週業務内容's columns are [30, 50, 20, 20, 10, 120]: left charts over A–D (120), right over F (120), E between.
const WEEK_LEFT: [number, number] = [0, 4], WEEK_RIGHT: [number, number] = [5, 6];

// 当週業務内容 (spec §10): the range's latest week as the 週報 shows it — its digest, then its 案件, then 本周日别.
export function drawWeek(ws: ExcelJS.Worksheet, data: RangeData, L: RangeLabels, s: RangeStyle, lang: Lang): WeekLayout {
  const W = data.weeks.at(-1)!, Wl = L.week, cols = 6, colW = [30, 50, 20, 20, 10, 120], width = sum(colW), body = font(s, s.bodySize, s.ink);
  widths(ws, colW);
  block(ws, 1, 1, cols, L.sheet.week, font(s, s.titleSize, s.ink, true));
  ws.getRow(1).height = s.titleSize * 1.8;
  block(ws, 3, 1, 1, Wl.week, font(s, s.bodySize, s.muted)); block(ws, 3, 2, cols, weekText(lang, W.week), font(s, s.bodySize, s.ink, true));
  block(ws, 4, 1, 1, Wl.period, font(s, s.bodySize, s.muted)); block(ws, 4, 2, cols, periodText(lang, W.start, W.end), body);

  let r = 6;
  heading(ws, r++, cols, Wl.summary, s);
  // The 週報 PDF's digest (one ■ line per 案件) → the oneliner → the week's top 案件 → nothing recorded.
  const digest = (W.digest_text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const lines: Array<[string, boolean]> = digest.length ? digest.map((l) => [l, false])
    : W.oneliner?.trim() ? [[oneLine(W.oneliner), false]]
    : W.top_tasks.length ? [[fill(Wl.top, { names: W.top_tasks.join(L.sep) }), true]]
    : [[Wl.none, true]];
  for (const [text, fallback] of lines) block(ws, r++, 1, cols, text, font(s, s.bodySize, fallback ? s.muted : s.ink), width);

  r++; heading(ws, r++, cols, Wl.table, s);
  const C = Wl.cols;
  header(ws, r++, [C.requester, C.title, C.week, C.total, C.status, C.deliverables], s);
  for (const t of W.tasks) tableRow(ws, r++, [
    [t.requester, null], [t.title, null], [t.week_hours, "0.0"], [t.total_hours_all_time, "0.0"], [L.status[t.status], null], [t.deliverables.join("\n") || null, null],
  ], [1, 5], () => body, s);
  if (W.tasks.length === 0) block(ws, r++, 1, cols, Wl.noTasks, font(s, s.bodySize, s.muted));
  block(ws, r + 1, 1, cols, Wl.note, font(s, s.kpiLabelSize, s.muted), width);

  // 本周日别: the charts in two bands under the heading, a basis note under each (drawCover's pattern).
  r += 3; heading(ws, r, cols, Wl.days, s);
  const top1 = r, top2 = top1 + CHART_ROWS + 2, muted = font(s, s.kpiLabelSize, s.muted);
  const note = (c: { basis: string }) => fill(L.cover.note, { text: fill(c.basis, { other: L.otherTask, unlinked: L.unassigned }) });
  const under = (top: number, [c1, c2]: [number, number], c: { basis: string }) =>
    block(ws, top + CHART_ROWS + 1, c1 + 1, c2, note(c), muted, sum(colW.slice(c1, c2)));
  under(top1, WEEK_LEFT, Wl.dayCharts.series); under(top1, WEEK_RIGHT, Wl.dayCharts.tasks); under(top2, WEEK_LEFT, Wl.dayCharts.span);
  ws.views = [{ state: "normal", showGridLines: false }];
  ws.pageSetup = PRINT;
  return { bands: [top1, top2] };
}

export function drawWeekly(ws: ExcelJS.Worksheet, data: RangeData, L: RangeLabels, s: RangeStyle): void {
  const W = L.weekly;
  header(ws, 1, [W.week, W.period, W.oneliner, W.hours, W.sum, W.new, W.done, W.top], s);
  [...data.weeks].reverse().forEach((w, i) => {
    const fallback = !w.oneliner?.trim();
    tableRow(ws, 2 + i, [
      [w.week, null], [periodOf(w.start, w.end), null], [fallback ? w.top_tasks.join(L.sep) : oneLine(w.oneliner!), null],
      [w.hours, "0.0"], [w.sum_hours, "0.0"], [w.new, "0"], [w.done, "0"], [w.top_tasks.join("\n"), null],
    ], [2, 7], (j) => font(s, s.bodySize, j === 2 && fallback ? s.muted : s.ink), s);
  });
  widths(ws, [11, 14, 80, 20, 20, 15, 15, 100]);
  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  ws.pageSetup = PRINT;
}

// 案件一覧: every 案件 the range touched, in data.tasks order; the 成果物 one per line.
export function drawTasks(ws: ExcelJS.Worksheet, data: RangeData, L: RangeLabels, s: RangeStyle): void {
  const T = L.tasks, cols = 9;
  header(ws, 1, [T.requester, T.title, T.project, T.status, T.received, T.done, T.range, T.total, T.deliverables], s);
  // A hand-entered 通算 keeps its number (the mark is in the format) and gets the footnote below.
  const manualFmt = `0.0"${T.manualMark}"`;
  data.tasks.forEach((t, i) => tableRow(ws, 2 + i, [
    [t.requester, null], [t.title, null], [t.project || null, null], [L.status[t.status], null],
    [parseDay(t.received_at), "yyyy-mm-dd"], [t.done_at === null ? null : parseDay(t.done_at), "yyyy-mm-dd"],
    [t.range_hours, "0.0"], [t.total_hours, t.total_manual ? manualFmt : "0.0"], [t.deliverables.join("\n") || null, null],
  ], [1, 8], () => font(s, s.bodySize, s.ink), s));
  let r = 2 + data.tasks.length;
  if (data.tasks.length === 0) block(ws, r++, 1, cols, T.none, font(s, s.bodySize, s.muted));
  const w = [30, 60, 20, 9, 12, 12, 15, 15, 120];
  block(ws, ++r, 1, cols, T.note, font(s, s.kpiLabelSize, s.muted), sum(w));
  if (data.tasks.some((t) => t.total_manual)) block(ws, ++r, 1, cols, T.manualNote, font(s, s.kpiLabelSize, s.muted), sum(w));
  widths(ws, w);
  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  ws.pageSetup = PRINT;
}

/** A series' colour by its key: its rank among the 依頼元; その他の依頼元 and 未紐付 have their own fixed slots. */
export const seriesColor = (s: RangeStyle, key: string, j: number) =>
  key === UNLINKED ? s.series[7] : key === OTHER ? s.series[6] : s.series[j % 6];

export function overviewCharts(data: RangeData, d: DataLayout, L: RangeLabels, s: RangeStyle, at: CoverLayout): Array<{ xml: string; anchor: Anchor }> {
  const cats = data.weeks.map((w) => w.week);
  const ref = (col: number) => ({ sheet: d.sheet, col, from: d.first, to: d.last });
  const ser = (name: string, col: number, vals: number[], color: string): LineSeries =>
    ({ name, nameCell: { sheet: d.sheet, col, row: 1 }, cat: ref(d.weekCol), val: ref(col), cats, vals, color });
  // No series (no hours in the range): the total column stands in, so the chart is never empty (Excel repairs those).
  const bars = data.series.length
    ? data.series.map((name, j) => ser(name, d.seriesCol + j, data.weeks.map((w) => w.by_series[j]), seriesColor(s, data.series_keys[j], j)))
    : [ser(L.data.total, d.totalCol, data.weeks.map((w) => w.hours), s.accent)];
  const share = shareRows(data, L);
  const anchor = (band: number, right: boolean): Anchor => ({
    from: { col: right ? CHART_SPLIT + 1 : 0, row: at.bands[band] }, to: { col: right ? COVER_COLS : CHART_SPLIT, row: at.bands[band] + CHART_ROWS },
  });
  return [
    { xml: chartXml({ kind: "bar", title: L.chart.hours.title, grouping: "stacked", bars, numFmt: "0.0", style: s.chart }), anchor: anchor(0, false) },
    { xml: chartXml({ kind: "bar", title: L.chart.tasks.title, grouping: "clustered", numFmt: "0", lineNumFmt: "0", style: s.chart,
        bars: [ser(L.data.new, d.newCol, data.weeks.map((w) => w.new), s.newBar), ser(L.data.done, d.doneCol, data.weeks.map((w) => w.done), s.doneBar)],
        lines: [ser(L.data.cum, d.cumCol, data.weeks.map((w) => w.done_cum), s.line)] }),
      anchor: anchor(0, true) },
    { xml: chartXml({ kind: "doughnut", title: L.chart.share.title, style: s.chart,
        series: { name: L.data.hours, nameCell: { sheet: d.sheet, col: 2, row: d.shareFirst - 1 },
          cat: { sheet: d.sheet, col: 1, from: d.shareFirst, to: d.shareLast }, val: { sheet: d.sheet, col: 2, from: d.shareFirst, to: d.shareLast },
          cats: share.map(([n]) => n), vals: share.map(([, h]) => h), color: s.accent },
        colors: share.map((_, j) => (data.share.length ? seriesColor(s, data.series_keys[j] ?? "", j) : s.series[6])) }),
      anchor: anchor(1, false) },
    { xml: chartXml({ kind: "bar", title: L.chart.cost.title, grouping: "clustered", numFmt: "$#,##0", style: s.chart,
        bars: [ser(L.data.cost, d.costCol, data.weeks.map((w) => w.cost_usd), s.costBar)] }),
      anchor: anchor(1, true) },
  ];
}

/** 本周日别 on 当週業務内容: hours by 依頼元 (the weekly chart's series and colours), hours by 案件 (badge colours), and
 *  start / end as floating bars (an invisible start, the span on top) on a clock axis from 05:00. */
export function weekCharts(data: RangeData, d: DataLayout, L: RangeLabels, s: RangeStyle, at: WeekLayout): Array<{ xml: string; anchor: Anchor }> {
  const C = L.week.dayCharts, cats = data.days.map((x) => dayLabel(x.date, L));
  const ref = (col: number) => ({ sheet: d.sheet, col, from: d.dayFirst, to: d.dayLast });
  const ser = (name: string, col: number, vals: number[], color: string | null): Series =>
    ({ name, nameCell: { sheet: d.sheet, col, row: d.dayHead }, cat: ref(d.dayLabelCol), val: ref(col), cats, vals, color });
  const hours = [ser(L.data.total, d.dayHoursCol, data.days.map((x) => x.hours), s.accent)];   // stand-in: never an empty chart
  const bySeries = data.series.map((name, j) => ser(name, d.daySeriesCol + j, data.days.map((x) => x.by_series[j]), seriesColor(s, data.series_keys[j], j)));
  const byTask = data.day_tasks.map((t, j) => ser(dayTaskName(t, L), d.dayTaskCol + j, data.days.map((x) => x.by_task[j]),
    t.key === UNLINKED ? s.series[7] : t.key === OTHER ? s.series[6] : t.color));
  const frac = (h: number | null) => (h === null ? 0 : h / 24);
  const span = [
    ser(L.data.start, d.dayStartCol, data.days.map((x) => frac(x.start)), null),
    ser(L.data.span, d.daySpanCol, data.days.map((x) => (x.start === null || x.end === null ? 0 : (x.end - x.start) / 24)), s.accent),
  ];
  const anchor = (band: number, [c1, c2]: [number, number]): Anchor => ({ from: { col: c1, row: at.bands[band] }, to: { col: c2, row: at.bands[band] + CHART_ROWS } });
  return [
    { xml: chartXml({ kind: "bar", title: C.series.title, grouping: "stacked", numFmt: "0.0", style: s.chart, bars: bySeries.length ? bySeries : hours }), anchor: anchor(0, WEEK_LEFT) },
    { xml: chartXml({ kind: "bar", title: C.tasks.title, grouping: "stacked", numFmt: "0.0", style: s.chart, bars: byTask.length ? byTask : hours }), anchor: anchor(0, WEEK_RIGHT) },
    { xml: chartXml({ kind: "bar", title: C.span.title, grouping: "stacked", numFmt: CLOCK, style: s.chart, bars: span, ...clockAxis(data) }), anchor: anchor(1, WEEK_LEFT) },
  ];
}

/** The start / end chart's axis on 3-hour lines: from 05:00 (no start is earlier) up to the first line at or above the
 *  latest end, at least 08:00. A week with no session time keeps Excel's own scale. */
function clockAxis(data: RangeData): { valMin?: number; valMax?: number; valMajor?: number } {
  const ends = data.days.flatMap((x) => (x.end === null ? [] : [x.end]));
  if (ends.length === 0) return {};
  return { valMin: 5 / 24, valMax: Math.max(8, Math.ceil((Math.max(...ends) - 5) / 3) * 3 + 5) / 24, valMajor: 3 / 24 };
}
