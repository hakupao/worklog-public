import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

// Times are UTC. A 5:00 JST day D runs [D-1 20:00Z, D 20:00Z).
const session = (id: string, started_at: string, over: Record<string, unknown> = {}) => ({
  id, machine: "macmini", agent: "claude-code", session_id: id + "-full", cwd: "/w",
  started_at, ended_at: started_at, active_minutes: 60, turns: 5, summary: "auto " + id,
  summary_source: "llm", task_id: null, link_method: "none", ts: "2026-09-21T12:00:00", ...over,
});
const iv = (a: string, b: string) => ({ started_at: a, ended_at: b, active_intervals: [[a, b]] });
const ingest = (sessions: unknown[]) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions }) });
const sql = (q: string) => ((env as any).DB as D1Database).prepare(q).run();
const get = (q: string) => api(`/api/stats/sessions${q}`);
const body = async (from: string, to: string) => {
  const r = await get(`?from=${from}&to=${to}`);
  expect(r.status).toBe(200);
  return (await r.json()) as any;
};
const ids = (b: any) => b.sessions.map((s: any) => s.id);
const counts = (input: number, output: number, cache_read: number, w5: number, w1: number, reasoning = 0) =>
  ({ input, output, cache_read, cache_write_5m: w5, cache_write_1h: w1, reasoning });

