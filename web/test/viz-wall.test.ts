import { describe, expect, it } from "vitest";
import type { StatsSession, StatsSessions } from "../src/api/types";
import { dayStartMs, DAY_MS } from "../src/pages/stats/viz/day";
import { geMin, peak, perDay, prepare, segments, splitBy, summedMin, unionMin } from "../src/pages/stats/viz/wall";
import { jst, VIZ } from "./viz-fixture";

const D21 = dayStartMs("2026-09-21"), D22 = dayStartMs("2026-09-22");
const byTask = (s: StatsSession) => s.task_id ?? "";
const obj = (m: Map<string, number>) => Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]));

/** A range with hand-made sessions (intervals in JST wall clock). */
const mk = (from: string, to: string, ss: { id: string; iv: [string, string][]; task?: string | null }[]): StatsSessions => ({
  range: { from, to }, day_start: "05:00", plans: [],
  sessions: ss.map(({ id, iv, task }) => ({
    id, machine: "macmini", agent: "claude-code", task_id: task ?? null,
    started_at: new Date(jst(iv[0][0])).toISOString(), ended_at: new Date(jst(iv[iv.length - 1][1])).toISOString(),
    active_minutes: 0, turns: 0, files: 0, intervals: iv.map(([a, b]) => [new Date(jst(a)).toISOString(), new Date(jst(b)).toISOString()]),
    approx: false, tokens: null, subagent_tokens: null, cost_usd: null, cost_partial: false, summary: "",
  })),
});

