import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;

const session = (id: string, started_at: string, over: Record<string, unknown> = {}) => ({
  id, machine: "macmini", agent: "claude-code", session_id: id + "-full", cwd: "/w",
  started_at, ended_at: started_at, active_minutes: 60, turns: 5, summary: "auto " + id,
  summary_source: "llm", task_id: "T20260921-01", link_method: "auto-dir", ts: "2026-09-21T12:00:00", ...over,
});

const ingest = (sessions: unknown[]) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions }) });

const timeline = async (q = "") => (await api(`/api/weeks/2026-W39/timeline${q}`)).json() as Promise<any>;

describe("timeline", () => {
  beforeEach(resetDb);

  it("always returns seven days", async () => {
    const t = await timeline();
    expect(t.week).toBe("2026-W39");
    expect(t.days.map((d: any) => d.date)).toEqual(
      ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]);
    expect(t.total_minutes).toBe(0);
  });

  it("groups by JST day, not by the UTC string", async () => {
    await ingest([
      session("Slastweek", "2026-09-20T14:59:59Z"),          // Sun 23:59 JST -> W38, excluded
      session("Smonearly", "2026-09-20T15:30:00Z"),          // Mon 00:30 JST -> 9/21
      session("Smonfrac", "2026-09-21T01:00:00.123456Z"),    // Mon 10:00 JST, fractional seconds
      session("Stueoffs", "2026-09-22T08:00:00+09:00"),      // explicit offset -> 9/22
      session("Snextweek", "2026-09-27T15:00:00Z"),          // next Mon 00:00 JST -> W40, excluded
    ]);
    const t = await timeline();
    const ids = (date: string) => t.days.find((d: any) => d.date === date).sessions.map((s: any) => s.id);
    expect(ids("2026-09-21")).toEqual(["Smonearly", "Smonfrac"]);
    expect(ids("2026-09-22")).toEqual(["Stueoffs"]);
    expect(t.days.flatMap((d: any) => d.sessions).length).toBe(3);
  });

  it("exposes effective values and totals, and honours hidden", async () => {
    await ingest([
      session("Sa", "2026-09-21T01:00:00Z"),
      session("Sb", "2026-09-21T02:00:00Z", { task_id: null, link_method: "none" }),
      session("Sc", "2026-09-21T03:00:00Z"),
    ]);
    await db().prepare("UPDATE sessions SET summary_edited='人が直した', minutes_override=30 WHERE id='Sa'").run();
    await db().prepare("UPDATE sessions SET hidden=1 WHERE id='Sc'").run();

    const t = await timeline();
    const mon = t.days[0];
    expect(mon.sessions.map((s: any) => s.id)).toEqual(["Sa", "Sb"]);
    expect(mon.sessions[0].summary_effective).toBe("人が直した");
    expect(mon.sessions[0].minutes_effective).toBe(30);
    expect(mon.sessions[0].files_written).toEqual([]);
    expect(mon.sessions[0].tokens).toBeNull();
    expect(mon.sessions[1].summary_effective).toBe("auto Sb");
    expect(mon.minutes).toBe(90);
    expect(t.total_minutes).toBe(90);
    expect(t.unassigned).toBe(1);
    expect(t.hidden).toBe(1);

    const all = await timeline("?include_hidden=1");
    expect(all.days[0].sessions.map((s: any) => s.id)).toEqual(["Sa", "Sb", "Sc"]);
    expect(all.total_minutes).toBe(90);
  });

  it("工作时间 beside the sum: parallel sessions count once in wall_minutes, hidden ones not at all", async () => {
    const iv = (a: string, b: string) => JSON.stringify([[a, b]]);
    await ingest([
      session("Pa", "2026-09-21T01:00:00Z", { ended_at: "2026-09-21T03:00:00Z", active_minutes: 120 }),
      session("Pb", "2026-09-21T02:00:00Z", { ended_at: "2026-09-21T04:00:00Z", active_minutes: 120, task_id: null, link_method: "none" }),
      session("Ph", "2026-09-21T01:00:00Z", { ended_at: "2026-09-21T05:00:00Z", active_minutes: 240 }),
    ]);
    await db().prepare("UPDATE sessions SET active_intervals = ?1 WHERE id = 'Pa'").bind(iv("2026-09-21T01:00:00Z", "2026-09-21T03:00:00Z")).run();
    await db().prepare("UPDATE sessions SET active_intervals = ?1 WHERE id = 'Pb'").bind(iv("2026-09-21T02:00:00Z", "2026-09-21T04:00:00Z")).run();
    await db().prepare("UPDATE sessions SET hidden = 1 WHERE id = 'Ph'").run();
    const t = await timeline();
    expect(t.days[0].minutes).toBe(240);                 // 累計: 120 + 120
    expect(Math.round(t.days[0].wall_minutes)).toBe(180); // 工作时间: 10:00–13:00 JST
    expect(Math.round(t.total_wall_minutes)).toBe(180);
    expect(t.days[1].wall_minutes).toBe(0);
  });

  it("includes notes on their JST day and counts their minutes", async () => {
    await api("/api/notes/N20260922-101500", { method: "PUT", body: JSON.stringify({
      text: "打ち合わせ", task_id: null, minutes: 45, machine: "macmini", ts: "2026-09-22T10:15:00" }) });
    await api("/api/notes/N20260928-000100", { method: "PUT", body: JSON.stringify({
      text: "next week", task_id: null, minutes: 10, machine: "macmini", ts: "2026-09-28T00:01:00" }) });
    const t = await timeline();
    expect(t.days[1].notes.map((n: any) => n.text)).toEqual(["打ち合わせ"]);
    expect(t.days[1].minutes).toBe(45);
    expect(t.total_minutes).toBe(45);
  });

  it("splits a session's minutes over the JST days its active intervals touch", async () => {
    await ingest([
      // Mon 23:30 -> Tue 01:30 JST, one cluster: 30 min on 9/21, 90 on 9/22.
      session("Snight", "2026-09-21T14:30:00Z", {
        ended_at: "2026-09-21T16:30:00Z", active_minutes: 120, task_id: null, link_method: "none",
        active_intervals: [["2026-09-21T14:30:00Z", "2026-09-21T16:30:00Z"]],
      }),
      // Started the previous Sunday (W38), still active on Monday: only the Monday share shows.
      session("Sprev", "2026-09-20T12:00:00Z", {
        ended_at: "2026-09-20T16:00:00Z", active_minutes: 240,
        active_intervals: [["2026-09-20T12:00:00Z", "2026-09-20T16:00:00Z"]],   // Sun 21:00 -> Mon 01:00 JST
      }),
      // No intervals (old row): stays whole on its start day.
      session("Sold", "2026-09-21T01:00:00Z"),
    ]);
    const t = await timeline();
    const day = (date: string) => t.days.find((d: any) => d.date === date);
    const on = (date: string) => day(date).sessions.map((s: any) => [s.id, s.minutes_on_day]);
    expect(on("2026-09-21")).toEqual([["Sprev", 60], ["Sold", 60], ["Snight", 30]]);
    expect(on("2026-09-22")).toEqual([["Snight", 90]]);
    expect(day("2026-09-21").minutes).toBe(150);
    expect(day("2026-09-22").minutes).toBe(90);
    expect(t.total_minutes).toBe(240);
    // The whole-session figures are still on every copy of the card.
    expect(day("2026-09-22").sessions[0].minutes_effective).toBe(120);
    expect(day("2026-09-22").sessions[0].active_intervals).toEqual([["2026-09-21T14:30:00Z", "2026-09-21T16:30:00Z"]]);
    expect(t.unassigned).toBe(1);   // Snight, once, not once per day
  });

  it("scales a minutes_override over the same split", async () => {
    await ingest([
      session("Sovr", "2026-09-21T12:00:00Z", {
        ended_at: "2026-09-21T16:00:00Z", active_minutes: 240,
        active_intervals: [["2026-09-21T12:00:00Z", "2026-09-21T16:00:00Z"]],   // 21:00 -> 01:00 JST: 3h + 1h
      }),
    ]);
    await db().prepare("UPDATE sessions SET minutes_override=200 WHERE id='Sovr'").run();
    const t = await timeline();
    expect(t.days[0].sessions[0].minutes_on_day).toBe(150);
    expect(t.days[1].sessions[0].minutes_on_day).toBe(50);
    expect(t.total_minutes).toBe(200);
  });

  it("rejects a malformed week", async () => {
    const r = await api("/api/weeks/2026-39/timeline");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid week" });
  });
});
