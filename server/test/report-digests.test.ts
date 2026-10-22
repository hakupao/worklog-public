// server/test/report-digests.test.ts
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduled, DIGEST_CRON } from "../src/cron";
import worker from "../src/index";
import { loadDigestContext } from "../src/report/digest-context";
import { refreshDigests } from "../src/report/digests";
import { fakeAnthropic } from "./fake-anthropic";
import { api, resetDb } from "./helpers";

// DIGESTS_AUTO is "off" in wrangler.jsonc; the generation tests below run with it on.
const E = { ...(env as any), DIGESTS_AUTO: "on" } as any, db = () => E.DB as D1Database;
const T0 = new Date("2026-10-02T12:00:00Z");
// A model reply: the web lines and the PDF lines.
const L = (text: string, pdf = text) => ({ lines: [text], pdf_lines: [pdf] });

const session = (id: string, started_at: string, task_id: string | null) => ({
  id, machine: "macmini", agent: "claude-code", session_id: `${id}-full`, cwd: "/w",
  started_at, ended_at: started_at, active_minutes: 60, turns: 5, summary: `auto ${id}`,
  summary_source: "llm", task_id, link_method: task_id ? "auto-dir" : "none", ts: "2026-09-21T12:00:00",
});
const ingest = (sessions: unknown[]) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions }) });

// One task T and two sessions on Mon 9/28 and Tue 9/29 (W40: Sat 9/26 → Fri 10/2).
async function seed() {
  await api("/api/tasks/T", { method: "PUT", body: JSON.stringify({
    requester: "田中", title: "帳票", status: "open", received_at: "2026-09-01",
    machine: "macmini", ts: "2026-09-01T09:00:00" }) });
  await ingest([session("S1", "2026-09-28T01:00:00Z", "T"), session("S2", "2026-09-29T01:00:00Z", "T")]);
}

const patch = (day: string, body: unknown, headers: Record<string, string> = {}) =>
  api(`/api/reports/2026-W40/digests/${day}`, { method: "PATCH", body: JSON.stringify(body), headers });

