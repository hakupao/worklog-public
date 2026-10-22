import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { RANGE_LABELS } from "../src/report/range/labels";
import { MAX_WEEKS, loadRange, rangeWeeks } from "../src/report/range/data";
import { OTHER, UNLINKED } from "../src/report/range/series";
import { LINE_PALETTE, hashLineColor, inkOf } from "../src/badge/palette";
import { buildWeek } from "../src/report/weekly";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const session = (id: string, started_at: string, ended_at: string, task_id: string | null, over: Record<string, unknown> = {}) => ({
  id, machine: "macmini", agent: "claude-code", session_id: `${id}-full`, cwd: "/w", started_at, ended_at,
  active_minutes: Math.round((Date.parse(ended_at) - Date.parse(started_at)) / 60000), turns: 3, summary: `s ${id}`,
  summary_source: "llm", task_id, link_method: task_id ? "auto-dir" : "none", ts: started_at, ...over });
// Every seed write must land: a silently rejected row would make the parity test pass on zeros.
const ok = async (r: Promise<Response>) => { const res = await r; expect(res.status, await res.clone().text()).toBe(200); };
const ingest = (sessions: unknown[]) => ok(api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions }) }));
const putTask = (id: string, over: Record<string, unknown> = {}) => ok(api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({
  requester: "田中", title: `件名 ${id}`, status: "open", received_at: "2026-09-01", machine: "macmini", ts: "2026-09-01T09:00:00", ...over }) }));
const putNote = (id: string, ts: string, over: Record<string, unknown> = {}) => ok(api(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify({
  text: `メモ ${id}`, task_id: null, minutes: null, machine: "macmini", ts, ...over }) }));
const WEEKS = ["2026-W38", "2026-W39", "2026-W40", "2026-W41"];   // Sat 09-12 … Fri 10-09

async function seed() {
  await putTask("T1", { received_at: "2026-09-14" });
  await putTask("T2", { requester: "鈴木、佐藤", received_at: "2026-09-22", status: "done", done_at: "2026-10-01" });
  await putTask("T3", { requester: "x", received_at: "2026-10-05" });
  await db().prepare("UPDATE tasks SET requester = '' WHERE id = 'T3'").run();   // the API refuses a blank 依頼元; old rows can hold one
  await ingest([
    session("S1", "2026-09-15T01:00:00Z", "2026-09-15T03:00:00Z", "T1"),
    session("S2", "2026-09-15T02:30:00Z", "2026-09-15T04:00:00Z", "T2"),                   // overlaps S1 by 30 min: wall splits it
    // Fri 09-25 23:30 JST → Sat 09-26 06:30 JST: crosses the Saturday 05:00 week boundary (W39 → W40)
    session("S3", "2026-09-25T14:30:00Z", "2026-09-25T21:30:00Z", "T2", { active_intervals: [["2026-09-25T14:30:00Z", "2026-09-25T21:30:00Z"]] }),
    session("S4", "2026-10-06T01:00:00Z", "2026-10-06T02:00:00Z", null, { tokens: { by_model: { m: { input: 10, output: 5, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, reasoning: 0 } }, subagent: {}, cost_usd: 2, cost_partial: false } }),
    session("S5", "2026-10-07T01:00:00Z", "2026-10-07T01:30:00Z", "T3"),
  ]);
  await db().prepare("UPDATE sessions SET minutes_override = 90 WHERE id = 'S5'").run();   // overridden: whole minutes, outside the sweep
  expect((await db().prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>())!.n).toBe(5);
  await putNote("N1", "2026-09-30T10:00:00", { task_id: "T1", minutes: 45 });
}