describe("prepare", () => {
  const p = prepare(VIZ);

  it("window is [from 05:00, to+1 05:00); sessions outside it are dropped", () => {
    expect(p.from).toBe("2026-09-21");
    expect(p.to).toBe("2026-09-22");
    expect(p.a).toBe(D21);
    expect(p.b).toBe(D22 + DAY_MS);
    expect(p.sessions.map((s) => s.id)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect([...p.byId.keys()].sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(p.byId.get("X")).toBeUndefined();
    expect(p.byId.get("C")?.machine).toBe("win11");
  });

  it("intervals parsed (both ISO spellings), zero-length dropped; t0 / t1 / wall", () => {
    const A = p.byId.get("A")!, B = p.byId.get("B")!, D = p.byId.get("D")!;
    expect(A.iv).toEqual([[jst("2026-09-21T09:00"), jst("2026-09-21T11:00")]]);
    expect(A.wall).toBe(120);
    expect(B.iv).toEqual([[jst("2026-09-21T10:00"), jst("2026-09-21T12:00")]]);
    expect([D.t0, D.t1]).toEqual([jst("2026-09-21T23:30"), jst("2026-09-22T01:30")]);
    expect(p.byId.get("F")!.wall).toBe(30);
  });

  it("clips to the window, sorts, keeps the session's fields", () => {
    const d = mk("2026-09-21", "2026-09-21", [
      { id: "edge", task: "T9", iv: [["2026-09-22T04:00", "2026-09-22T07:00"], ["2026-09-21T03:00", "2026-09-21T06:00"]] },
      { id: "out", iv: [["2026-09-22T05:00", "2026-09-22T06:00"]] },
    ]);
    const q = prepare(d);
    expect(q.sessions.map((s) => s.id)).toEqual(["edge"]);
    const e = q.sessions[0];
    expect(e.iv).toEqual([[jst("2026-09-21T05:00"), jst("2026-09-21T06:00")], [jst("2026-09-22T04:00"), jst("2026-09-22T05:00")]]);
    expect([e.t0, e.t1, e.wall]).toEqual([jst("2026-09-21T05:00"), jst("2026-09-22T05:00"), 120]);
    expect(e.task_id).toBe("T9");
  });

  it("sessions are ordered by first clipped start", () => {
    const q = prepare(mk("2026-09-21", "2026-09-21", [
      { id: "late", iv: [["2026-09-21T12:00", "2026-09-21T13:00"]] },
      { id: "early", iv: [["2026-09-21T08:00", "2026-09-21T09:00"]] },
    ]));
    expect(q.sessions.map((s) => s.id)).toEqual(["early", "late"]);
  });
});

describe("segments and their measures", () => {
  const p = prepare(VIZ);

  it("event sweep over the whole window", () => {
    const segs = segments(p);
    expect(segs.map((g) => [new Date(g.a + 9 * 3_600_000).toISOString().slice(5, 16), (g.b - g.a) / 60_000, g.ids.join("")])).toEqual([
      ["09-21T09:00", 60, "A"],
      ["09-21T10:00", 30, "AB"],
      ["09-21T10:30", 30, "ABC"],
      ["09-21T11:00", 30, "BC"],
      ["09-21T11:30", 30, "B"],
      ["09-21T23:30", 120, "D"],
      ["09-22T04:00", 120, "E"],
      ["09-22T13:00", 30, "F"],
    ]);
    expect(unionMin(segs)).toBe(450);
    expect(summedMin(segs)).toBe(570);
    expect(peak(segs)).toEqual({ c: 3, at: jst("2026-09-21T10:30") });
    expect(geMin(segs, 1)).toBe(450);
    expect(geMin(segs, 2)).toBe(90);
    expect(geMin(segs, 3)).toBe(30);
    expect(geMin(segs, 4)).toBe(0);
  });

  it("clipping to [a, b) cuts at 05:00", () => {
    const d22 = segments(p, D22, D22 + DAY_MS);
    expect(d22.map((g) => [g.a, g.b, g.ids])).toEqual([
      [jst("2026-09-22T05:00"), jst("2026-09-22T06:00"), ["E"]],
      [jst("2026-09-22T13:00"), jst("2026-09-22T13:30"), ["F"]],
    ]);
    expect(unionMin(segments(p, D21, D22))).toBe(360);
    expect(summedMin(segments(p, D21, D22))).toBe(480);
  });

  it("at one instant closes come before opens; back-to-back intervals of the same set merge", () => {
    const q = prepare(mk("2026-09-21", "2026-09-21", [
      { id: "P", iv: [["2026-09-21T09:00", "2026-09-21T10:00"], ["2026-09-21T10:00", "2026-09-21T11:00"]] },
      { id: "Q", iv: [["2026-09-21T11:00", "2026-09-21T12:00"]] },
    ]));
    const segs = segments(q);
    expect(segs.map((g) => [g.a, g.b, g.ids])).toEqual([
      [jst("2026-09-21T09:00"), jst("2026-09-21T11:00"), ["P"]],
      [jst("2026-09-21T11:00"), jst("2026-09-21T12:00"), ["Q"]],
    ]);
    expect(peak(segs)?.c).toBe(1);
    expect(summedMin(segs)).toBe(180);
  });

  it("peak is the first segment with the highest concurrency; nothing → null", () => {
    const q = prepare(mk("2026-09-21", "2026-09-21", [
      { id: "P", iv: [["2026-09-21T09:00", "2026-09-21T10:00"], ["2026-09-21T12:00", "2026-09-21T13:00"]] },
      { id: "Q", iv: [["2026-09-21T09:30", "2026-09-21T10:30"], ["2026-09-21T12:30", "2026-09-21T13:30"]] },
    ]));
    expect(peak(segments(q))).toEqual({ c: 2, at: jst("2026-09-21T09:30") });
    expect(peak([])).toBeNull();
    expect(unionMin([])).toBe(0);
    expect(summedMin([])).toBe(0);
  });
});

describe("splitBy (U17: k keys share a segment evenly)", () => {
  const p = prepare(VIZ);

  it("by task on 9/21: T1 105, T2 135, unlinked 120 — sums to the wall clock", () => {
    const segs = segments(p, D21, D22);
    const m = splitBy(segs, p, byTask);
    expect(obj(m)).toEqual({ T1: 105, T2: 135, "": 120 });
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(unionMin(segs));
  });

  it("by machine on 9/21: macmini 330, win11 30", () => {
    expect(obj(splitBy(segments(p, D21, D22), p, (s) => s.machine))).toEqual({ macmini: 330, win11: 30 });
  });

  it("by agent over the range; same key twice in one segment counts once", () => {
    const segs = segments(p);
    // codex (B) shares 10:00–11:30 with claude-code (90 min → 45 each; A + C at 10:30 are one key) and holds 11:30–12:00 alone
    expect(obj(splitBy(segs, p, (s) => s.agent))).toEqual({ "claude-code": 375, codex: 75 });
    expect(obj(splitBy(segs, p, () => "all"))).toEqual({ all: 450 });
  });
});

describe("perDay", () => {
  const p = prepare(VIZ);

  it("one row per 5:00 day with the hand-computed numbers", () => {
    const [d21, d22] = perDay(p);
    expect(d21).toEqual({
      date: "2026-09-21", union: 360, sum: 480, peak: 3, peakAt: jst("2026-09-21T10:30"),
      first: jst("2026-09-21T09:00"), last: jst("2026-09-22T05:00"),
      ge: [0, 360, 90, 30, 0, 0, 0], ids: ["A", "B", "C", "D", "E"],
    });
    expect(d22).toEqual({
      date: "2026-09-22", union: 90, sum: 90, peak: 1, peakAt: jst("2026-09-22T05:00"),
      first: jst("2026-09-22T05:00"), last: jst("2026-09-22T13:30"),
      ge: [0, 90, 0, 0, 0, 0, 0], ids: ["E", "F"],
    });
  });

  it("empty days are kept, with nulls", () => {
    const days = perDay(prepare({ ...VIZ, range: { from: "2026-09-20", to: "2026-09-24" } }));
    expect(days.map((d) => d.date)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]);
    expect(days[0].union).toBe(60); // X now inside the window
    expect(days[3]).toEqual({ date: "2026-09-23", union: 0, sum: 0, peak: 0, peakAt: null, first: null, last: null, ge: [0, 0, 0, 0, 0, 0, 0], ids: [] });
  });

  it("ge caps at 6", () => {
    const ss = Array.from({ length: 7 }, (_, i) => ({ id: `S${i}`, iv: [["2026-09-21T09:00", "2026-09-21T10:00"]] as [string, string][] }));
    const [d] = perDay(prepare(mk("2026-09-21", "2026-09-21", ss)));
    expect(d.peak).toBe(7);
    expect(d.ge).toEqual([0, 60, 60, 60, 60, 60, 60]);
    expect(d.sum).toBe(420);
  });
});

describe("a single session (spec §5.2 boundary)", () => {
  it("one session in two pieces: wall = union = sum, peak 1 at its start, nothing parallel, all of it to its task and its one day", () => {
    const p = prepare(mk("2026-09-21", "2026-09-21", [{ id: "S", task: "T1", iv: [["2026-09-21T09:00", "2026-09-21T10:00"], ["2026-09-21T11:00", "2026-09-21T11:30"]] }]));
    expect(p.sessions.map((s) => [s.id, s.wall, s.t0, s.t1])).toEqual([["S", 90, jst("2026-09-21T09:00"), jst("2026-09-21T11:30")]]);
    const segs = segments(p);
    expect(segs).toEqual([
      { a: jst("2026-09-21T09:00"), b: jst("2026-09-21T10:00"), ids: ["S"] },
      { a: jst("2026-09-21T11:00"), b: jst("2026-09-21T11:30"), ids: ["S"] },
    ]);
    expect([unionMin(segs), summedMin(segs), geMin(segs, 2)]).toEqual([90, 90, 0]);
    expect(peak(segs)).toEqual({ c: 1, at: jst("2026-09-21T09:00") });
    expect(obj(splitBy(segs, p, byTask))).toEqual({ T1: 90 });
    expect(perDay(p)).toEqual([{
      date: "2026-09-21", union: 90, sum: 90, peak: 1, peakAt: jst("2026-09-21T09:00"),
      first: jst("2026-09-21T09:00"), last: jst("2026-09-21T11:30"), ge: [0, 90, 0, 0, 0, 0, 0], ids: ["S"],
    }]);
  });
});

describe("hand-edited minutes (R2)", () => {
  it("the views go by the real active intervals: a session cut to 10 minutes by hand (active_minutes) still counts its 8h", () => {
    const d = mk("2026-09-21", "2026-09-21", [{ id: "H", iv: [["2026-09-21T09:00", "2026-09-21T17:00"]] }]);
    d.sessions[0].active_minutes = 10;                               // the server sends minutes_override here
    const p = prepare(d);
    expect(p.byId.get("H")!.wall).toBe(480);
    expect(perDay(p)[0].union).toBe(480);
  });
});