describe("report digests", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("generates one line per worked day and one for the week", async () => {
    const calls: string[] = [];
    const client = fakeAnthropic((u) => u.includes("日別まとめ")
      ? { lines: ["■ 帳票：今週は直した。", "■ その他：少し。"], pdf_lines: ["■ 帳票：直した。"] }
      : L("■ 帳票：直した。", "帳票を直した"), calls);
    const r = await refreshDigests(E, "2026-W40", { client, now: T0 });
    expect(r.generated).toBe(3);   // 9/28, 9/29, week
    const rows = (await db().prepare("SELECT day, text, pdf_text, edited, model FROM report_digests ORDER BY day").all<any>()).results;
    expect(rows.map((x) => x.day)).toEqual(["", "2026-09-28", "2026-09-29"]);
    expect(rows[0]).toMatchObject({ text: "■ 帳票：今週は直した。\n■ その他：少し。", pdf_text: "■ 帳票：直した。", edited: 0, model: "claude-opus-5-5" });
    expect(rows[1]).toMatchObject({ text: "■ 帳票：直した。", pdf_text: "帳票を直した" });
    expect(calls.length).toBe(3);   // one call per line, no retries
    expect(calls[0]).toContain("auto S1");
    expect(calls[0]).toContain("帳票（依頼元：田中");
    expect(calls[2]).toContain("2026-09-28：■ 帳票：直した。");
  });

  it("over-long lines are cut at the last whole line under the limit, with one call and no retry", async () => {
    await db().prepare("DELETE FROM sessions WHERE id = 'S2'").run();
    const bodies: any[] = [];
    const long = "あ".repeat(300);
    const client = fakeAnthropic(() => ({ lines: [long, long, long], pdf_lines: ["い".repeat(100), "う".repeat(30)] }), [], (b) => bodies.push(b));
    const r = await refreshDigests(E, "2026-W40", { client, now: T0 });
    expect(r).toMatchObject({ generated: 2, failed: 0 });
    expect(bodies.length).toBe(2);   // the day + the week
    expect(bodies.every((b) => b.messages.length === 1)).toBe(true);
    const day = await db().prepare("SELECT text, pdf_text FROM report_digests WHERE day='2026-09-28'").first<any>();
    expect(day.text).toBe(`${long}\n${long}`);           // 601 ≤ 800; a third line would be 902
    expect(day.pdf_text).toBe("い".repeat(100));          // 131 > 120
    const week = await db().prepare("SELECT text, pdf_text FROM report_digests WHERE day=''").first<any>();
    expect(week.text).toBe(`${long}\n${long}\n${long}`); // 902 ≤ 1600
    expect(week.pdf_text).toBe(`${"い".repeat(100)}\n${"う".repeat(30)}`);
  });

  it("an empty lines reply is a failed line, not an empty digest", async () => {
    await db().prepare("DELETE FROM sessions WHERE id = 'S2'").run();
    const r = await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => ({ lines: ["  "], pdf_lines: ["x"] })), now: T0 });
    expect(r).toEqual({ generated: 0, skipped: 0, failed: 1 });   // the day failed, so the week has nothing to read
    expect(await db().prepare("SELECT count(*) AS n FROM report_digests").first<any>()).toEqual({ n: 0 });
  });

  it("an empty pdf_lines reply is a failed line too (R13): nothing written, pdf_text never stored NULL", async () => {
    await db().prepare("DELETE FROM sessions WHERE id = 'S2'").run();
    const r = await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => ({ lines: ["x。"], pdf_lines: [" "] })), now: T0 });
    expect(r).toEqual({ generated: 0, skipped: 0, failed: 1 });
    expect(await db().prepare("SELECT count(*) AS n FROM report_digests").first<any>()).toEqual({ n: 0 });
  });

  it("sends effort low and a {lines, pdf_lines} JSON schema, never thinking or temperature", async () => {
    const bodies: any[] = [];
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。"), [], (b) => bodies.push(b)), now: T0 });
    expect(bodies[0].model).toBe("claude-opus-5-5");
    expect(bodies[0].max_tokens).toBe(4000);
    expect(bodies[0].output_config.effort).toBe("low");
    expect(bodies[0].output_config.format.schema.required).toEqual(["lines", "pdf_lines"]);
    expect(bodies[0].thinking).toBeUndefined();
    expect(bodies[0].temperature).toBeUndefined();
  });

  it("unchanged inputs are not regenerated; changed inputs are", async () => {
    const client = fakeAnthropic(() => L("x。"));
    await refreshDigests(E, "2026-W40", { client, now: T0 });
    const calls: string[] = [];
    expect((await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。"), calls), now: T0 })).generated).toBe(0);
    expect(calls).toEqual([]);
    await db().prepare("UPDATE sessions SET summary_edited = '別の内容' WHERE id = 'S1'").run();
    const r = await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("y。")), now: T0 });
    expect(r).toEqual({ generated: 2, skipped: 1, failed: 0 });   // 9/28, then the week (its day text changed); 9/29 skipped
  });

  it("an edited week line is never overwritten; regenerate clears the flag; an old day hand edit gives way (day lines are no longer shown)", async () => {
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。")), now: T0 });
    const r = await patch("week", { text: "手で書いた。" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ text: "手で書いた。", edited: true, stale: false });
    expect((await patch("2026-09-28", { text: "日の手書き。" })).status).toBe(200);
    await db().prepare("UPDATE sessions SET summary_edited = '変更' ").run();
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("z。")), now: T0 });
    const at = (day: string) => db().prepare("SELECT text, edited FROM report_digests WHERE day=?1").bind(day).first<any>();
    expect(await at("")).toEqual({ text: "手で書いた。", edited: 1 });
    expect(await at("2026-09-28")).toEqual({ text: "z。", edited: 0 });
    const g = await patch("week", { regenerate: true });
    expect(g.status).toBe(200);
    expect(await g.json()).toMatchObject({ edited: false, stale: true, auto: expect.any(Boolean) });
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("w。")), now: T0 });
    expect(await at("")).toEqual({ text: "w。", edited: 0 });
  });

  it("PATCH: week line via `week`, a day outside the report week is 400, a missing row is 404, a bad body is 400", async () => {
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。")), now: T0 });
    expect((await patch("week", { text: "週の手書き。" })).status).toBe(200);
    expect((await db().prepare("SELECT text, edited FROM report_digests WHERE day=''").first<any>())).toEqual({ text: "週の手書き。", edited: 1 });
    expect((await patch("2026-10-03", { text: "a" })).status).toBe(400);   // next Saturday: W41
    expect((await patch("2026-09-26", { text: "a" })).status).toBe(404);   // in the week, no digest row
    expect((await patch("2026-09-28", { text: "" })).status).toBe(400);
    expect((await patch("2026-09-28", { regenerate: false })).status).toBe(400);
    expect((await api("/api/reports/2026-W99/digests/week", { method: "PATCH", body: JSON.stringify({ text: "a" }) })).status).toBe(400);
  });

  it("PATCH under X-Lang: re-sending the shown translation is not an edit", async () => {
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。")), now: T0 });
    await db().prepare(
      `INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
       VALUES ('digest', '2026-W40' || char(31) || '2026-09-28', 'text', 'x。', 'ja', 'zh:x', 'x。', 'en:x', 'm', 'u')`).run();
    const r = await patch("2026-09-28", { text: "en:x" }, { "X-Lang": "en" });
    expect(await r.json()).toMatchObject({ text: "en:x", edited: false });
    expect((await db().prepare("SELECT text, edited FROM report_digests WHERE day='2026-09-28'").first<any>())).toEqual({ text: "x。", edited: 0 });
  });

  it("a hand-edited day still moves the non-edited week line", async () => {
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。")), now: T0 });
    const before = await db().prepare("SELECT text, inputs_hash FROM report_digests WHERE day=''").first<any>();
    await patch("2026-09-28", { text: "手で書いた。" });
    const calls: string[] = [];
    const r = await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("週が変わった。"), calls), now: T0 });
    expect(r).toEqual({ generated: 1, skipped: 2, failed: 0 });
    expect(calls[0]).toContain("2026-09-28：手で書いた。");
    const after = await db().prepare("SELECT text, inputs_hash, edited FROM report_digests WHERE day=''").first<any>();
    expect(after.text).toBe("週が変わった。");
    expect(after.edited).toBe(0);
    expect(after.inputs_hash).not.toBe(before.inputs_hash);
  });

  it("one failed generation does not stop the others", async () => {
    let n = 0;
    const client = fakeAnthropic(async () => ++n === 1
      ? new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5",
          content: [{ type: "text", text: "not json" }], stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } })
      : L("ok。"));
    const r = await refreshDigests(E, "2026-W40", { client, now: T0 });
    expect(r).toEqual({ generated: 2, skipped: 0, failed: 1 });
    const rows = (await db().prepare("SELECT day, text FROM report_digests ORDER BY day").all<any>()).results;
    expect(rows).toEqual([{ day: "", text: "ok。" }, { day: "2026-09-29", text: "ok。" }]);
  });

  it("regenerate on a worked day with no line yet: 200 { auto } only, and the refresh creates it", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      id: "m", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(L("新しい。")) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const ps: Promise<unknown>[] = [];
    const r = await worker.fetch(new Request("http://worklog.test/api/reports/2026-W40/digests/2026-09-28", {
      method: "PATCH", body: JSON.stringify({ regenerate: true }),
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    }), { ...E, ANTHROPIC_API_KEY: "k" }, { waitUntil: (p: Promise<unknown>) => ps.push(p) } as any);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ auto: true });
    expect(ps.length).toBe(1);
    await Promise.all(ps);
    expect(await db().prepare("SELECT text, edited FROM report_digests WHERE day='2026-09-28'").first<any>()).toEqual({ text: "新しい。", edited: 0 });
  });

  it("preview carries digests, localized and stale-flagged", async () => {
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。")), now: T0 });
    const p = (await (await api("/api/reports/2026-W40/weekly")).json()) as any;
    expect(p.digests.week.text).toBe("x。");
    expect(p.digests.days["2026-09-28"]).toMatchObject({ text: "x。", edited: false, stale: false });
    await db().prepare("UPDATE sessions SET summary_edited = '別の内容' WHERE id = 'S1'").run();
    await db().prepare(
      `INSERT INTO translations (entity, entity_id, field, source_text, source_lang, zh, ja, en, model, updated_at)
       VALUES ('digest', '2026-W40' || char(31) || '2026-09-29', 'text', 'x。', 'ja', 'zh:x', 'x。', 'en:x', 'm', 'u')`).run();
    const q = (await (await api("/api/reports/2026-W40/weekly", { headers: { "X-Lang": "en" } })).json()) as any;
    expect(q.digests.days["2026-09-28"]).toMatchObject({ text: "x。", stale: true });
    expect(q.digests.days["2026-09-29"]).toMatchObject({ text: "en:x", stale: false });
    const empty = (await (await api("/api/reports/2026-W30/weekly")).json()) as any;
    expect(empty.digests).toEqual({ week: null, days: {} });
  });

  it("preview before migration 0012 (no report_digests table): still 200, empty digests", async () => {
    await db().prepare("ALTER TABLE report_digests RENAME TO report_digests_gone").run();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await api("/api/reports/2026-W40/weekly");
      expect(r.status).toBe(200);
      expect(((await r.json()) as any).digests).toEqual({ week: null, days: {} });
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
      await db().prepare("ALTER TABLE report_digests_gone RENAME TO report_digests").run();
    }
  });

  it("no API key: refreshDigests is a quiet no-op", async () => {
    expect(await refreshDigests({ ...E, ANTHROPIC_API_KEY: undefined }, "2026-W40", { now: T0 })).toEqual({ generated: 0, skipped: 0, failed: 0 });
  });
});

