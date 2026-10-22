import { describe, expect, it } from "vitest";
import { pdfDataComposed, pdfDataOf } from "../src/report/pdf/data";
import { renderReportHtml } from "../src/report/pdf/html";
import type { WeekData } from "../src/report/types";
import baseline from "./fixtures/pdf-html-baseline.json";
import { PDF_FIXTURES } from "./fixtures/pdf-data";

const dates = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
function week(tasks: Array<[string, number]>, unassigned = 0): WeekData {
  const total = tasks.reduce((a, [, m]) => a + m, 0) + unassigned;
  return {
    tasks: tasks.map(([id, m]) => ({ task: { id, title: `案件${id}`, requester: "田中" } as any, hours: m / 60, week_minutes: m, sessions: [] })),
    days: [], summary: { week: "2026-W40" } as any, dates,
    day_minutes: dates.map((d, i) => [d, i === 2 ? total : 0]), day_sum_minutes: dates.map((d, i) => [d, i === 2 ? total : 0]), day_buckets: {}, unassigned_sessions: 0, unassigned_minutes: 0,
  };
}
const O = { lang: "ja" as const, issued: "2026-10-09", name: "N" };
const T = { summary: ["■ 案件B：進んだ"], days: { "2026-09-28": ["B を進めた"] } };

describe("pdfDataComposed", () => {
  it("show rows in selection order, one composed その他 = other + hide minutes, totals unchanged", () => {
    const d = pdfDataComposed(week([["A", 300], ["B", 60], ["C", 30], ["D", 12]]),
      [{ id: "B", mode: "show" }, { id: "A", mode: "show" }, { id: "C", mode: "other" }, { id: "D", mode: "hide" }], T, O);
    expect(d.tasks.map((t) => [t.title, t.minutes, t.rest])).toEqual([["案件B", 60, undefined], ["案件A", 300, undefined], ["", 42, 2]]);
    expect(d.totalMinutes).toBe(402);
    expect(d.taskCount).toBe(4);
    expect(d.summary).toEqual(["■ 案件B：進んだ"]);
    // the composer's day text is not the day line: it is built from the day rows (none here)
    expect(d.days.find((x) => x.date === "2026-09-28")!.text).toEqual([]);
    expect(d.days.find((x) => x.date === "2026-09-26")!.text).toEqual([]);
  });

  it("day lines: shown 案件 by name, other + hide (and a folded 未関連) in one その他 entry", () => {
    const w = week([["A", 300], ["B", 60], ["C", 30]], 30);
    w.tasks.forEach((r) => { r.task.project = `P${r.task.id}`; });
    w.day_buckets = { "2026-09-28": { A: 300, B: 60, C: 30, "": 30 } };
    const d = pdfDataComposed(w, [{ id: "B", mode: "show" }, { id: "A", mode: "show" }, { id: "C", mode: "hide" }, { id: "__unassigned", mode: "other" }], T, O);
    expect(d.days.find((x) => x.date === "2026-09-28")!.text).toEqual(["PA 5.0h · PB 1.0h · その他 1.0h"]);
  });

  it("no other / hide → no composed row", () => {
    const d = pdfDataComposed(week([["A", 60]]), [{ id: "A", mode: "show" }], T, O);
    expect(d.tasks.some((t) => t.rest !== undefined)).toBe(false);
  });

  it("ids no longer worked are ignored; 未関連 can be folded", () => {
    const d = pdfDataComposed(week([["A", 60]], 30),
      [{ id: "A", mode: "show" }, { id: "GONE", mode: "other" }, { id: "__unassigned", mode: "other" }], T, O);
    expect(d.tasks.map((t) => [t.minutes, t.rest])).toEqual([[60, undefined], [30, 1]]);
  });
});