describe("rangeWeeks", () => {
  it("lists report weeks from → to inclusive", () => {
    expect(rangeWeeks("2026-W39", "2026-W41")).toEqual(["2026-W39", "2026-W40", "2026-W41"]);
    expect(rangeWeeks("2026-W41", "2026-W41")).toEqual(["2026-W41"]);
  });
  it("lists report weeks across New Year, W53 included", () => {
    expect(rangeWeeks("2026-W52", "2027-W01")).toEqual(["2026-W52", "2026-W53", "2027-W01"]);
  });
  it("null for a malformed week or from after to", () => {
    expect(rangeWeeks("2026-41", "2026-W41")).toBeNull();
    expect(rangeWeeks("2026-W41", "2026-W40")).toBeNull();
  });

  it("stops after MAX_WEEKS + 1 weeks (a backstop: the route refuses longer ranges before walking them)", () => {
    const w = rangeWeeks("1000-W01", "9999-W52")!;
    expect(w.length).toBe(MAX_WEEKS + 1);
    expect(w[0]).toBe("1000-W01");
  });
});

describe("loadRange", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("every week of the range equals buildWeek's summary (hours, 累計, new, done)", async () => {
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    for (const w of r.weeks) {
      const one = (await buildWeek(db(), w.week))!;
      const sum = Math.round(one.day_sum_minutes.reduce((a, [, m]) => a + m, 0) / 60 * 100) / 100;
      expect({ week: w.week, hours: w.hours, sum: w.sum_hours, new: w.new, done: w.done })
        .toEqual({ week: w.week, hours: one.summary.total_hours, sum, new: one.summary.new, done: one.summary.done });
    }
  });

  it("stacked series add up to each week's hours (even split of a multi-requester 案件, 未割当, （依頼元なし）)", async () => {
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    const L = RANGE_LABELS.ja;
    expect(r.series).toEqual(expect.arrayContaining(["田中", "鈴木", "佐藤", L.noRequester, L.unassigned]));
    expect(r.series.at(-1)).toBe(L.unassigned);
    expect(r.series_keys.at(-1)).toBe(UNLINKED);
    for (const w of r.weeks) expect(Math.abs(w.by_series.reduce((a, b) => a + b, 0) - w.hours)).toBeLessThanOrEqual(0.01 * r.series.length);
    const w38 = r.weeks.find((w) => w.week === "2026-W38")!;
    expect(w38.by_series[r.series.indexOf("鈴木")]).toBe(w38.by_series[r.series.indexOf("佐藤")]);
  });

  it("cumulative done, top 案件, cost apportioned to its week, oneliner NULL until stored", async () => {
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    expect(r.weeks.map((w) => w.done_cum)).toEqual([0, 0, 1, 1]);
    // W38: T1 runs 01:00–03:00, T2 02:30–04:00 → T1 1.75 h, T2 1.25 h of wall clock: T1 first, no tie
    expect(r.weeks[0].top_tasks).toEqual(["件名 T1", "件名 T2"]);
    expect(r.weeks.find((w) => w.week === "2026-W41")!.cost_usd).toBe(2);
    expect(r.totals.cost_partial).toBe(true);           // S1–S3, S5 have no tokens
    expect(r.weeks.every((w) => w.oneliner === null)).toBe(true);
    await db().prepare("INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at, oneliner) VALUES ('2026-W41', '', 't', 'h', 0, 'g', 'u', '一言')").run();
    expect((await loadRange(db(), WEEKS, "ja", "2026-10-13")).weeks[3].oneliner).toBe("一言");
  });

  it("案件一覧: touched 案件 only, sorted by 依頼元 then 受領日; range and 累計 hours", async () => {
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    expect(r.tasks.map((t) => t.id)).toEqual(["T3", "T1", "T2"]);   // "" < "田中" < "鈴木、佐藤" in code-point order
    const t1 = r.tasks.find((t) => t.id === "T1")!;
    expect(t1.range_hours).toBeGreaterThan(0);
    expect(t1.total_hours).toBe((await buildWeek(db(), "2026-W38"))!.tasks.find((x) => x.task.id === "T1")!.hours);
  });

  it("案件一覧 hours: 期間内 quarter-rounded like 通算 (never above it); a hand 通算 is kept and flagged, 期間内 then 2 decimals", async () => {
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    for (const t of r.tasks) {
      expect(t.total_manual, t.id).toBe(false);
      expect(t.range_hours * 4, t.id).toBe(Math.round(t.range_hours * 4));
      expect(t.range_hours, t.id).toBeLessThanOrEqual(t.total_hours);
    }
    // T1: 1.75 h (S1) + 0.75 h (N1) in the range = 2.5 h; a hand 通算 of 1 stays, flagged.
    await db().prepare("UPDATE tasks SET hours_manual = 1 WHERE id = 'T1'").run();
    const t1 = (await loadRange(db(), WEEKS, "ja", "2026-10-13")).tasks.find((t) => t.id === "T1")!;
    expect([t1.total_hours, t1.total_manual, t1.range_hours]).toEqual([1, true, 2.5]);
  });

  it("案件一覧 成果物: hand-picked plus the automatic ones written in the range (as the 週報 names them)", async () => {
    await resetDb();
    await putTask("T9", { deliverables: ["docs/hand.md"] });
    await ingest([
      session("S8", "2026-09-07T01:00:00Z", "2026-09-07T02:00:00Z", "T9", { files_written: ["/w/成果物/old.md"] }),   // W37: before the range
      session("S9", "2026-09-22T01:00:00Z", "2026-09-22T02:00:00Z", "T9", { files_written: ["/w/成果物/a.md", "/w/src/x.ts"] }),
    ]);
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    const one = (await buildWeek(db(), "2026-W39"))!.tasks.find((x) => x.task.id === "T9")!;
    expect(r.tasks.find((t) => t.id === "T9")!.deliverables).toEqual(["docs/hand.md", ...(one.auto ?? []).map((a) => a.label)]);
    expect(r.tasks.find((t) => t.id === "T9")!.deliverables).toEqual(["docs/hand.md", "成果物/a.md"]);
  });

  it("per-week 案件 rows (当週業務内容) equal the 週報's: same 案件, 当週作業時間 = 今週(h), 累計作業時間 = all-history 累計(h)", async () => {
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    for (const w of r.weeks) {
      const one = (await buildWeek(db(), w.week))!;
      expect(w.tasks.map((t) => t.id).sort(), w.week).toEqual(one.tasks.map((x) => x.task.id).sort());
      for (const t of w.tasks) {
        const x = one.tasks.find((y) => y.task.id === t.id)!;
        expect({ id: t.id, hours: t.week_hours, total: t.total_hours_all_time, status: t.status, requester: t.requester, title: t.title })
          .toEqual({ id: t.id, hours: Math.round(x.week_minutes / 60 * 100) / 100, total: x.hours, status: x.task.status, requester: x.task.requester, title: x.task.title });
      }
    }
    expect(r.weeks.find((w) => w.week === "2026-W40")!.tasks.map((t) => t.id)).toEqual(["T1", "T2"]);   // T1 by its 09-30 note only
  });

  it("S3 splits at the Saturday 05:00 boundary: 5.5 h in W39, 1.5 h in W40 (hand-computed)", async () => {
    // Fri 09-25 23:30 JST → Sat 09-26 05:00 = 5.5 h on the 09-25 day (W39); 05:00 → 06:30 = 1.5 h on 09-26 (W40).
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    const [w39, w40] = [r.weeks[1], r.weeks[2]];
    expect(w39.hours).toBe(5.5);
    expect(w39.tasks.map((t) => [t.id, t.week_hours])).toEqual([["T2", 5.5]]);
    expect(w40.tasks.find((t) => t.id === "T2")!.week_hours).toBe(1.5);
    expect([w39.by_series[r.series.indexOf("鈴木")], w39.by_series[r.series.indexOf("佐藤")]]).toEqual([2.75, 2.75]);
  });

  it("per-week 成果物: hand-picked plus the automatic ones written that week, in the 週報's order (date, then label)", async () => {
    await resetDb();
    await putTask("T9", { deliverables: ["docs/hand.md"] });
    await ingest([
      session("S9", "2026-09-22T01:00:00Z", "2026-09-22T02:00:00Z", "T9", { files_written: ["/w/成果物/z.md"] }),   // W39
      session("S10", "2026-09-29T01:00:00Z", "2026-09-29T02:00:00Z", "T9", { files_written: ["/w/成果物/b.md"] }),  // W40
    ]);
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    for (const week of ["2026-W39", "2026-W40"]) {
      const one = (await buildWeek(db(), week))!.tasks.find((x) => x.task.id === "T9")!;
      expect(r.weeks.find((w) => w.week === week)!.tasks[0].deliverables).toEqual(["docs/hand.md", ...(one.auto ?? []).map((a) => a.label)]);
    }
    expect(r.weeks.find((w) => w.week === "2026-W40")!.tasks[0].deliverables).toEqual(["docs/hand.md", "成果物/b.md"]);
    expect(r.tasks[0].deliverables).toEqual(["docs/hand.md", "成果物/z.md", "成果物/b.md"]);   // by date, not by label
  });

  it("the week digest's PDF text per week, null when none stored", async () => {
    await db().prepare("INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at, pdf_text) VALUES ('2026-W40', '', 't', 'h', 0, 'g', 'u', 'PDF 版')").run();
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    expect(r.weeks.map((w) => w.digest_text)).toEqual([null, null, "PDF 版", null]);
    expect(r.weeks[2].oneliner).toBeNull();
  });

  it("digest_text falls back to the week text when pdf_text is NULL (a hand edit clears it), as the 週報 PDF does", async () => {
    await db().prepare("INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at, pdf_text) VALUES ('2026-W39', '', '手で直した本文', 'h', 1, 'g', 'u', NULL)").run();
    const r = await loadRange(db(), WEEKS, "ja", "2026-10-13");
    expect(r.weeks[1].digest_text).toBe("手で直した本文");
  });

  it("D1 statements do not grow with the weeks (≤ 7; the route adds the download record)", async () => {
    for (const w of ["2026-W38", "2026-W41"]) {
      await db().prepare("INSERT INTO report_digests (week, day, text, inputs_hash, edited, generated_at, updated_at, oneliner) VALUES (?1, '', 't', 'h', 0, 'g', 'u', '一言')").bind(w).run();
    }
    const count = async (weeks: string[]) => {
      let n = 0;
      const real = db();
      const counted = new Proxy(real, { get: (t, k) => (k === "prepare" ? (sql: string) => { n++; return t.prepare(sql); } : (t as any)[k]?.bind?.(t) ?? (t as any)[k]) });
      await loadRange(counted, weeks, "ja", "2026-10-13");
      return n;
    };
    const one = await count(["2026-W38"]), many = await count(WEEKS);
    expect(one).toBe(7);
    expect(many).toBe(one);
  });

  it("a range with no work: every week present with zeros, no series", async () => {
    const r = await loadRange(db(), ["2027-W10", "2027-W11"], "ja", "2026-10-13");
    expect(r.weeks.map((w) => [w.hours, w.new, w.done])).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(r.series).toEqual([]);
    expect(r.series_keys).toEqual([]);
    expect(r.tasks).toEqual([]);
  });
});

