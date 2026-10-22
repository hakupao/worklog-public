import type ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { RANGE_LABELS } from "../src/report/range/labels";
import { STYLE } from "../src/report/range/style";
import { OTHER, UNLINKED } from "../src/report/range/series";
import type { RangeData, RangeWeek } from "../src/report/range/types";
import { linesOf } from "../src/report/range/sheets";
import { renderRangeSheets, renderRangeXlsx } from "../src/report/range/xlsx";

const DATA: RangeData = {
  from: "2026-W40", to: "2026-W41", generated: "2026-10-13",
  weeks: [
    { week: "2026-W40", start: "2026-09-26", end: "2026-10-02", hours: 10, sum_hours: 14, new: 2, done: 1, done_cum: 1, by_series: [6, 4], cost_usd: 12.5, tokens: 1000, oneliner: null, top_tasks: ["帳票", "画面"], digest_text: null, tasks: [] },
    { week: "2026-W41", start: "2026-10-03", end: "2026-10-09", hours: 8, sum_hours: 8, new: 0, done: 2, done_cum: 3, by_series: [8, 0], cost_usd: 3, tokens: 500, oneliner: "帳票の修正を終えた", top_tasks: ["帳票"], digest_text: null, tasks: [] },
  ],
  series_keys: ["田中", UNLINKED], series: ["田中", "未紐付"], share: [["田中", 14], ["未紐付", 4]],
  totals: { hours: 18, sum_hours: 22, done: 3, cost_usd: 15.5, tokens: 1500, cost_partial: true },
  tasks: [],
  // W41 day by day: Sat 10-03 … Fri 10-09; Tue runs past midnight (25.5 = 01:30), Sun has no work.
  days: [
    { date: "2026-10-03", hours: 2, by_series: [2, 0], by_task: [2, 0, 0], start: 9.5, end: 11.5 },
    { date: "2026-10-04", hours: 0, by_series: [0, 0], by_task: [0, 0, 0], start: null, end: null },
    { date: "2026-10-05", hours: 1.5, by_series: [1, 0.5], by_task: [0.5, 0.5, 0.5], start: 9, end: 12 },
    { date: "2026-10-06", hours: 3.5, by_series: [3.5, 0], by_task: [3, 0.5, 0], start: 22, end: 25.5 },
    { date: "2026-10-07", hours: 1, by_series: [1, 0], by_task: [1, 0, 0], start: 13, end: 14 },
    { date: "2026-10-08", hours: 0, by_series: [0, 0], by_task: [0, 0, 0], start: null, end: null },
    { date: "2026-10-09", hours: 0, by_series: [0, 0], by_task: [0, 0, 0], start: null, end: null },
  ],
  day_tasks: [{ key: "T1", label: "帳票", color: "B5482A" }, { key: OTHER, label: "その他の案件", color: "" }, { key: UNLINKED, label: "未紐付", color: "" }],
};
const TASKS: RangeData["tasks"] = [
  { id: "T1", requester: "田中", title: "帳票", project: "社内", status: "done", received_at: "2026-09-01", done_at: "2026-10-01", range_hours: 12.5, total_hours: 20, total_manual: false, deliverables: ["out/a.xlsx", "out/b.pdf"] },
  { id: "T2", requester: "鈴木", title: "画面", project: "", status: "open", received_at: "2026-09-20", done_at: null, range_hours: 3, total_hours: 3, total_manual: false, deliverables: [] },
];
const WEEK_TASKS: RangeWeek["tasks"] = [
  { id: "T1", requester: "田中", title: "帳票", status: "done", week_hours: 5.25, total_hours_all_time: 20, deliverables: ["out/a.xlsx", "帳票 v2"] },
  { id: "T2", requester: "鈴木", title: "画面", status: "open", week_hours: 0, total_hours_all_time: 3, deliverables: [] },
];
const FULL: RangeData = { ...DATA, tasks: TASKS, weeks: [DATA.weeks[0], { ...DATA.weeks[1], tasks: WEEK_TASKS }] };
const latest = (d: RangeData, w: Partial<RangeWeek>): RangeData => ({ ...d, weeks: [d.weeks[0], { ...d.weeks[1], ...w }] });

/** The row whose column-A cell holds `text` (labels sit in column A on 表紙・概要 and 当週業務内容). */
const rowOf = (ws: ExcelJS.Worksheet, text: string) => {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === text) return r;
  throw new Error(`no row with ${text}`);
};
const columnA = (ws: ExcelJS.Worksheet, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ws.getCell(from + i, 1).value);