describe("renderReportHtml with a composed その他", () => {
  const ids = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
  it("merges overflow into the composed その他: one row, count = overflow + folded", () => {
    const d = pdfDataComposed(week(ids.map((id, i) => [id, 100 - i]), 0),
      [...ids.slice(0, 8).map((id) => ({ id, mode: "show" as const })), { id: "I", mode: "other" as const }], T, O);
    const html = renderReportHtml(d);
    expect((html.match(/class="tk rest r7"/g) ?? []).length).toBe(1);
    expect(html).toContain("その他 2 件");     // H (8th show) + I (other)
    expect(html).toContain("その他 4 件");     // trim: F G H + I
    expect((html.match(/class="tk" data-rank/g) ?? []).length).toBe(7);
  });

  it("a composed その他 row bigger than the largest 案件 draws a full bar, never over 100%", () => {
    // trim row r5 = shown 6..8 (3 × 50) + folded (100) = 250 min against a 100-min largest 案件
    const t = ids.slice(0, 8).map((id, i): [string, number] => [id, i < 5 ? 100 : 50]);
    const d = pdfDataComposed(week([...t, ["I", 100]]), [...ids.slice(0, 8).map((id) => ({ id, mode: "show" as const })), { id: "I", mode: "other" as const }], T, O);
    const widths = [...renderReportHtml(d).matchAll(/tk rest r5[^\n]*?width:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths).toEqual([100]);
  });

  it("no empty その他 row when the folded group is empty", () => {
    const d = pdfDataComposed(week([["A", 60], ["B", 30]]), [{ id: "A", mode: "show" }, { id: "B", mode: "show" }], T, O);
    expect(renderReportHtml(d)).not.toContain("その他 0 件");
    expect(renderReportHtml(d)).not.toContain("tk rest");
  });

  it("a composed row folding 0 案件 / 0 minutes prints no その他 row", () => {
    const d = pdfDataComposed(week([["A", 60]]), [{ id: "A", mode: "show" }], T, O);
    d.tasks.push({ title: "", requester: "", minutes: 0, rest: 0 });
    const html = renderReportHtml(d);
    expect(html).not.toContain("その他 0 件");
    expect(html).not.toContain("tk rest");
  });

  it("a week without composition renders exactly as before (pdfDataOf path untouched)", () => {
    const wk = week(ids.map((id, i) => [id, 100 - i]), 20);
    const digests = { week: { text: "今週", pdf_text: null, edited: false, stale: false, updated_at: "x" }, days: {} };
    const html = renderReportHtml(pdfDataOf(wk, digests as any, O));
    expect(html).toContain("その他 3 件");   // rows 8..10 (9 tasks + 未関連 = 10 rows)
    expect(html).toContain("その他 5 件");   // trim
  });

  it("byte-for-byte: every un-composed fixture renders as the pre-change baseline", () => {
    const names = Object.keys(PDF_FIXTURES).sort();
    expect(names).toEqual(Object.keys(baseline).sort());
    for (const k of names) expect(renderReportHtml(PDF_FIXTURES[k]) === (baseline as Record<string, string>)[k], k).toBe(true);
  });
});

describe("composed renders: a hidden or cut summary line counts as overflow", () => {
  const d = () => pdfDataComposed(week([["A", 60], ["B", 30]]), [{ id: "A", mode: "show" }, { id: "B", mode: "show" }],
    { summary: ["■ 案件A：x", "■ 案件B：y"], days: {} }, O);
  /** Runs the page's scripts against a stand-in DOM: the base __fit always fits; `leads` are the .lead elements. */
  function fitWith(html: string, leads: Array<{ rects: number; scrollHeight: number; clientHeight: number }>) {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const el = { clientHeight: 1000, scrollHeight: 1000, classList: { add() {}, remove() {}, contains: () => false }, style: { setProperty() {}, removeProperty() {} },
      getBoundingClientRect: () => ({ height: 900 }), getClientRects: () => [1] };
    const document = {
      querySelector: () => el,
      querySelectorAll: (sel: string) => (sel === ".lead" ? leads.map((l) => ({ getClientRects: () => Array(l.rects), scrollHeight: l.scrollHeight, clientHeight: l.clientHeight })) : []),
      fonts: { forEach() {} },
    };
    const window: Record<string, any> = {};
    const getComputedStyle = () => ({ paddingTop: "0", paddingBottom: "0" });
    for (const src of scripts) new Function("window", "document", "getComputedStyle", src)(window, document, getComputedStyle);
    return window.__fit();
  }
  it("composed HTML adds the check; every line visible and whole → not over", () => {
    expect(d().composed).toBe(true);
    const r = fitWith(renderReportHtml(d()), [{ rects: 1, scrollHeight: 40, clientHeight: 40 }, { rects: 1, scrollHeight: 40, clientHeight: 40 }]);
    expect(r.over).toBe(false);
  });
  it("a summary line not displayed (clamp's 7th on) → over", () => {
    const r = fitWith(renderReportHtml(d()), [{ rects: 1, scrollHeight: 40, clientHeight: 40 }, { rects: 0, scrollHeight: 0, clientHeight: 0 }]);
    expect(r).toMatchObject({ over: true, hiddenLines: 1 });
  });
  it("a summary line cut by the line clamp → over", () => {
    const r = fitWith(renderReportHtml(d()), [{ rects: 1, scrollHeight: 120, clientHeight: 80 }]);
    expect(r.over).toBe(true);
  });
  it("an un-composed render has no such check (its HTML stays the baseline)", () => {
    const html = renderReportHtml(pdfDataOf(week([["A", 60]]), { week: null, days: {} }, O));
    expect(fitWith(html, [{ rects: 0, scrollHeight: 0, clientHeight: 0 }]).over).toBe(false);
  });
});
