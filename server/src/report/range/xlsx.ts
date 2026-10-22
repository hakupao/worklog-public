// Assembles the range workbook: exceljs draws the sheets, then the charts are injected (spec §6).
import ExcelJS from "exceljs";
import type { Lang } from "../../i18n/langs";
import { injectCharts } from "./charts/inject";
import { RANGE_LABELS } from "./labels";
import { drawCover, drawData, drawTasks, drawWeek, drawWeekly, overviewCharts, weekCharts, type CoverLayout, type DataLayout, type WeekLayout } from "./sheets";
import { STYLE, type RangeStyle } from "./style";
import type { RangeData } from "./types";

/** The sheets without charts — what the tests read cells from (exceljs cannot read a charted file back). */
export async function renderRangeSheets(data: RangeData, lang: Lang, s: RangeStyle = STYLE): Promise<ExcelJS.Workbook> {
  return (await draw(data, lang, s)).wb;
}

async function draw(data: RangeData, lang: Lang, s: RangeStyle): Promise<{ wb: ExcelJS.Workbook; d: DataLayout; cover: CoverLayout; week: WeekLayout }> {
  const L = RANGE_LABELS[lang];
  const wb = new ExcelJS.Workbook();
  // Sheet order = tab order (spec §10): ① 表紙・概要 ② 当週業務内容 ③ 週次一覧 ④ 案件一覧 ⑤ データ.
  const [cv, wk, wl, tk, dt] = [L.sheet.cover, L.sheet.week, L.sheet.weekly, L.sheet.tasks, L.sheet.data].map((n) => wb.addWorksheet(n));
  const cover = drawCover(cv, data, L, s, lang);
  const week = drawWeek(wk, data, L, s, lang);
  drawWeekly(wl, data, L, s);
  drawTasks(tk, data, L, s);
  return { wb, d: drawData(dt, data, L, s), cover, week };
}

export async function renderRangeXlsx(data: RangeData, lang: Lang, s: RangeStyle = STYLE): Promise<ArrayBuffer> {
  const L = RANGE_LABELS[lang];
  const { wb, d, cover, week } = await draw(data, lang, s);
  // STORE here, DEFLATE once in injectCharts: the package is compressed a single time (Worker CPU).
  const raw = new Uint8Array((await wb.xlsx.writeBuffer({ zip: { compression: "STORE" } } as never)) as unknown as Uint8Array);
  const out = await injectCharts(raw, [
    { sheet: L.sheet.cover, charts: overviewCharts(data, d, L, s, cover) },
    { sheet: L.sheet.week, charts: weekCharts(data, d, L, s, week) },
  ]);
  return out.slice().buffer as ArrayBuffer;   // a copy of exactly its bytes
}