describe("renderRangeXlsx: sheet order and names", () => {
  it("five sheets in order, names per language", async () => {
    for (const [lang, names] of [
      ["ja", ["表紙・概要", "当週業務内容", "週次一覧", "案件一覧", "データ"]],
      ["zh", ["封面及概要", "本周业务内容", "每周一览", "案件一览", "数据"]],
      ["en", ["Cover and Summary", "Reporting Week", "Weekly Summary", "Task List", "Data"]],
    ] as const) expect((await renderRangeSheets(FULL, lang, STYLE)).worksheets.map((w) => w.name)).toEqual(names);
  });

  it("every language fills every label (no empty string)", () => {
    const walk = (x: unknown, path: string): void => {
      if (typeof x === "string") expect(x.trim(), path).not.toBe("");
      else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`);
    };
    for (const lang of ["ja", "zh", "en"] as const) walk(RANGE_LABELS[lang], lang);
  });

  it("the 案件's own hour columns and their notes never use the range pair's words (稼働 / 累計, 工作时间 / 累计, Working / Cumulative)", () => {
    const banned = { ja: ["稼働", "累計"], zh: ["工作时间", "累计"], en: ["Working", "Cumulative"] };
    for (const lang of ["ja", "zh", "en"] as const) {
      const L = RANGE_LABELS[lang];
      for (const h of [L.week.cols.week, L.week.cols.total, L.tasks.range, L.tasks.total, L.week.note, L.tasks.note])
        for (const w of banned[lang]) expect(h, `${lang}: ${h}`).not.toContain(w);
    }
  });
});

describe("表紙・概要", () => {
  it("title, then 対象期間 / 作成日 / 集計対象 / 集計単位, purpose and the guide to the five sheets", async () => {
    const ws = (await renderRangeSheets(FULL, "ja", STYLE)).getWorksheet("表紙・概要")!;
    expect(ws.getCell("A1").value).toBe("業務報告書（期間集計）");
    expect(columnA(ws, 3, 6)).toEqual(["対象期間", "作成日", "集計対象", "集計単位"]);
    expect(ws.getCell("D3").value).toBe("2026年 第40週 〜 2026年 第41週（2026.09.26（土）〜 10.09（金）、全 2 週）");
    expect(ws.getCell("D4").value).toBe("2026-10-13");
    const about = rowOf(ws, "本書について"), guide = rowOf(ws, "シート構成");
    expect(ws.getCell(about + 1, 1).value).toBe(RANGE_LABELS.ja.cover.purpose);
    expect(columnA(ws, guide + 1, guide + 5)).toEqual(["表紙・概要", "当週業務内容", "週次一覧", "案件一覧", "データ"]);
    expect(ws.getCell(guide + 2, 4).value).toBe(RANGE_LABELS.ja.cover.guideRows.week);
  });

  it("the purpose is one merged, wrapped cell across the page, its row tall enough for more than one line", async () => {
    const ws = (await renderRangeSheets(FULL, "ja", STYLE)).getWorksheet("表紙・概要")!;
    const r = rowOf(ws, "本書について") + 1;
    expect(ws.getCell(r, 15).master.address).toBe(`A${r}`);
    expect(ws.getCell(r, 1).alignment).toMatchObject({ wrapText: true });
    expect(ws.getRow(r).height).toBeGreaterThan(20);
  });

  it("KPI table: 稼働 and 累計 first, then 週平均 / 完了 / AI 費用 — each with a value format, a unit and a definition; the cost note when partial", async () => {
    const ws = (await renderRangeSheets(FULL, "ja", STYLE)).getWorksheet("表紙・概要")!;
    const h = rowOf(ws, "指標");
    expect([1, 4, 6, 7].map((c) => ws.getCell(h, c).value)).toEqual(["指標", "値", "単位", "定義"]);
    expect(columnA(ws, h + 1, h + 5)).toEqual(["稼働時間（実時間）", "累計作業時間", "週平均稼働時間", "完了案件数", "AI 利用費用"]);
    expect([1, 2, 3, 4, 5].map((i) => ws.getCell(h + i, 4).value)).toEqual([18, 22, 9, 3, 15.5]);   // avg = 18 h / 2 weeks
    expect([1, 2, 3, 4, 5].map((i) => ws.getCell(h + i, 4).numFmt)).toEqual(["0.0", "0.0", "0.0", "0", "$#,##0.00"]);
    expect([1, 2, 3, 4, 5].map((i) => ws.getCell(h + i, 6).value)).toEqual(["時間", "時間", "時間／週", "件", "米ドル"]);
    expect(ws.getCell(h + 3, 7).value).toContain("稼働のない週を含む");
    expect(ws.getCell(h + 6, 1).value).toBe(RANGE_LABELS.ja.costPartial);
  });

  it("no cost note when every session has a cost", async () => {
    const ws = (await renderRangeSheets({ ...FULL, totals: { ...FULL.totals, cost_partial: false } }, "ja", STYLE)).getWorksheet("表紙・概要")!;
    expect(ws.getCell(rowOf(ws, "指標") + 6, 1).value).toBeNull();
  });

  it("no 本周 block on the cover any more", async () => {
    const ws = (await renderRangeSheets(FULL, "ja", STYLE)).getWorksheet("表紙・概要")!;
    const all: unknown[] = [];
    ws.eachRow((row) => row.eachCell((c) => all.push(c.value)));
    expect(all).not.toContain("帳票の修正を終えた");
    expect(all).not.toContain("直近の週");
  });

  it("chart basis notes sit under the charts, after the KPI table, and name the legend's words", async () => {
    const ws = (await renderRangeSheets(FULL, "ja", STYLE)).getWorksheet("表紙・概要")!;
    const charts = rowOf(ws, "推移グラフ");
    expect(charts).toBeGreaterThan(rowOf(ws, "指標") + 5);
    const notes: string[] = [];
    ws.eachRow((row, r) => { if (r > charts) row.eachCell((c) => { if (c.master.address === c.address && typeof c.value === "string" && c.value.startsWith("注：")) notes.push(c.value); }); });
    expect(notes).toHaveLength(4);
    expect(notes[0]).toContain("「その他の依頼元」"); expect(notes[0]).toContain("「未紐付」");
  });

  it("refuses a range with no weeks (the weekly average would divide by zero)", async () => {
    await expect(renderRangeSheets({ ...DATA, weeks: [] }, "ja", STYLE)).rejects.toThrow(/no weeks/);
  });

  it("en: formal labels, singular week count", async () => {
    const one: RangeData = { ...FULL, from: "2026-W41", weeks: [FULL.weeks[1]] };
    const ws = (await renderRangeSheets(one, "en", STYLE)).getWorksheet("Cover and Summary")!;
    expect(ws.getCell("A1").value).toBe("Work Report (Period Summary)");
    expect(ws.getCell("D3").value).toBe("2026 · Week 41 (Sat 3 Oct – Fri 9 Oct 2026; 1 week)");   // one week: printed once
    expect(columnA(ws, rowOf(ws, "Item") + 1, rowOf(ws, "Item") + 2)).toEqual(["Working Hours (Wall Clock)", "Cumulative Work Hours"]);
  });
});

describe("当週業務内容 (the latest week of the range)", () => {
  const sheet = async (d: RangeData, lang: "ja" | "zh" | "en" = "ja") => {
    const wb = await renderRangeSheets(d, lang, STYLE);
    return wb.getWorksheet(RANGE_LABELS[lang].sheet.week)!;
  };
  const summaryRows = (ws: ExcelJS.Worksheet, L = RANGE_LABELS.ja) => {
    const out: unknown[] = [];
    for (let r = rowOf(ws, L.week.summary) + 1; ws.getCell(r, 1).value !== null; r++) out.push(ws.getCell(r, 1).value);
    return out;
  };

  it("week label and period of the latest week", async () => {
    const ws = await sheet(FULL);
    expect(ws.getCell("A1").value).toBe("当週業務内容");
    expect([ws.getCell(rowOf(ws, "対象週"), 2).value, ws.getCell(rowOf(ws, "期間"), 2).value]).toEqual(["2026年 第41週", "2026.10.03（土）〜 10.09（金）"]);
  });

  it("the week digest: one ■ line per merged, wrapped row; blank lines dropped", async () => {
    const ws = await sheet(latest(FULL, { digest_text: "■ 帳票：修正を完了した。\n\n■ 画面：レイアウトを確定した。\n" }));
    expect(summaryRows(ws)).toEqual(["■ 帳票：修正を完了した。", "■ 画面：レイアウトを確定した。"]);
    const r = rowOf(ws, "■ 帳票：修正を完了した。");
    expect(ws.getCell(r, 6).master.address).toBe(`A${r}`);
    expect(ws.getCell(r, 1).alignment).toMatchObject({ wrapText: true, vertical: "top" });
  });

  it("no digest: the oneliner, its newlines as spaces", async () => {
    expect(summaryRows(await sheet(latest(FULL, { oneliner: "帳票の修正を終え、\n画面に着手した" })))).toEqual(["帳票の修正を終え、 画面に着手した"]);
  });

  it("no digest, no oneliner: the top 案件 joined with the language's separator, in muted ink", async () => {
    const d = latest(FULL, { oneliner: null, top_tasks: ["帳票", "画面", "API"] });
    const ja = await sheet(d);
    expect(summaryRows(ja)).toEqual(["主な案件：帳票、画面、API"]);
    expect(ja.getCell(rowOf(ja, "主な案件：帳票、画面、API"), 1).font.color?.argb).toBe(`FF${STYLE.muted}`);
    expect(summaryRows(await sheet(d, "en"), RANGE_LABELS.en)).toEqual(["Main tasks: 帳票, 画面, API"]);
  });

  it("nothing at all: the no-record line", async () => {
    expect(summaryRows(await sheet(latest(FULL, { oneliner: null, top_tasks: [] })))).toEqual(["当該週の作業記録なし"]);
  });

  it("task table: headers per language, localized status, hours, deliverables one per line; the column note below", async () => {
    for (const lang of ["ja", "zh", "en"] as const) {
      const ws = await sheet(FULL, lang), C = RANGE_LABELS[lang].week.cols;
      const h = rowOf(ws, C.requester);
      expect([1, 2, 3, 4, 5, 6].map((c) => ws.getCell(h, c).value)).toEqual([C.requester, C.title, C.week, C.total, C.status, C.deliverables]);
      expect([1, 2, 3, 4, 5, 6].map((c) => ws.getCell(h + 1, c).value)).toEqual(["田中", "帳票", 5.25, 20, RANGE_LABELS[lang].status.done, "out/a.xlsx\n帳票 v2"]);
      expect(ws.getCell(h + 1, 3).numFmt).toBe("0.0");
      expect(ws.getCell(h + 1, 6).alignment).toMatchObject({ wrapText: true });
      expect(ws.getCell(h + 2, 6).value).toBeNull();
      expect(ws.getCell(h + 4, 1).value).toBe(RANGE_LABELS[lang].week.note);   // one blank row before it
    }
  });

  it("no 案件 in the week: the header, then the no-task line", async () => {
    const ws = await sheet(latest(FULL, { tasks: [] }));
    expect(ws.getCell(rowOf(ws, "依頼元") + 1, 1).value).toBe("該当する案件なし");
  });

  it("A4 landscape, one page wide, no gridlines", async () => {
    const ws = await sheet(FULL);
    expect(ws.views[0]).toMatchObject({ showGridLines: false });
    expect(ws.pageSetup).toMatchObject({ orientation: "landscape", fitToWidth: 1, fitToHeight: 0 });
  });
});

describe("週次一覧", () => {
  it("newest week first, formal headers, oneliner (newlines as spaces) or the top 案件 as fallback", async () => {
    const ws = (await renderRangeSheets(latest(DATA, { oneliner: "帳票の修正を\n終えた" }), "ja", STYLE)).getWorksheet("週次一覧")!;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((c) => ws.getCell(1, c).value))
      .toEqual(["週次", "期間", "業務概要", "稼働時間（実時間）(h)", "累計作業時間 (h)", "新規案件数", "完了案件数", "主な案件"]);
    expect(ws.getCell("A2").value).toBe("2026-W41");
    expect(ws.getCell("C2").value).toBe("帳票の修正を 終えた");
    expect(ws.getCell("C3").value).toBe("帳票、画面");
    expect(ws.getCell("D2").numFmt).toBe("0.0");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1, showGridLines: false });
    expect(ws.pageSetup).toMatchObject({ orientation: "landscape", fitToWidth: 1, fitToHeight: 0 });
  });

  it("en: the fallback joins with \", \"", async () => {
    const ws = (await renderRangeSheets(DATA, "en", STYLE)).getWorksheet("Weekly Summary")!;
    expect(ws.getCell("C3").value).toBe("帳票, 画面");
  });
});

describe("案件一覧", () => {
  it("header, localized status, dates as dates, hours, deliverables one per line; the hour note below", async () => {
    const ws = (await renderRangeSheets(FULL, "en", STYLE)).getWorksheet("Task List")!;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => ws.getCell(1, c).value))
      .toEqual(["Requester", "Task", "Project", "Status", "Date Received", "Date Completed", "Hours in Period (h)", "Total Hours to Date (h)", "Deliverables"]);
    expect(ws.getCell("D2").value).toBe("Done");
    expect(ws.getCell("E2").value).toEqual(new Date("2026-09-01T00:00:00Z")); expect(ws.getCell("E2").numFmt).toBe("yyyy-mm-dd");
    expect(ws.getCell("F3").value).toBeNull();
    expect(ws.getCell("G2").numFmt).toBe("0.0");
    expect(ws.getCell("I2").value).toBe("out/a.xlsx\nout/b.pdf");
    expect(ws.getCell("H2").numFmt).toBe("0.0");
    expect(ws.getCell("A5").value).toBe(RANGE_LABELS.en.tasks.note);
    expect(ws.getCell("A6").value).toBeNull();   // no hand value: no footnote
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1, showGridLines: false });
  });

  it("a hand-entered 通算 keeps its number, carries the mark in its format and gets the footnote", async () => {
    const d: RangeData = { ...FULL, tasks: [{ ...TASKS[0], total_manual: true, total_hours: 10 }, TASKS[1]] };
    for (const [lang, fmt] of [["ja", '0.0"※"'], ["en", '0.0"*"']] as const) {
      const ws = (await renderRangeSheets(d, lang, STYLE)).getWorksheet(RANGE_LABELS[lang].sheet.tasks)!;
      expect([ws.getCell("H2").value, ws.getCell("H2").numFmt, ws.getCell("H3").numFmt]).toEqual([10, fmt, "0.0"]);
      expect(ws.getCell("A6").value).toBe(RANGE_LABELS[lang].tasks.manualNote);
    }
  });

  it("no 案件 in the range: the header, then the no-task line", async () => {
    const ws = (await renderRangeSheets(DATA, "ja", STYLE)).getWorksheet("案件一覧")!;
    expect(ws.getCell("A2").value).toBe(RANGE_LABELS.ja.tasks.none);
  });
});

describe("データ and the charts", () => {
  it("データ: oldest first, one column per series, then totals / counts / cost", async () => {
    const ws = (await renderRangeSheets(DATA, "ja", STYLE)).getWorksheet("データ")!;
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => ws.getCell(1, c).value))
      .toEqual(["週次", "期間", "田中", "未紐付", "稼働時間（実時間）(h)", "累計作業時間 (h)", "新規案件数", "完了案件数", "完了案件数（累計）", "AI 利用費用 (USD)", "トークン数"]);
    expect([ws.getCell("A2").value, ws.getCell("C2").value, ws.getCell("I3").value]).toEqual(["2026-W40", 6, 3]);
  });

  it("the first two charts on 表紙・概要 reference データ", async () => {
    const z = await JSZip.loadAsync(await renderRangeXlsx(DATA, "ja", STYLE));
    const c1 = await z.file("xl/charts/chart1.xml")!.async("string"), c2 = await z.file("xl/charts/chart2.xml")!.async("string");
    expect(c1).toContain("<c:f>'データ'!$C$2:$C$3</c:f>");
    expect(c1).toContain("週別稼働時間（依頼元別）");
    expect(c2).toContain("<c:lineChart>");
  });

  it("four charts: stacked hours, new/done + cumulative line, requester doughnut, weekly cost", async () => {
    const z = await JSZip.loadAsync(await renderRangeXlsx(FULL, "ja", STYLE));
    const c = await Promise.all([1, 2, 3, 4].map((i) => z.file(`xl/charts/chart${i}.xml`)!.async("string")));
    expect(c[0]).toContain('<c:grouping val="stacked"/>');
    expect(c[1]).toContain("<c:lineChart>");
    expect(c[2]).toContain("<c:doughnutChart>"); expect(c[2]).toContain("<c:f>'データ'!$B$7:$B$8</c:f>");   // share block: weeks end row 3, block head row 6
    expect(c[3]).toContain("<c:f>'データ'!$J$2:$J$3</c:f>");                                             // cost column (3 + 2 series + 5)
    expect(z.file("xl/charts/chart8.xml")).toBeNull();   // 4 on 表紙・概要 + 3 on 当週業務内容
  });

  it("charts are anchored below the KPI table (never charts first), two per band, under the 推移グラフ heading", async () => {
    const wb = await renderRangeSheets(FULL, "ja", STYLE);
    const ws = wb.getWorksheet("表紙・概要")!, head = rowOf(ws, "推移グラフ");   // 1-based; anchors are 0-based
    const dr = await (await JSZip.loadAsync(await renderRangeXlsx(FULL, "ja", STYLE))).file("xl/drawings/drawing1.xml")!.async("string");
    const froms = [...dr.matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(froms).toEqual([[0, head], [8, head], [0, froms[2][1]], [8, froms[2][1]]]);
    const tos = [...dr.matchAll(/<xdr:to><xdr:col>(\d+)<\/xdr:col>/g)].map((m) => Number(m[1]));
    expect(tos).toEqual([7, 15, 7, 15]);   // both charts 7 columns wide (all columns are 10)
    expect(froms[2][1]).toBeGreaterThan(head + 18);
    expect(head).toBeGreaterThan(rowOf(ws, "指標") + 5);
  });

  it("a range with no hours: one stand-in series, a one-point doughnut — no empty chart", async () => {
    const empty: RangeData = { ...FULL, series_keys: [], series: [], share: [], weeks: FULL.weeks.map((w) => ({ ...w, hours: 0, by_series: [] })), tasks: [] };
    const z = await JSZip.loadAsync(await renderRangeXlsx(empty, "ja", STYLE));
    expect(await z.file("xl/charts/chart1.xml")!.async("string")).toContain("<c:ser>");
    const c3 = await z.file("xl/charts/chart3.xml")!.async("string");
    expect(c3.match(/<c:dPt>/g)).toHaveLength(1);
    expect(c3).toContain("<c:f>'データ'!$B$7:$B$7</c:f>");
  });

  it("a requester really named like a reserved label keeps the suffix in the legend", async () => {
    const d: RangeData = { ...FULL, series_keys: ["その他の依頼元", UNLINKED], series: ["その他の依頼元（依頼元）", "未紐付"] };
    const c1 = await (await JSZip.loadAsync(await renderRangeXlsx(d, "ja", STYLE))).file("xl/charts/chart1.xml")!.async("string");
    expect(c1).toContain("<c:v>その他の依頼元（依頼元）</c:v>");
  });
});

describe("本周日别 (the last week day by day)", () => {
  const dataSheet = async (lang: "ja" | "zh" | "en" = "ja") => (await renderRangeSheets(FULL, lang, STYLE)).getWorksheet(RANGE_LABELS[lang].sheet.data)!;

  it("データ: a day block under the share block — date, M/D (weekday), hours, one column per series and per 案件, start / end / span as clock time", async () => {
    const ws = await dataSheet(), head = rowOf(ws, "当週の日別"), h = head + 1;
    expect(head).toBeGreaterThan(8);   // share block ends on row 8
    expect(Array.from({ length: 11 }, (_, i) => ws.getCell(h, i + 1).value))
      .toEqual(["日付", "曜日", "稼働時間（実時間）(h)", "田中", "未紐付", "帳票", "その他の案件", "未紐付（案件）", "開始時刻", "終了時刻", "稼働幅"]);
    expect(columnA(ws, h + 1, h + 7).map((v) => (v as Date).toISOString().slice(0, 10)))
      .toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(ws.getCell(h + 1, 1).numFmt).toBe("yyyy-mm-dd");
    expect(Array.from({ length: 7 }, (_, i) => ws.getCell(h + 1 + i, 2).value)).toEqual(["10/3 (土)", "10/4 (日)", "10/5 (月)", "10/6 (火)", "10/7 (水)", "10/8 (木)", "10/9 (金)"]);
    expect([3, 4, 5, 6, 7, 8].map((c) => ws.getCell(h + 3, c).value)).toEqual([1.5, 1, 0.5, 0.5, 0.5, 0.5]);
    // Tue 22:00 → 25:30: fractions of a day, shown [h]:mm; the span is end − start.
    expect([9, 10, 11].map((c) => ws.getCell(h + 4, c).value)).toEqual([22 / 24, 25.5 / 24, 3.5 / 24]);
    expect([9, 10, 11].map((c) => ws.getCell(h + 4, c).numFmt)).toEqual(["[h]:mm", "[h]:mm", "[h]:mm"]);
    expect([9, 10, 11].map((c) => ws.getCell(h + 2, c).value)).toEqual([null, null, null]);   // no work: blank
  });

  it("weekday names per language", async () => {
    expect((await dataSheet("zh")).getCell(rowOf(await dataSheet("zh"), "本周日别") + 2, 2).value).toBe("10/3 (六)");
    expect((await dataSheet("en")).getCell(rowOf(await dataSheet("en"), "This Week by Day") + 2, 2).value).toBe("10/3 (Sat)");
  });

  it("当週業務内容: the 本周日别 heading after the 案件 table's note, three basis notes under the charts", async () => {
    for (const lang of ["ja", "zh", "en"] as const) {
      const L = RANGE_LABELS[lang], ws = (await renderRangeSheets(FULL, lang, STYLE)).getWorksheet(L.sheet.week)!;
      const head = rowOf(ws, L.week.days);
      expect(head).toBeGreaterThan(rowOf(ws, L.week.note));
      const notes: string[] = [];
      ws.eachRow((row, r) => { if (r > head) row.eachCell((c) => { if (c.master.address === c.address && typeof c.value === "string") notes.push(c.value); }); });
      expect(notes, lang).toHaveLength(3);
      expect(notes[0]).toContain(L.week.dayCharts.series.basis.slice(0, 8));
      expect(notes[1]).toContain(`${L.otherTask}`);
    }
  });

  it("the xlsx: 当週業務内容 has a drawing with three charts (by 依頼元, by 案件, start / end) that read データ's day block", async () => {
    const z = await JSZip.loadAsync(await renderRangeXlsx(FULL, "ja", STYLE));
    const sheet2 = await z.file("xl/worksheets/sheet2.xml")!.async("string");
    expect(sheet2).toContain("<drawing ");
    const rels = await z.file("xl/worksheets/_rels/sheet2.xml.rels")!.async("string");
    const drawing = /Target="\.\.\/drawings\/(drawing\d+\.xml)"/.exec(rels)![1];
    const dr = await z.file(`xl/drawings/${drawing}`)!.async("string");
    expect(dr.match(/<xdr:twoCellAnchor /g)).toHaveLength(3);
    const ws = (await renderRangeSheets(FULL, "ja", STYLE)).getWorksheet("当週業務内容")!, head = rowOf(ws, "当週の日別");
    const froms = [...dr.matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(froms).toEqual([[0, head], [5, head], [0, froms[2][1]]]);   // A–D | F, then A–D
    expect(froms[2][1]).toBeGreaterThan(head + 18);
    expect([...dr.matchAll(/<xdr:to><xdr:col>(\d+)<\/xdr:col>/g)].map((m) => Number(m[1]))).toEqual([4, 6, 4]);

    const c = await Promise.all([5, 6, 7].map((i) => z.file(`xl/charts/chart${i}.xml`)!.async("string")));
    const dh = rowOf((await renderRangeSheets(FULL, "ja", STYLE)).getWorksheet("データ")!, "当週の日別") + 1;
    const rows = `$${dh + 1}:$`;
    expect(c[0]).toContain("日別稼働時間（依頼元別）"); expect(c[0]).toContain('<c:grouping val="stacked"/>');
    expect(c[0]).toContain(`<c:f>'データ'!$B$${dh + 1}:$B$${dh + 7}</c:f>`);            // categories: M/D (曜)
    expect(c[0]).toContain(`<c:f>'データ'!$D${rows}D$${dh + 7}</c:f>`);
    expect(c[0]).toContain("<c:v>10/3 (土)</c:v>");
    expect(c[0]).toContain(`<a:srgbClr val="${STYLE.series[0]}"/>`); expect(c[0]).toContain(`<a:srgbClr val="${STYLE.series[7]}"/>`);
    expect(c[1]).toContain("日別稼働時間（案件別）");
    expect(c[1]).toContain('<a:srgbClr val="B5482A"/>'); expect(c[1]).toContain(`<a:srgbClr val="${STYLE.series[6]}"/>`); expect(c[1]).toContain(`<a:srgbClr val="${STYLE.series[7]}"/>`);
    expect(c[1]).toContain(`<c:f>'データ'!$F${rows}F$${dh + 7}</c:f>`);
    expect(c[2]).toContain("日別の開始・終了時刻");
    expect(c[2]).toContain("<a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative");
    expect(c[2]).toContain(`<a:srgbClr val="${STYLE.accent}"/>`);
    expect(c[2]).toContain('<c:numFmt formatCode="[h]:mm" sourceLinked="0"/>');
    expect(c[2]).toContain(`<c:f>'データ'!$I${rows}I$${dh + 7}</c:f>`); expect(c[2]).toContain(`<c:f>'データ'!$K${rows}K$${dh + 7}</c:f>`);
    expect(c[2]).toContain(`<c:pt idx="3"><c:v>${22 / 24}</c:v></c:pt>`);                   // Tue start, a fraction of a day
    expect(c[2]).toContain('<c:pt idx="1"><c:v>0</c:v></c:pt>');                              // Sun: no bar
    // Clock axis on 3-hour lines from 05:00 (05, 08 … 26): up to the first line at or above the latest end (25:30 → 26:00).
    expect(c[2]).toContain(`<c:scaling><c:orientation val="minMax"/><c:max val="${26 / 24}"/><c:min val="${5 / 24}"/></c:scaling>`);
    expect(c[2]).toContain(`<c:majorUnit val="${3 / 24}"/>`);
    expect(c[1]).toContain("<c:v>未紐付（案件）</c:v>");
  });

  it("the 案件 unlinked column is told apart from the 依頼元 one in every language", async () => {
    for (const [lang, want] of [["ja", "未紐付（案件）"], ["zh", "未关联（案件）"], ["en", "Unlinked (tasks)"]] as const) {
      const L = RANGE_LABELS[lang], d: RangeData = { ...FULL, series: ["田中", L.unassigned], day_tasks: FULL.day_tasks.map((t) => ({ ...t, label: t.key === UNLINKED ? L.unassigned : t.label })) };
      const ws = (await renderRangeSheets(d, lang, STYLE)).getWorksheet(L.sheet.data)!, h = rowOf(ws, L.data.days) + 1;
      expect([5, 8].map((c) => ws.getCell(h, c).value), lang).toEqual([L.unassigned, want]);
    }
  });

  it("a long 案件 title is cut to 16 characters + … in データ's header and the legend (案件一覧 keeps it whole)", async () => {
    const long = "とても長い案件名ですとても長い案件名です";   // 20 characters
    const d: RangeData = { ...FULL, day_tasks: [{ ...FULL.day_tasks[0], label: long }, ...FULL.day_tasks.slice(1)] };
    const ws = (await renderRangeSheets(d, "ja", STYLE)).getWorksheet("データ")!;
    expect(ws.getCell(rowOf(ws, "当週の日別") + 1, 6).value).toBe(`${long.slice(0, 16)}…`);
    const c6 = await (await JSZip.loadAsync(await renderRangeXlsx(d, "ja", STYLE))).file("xl/charts/chart6.xml")!.async("string");
    expect(c6).toContain(`<c:v>${long.slice(0, 16)}…</c:v>`);
    expect(c6).not.toContain(long);
    const short = "ちょうど十六文字の案件名ですよね";   // exactly 16: kept
    const ws2 = (await renderRangeSheets({ ...FULL, day_tasks: [{ ...FULL.day_tasks[0], label: short }, ...FULL.day_tasks.slice(1)] }, "ja", STYLE)).getWorksheet("データ")!;
    expect(ws2.getCell(rowOf(ws2, "当週の日別") + 1, 6).value).toBe(short);
  });

  it("the cover's guide to 当週業務内容 mentions the day-by-day charts", () => {
    expect(RANGE_LABELS.ja.cover.guideRows.week).toContain("日別の稼働");
    expect(RANGE_LABELS.zh.cover.guideRows.week).toContain("每日工作情况");
    expect(RANGE_LABELS.en.cover.guideRows.week).toContain("day-by-day hours");
  });

  it("a week with no 案件 and no series: stand-in hours series, the charts are never empty", async () => {
    const empty: RangeData = { ...FULL, series_keys: [], series: [], share: [], day_tasks: [],
      weeks: FULL.weeks.map((w) => ({ ...w, hours: 0, by_series: [] })),
      days: FULL.days.map((d) => ({ ...d, hours: 0, by_series: [], by_task: [], start: null, end: null })) };
    const z = await JSZip.loadAsync(await renderRangeXlsx(empty, "ja", STYLE));
    for (const i of [5, 6, 7]) expect(await z.file(`xl/charts/chart${i}.xml`)!.async("string")).toContain("<c:ser>");
  });
});

describe("row heights of wrapped cells (Excel never sizes a merged row)", () => {
  // ② width 140: the first estimate (×1.1) gave these two 1 line — 127 units → 139.7, 120 → 132 — and Excel wrapped them.
  const text = (u: number) => "あ".repeat(Math.floor(u / 2)) + "a".repeat(u % 2);
  it("a line near the full width gets a second line", () => {
    expect(linesOf(text(127), 140, 10)).toBe(2);
    expect(linesOf(text(120), 140, 10)).toBe(2);
    expect(linesOf(text(100), 140, 10)).toBe(2);   // 125 of 140 = 89 % full: a spare line
  });
  it("short lines stay one line; each newline starts a line", () => {
    expect(linesOf(text(60), 140, 10)).toBe(1);
    expect(linesOf(`${text(60)}\n${text(60)}`, 140, 10)).toBe(2);
  });
  it("② sizes a long digest row for two lines or more", async () => {
    const line = `■ ${text(240)}`;   // wider than ②'s 250-unit columns (user's widths, 10/13) once the margin applies
    const ws = (await renderRangeSheets(latest(FULL, { digest_text: line }), "ja", STYLE)).getWorksheet("当週業務内容")!;
    expect(ws.getRow(rowOf(ws, line)).height).toBeGreaterThanOrEqual(2 * 10 * 1.6);
  });
});