describe("GET /api/stats/sessions", () => {
  beforeEach(resetDb);

  it("400s a malformed range, and either parameter missing (no 28-day default)", async () => {
    for (const q of ["?from=2026-09-29&to=2026-09-01", "?from=2026-09-01", "?to=2026-09-01", "", "?from=2026-9-1&to=2026-09-02", "?from=2026-02-30&to=2026-03-01"]) {
      const r = await get(q);
      expect(r.status, q).toBe(400);
      expect(((await r.json()) as any).error).toBeTypeOf("string");
    }
  });

  it("does not shadow GET /api/stats (the row counts)", async () => {
    const r = await api("/api/stats");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ tasks: 0, sessions: 0, notes: 0 });
  });

  it("days start at 05:00 JST: 04:30 belongs to the day before, 05:10 to the day itself", async () => {
    await ingest([
      session("S0430", "2026-09-21T19:30:00Z", iv("2026-09-21T19:30:00Z", "2026-09-21T19:50:00Z")),  // 9/22 04:30 JST → 9/21
      session("S0510", "2026-09-21T20:10:00Z", iv("2026-09-21T20:10:00Z", "2026-09-21T20:40:00Z")),  // 9/22 05:10 JST → 9/22
      session("S0400", "2026-09-20T19:00:00Z", iv("2026-09-20T19:00:00Z", "2026-09-20T19:30:00Z")),  // 9/21 04:00 JST → 9/20
    ]);
    const d21 = await body("2026-09-21", "2026-09-21");
    expect(d21.range).toEqual({ from: "2026-09-21", to: "2026-09-21" });
    expect(d21.day_start).toBe("05:00");
    expect(ids(d21)).toEqual(["S0430"]);
    expect(ids(await body("2026-09-22", "2026-09-22"))).toEqual(["S0510"]);
    expect(ids(await body("2026-09-20", "2026-09-20"))).toEqual(["S0400"]);
    expect(ids(await body("2026-09-20", "2026-09-22"))).toEqual(["S0400", "S0430", "S0510"]);
  });

  it("a session across the window edge is in both days, intervals unclipped; one interval inside is enough", async () => {
    await ingest([
      session("Sx", "2026-09-21T19:00:00Z", iv("2026-09-21T19:00:00Z", "2026-09-21T21:00:00Z")),
      // first interval on 9/20 (before 9/21 05:00 JST), second inside 9/21
      session("Sy", "2026-09-20T10:00:00Z", {
        ended_at: "2026-09-21T02:00:00Z",
        active_intervals: [["2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z"], ["2026-09-21T01:00:00Z", "2026-09-21T02:00:00Z"]],
      }),
    ]);
    const d21 = await body("2026-09-21", "2026-09-21"), d22 = await body("2026-09-22", "2026-09-22");
    expect(ids(d21)).toEqual(["Sy", "Sx"]);
    expect(ids(d22)).toEqual(["Sx"]);
    expect(d22.sessions[0].intervals).toEqual([["2026-09-21T19:00:00Z", "2026-09-21T21:00:00Z"]]);
    expect(d21.sessions[0].intervals).toHaveLength(2);
    expect(ids(await body("2026-09-20", "2026-09-20"))).toEqual(["Sy"]);
  });

  it("hidden sessions are left out", async () => {
    await ingest([session("Sa", "2026-09-21T01:00:00Z"), session("Sb", "2026-09-21T02:00:00Z")]);
    await sql("UPDATE sessions SET hidden=1 WHERE id='Sb'");
    expect(ids(await body("2026-09-21", "2026-09-21"))).toEqual(["Sa"]);
  });

  it("zero-length and reversed intervals are dropped; NULL or nothing left → [started, started+minutes], approx", async () => {
    await ingest([
      session("Smix", "2026-09-21T01:00:00Z", {
        ended_at: "2026-09-21T03:00:00Z",
        active_intervals: [
          ["2026-09-21T01:00:00Z", "2026-09-21T01:00:00Z"],
          ["2026-09-21T01:10:00Z", "2026-09-21T01:40:00Z"],
          ["2026-09-21T03:00:00Z", "2026-09-21T02:00:00Z"],
        ],
      }),
      session("Snull", "2026-09-21T04:00:00Z", { active_minutes: 45 }),
      session("Szero", "2026-09-21T06:00:00Z", { active_minutes: 30, active_intervals: [["2026-09-21T06:00:00Z", "2026-09-21T06:00:00Z"]] }),
      session("Sover", "2026-09-21T08:00:00Z", { active_minutes: 10 }),
    ]);
    await sql("UPDATE sessions SET minutes_override=20 WHERE id='Sover'");
    const s = Object.fromEntries((await body("2026-09-21", "2026-09-21")).sessions.map((x: any) => [x.id, x]));
    expect(s.Smix).toMatchObject({ intervals: [["2026-09-21T01:10:00Z", "2026-09-21T01:40:00Z"]], approx: false });
    expect(s.Snull).toMatchObject({ intervals: [["2026-09-21T04:00:00Z", "2026-09-21T04:45:00.000Z"]], approx: true, active_minutes: 45 });
    expect(s.Szero).toMatchObject({ intervals: [["2026-09-21T06:00:00Z", "2026-09-21T06:30:00.000Z"]], approx: true });
    // minutes_override wins, also for the synthesized interval
    expect(s.Sover).toMatchObject({ intervals: [["2026-09-21T08:00:00Z", "2026-09-21T08:20:00.000Z"]], approx: true, active_minutes: 20 });
  });

  it("0 minutes and no interval of length: not returned (A1: the filled-in [started, started] met the window)", async () => {
    await ingest([
      session("S0null", "2026-09-21T04:00:00Z", { active_minutes: 0 }),
      session("S0zero", "2026-09-21T05:00:00Z", { active_minutes: 0, active_intervals: [["2026-09-21T05:00:00Z", "2026-09-21T05:00:00Z"]] }),
      session("Skept", "2026-09-21T06:00:00Z", { active_minutes: 5 }),
    ]);
    expect(ids(await body("2026-09-21", "2026-09-21"))).toEqual(["Skept"]);
  });

  it("decides the window edge by instant, for both stored ISO spellings (…00Z and …00.000000Z)", async () => {
    // 9/21's window is [2026-09-20T20:00:00Z, 2026-09-21T20:00:00Z)
    await ingest([
      session("SendAtStart", "2026-09-20T19:00:00.000000Z", iv("2026-09-20T19:00:00.000000Z", "2026-09-20T20:00:00.000000Z")),
      // as strings these two would compare wrongly ("…00Z" > "…00.000Z", "…00.000000Z" < "…00.000Z")
      session("SendAtStartNoFrac", "2026-09-20T19:00:00Z", iv("2026-09-20T19:00:00Z", "2026-09-20T20:00:00Z")),
      session("SstartAtEndFrac", "2026-09-21T20:00:00.000000Z", iv("2026-09-21T20:00:00.000000Z", "2026-09-21T21:00:00.000000Z")),
      session("SendAfterStart", "2026-09-20T19:00:00Z", iv("2026-09-20T19:00:00Z", "2026-09-20T20:00:00.500000Z")),
      session("SstartAtEnd", "2026-09-21T20:00:00Z", iv("2026-09-21T20:00:00Z", "2026-09-21T21:00:00Z")),
      session("SstartBeforeEnd", "2026-09-21T19:59:59.999000Z", iv("2026-09-21T19:59:59.999000Z", "2026-09-21T21:00:00.000000Z")),
    ]);
    expect(ids(await body("2026-09-21", "2026-09-21"))).toEqual(["SendAfterStart", "SstartBeforeEnd"]);
  });

  it("fields: effective summary cut to 80 code points, files count, turns, agent, task, tokens merged per model", async () => {
    const long = "😀".repeat(100);
    await ingest([
      session("St", "2026-09-21T01:00:00Z", {
        ...iv("2026-09-21T01:00:00Z", "2026-09-21T02:00:00Z"), agent: "codex", machine: "win11", turns: 12,
        summary: long, files_written: ["/a", "/b", "/c"], task_id: "T20260921-01",
        tokens: {
          by_model: { "claude-opus": counts(10, 20, 300, 4, 5, 99), "claude-haiku": counts(1, 2, 3, 0, 0) },
          subagent: { "claude-haiku": counts(1, 2, 3, 0, 0) },
          cost_usd: 1.25, cost_partial: true,
        },
      }),
      session("Snone", "2026-09-21T03:00:00Z", iv("2026-09-21T03:00:00Z", "2026-09-21T03:30:00Z")),
      session("Snosub", "2026-09-21T04:00:00Z", {
        ...iv("2026-09-21T04:00:00Z", "2026-09-21T04:30:00Z"),
        tokens: { by_model: { m: counts(1, 1, 1, 1, 1) }, subagent: {}, cost_usd: null, cost_partial: false },
      }),
    ]);
    await sql("UPDATE sessions SET summary_edited='人が直した' WHERE id='Snone'");
    const [st, none, nosub] = (await body("2026-09-21", "2026-09-21")).sessions;
    expect(st).toEqual({
      id: "St", machine: "win11", agent: "codex", task_id: "T20260921-01",
      started_at: "2026-09-21T01:00:00Z", ended_at: "2026-09-21T02:00:00Z", active_minutes: 60, turns: 12, files: 3,
      intervals: [["2026-09-21T01:00:00Z", "2026-09-21T02:00:00Z"]], approx: false,
      tokens: {
        "claude-opus": { input: 10, output: 20, cache_read: 300, cache_write: 9 },
        "claude-haiku": { input: 1, output: 2, cache_read: 3, cache_write: 0 },
      },
      subagent_tokens: 6, cost_usd: 1.25, cost_partial: true, summary: "😀".repeat(80),
    });
    expect(none).toMatchObject({ id: "Snone", tokens: null, subagent_tokens: null, cost_usd: null, cost_partial: false, summary: "人が直した", files: 0 });
    expect(nosub).toMatchObject({ id: "Snosub", tokens: { m: { input: 1, output: 1, cache_read: 1, cache_write: 2 } }, subagent_tokens: null, cost_usd: null, cost_partial: false });
  });

  it("plans: the range's day-plan items by date, sort, id, with their tasks (sorted); calendar days, not 5:00 days", async () => {
    const task = async (title: string) =>
      ((await (await api("/api/tasks", { method: "POST", body: JSON.stringify({ requester: "田中", title }) })).json()) as any).id as string;
    const t1 = await task("案件1"), t2 = await task("案件2");
    // start every day first: a day started later would carry the earlier days' open items over
    for (const d of ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"]) await api(`/api/day-plans/${d}/start`, { method: "POST" });
    const add = async (date: string, text: string, task_ids: string[] = []) => (await (await api(`/api/day-plans/${date}/items`, { method: "POST", body: JSON.stringify({ text, task_ids }) })).json()) as any;
    const before = await add("2026-09-20", "前日");
    const a = await add("2026-09-22", "二日目", [t1]);
    const b = await add("2026-09-21", "両方", [t2, t1]);
    const c = await add("2026-09-21", "なし");
    const after = await add("2026-09-23", "翌日");
    expect([before, after].every((x) => x.id)).toBe(true);
    await sql(`UPDATE day_plan_items SET sort = 5 WHERE id = '${b.id}'`);
    await sql(`UPDATE day_plan_items SET sort = 1, ai_status = 'partial' WHERE id = '${c.id}'`);
    await api(`/api/day-plan-items/${a.id}`, { method: "PATCH", body: JSON.stringify({ updated_at: a.updated_at, manual_status: "done" }) });
    const r = await body("2026-09-21", "2026-09-22");
    expect(r.sessions).toEqual([]);
    expect(r.plans).toEqual([
      { date: "2026-09-21", text: "なし", task_ids: [], ai_status: "partial", manual_status: null },
      { date: "2026-09-21", text: "両方", task_ids: [t1, t2].sort(), ai_status: null, manual_status: null },
      { date: "2026-09-22", text: "二日目", task_ids: [t1], ai_status: null, manual_status: "done" },
    ]);
  });
});