describe("digest switch and pdf_text", () => {
  beforeEach(async () => { await resetDb(); await seed(); });

  it("refreshDigests does nothing unless DIGESTS_AUTO is 'on'", async () => {
    const calls: string[] = [];
    const client = fakeAnthropic(() => L("x。"), calls);
    const off = await refreshDigests({ ...E, DIGESTS_AUTO: "off" }, "2026-W40", { client, now: T0 });
    expect(off).toEqual({ generated: 0, skipped: 0, failed: 0 });
    expect(calls).toEqual([]);
    const unset = await refreshDigests({ ...E, DIGESTS_AUTO: undefined }, "2026-W40", { client, now: T0 });
    expect(unset.generated).toBe(0);
    expect(calls).toEqual([]);
    const forced = await refreshDigests({ ...E, DIGESTS_AUTO: "off" }, "2026-W40", { client, now: T0, force: true });
    expect(forced.generated).toBe(3);
    expect(calls.length).toBe(3);
  });

  it("the digest cron makes no API call while DIGESTS_AUTO is off", async () => {
    const fetched: unknown[] = [];
    vi.stubGlobal("fetch", async (u: unknown) => { fetched.push(u); return new Response("{}", { status: 500 }); });
    try {
      await scheduled({ cron: DIGEST_CRON } as any, { ...E, DIGESTS_AUTO: "off", ANTHROPIC_API_KEY: "k" } as any, { waitUntil: () => {} } as any);
      expect(fetched).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("digest context", () => {
  beforeEach(resetDb);

  it("loadDigestContext reads the week's plan goals, the days' plans with their judgement, and last week's summary", async () => {
    const plan = (id: string, horizon: string, status: string, task_id: string | null, done_at: string | null,
                  created = "2026-09-01T00:00:00.000Z", sort = 0) =>
      db().prepare(`INSERT INTO plan_items (id, horizon, text, task_id, status, sort, created_at, done_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?8, ?7, 'u')`).bind(id, horizon, `goal ${id}`, task_id, status, sort, done_at, created);
    const link = (p: string, t: string) => db().prepare("INSERT INTO plan_item_tasks (plan_item_id, task_id) VALUES (?1, ?2)").bind(p, t);
    const dayPlan = (date: string) => db().prepare("INSERT INTO day_plans (date, started_at, updated_at) VALUES (?1, 's', 'u')").bind(date);
    const dayItem = (id: string, date: string, ai: string | null, manual: string | null, progress: string | null, task_id: string | null = null) =>
      db().prepare(`INSERT INTO day_plan_items (id, date, task_id, text, detail, ai_status, ai_progress, manual_status, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'u')`).bind(id, date, task_id, `plan ${id}`, `detail ${id}`, ai, progress, manual);
    const dayLink = (d: string, t: string) => db().prepare("INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) VALUES (?1, ?2)").bind(d, t);
    const digest = (week: string, day: string, text: string) => db().prepare(`INSERT INTO report_digests
      (week, day, text, inputs_hash, edited, model, generated_at, updated_at) VALUES (?1, ?2, ?3, 'h', 0, 'm', 'g', 'u')`).bind(week, day, text);
    // W40 runs Sat 2026-09-26 05:00 JST (= 09-25T20:00Z) to Sat 10-03 05:00 JST.
    await db().batch([
      plan("P1", "near", "active", "T", null),                            // hung directly (pre-0008 column)
      plan("P2", "week", "active", null, null), link("P2", "U"),          // hung through plan_item_tasks
      plan("P3", "near", "dropped", null, "2026-09-28T00:00:00.000Z"), link("P3", "T"),
      plan("P4", "far", "done", null, "2026-09-25T21:00:00.000Z"), link("P4", "T"),   // done inside the week (Sat 06:00 JST)
      plan("P5", "far", "done", null, "2026-09-20T00:00:00.000Z"), link("P5", "T"),   // done the week before
      plan("P6", "near", "active", null, null),                           // on no task
      plan("P7", "week", "done", null, "2026-10-02T20:00:00.000Z"), link("P7", "T"),  // done at the week's end: still active then
      plan("P8", "week", "dropped", null, "2026-10-05T00:00:00.000Z"), link("P8", "T"), // dropped after the week: active then
      plan("P9", "week", "active", null, null, "2026-10-02T20:00:00.000Z"), link("P9", "T"), // made at the week's end: not yet
      dayPlan("2026-09-28"), dayPlan("2026-09-29"), dayPlan("2026-10-03"),
      dayItem("D1", "2026-09-28", "partial", "done", "半分", "V"), dayLink("D1", "T"),
      dayItem("D2", "2026-09-29", null, null, null),
      dayItem("D3", "2026-10-03", "done", null, null),                    // next report week
      digest("2026-W39", "", "■ 帳票：先週の要約"), digest("2026-W39", "2026-09-22", "日の要約"), digest("2026-W40", "", "今週"),
    ]);
    const dates = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
    const ctx = await loadDigestContext(db(), "2026-W40", dates);
    expect(ctx.plans).toEqual([
      { task_id: "T", horizon: "far", text: "goal P4", status: "done" },
      { task_id: "T", horizon: "near", text: "goal P1", status: "active" },
      { task_id: "U", horizon: "week", text: "goal P2", status: "active" },
      { task_id: "T", horizon: "week", text: "goal P7", status: "active" },
      { task_id: "T", horizon: "week", text: "goal P8", status: "active" },
    ]);
    expect(ctx.dayPlans).toEqual([
      { date: "2026-09-28", text: "plan D1", detail: "detail D1", status: "done", progress: "半分", task_ids: ["T", "V"] },
      { date: "2026-09-29", text: "plan D2", detail: "detail D2", status: null, progress: null, task_ids: [] },
    ]);
    expect(ctx.lastWeek).toBe("■ 帳票：先週の要約");
    expect((await loadDigestContext(db(), "2026-W39", dates.map(() => "2026-09-19"))).lastWeek).toBeNull();
  });

  it("a plan goal change makes the generated lines stale", async () => {
    await seed();
    await refreshDigests(E, "2026-W40", { client: fakeAnthropic(() => L("x。")), now: T0 });
    let p = (await (await api("/api/reports/2026-W40/weekly")).json()) as any;
    expect(p.digests.days["2026-09-28"].stale).toBe(false);
    await db().batch([
      db().prepare(`INSERT INTO plan_items (id, horizon, text, status, sort, created_at, updated_at)
        VALUES ('P', 'near', '帳票を月末までに', 'active', 0, '2026-09-27T00:00:00.000Z', 'u')`),
      db().prepare("INSERT INTO plan_item_tasks (plan_item_id, task_id) VALUES ('P', 'T')"),
    ]);
    p = (await (await api("/api/reports/2026-W40/weekly")).json()) as any;
    expect(p.digests.days["2026-09-28"].stale).toBe(true);
    expect(p.digests.week.stale).toBe(true);
  });
});

describe("cron dispatch", () => {
  beforeEach(resetDb);
  afterEach(() => { vi.unstubAllGlobals(); });

  const run = async (cron: string, e: unknown) => {
    const ps: Promise<unknown>[] = [];
    await scheduled({ cron } as any, e as any, { waitUntil: (p: Promise<unknown>) => ps.push(p) } as any);
    await Promise.all(ps);
  };

  it("the digest cron refreshes this and last report week's digests", async () => {
    const msg = (text: string) => new Response(JSON.stringify({
      id: "m", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(L(text)) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", async () => msg("cron。"));
    await api("/api/tasks/T", { method: "PUT", body: JSON.stringify({
      requester: "田中", title: "帳票", status: "open", received_at: "2026-09-01",
      machine: "macmini", ts: "2026-09-01T09:00:00" }) });
    await ingest([session("C1", new Date(Date.now() - 2 * 3_600_000).toISOString(), "T")]);
    await run(DIGEST_CRON, { ...E, ANTHROPIC_API_KEY: "k" });
    const rows = (await db().prepare("SELECT day, text FROM report_digests").all<any>()).results;
    expect(rows.length).toBe(2);   // the session's day + its week
    expect(rows.every((r) => r.text === "cron。")).toBe(true);
    expect(await db().prepare("SELECT count(*) AS n FROM translations").first<any>()).toEqual({ n: 0 });
  });

  it("*/5 still runs the translation sweep", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (_u: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push(body.messages[0].content);
      return new Response(JSON.stringify({
        id: "m", type: "message", role: "assistant", model: body.model,
        content: [{ type: "text", text: JSON.stringify({ source: "ja", polished: "帳票", zh: "zh", ja: "帳票", en: "en" }) }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await db().prepare(
      `INSERT INTO tasks (id, requester, project, title, status, received_at, thinking, deliverables, machine, ts, updated_at)
       VALUES ('T1', 'r', '', '帳票', 'open', '2026-10-01', '', '[]', 'm', 'x', 'u0')`).run();
    await run("*/5 * * * *", { ...E, ANTHROPIC_API_KEY: "k" });
    expect(seen.length).toBe(1);
    expect(await db().prepare("SELECT en FROM translations WHERE entity='task' AND entity_id='T1' AND field='title'").first<any>()).toEqual({ en: "en" });
    expect(await db().prepare("SELECT count(*) AS n FROM report_digests").first<any>()).toEqual({ n: 0 });
  });
});

describe("report digests — week oneliner (Worker path)", () => {
  beforeEach(async () => { await resetDb(); await seed(); });
  const week = () => db().prepare("SELECT oneliner, oneliner_edited FROM report_digests WHERE week = '2026-W40' AND day = ''").first<any>();

  it("a regenerated week replaces an AI oneliner, and a reply without one clears it", async () => {
    const reply = (one?: string) => fakeAnthropic((u) => u.includes("日別まとめ") ? { ...L("■ 帳票：直した。"), ...(one ? { oneliner: one } : {}) } : L("■ 帳票：直した。"));
    const stale = () => db().prepare("UPDATE report_digests SET inputs_hash = 'old' WHERE week = '2026-W40' AND day = ''").run();
    await refreshDigests(E, "2026-W40", { client: reply("帳票を直した"), now: T0 });
    expect(await week()).toMatchObject({ oneliner: "帳票を直した", oneliner_edited: 0 });
    await stale();
    await refreshDigests(E, "2026-W40", { client: reply("次の一言"), now: T0 });
    expect((await week()).oneliner).toBe("次の一言");
    await stale();
    await refreshDigests(E, "2026-W40", { client: reply(), now: T0 });
    expect((await week()).oneliner).toBeNull();
  });

  it("a regenerated week keeps a hand-edited oneliner", async () => {
    const reply = (one: string) => fakeAnthropic((u) => u.includes("日別まとめ") ? { ...L("■ 帳票：直した。"), oneliner: one } : L("■ 帳票：直した。"));
    await refreshDigests(E, "2026-W40", { client: reply("最初の一言"), now: T0 });
    await db().prepare("UPDATE report_digests SET oneliner = '手の一言', oneliner_edited = 1, inputs_hash = 'old' WHERE week = '2026-W40' AND day = ''").run();
    await refreshDigests(E, "2026-W40", { client: reply("次の一言"), now: T0 });
    expect(await week()).toMatchObject({ oneliner: "手の一言", oneliner_edited: 1 });
  });

  it("the week call asks for the oneliner in formal written style; a day call does not", async () => {
    const bodies: any[] = [];
    const client = fakeAnthropic(() => L("■ 帳票：直した。"), [], (b) => bodies.push(b));
    await refreshDigests(E, "2026-W40", { client, now: T0 });
    const wk = bodies.find((b) => b.messages[0].content.includes("日別まとめ")), dy = bodies.find((b) => !b.messages[0].content.includes("日別まとめ"));
    expect(wk.output_config.format.schema.required).toEqual(["lines", "pdf_lines", "oneliner"]);
    expect(wk.system).toContain("oneliner");
    expect(wk.system).toContain("書き言葉");
    expect(dy.output_config.format.schema.required).toEqual(["lines", "pdf_lines"]);
  });
});