describe("loadRange: 本周日别 (the last week, day by day)", () => {
  // W41 = Sat 10-03 … Fri 10-09 (05:00 days). Times below are JST; UTC = JST − 9 h.
  const iv = (a: string, b: string) => ({ active_intervals: [[a, b]] });
  async function seedDays() {
    await resetDb();
    for (const [id, req] of [["A1", "田中"], ["A2", "田中"], ["A3", "田中"], ["A4", "田中"], ["A5", "鈴木"], ["A6", "鈴木"], ["A7", "鈴木"]])
      await putTask(id, { requester: req, received_at: "2026-09-20" });
    await putTask("Z9", { requester: "田中", received_at: "2026-09-20" });
    // PUT assigns badges; pin one stored colour and clear another (an older 案件 without a badge).
    await db().prepare("UPDATE tasks SET badge_color = CASE id WHEN 'A1' THEN 3 WHEN 'A3' THEN NULL ELSE badge_color END").run();
    await ingest([
      session("W40", "2026-09-28T01:00:00Z", "2026-09-28T02:00:00Z", "A1"),                                          // W40: not a day of the last week
      session("D1", "2026-10-03T01:00:00Z", "2026-10-03T03:00:00Z", "A1", iv("2026-10-03T01:00:00Z", "2026-10-03T03:00:00Z")),   // Sat 10:00–12:00
      session("D2", "2026-10-05T00:30:00Z", "2026-10-05T01:30:00Z", "A2"),                                            // Mon 09:30–10:30, no intervals
      session("D3", "2026-10-05T02:00:00Z", "2026-10-05T02:30:00Z", null),                                            // Mon 11:00–11:30 unlinked
      session("D4", "2026-10-06T13:00:00Z", "2026-10-06T16:30:00Z", "A3", iv("2026-10-06T13:00:00Z", "2026-10-06T16:30:00Z")),   // Tue 22:00 → Wed 01:30
      session("D5", "2026-10-07T04:00:00Z", "2026-10-07T05:00:00Z", "A4"),                                            // Wed 13:00–14:00
      session("D6", "2026-10-07T05:00:00Z", "2026-10-07T05:45:00Z", "A5"),                                            // Wed 14:00–14:45
      session("D7", "2026-10-08T01:00:00Z", "2026-10-08T01:40:00Z", "A6"),                                            // Thu 10:00–10:40
      session("D8", "2026-10-08T02:00:00Z", "2026-10-08T02:20:00Z", "A7"),                                            // Thu 11:00–11:20
      // Sat 12:59:50–13:29:40 on a 案件 deleted below: unlinked time; the end rounds to 13:30.
      session("D9", "2026-10-03T03:59:50Z", "2026-10-03T04:29:40Z", "Z9", iv("2026-10-03T03:59:50Z", "2026-10-03T04:29:40Z")),
      // Thu 04:30 → 05:30 (calendar): crosses the 05:00 day line — Wed's day ends 29:00, Thu's starts 05:00.
      session("D10", "2026-10-07T19:30:00Z", "2026-10-07T20:30:00Z", "A3", iv("2026-10-07T19:30:00Z", "2026-10-07T20:30:00Z")),
      // Fri 04:00 (calendar), overridden to 120 min: the wall books it all to Thu's 05:00 day; its span 28:00 → 30:00
      // is cut at 29:00 there, and Fri gets nothing from it.
      session("D11", "2026-10-08T19:00:00Z", "2026-10-08T19:30:00Z", null, iv("2026-10-08T19:00:00Z", "2026-10-08T19:30:00Z")),
    ]);
    await db().prepare("DELETE FROM tasks WHERE id = 'Z9'").run();
    await db().prepare("UPDATE sessions SET minutes_override = 120 WHERE id = 'D11'").run();
    await putNote("NF", "2026-10-09T15:00:00", { task_id: "A1", minutes: 30 });                                       // Fri: a note only
  }
  beforeEach(seedDays);
  const paper = (c: string) => inkOf(c).slice(1).toUpperCase();

  it("seven days of the last week, oldest first; hours add up to the week's", async () => {
    const r = await loadRange(db(), ["2026-W40", "2026-W41"], "ja", "2026-10-13");
    expect(r.days.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    expect(r.days.map((d) => d.hours)).toEqual([2.5, 0, 1.5, 3.5, 2.25, 3.5, 0.5]);
    expect(Math.abs(r.days.reduce((a, d) => a + d.hours, 0) - r.weeks.at(-1)!.hours)).toBeLessThanOrEqual(0.02);
  });

  it("each day: Σ by_series = hours = Σ by_task (2-decimal rounding per entry)", async () => {
    const r = await loadRange(db(), ["2026-W40", "2026-W41"], "ja", "2026-10-13");
    for (const d of r.days) {
      expect(d.by_series).toHaveLength(r.series.length);
      expect(d.by_task).toHaveLength(r.day_tasks.length);
      expect(Math.abs(d.by_series.reduce((a, b) => a + b, 0) - d.hours), d.date).toBeLessThanOrEqual(0.01 * r.series.length);
      expect(Math.abs(d.by_task.reduce((a, b) => a + b, 0) - d.hours), d.date).toBeLessThanOrEqual(0.01 * r.day_tasks.length);
    }
    const wed = r.days[4];
    expect([wed.by_series[r.series.indexOf("田中")], wed.by_series[r.series.indexOf("鈴木")]]).toEqual([1.5, 0.75]);   // A4 1 h + D10 0.5 h
    expect(r.days[2].by_series[r.series.indexOf("未紐付")]).toBe(0.5);
  });

  it("day_tasks: the week's top 6 案件 by wall minutes (ties by id), then その他の案件, then 未紐付", async () => {
    const r = await loadRange(db(), ["2026-W40", "2026-W41"], "ja", "2026-10-13");
    // A3 270 min, A1 150 (incl. the note), A2 60 = A4 60 (tie → id), A5 45, A6 40; A7 20 folds; unlinked: D3, D9 (deleted 案件), D11.
    expect(r.day_tasks.map((t) => t.key)).toEqual(["A3", "A1", "A2", "A4", "A5", "A6", OTHER, UNLINKED]);
    expect(r.day_tasks.map((t) => t.label)).toEqual(["件名 A3", "件名 A1", "件名 A2", "件名 A4", "件名 A5", "件名 A6", "その他の案件", "未紐付"]);
    const at = (k: string) => r.day_tasks.findIndex((t) => t.key === k);
    expect(r.days[5].by_task[at(OTHER)]).toBe(0.33);
    expect(r.days[5].by_task[at("A6")]).toBe(0.67);
    expect(r.days[6].by_task[at("A1")]).toBe(0.5);
    expect(r.days[2].by_task[at(UNLINKED)]).toBe(0.5);
    expect(r.days[0].by_task[at(UNLINKED)]).toBe(0.5);                            // D9: its 案件 is gone
    expect(r.days[5].by_task[at(UNLINKED)]).toBe(2);                              // D11: all 120 override minutes on Thu
    expect(r.days[5].by_task[at("A3")]).toBe(0.5);                                // D10's half after 05:00
    expect((await loadRange(db(), ["2026-W40", "2026-W41"], "zh", "2026-10-13")).day_tasks.at(-2)!.label).toBe("其他案件");
    expect((await loadRange(db(), ["2026-W40", "2026-W41"], "en", "2026-10-13")).day_tasks.at(-2)!.label).toBe("Other tasks");
  });

  it("colours: a stored badge colour → its palette entry, else the id's hash colour; inked for paper; folded buckets left to the style", async () => {
    const r = await loadRange(db(), ["2026-W40", "2026-W41"], "ja", "2026-10-13");
    const of = (k: string) => r.day_tasks.find((t) => t.key === k)!.color;
    expect(of("A1")).toBe(paper(LINE_PALETTE[3]));
    expect(of("A3")).toBe(paper(hashLineColor("A3")));
    expect(of("A1")).toMatch(/^[0-9A-F]{6}$/);
    expect([of(OTHER), of(UNLINKED)]).toEqual(["", ""]);
  });

  it("start / end: hours after the day's 00:00 JST from session time (intervals, else started_at + minutes); past midnight > 24; notes do not count", async () => {
    const r = await loadRange(db(), ["2026-W40", "2026-W41"], "ja", "2026-10-13");
    const se = r.days.map((d) => (d.start === null ? null : [d.start, d.end]));
    expect(se[0]).toEqual([10, 13.5]);               // D9 ends 13:29:40 → 13:30 (to the minute)
    expect(se[1]).toBeNull();                       // no work
    expect(se[2]).toEqual([9.5, 11.5]);             // D2 has no intervals: 09:30 + 60 min
    expect(se[3]).toEqual([22, 25.5]);              // 22:00 → 01:30 next morning
    expect(se[4]).toEqual([13, 29]);                // D10 cut at the 05:00 line
    expect(se[5]).toEqual([5, 29]);                 // D10's rest from 05:00; D11 28:00 → cut at 29:00
    expect(se[6]).toBeNull();                       // a note only; nothing of D11 (its minutes are Thu's)
    expect(r.days[1]).toMatchObject({ hours: 0, start: null, end: null });
    expect(r.days[1].by_series.every((x) => x === 0) && r.days[1].by_task.every((x) => x === 0)).toBe(true);
  });

  it("a week with no work: seven empty days, no day_tasks", async () => {
    const r = await loadRange(db(), ["2027-W10"], "ja", "2026-10-13");
    expect(r.days).toHaveLength(7);
    expect(r.days.every((d) => d.hours === 0 && d.start === null && d.end === null && d.by_task.length === 0)).toBe(true);
    expect(r.day_tasks).toEqual([]);
  });
});
