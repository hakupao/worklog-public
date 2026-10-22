// server/test/report-pdf-html.test.ts
import { describe, expect, it } from "vitest";
import { dayLines, hoursText, pdfDataOf } from "../src/report/pdf/data";
import { FIT_STEPS, GROW_STEPS, renderReportHtml, spaceMixed } from "../src/report/pdf/html";
import type { DigestOut, TaskLike, WeekData } from "../src/report/types";
import { PDF_FIXTURES } from "./fixtures/pdf-data";

const DATES = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const t = (id: string, title: string, requester = "田中"): TaskLike => ({ id, requester, project: "", title, status: "open",
  received_at: "2026-09-28", done_at: null, thinking: "", deliverables: [], hours_manual: null });
const dg = (text: string): DigestOut => ({ text, pdf_text: null, edited: false, stale: false, updated_at: "2026-10-02T00:00:00Z" });
const week = (taskMinutes: number[], dayMinutes: number[]): WeekData => ({
  tasks: taskMinutes.map((m, i) => ({ task: t(`T${i}`, `案件${i}`), hours: 0, week_minutes: m, sessions: [] })),
  days: [], dates: DATES, day_minutes: DATES.map((d, i) => [d, dayMinutes[i]]), day_sum_minutes: DATES.map((d, i) => [d, dayMinutes[i]]), day_buckets: {},
  summary: { week: "2026-W40", week_start: DATES[0], week_end: DATES[6], new: 0, done: 0, ongoing: 0, by_requester: [], total_hours: 0, unassigned_hours: 0 },
  unassigned_sessions: 0, unassigned_minutes: 0,
});
const O = { lang: "ja" as const, issued: "2026-10-08", name: "Jordan Smith" };

describe("pdfDataOf", () => {
  it("sorts tasks by minutes, adds the unassigned remainder as a row, counts real tasks only", () => {
    const d = pdfDataOf(week([0, 120, 300], [0, 0, 300, 160, 0, 0, 0]), { week: dg("週"), days: { "2026-09-28": dg("日") } }, O);
    expect(d.tasks).toEqual([
      { title: "案件2", requester: "田中", minutes: 300 }, { title: "案件1", requester: "田中", minutes: 120 },
      { title: "その他・調査", requester: "", minutes: 40 },
    ]);
    expect(d.taskCount).toBe(2);
    expect(d.totalMinutes).toBe(460);
    expect(d.summary).toEqual(["週"]);
    // the day digest is not the day line: no day rows here, so no line
    expect(d.days.map((x) => x.text)).toEqual([[], [], [], [], [], [], []]);
  });

  it("dayLines: each day names every 案件 worked by its プロジェクト with that day's wall-clock hours, most first; 未関連 by its label; 0h left out", () => {
    const w = week([0, 0], [0, 0, 380, 2, 0, 0, 0]);
    w.tasks[0].task.project = "ATLAS"; w.tasks[1].task.project = "";   // no プロジェクト: the title stands in
    // the day's wall-clock buckets, unrounded ("" = 未関連): ten 0.4-minute shares still add up
    w.day_buckets = { "2026-09-28": { T0: 225.5, T1: 120, "": 30 }, "2026-09-29": { T1: 2 } };
    for (let i = 0; i < 10; i++) w.day_buckets["2026-09-28"].T0 += 0.45;
    const l = dayLines(w, "ja");
    expect(l["2026-09-28"]).toEqual(["ATLAS 3.8h · 案件1 2.0h · その他・調査 0.5h"]);
    expect(l["2026-09-29"]).toEqual([]);   // 2 minutes show as 0h
    expect(l["2026-09-26"]).toEqual([]);
    // folded (a composed sheet): one その他 entry, after the named ones
    expect(dayLines(w, "zh", new Set(["T1", "__unassigned"]))["2026-09-28"]).toEqual(["ATLAS 3.8h · 其他 2.5h"]);
    expect(pdfDataOf(w, { week: null, days: {} }, O).days[2].text).toEqual(["ATLAS 3.8h · 案件1 2.0h · その他・調査 0.5h"]);
  });

  it("no unassigned row under half a minute (float residue)", () => {
    expect(pdfDataOf(week([60.2], [0, 0, 60.4, 0, 0, 0, 0]), { week: null, days: {} }, O).tasks).toHaveLength(1);
  });

  it("an empty week: no tasks, zero total, no digests", () => {
    const d = pdfDataOf(week([], [0, 0, 0, 0, 0, 0, 0]), { week: null, days: {} }, O);
    expect([d.tasks, d.taskCount, d.totalMinutes, d.summary]).toEqual([[], 0, 0, []]);
  });

  it("hoursText", () => {
    expect([0, 2, 3, 90, 545.9].map(hoursText)).toEqual(["0h", "0h", "0.1h", "1.5h", "9.1h"]);
  });
});

