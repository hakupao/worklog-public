import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildWeek } from "../src/report/weekly";
import { api, resetDb } from "./helpers";

const db = () => (env as any).DB as D1Database;
const build = (week = "2026-W39") => buildWeek(db(), week);   // report week Sat 9/19 05:00 → Sat 9/26 05:00 JST

const session = (id: string, started_at: string, over: Record<string, unknown> = {}) => ({
  id, machine: "macmini", agent: "claude-code", session_id: `${id}-full`, cwd: "/w",
  started_at, ended_at: started_at, active_minutes: 60, turns: 5, summary: `auto ${id}`,
  summary_source: "llm", task_id: null, link_method: "none", ts: "2026-09-21T12:00:00", ...over,
});
const linked = (id: string, started_at: string, task_id: string, over: Record<string, unknown> = {}) =>
  session(id, started_at, { task_id, link_method: "auto-dir", ...over });

const ingest = (sessions: unknown[]) =>
  api("/api/ingest/sessions", { method: "POST", body: JSON.stringify({ machine: "macmini", sessions }) });

const putTask = (id: string, over: Record<string, unknown> = {}) =>
  api(`/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({
    requester: "田中", title: `件名 ${id}`, status: "open", received_at: "2026-09-01",
    machine: "macmini", ts: "2026-09-01T09:00:00", ...over }) });

const putNote = (id: string, ts: string, over: Record<string, unknown> = {}) =>
  api(`/api/notes/${id}`, { method: "PUT", body: JSON.stringify({
    text: `メモ ${id}`, task_id: null, minutes: null, machine: "macmini", ts, ...over }) });

describe("buildWeek", () => {
  beforeEach(resetDb);

  it("returns null for a week that is not a valid ISO week", async () => {
    expect(await build("2026-39")).toBeNull();
    expect(await build("2026-W00")).toBeNull();
    expect(await build("2026-W54")).toBeNull();
    expect(await build("")).toBeNull();
  });

  it("includes a task touched by received_at, done_at, a session or a note, and nothing else", async () => {
    await putTask("T1", { received_at: "2026-09-22" });
    await putTask("T2", { done_at: "2026-09-25", status: "done" });
    await putTask("T3");
    await putTask("T4");
    await putTask("T5");
    await ingest([
      linked("S3", "2026-09-23T01:00:00Z", "T3"),
      linked("S5", "2026-09-14T01:00:00Z", "T5"),   // previous week only
    ]);
    await putNote("N4", "2026-09-24T10:00:00", { task_id: "T4" });
    await putNote("N5", "2026-09-14T10:00:00", { task_id: "T5" });

    const w = (await build())!;
    expect(w.tasks.map((r) => r.task.id)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(w.tasks[0].task.deliverables).toEqual([]);
  });

  it("names the week's automatic 成果物 per task: written / published this week, verdict in, relative to the cwd", async () => {
    await putTask("T1", { deliverables: ["docs/hand.md"] });
    const art = (url: string, title: string, ts: string) => ({ url, title, artifact_id: null, ts });
    await ingest([
      // last week: its file is not this week's
      linked("S0", "2026-09-14T01:00:00Z", "T1", { cwd: "/w", files_written: ["/w/成果物/old.md"] }),
      linked("S1", "2026-09-21T01:00:00Z", "T1", { cwd: "/w", files_written: ["/w/成果物/a.md", "/w/src/x.ts", "/w/docs/hand.md", "/w/成果物/out.md"] }),
      linked("S2", "2026-09-23T01:00:00Z", "T1", { cwd: "/w", files_written: ["/w/成果物/a.md"],
        artifacts: [art("https://claude.ai/artifact/A", "週報ページ", "2026-09-23T02:00:00Z")] }),
      linked("S3", "2026-09-22T01:00:00Z", "T1", { cwd: "/w", files_written: ["/w/成果物/hidden.md"] }),
    ]);
    await db().prepare("UPDATE sessions SET hidden = 1 WHERE id = 'S3'").run();
    await api("/api/deliverable-verdicts", { method: "PUT", body: JSON.stringify({ key: "/w/成果物/out.md", kind: "file", verdict: "out" }) });

    const w = (await build())!;
    expect(w.tasks.find((r) => r.task.id === "T1")!.auto).toEqual([
      { kind: "file", key: "/w/成果物/a.md", label: "成果物/a.md", date: "2026-09-23" },
      { kind: "artifact", key: "https://claude.ai/artifact/A", label: "週報ページ", date: "2026-09-23" },
    ]);
  });

  it("prefers hours_manual, else rounds all linked minutes to a quarter hour", async () => {
    for (const id of ["H1", "H2", "H3", "H4", "H5", "H6"]) await putTask(id, { received_at: "2026-09-21" });
    await api("/api/tasks/H1", { method: "PUT", body: JSON.stringify({
      requester: "田中", title: "件名 H1", status: "open", received_at: "2026-09-21",
      hours_manual: 3.5, machine: "macmini", ts: "2026-09-01T09:00:00" }) });
    await ingest([
      // One after another: on the wall clock, parallel sessions of different tasks would split 1/k.
      linked("SH1", "2026-09-22T01:00:00Z", "H1", { active_minutes: 600 }),
      linked("SH2", "2026-09-22T12:00:00Z", "H2", { active_minutes: 37 }),
      linked("SH3", "2026-09-22T13:00:00Z", "H3", { active_minutes: 8 }),
      linked("SH4", "2026-09-22T14:00:00Z", "H4", { active_minutes: 7 }),
      linked("SH5in", "2026-09-22T15:00:00Z", "H5", { active_minutes: 30 }),
      linked("SH5prev", "2026-09-15T01:00:00Z", "H5", { active_minutes: 30 }),
    ]);
    await putNote("NH6", "2026-09-22T10:00:00", { task_id: "H6", minutes: 45 });
    await putNote("NH6b", "2026-09-22T11:00:00", { task_id: "H6" });   // minutes null counts as 0

    const w = (await build())!;
    expect(Object.fromEntries(w.tasks.map((r) => [r.task.id, r.hours])))
      .toEqual({ H1: 3.5, H2: 0.5, H3: 0.25, H4: 0, H5: 1, H6: 0.75 });
    // The out-of-week session pays into the hours but is not offered to the web page.
    expect(w.tasks.find((r) => r.task.id === "H5")!.sessions.map((s) => s.id)).toEqual(["SH5in"]);
  });

  it("puts a session on its 05:00 JST day, not on the day its UTC string starts with", async () => {
    const one = { active_minutes: 1 };
    await ingest([
      session("Sbefore", "2026-09-18T19:59:00Z", one),   // Sat 9/19 04:59 JST -> Friday 9/18's day, W38
      session("Sfirst", "2026-09-18T20:00:00Z", one),    // Sat 9/19 05:00 JST -> 9/19, first day of W39
      session("Slast", "2026-09-25T19:59:00Z", one),     // Sat 9/26 04:59 JST -> Friday 9/25's day
      session("Safter", "2026-09-25T20:00:00Z", one),    // Sat 9/26 05:00 JST -> W40
    ]);
    const w = (await build())!;
    expect(w.days.map((d) => [d.source.id, d.date]))
      .toEqual([["Sfirst", "2026-09-19"], ["Slast", "2026-09-25"]]);
  });

  it("keeps a Saturday-04:30 note inside the week: notes.ts is already a JST wall clock", async () => {
    await putTask("B1");                        // received 2026-09-01, no session: only the note touches it
    await putTask("B2");
    await putNote("Nfri", "2026-09-26T04:30:00", { task_id: "B1", minutes: 15 });   // Friday 9/25's day
    await putNote("Nprev", "2026-09-19T04:30:00", { task_id: "B2", minutes: 15 });  // Friday 9/18's day, W38

    const w = (await build())!;
    // Converting ts as if it were a UTC instant would push Nfri to 9/26 and pull Nprev in to 9/19.
    expect(w.tasks.map((r) => r.task.id)).toEqual(["B1"]);
    expect(w.days.map((d) => [d.source.id, d.date])).toEqual([["Nfri", "2026-09-25"]]);
    expect(w.tasks[0].hours).toBe(0.25);
  });

  it("breaks ties inside one day and task by time, then by id", async () => {
    await putTask("O1", { received_at: "2026-09-21" });
    await ingest([
      linked("Sb", "2026-09-22T01:00:00Z", "O1"),     // same instant as Sa
      linked("Sa", "2026-09-22T01:00:00Z", "O1"),
    ]);
    await putNote("Nb", "2026-09-22T15:00:00", { task_id: "O1" });
    await putNote("Nc", "2026-09-22T09:00:00", { task_id: "O1" });   // same ts as Na
    await putNote("Na", "2026-09-22T09:00:00", { task_id: "O1" });

    const w = (await build())!;
    expect(w.days.map((d) => d.source.id)).toEqual(["Sa", "Sb", "Na", "Nc", "Nb"]);
  });

  it("honours hidden, summary_edited and minutes_override", async () => {
    await putTask("E1", { received_at: "2026-09-21" });
    await ingest([
      linked("Sa", "2026-09-22T01:00:00Z", "E1"),
      linked("Sb", "2026-09-22T02:00:00Z", "E1"),
      linked("Sc", "2026-09-22T03:00:00Z", "E1"),
      session("Su", "2026-09-22T04:00:00Z"),
    ]);
    await db().prepare("UPDATE sessions SET summary_edited='人が直した', minutes_override=30 WHERE id='Sa'").run();
    await db().prepare("UPDATE sessions SET hidden=1 WHERE id IN ('Sc','Su')").run();

    const w = (await build())!;
    expect(w.days.map((d) => d.source.id)).toEqual(["Sa", "Sb"]);
    expect(w.days[0].text).toBe("人が直した");
    expect(w.days[0].minutes).toBe(30);
    expect(w.tasks[0].hours).toBe(1.5);                                  // (30 + 60) / 60
    expect(w.tasks[0].sessions.map((s) => s.id)).toEqual(["Sa", "Sb"]);
    expect(w.tasks[0].sessions[0]).toEqual({
      id: "Sa", started_at: "2026-09-22T01:00:00Z", summary: "人が直した", minutes: 30, task_id: "E1" });
    expect(w.unassigned_sessions).toBe(0);
    expect(w.unassigned_minutes).toBe(0);
    expect(w.summary.unassigned_hours).toBe(0);
  });

  it("summarises counts, requesters in first-appearance order and two-decimal hours", async () => {
    await putTask("T20260921-03", { requester: "佐藤", received_at: "2026-09-23", hours_manual: 2.45 });
    await putTask("T20260921-01", { requester: "佐藤", received_at: "2026-09-22", hours_manual: 1.1 });
    await putTask("T20260921-02", { requester: "田中", received_at: "2026-09-01",
      done_at: "2026-09-24", status: "done", hours_manual: 0.2 });
    await ingest([session("Sun1", "2026-09-22T01:00:00Z", { active_minutes: 20 })]);
    await putNote("Nun1", "2026-09-22T11:00:00", { minutes: 30 });

    const w = (await build())!;
    expect(w.tasks.map((r) => r.task.id)).toEqual(["T20260921-01", "T20260921-02", "T20260921-03"]);
    expect(w.summary).toEqual({
      week: "2026-W39", week_start: "2026-09-19", week_end: "2026-09-25",
      new: 2, done: 1, ongoing: 2,
      by_requester: [["佐藤", 2], ["田中", 1]],
      total_hours: 0.83,        // the week's wall clock, (20 + 30) / 60 — hours_manual is no part of it
      unassigned_hours: 0.83,   // (20 + 30) / 60
    });
    expect(w.unassigned_sessions).toBe(1);   // the note does not count as a session
    expect(w.unassigned_minutes).toBe(20);
  });

  it("splits a session's minutes over the 05:00 JST days its active intervals touch", async () => {
    await putTask("X1", { received_at: "2026-09-21" });
    await ingest([
      // Mon 04:30 -> 06:30 JST: 30 min on Sunday 9/20's day, 90 on 9/21.
      linked("Snight", "2026-09-20T19:30:00Z", "X1", {
        ended_at: "2026-09-20T21:30:00Z", active_minutes: 120,
        active_intervals: [["2026-09-20T19:30:00Z", "2026-09-20T21:30:00Z"]],
      }),
      // Started on the previous week's Friday day, still active past Saturday 05:00: that share is in the week.
      session("Sprev", "2026-09-18T18:00:00Z", {
        ended_at: "2026-09-18T21:00:00Z", active_minutes: 180,
        active_intervals: [["2026-09-18T18:00:00Z", "2026-09-18T21:00:00Z"]],   // Sat 03:00 -> 06:00 JST
      }),
    ]);
    const w = (await build())!;
    expect(w.days.map((d) => [d.source.id, d.date, d.minutes])).toEqual([
      ["Sprev", "2026-09-19", 60],
      ["Snight", "2026-09-20", 30],
      ["Snight", "2026-09-21", 90],
    ]);
    // Task hours are the whole session; the session is offered to the web page once.
    expect(w.tasks[0].hours).toBe(2);
    expect(w.tasks[0].sessions.map((s) => [s.id, s.minutes])).toEqual([["Snight", 120]]);
    expect(w.unassigned_sessions).toBe(1);
    expect(w.unassigned_minutes).toBe(60);
    expect(w.summary.unassigned_hours).toBe(1);
  });

  it("counts a task with several 依頼元 once under each of them", async () => {
    await putTask("M1", { requester: "佐藤、田中", received_at: "2026-09-22" });
    await putTask("M2", { requester: "田中", received_at: "2026-09-22" });
    await putTask("M3", { requester: "鈴木, 佐藤、佐藤", received_at: "2026-09-22" });

    const w = (await build())!;
    expect(w.summary.by_requester).toEqual([["佐藤", 2], ["田中", 2], ["鈴木", 1]]);
    expect(w.summary.new).toBe(3);
  });

  it("orders days by date, then task with the unassigned first, sessions before notes", async () => {
    await putTask("D1", { received_at: "2026-09-21" });
    await putTask("D2", { received_at: "2026-09-21" });
    await ingest([
      linked("Sd1", "2026-09-22T03:00:00Z", "D1"),
      linked("Sd2late", "2026-09-22T02:00:00Z", "D2"),
      linked("Sd2early", "2026-09-22T00:00:00Z", "D2"),
      session("Sun", "2026-09-22T01:00:00Z"),
      session("Smon", "2026-09-21T01:00:00Z"),
      linked("Sghost", "2026-09-22T05:00:00Z", "GONE"),   // task_id pointing at no task
    ]);
    await putNote("Nun", "2026-09-22T09:00:00");

    const w = (await build())!;
    expect(w.days.map((d) => d.source)).toEqual([
      { kind: "session", id: "Smon" },
      { kind: "session", id: "Sun" },
      { kind: "note", id: "Nun" },
      { kind: "session", id: "Sd1" },
      { kind: "session", id: "Sd2early" },
      { kind: "session", id: "Sd2late" },
      { kind: "session", id: "Sghost" },
    ]);
    expect(w.days.map((d) => d.task_title)).toEqual([
      "その他・調査", "その他・調査", "その他・調査", "件名 D1", "件名 D2", "件名 D2", "その他・調査",
    ]);
    expect(w.days[2].text).toBe("メモ Nun");
    expect(w.days[2].minutes).toBe(0);
    expect(w.unassigned_sessions).toBe(2);   // Smon and Sun; Sghost points at a task, gone or not
    expect(w.unassigned_minutes).toBe(120);
  });
});

describe("buildWeek on the report week (S2)", () => {
  beforeEach(resetDb);
  const w40 = () => buildWeek(db(), "2026-W40");
  // A session with one explicit active interval, both ends given as JST wall clock.
  const jst = (s: string) => new Date(`${s}+09:00`).toISOString();
  const run = (id: string, task_id: string | null, from: string, to: string, over: Record<string, unknown> = {}) => {
    const [a, b] = [jst(from), jst(to)];
    return session(id, a, {
      ended_at: b, active_minutes: (Date.parse(b) - Date.parse(a)) / 60_000, active_intervals: [[a, b]],
      ...(task_id === null ? {} : { task_id, link_method: "auto-dir" }), ...over,
    });
  };
  // T1 Sat 9/26 10:00–12:00; T1 + T2 parallel Mon 9/28 10:00–12:00; unlinked Fri 10/2 23:00 → Sat 10/3 06:00.
  const seed = async () => {
    await putTask("T1");
    await putTask("T2");
    await ingest([
      run("Ssat", "T1", "2026-09-26T10:00:00", "2026-09-26T12:00:00"),
      run("Smon1", "T1", "2026-09-28T10:00:00", "2026-09-28T12:00:00"),
      run("Smon2", "T2", "2026-09-28T10:00:00", "2026-09-28T12:00:00"),
      run("Sfri", null, "2026-10-02T23:00:00", "2026-10-03T06:00:00"),
    ]);
  };

  it("dates are Sat→Fri and day_minutes are wall clock", async () => {
    await seed();
    const d = (await w40())!;
    expect(d.dates).toEqual(["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(d.day_minutes.map(([date]) => date)).toEqual(d.dates);   // all seven days, zeros included
    expect(Object.fromEntries(d.day_minutes)).toMatchObject({
      "2026-09-26": 120, "2026-09-27": 0, "2026-09-28": 120, "2026-10-02": 360,
    });
    expect([d.summary.week_start, d.summary.week_end]).toEqual(["2026-09-26", "2026-10-02"]);
  });

  it("parallel tasks split, task week_minutes and total add up", async () => {
    await seed();
    const d = (await w40())!;
    const wm = Object.fromEntries(d.tasks.map((r) => [r.task.id, r.week_minutes]));
    expect(wm).toEqual({ T1: 180, T2: 60 });               // Sat 120 + Mon half 60; Mon half 60
    expect(d.summary.total_hours).toBeCloseTo((120 + 120 + 360) / 60, 2);
    expect(d.summary.unassigned_hours).toBeCloseTo(6, 2);
  });

  it("the Saturday 05:00 cut keeps 10/3 05:00–06:00 out of W40", async () => {
    await seed();
    const d = (await w40())!;
    expect(d.days.filter((r) => r.date === "2026-10-03")).toEqual([]);
    expect(d.days.find((r) => r.source.id === "Sfri")).toMatchObject({ date: "2026-10-02", minutes: 360 });
  });

  it("splits against sessions of every task, even one the week would not list", async () => {
    // T9 is received long before and only ever ran in W40 — but it is a parallel neighbour of T1.
    await putTask("T1");
    await putTask("T9");
    await ingest([
      run("Sa", "T1", "2026-09-29T10:00:00", "2026-09-29T12:00:00"),
      run("Sb", "T9", "2026-09-29T11:00:00", "2026-09-29T12:00:00"),
    ]);
    const d = (await w40())!;
    expect(Object.fromEntries(d.tasks.map((r) => [r.task.id, r.week_minutes]))).toEqual({ T1: 90, T9: 30 });
  });

  it("lists a task by received_at, done_at, week minutes or a week note, and nothing else", async () => {
    await putTask("A1", { received_at: "2026-09-26" });                      // Saturday: first day of W40
    await putTask("A2", { done_at: "2026-10-02", status: "done" });         // Friday: last day of W40
    await putTask("A3");
    await putTask("A4");
    await putTask("A5", { received_at: "2026-10-03" });                      // Saturday after: W41
    await putTask("A6");
    await ingest([
      run("S3", "A3", "2026-09-30T10:00:00", "2026-09-30T10:30:00"),
      run("S6", "A6", "2026-10-03T05:00:00", "2026-10-03T06:00:00"),        // W41's Saturday day
    ]);
    await putNote("N4", "2026-10-03T04:30:00", { task_id: "A4" });           // 04:30: still Friday's day
    const d = (await w40())!;
    expect(d.tasks.map((r) => r.task.id)).toEqual(["A1", "A2", "A3", "A4"]);
  });

  it("累計 hours sweep all history; sessions and their minutes are the week's share", async () => {
    await putTask("T1");
    await putTask("T2");
    await ingest([
      run("Sold", "T1", "2026-09-14T10:00:00", "2026-09-14T11:00:00"),      // W38, alone: 60
      run("Sa", "T1", "2026-09-28T10:00:00", "2026-09-28T11:00:00"),
      run("Sb", "T2", "2026-09-28T10:00:00", "2026-09-28T11:00:00"),
    ]);
    await putNote("Nold", "2026-09-15T10:00:00", { task_id: "T1", minutes: 15 });
    const d = (await w40())!;
    const t1 = d.tasks.find((r) => r.task.id === "T1")!;
    expect(t1.hours).toBe(1.75);                            // (Sold 60 + Sa's half 30 + Nold 15) / 60
    expect(t1.week_minutes).toBeCloseTo(30);
    expect(t1.sessions.map((s) => [s.id, s.minutes])).toEqual([["Sa", 30]]);
  });

  it("days: one row per (session, 05:00 day) with the rounded wall share; a share that rounds to 0 is dropped", async () => {
    await putTask("T1");
    await putTask("T2");
    await ingest([
      run("Slong", "T1", "2026-09-28T04:00:00", "2026-09-28T06:00:00"),     // 60 on 9/27, 60 on 9/28
      run("Sa", "T1", "2026-09-29T10:00:00", "2026-09-29T11:00:00"),
      run("Stiny", "T2", "2026-09-29T10:00:00", "2026-09-29T10:00:40", { active_minutes: 1 }),   // 40 s halved: 20 s → 0
    ]);
    await putNote("N1", "2026-09-29T15:00:00", { task_id: "T2", minutes: 10 });
    const d = (await w40())!;
    expect(d.days.map((r) => [r.source.id, r.date, r.minutes])).toEqual([
      ["Slong", "2026-09-27", 60], ["Slong", "2026-09-28", 60], ["Sa", "2026-09-29", 60], ["N1", "2026-09-29", 10],
    ]);
  });

  it("history: false reads only the week ±1 day and gives the same week figures, 累計 hours left week-only", async () => {
    await seed();
    await putTask("T3");
    await ingest([
      run("Sold", "T1", "2026-09-14T10:00:00", "2026-09-14T11:00:00"),      // W38: only in 累計
      // started two days before the week, still running at Sat 05:00 (read: its end is in the window)
      run("Slong", "T3", "2026-09-24T23:00:00", "2026-09-26T06:00:00"),
      run("Snext", "T2", "2026-10-03T10:00:00", "2026-10-03T11:00:00"),     // W41
    ]);
    await putNote("Nold", "2026-09-15T10:00:00", { task_id: "T1", minutes: 15 });
    const full = (await buildWeek(db(), "2026-W40"))!;
    const lean = (await buildWeek(db(), "2026-W40", null, { history: false }))!;
    const strip = (d: typeof full) => ({ ...d, tasks: d.tasks.map(({ hours: _h, ...r }) => r) });
    expect(strip(lean)).toEqual(strip(full));
    expect(full.days.find((r) => r.source.id === "Slong")).toMatchObject({ date: "2026-09-26", minutes: 60 });
    expect(full.tasks.find((r) => r.task.id === "T1")!.hours).toBe(4.25);   // Sold 60 + Sat 120 + Mon half 60 + Nold 15
    expect(lean.tasks.find((r) => r.task.id === "T1")!.hours).toBe(3);      // the week's 180 only
  });

  it("unassigned: hours from the UNLINKED bucket, sessions and minutes from their week share, notes left out", async () => {
    await putTask("T1");
    await ingest([
      run("Su1", null, "2026-09-29T10:00:00", "2026-09-29T11:00:00"),
      run("Su2", null, "2026-09-29T10:30:00", "2026-09-29T11:00:00"),
      run("St", "T1", "2026-09-29T10:00:00", "2026-09-29T11:00:00"),
      run("Sout", null, "2026-09-20T10:00:00", "2026-09-20T11:00:00"),     // another week
    ]);
    await putNote("Nu", "2026-09-30T10:00:00", { minutes: 30 });
    const d = (await w40())!;
    // 10:00–11:00: UNLINKED and T1 halve the hour → 30 to UNLINKED; + the 30-minute note.
    expect(d.summary.unassigned_hours).toBe(1);
    expect(d.unassigned_sessions).toBe(2);
    expect(d.unassigned_minutes).toBe(30);                 // Su1 22.5 + Su2 7.5, no note
    expect(d.summary.total_hours).toBe(1.5);               // 60 wall + 30 note
  });
});