describe("renderReportHtml", () => {
  const html = (k: string) => renderReportHtml(PDF_FIXTURES[k]);
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  it("ja: title, period, name, issue date, 7 day rows, weekend rows marked off, labels vertical", () => {
    const h = html("ja-w40");
    expect(h).toContain('<html lang="ja">');
    expect(h).toContain("週次作業報告書");
    expect(h).toContain("2026.09.26（土）〜 10.02（金）");
    expect(h).toContain("2026年 第40週");
    expect(h).toContain("発行 2026.10.08");
    expect(h).toContain("Jordan Smith");
    expect(count(h, /class="day( off)?"/g)).toBe(7);
    expect(count(h, /class="day off"/g)).toBe(2);
    expect(h).not.toContain('class="k h"');
    expect(h).toContain("9/27 日</span><span>—</span>");
  });

  it("tasks: 7 shown + その他 5 件; trim variant 5 + その他 7 件; totals line", () => {
    const h = html("ja-w40");
    expect(count(h, /class="tk" data-rank="\d+"/g)).toBe(7);
    expect(h).toMatch(/class="tk rest r7"><span>その他 5 件<\/span>/);
    expect(h).toMatch(/class="tk rest r5"><span>その他 7 件<\/span>/);
    // rest hours: ranks 8..12 (60+24+18+12+6 = 120 min) and ranks 6..12 (222+114+120 = 456 min)
    expect(h).toMatch(/r7">.*?<span class="h">2\.0h<\/span>/s);
    expect(h).toMatch(/r5">.*?<span class="h">7\.6h<\/span>/s);
    expect(h).toContain("対応案件 11 件");
    expect(h).toContain("稼働 6 日");
    expect(h).toMatch(/稼働時間<b>43\.6h<\/b>/);
    // 累計 (user 10/9): under a day's hours only where it differs, and beside 稼働 in the totals line
    expect(h).toMatch(/<span class="h">8\.5h<span class="sm">累計 17\.9h<\/span><\/span>/);
    expect(h).toMatch(/<span class="h">1\.5h<\/span>/);
    expect(h).toMatch(/累計<b class="cum">69\.8h<\/b>/);
  });

  it("bars: widths relative to the section's max, never NaN", () => {
    const h = html("ja-w40");
    expect(h).toContain('<i style="width:100%"></i>');
    const e = html("empty");
    expect(e).not.toMatch(/NaN|Infinity/);
    expect(count(e, /width:0%/g)).toBe(7);
    expect(e).toContain("稼働 0 日");
    expect(e).toMatch(/稼働時間<b>0h<\/b>/);
    expect(e).toContain('<p class="lead">—</p>');
  });

  it("zh uses SC fonts and zh-Hans; en sets labels across", () => {
    const z = html("zh");
    expect(z).toContain('<html lang="zh-Hans">');
    expect(z).toContain("Noto+Serif+SC");
    expect(z).toContain("周工作报告");
    const e = html("en-long");
    expect(e).toContain('class="k h"');
    expect(e).toContain("Sat 26 Dec 2026 – Fri 1 Jan 2027");
    expect(e).toContain("2026 · Week 53");
  });

  it("escapes data text", () => {
    const h = renderReportHtml({ ...PDF_FIXTURES.empty, name: "<b>&\"x\"</b>", summary: ["a<script>b"],
      days: PDF_FIXTURES.empty.days.map((x) => ({ ...x, text: ["d<i>&\""] })),
      tasks: [{ title: "t<u>&\"", requester: "r<s>&\"", minutes: 60 }] });
    expect(h).not.toMatch(/<(i|u|s)>/);
    expect(h).toContain("t&lt;u&gt;&amp;&quot;");
    expect(h).toContain("r&lt;s&gt;&amp;&quot;");
    expect(h).toContain("d&lt;i&gt;&amp;&quot;");
    expect(h).toContain("&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;");
    expect(h).not.toContain("a<script>b");
  });

  it("carries the fit script and its steps", () => {
    const h = html("ja-w40");
    expect(h).toContain("window.__fit");
    expect(FIT_STEPS).toEqual(["fit1", "fit2", "fit3", "trim", "clamp"]);
    for (const s of FIT_STEPS) expect(h).toContain(`.${s}`);
  });

  it("en footer is singular for one task and one worked day", () => {
    const html = renderReportHtml(pdfDataOf(week([120], [0, 0, 120, 0, 0, 0, 0]), { week: null, days: {} }, { ...O, lang: "en" }));
    expect(html).toContain("1 project<");
    expect(html).toContain("1 day worked<");
  });
});

describe("S2c PDF", () => {
  it("prefers pdf_text and falls back to text; lines become blocks; a day digest is never the day line", () => {
    const d = pdfDataOf(week([120], [0, 0, 120, 0, 0, 0, 0]), {
      week: { text: "■ A：長い版", pdf_text: "■ A：短い版\n■ その他：小さな作業", edited: false, stale: false, updated_at: "" },
      days: { "2026-09-28": { text: "■ A：長い日\n■ B：別", pdf_text: null, edited: true, stale: false, updated_at: "" } },
    }, O);
    expect(d.summary).toEqual(["■ A：短い版", "■ その他：小さな作業"]);
    expect(d.days[2].text).toEqual([]);
    const h = renderReportHtml(d);
    expect(h).toMatch(/<p class="lead">■ A：短い版<\/p>\s*<p class="lead">■ その他：小さな作業<\/p>/);
  });

  it("spaceMixed puts a thin space between CJK and Latin / digits, not next to punctuation", () => {
    const T = "\u2009";
    expect(spaceMixed("ATLASの画面一覧をv2.3で提出")).toBe(`ATLAS${T}の画面一覧を${T}v2.3${T}で提出`);
    expect(spaceMixed("（ATLAS）を、LEDGER。")).toBe("（ATLAS）を、LEDGER。");
    expect(spaceMixed("20画面中8完了")).toBe(`20${T}画面中${T}8${T}完了`);
    expect(spaceMixed("plain english 12")).toBe("plain english 12");
  });

  it("data text is spaced, labels are not", () => {
    const h = renderReportHtml({ ...PDF_FIXTURES["ja-w40"], summary: ["ATLASを直した"] });
    expect(h).toContain("ATLAS\u2009を直した");
    expect(h).toContain("週次作業報告書");
  });

  it("no single-line ellipsis in the task rows; grow steps exist; requester wraps to two lines at most", () => {
    const h = renderReportHtml(PDF_FIXTURES["ja-w40"]);
    expect(h).not.toMatch(/\.tk>span:first-child\{[^}]*ellipsis/);
    for (const s of GROW_STEPS) expect(h).toContain(`.${s}`);
    expect(h).toMatch(/\.tk \.r\{[^}]*-webkit-line-clamp:2/);
  });

  it("spread: a CSS hook, a --pad variable the rows use, and a __fit step", () => {
    const h = renderReportHtml(PDF_FIXTURES["ja-w40"]);
    expect(h).toContain(".spread");
    expect(h).toMatch(/\.day\{[^}]*var\(--pad,0px\)/);
    expect(h).toMatch(/\.tk\{[^}]*var\(--pad,0px\)/);
    expect(h).toContain('used.push("spread")');
  });

  it("clamp caps rows (one .ln a day — hand-edited worst case) and each block's lines (R5); content sits in .cnt", () => {
    const h = renderReportHtml(PDF_FIXTURES["ja-w40"]);
    expect(h).toContain(".clamp .lead:nth-of-type(n+7){display:none}");
    expect(h).toContain(".clamp .day>span:nth-child(2) .ln:nth-child(n+2){display:none}");
    expect(h).toMatch(/\.clamp \.lead\{[^}]*-webkit-line-clamp:3/);
    expect(h).toMatch(/\.clamp \.ln\{[^}]*-webkit-line-clamp:2/);
    expect(h).toContain('<div class="cnt">');
    expect(h).toMatch(/<\/div>\s*<div class="foot">/);
  });
});
