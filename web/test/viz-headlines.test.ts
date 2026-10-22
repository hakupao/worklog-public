import { describe, expect, it } from "vitest";
import type { StatsSession, StatsSessions } from "../src/api/types";
import { deriveHeadlines, medians, streakOf } from "../src/pages/stats/viz/headlines";
import { clock5, hm, hmin, pct } from "../src/pages/stats/viz/fmt";
import { perDay, prepare, segments } from "../src/pages/stats/viz/wall";
import { tv, type VStrKey } from "../src/pages/stats/viz/strings";
import { jst, VIZ } from "./viz-fixture";

const iso = (t: string) => new Date(jst(t)).toISOString();
const one = (id: string, a: string, b: string, over: Partial<StatsSession> = {}): StatsSession => ({
  id, machine: "macmini", agent: "claude-code", task_id: null, started_at: iso(a), ended_at: iso(b),
  active_minutes: 0, turns: 0, files: 0, intervals: [[iso(a), iso(b)]], approx: false,
  tokens: null, subagent_tokens: null, cost_usd: null, cost_partial: false, summary: "", ...over,
});
const run = (d: StatsSessions) => {
  const prep = prepare(d), segs = segments(prep), days = perDay(prep);
  return { days, h: deriveHeadlines(prep, segs, days) };
};

/** 9/21 (Mon) – 9/24 (Thu): 9/21 30 min (under an hour, so out of the start / finish medians), 9/22 idle, 9/23
 *  08:00–09:30, 9/24 06:00–08:00 and 20:00–21:00. No tokens, no prices. */
const MINI: StatsSessions = {
  range: { from: "2026-09-21", to: "2026-09-24" }, day_start: "05:00", plans: [],
  sessions: [
    one("S1", "2026-09-21T10:00", "2026-09-21T10:30"),
    one("S2", "2026-09-23T08:00", "2026-09-23T09:30"),
    one("S3", "2026-09-24T06:00", "2026-09-24T08:00"),
    one("S4", "2026-09-24T20:00", "2026-09-24T21:00"),
  ],
};

describe("deriveHeadlines — the shared fixture (hand-computed)", () => {
  const { h } = run(VIZ);

  it("wall clock 450 vs summed 570; peak ×3 at 9/21 10:30; the fullest day by summed minutes is 9/21 (480 summed, 360 wall)", () => {
    expect(h.sessions).toBe(6);
    expect([h.wall, h.summed]).toEqual([450, 570]);
    expect(h.peak).toEqual({ c: 3, at: jst("2026-09-21T10:30"), date: "2026-09-21" });
    expect(h.dense).toEqual({ date: "2026-09-21", sum: 480, union: 360 });
  });

  it("longest session by in-window wall clock: A, B, D and E all run 120 min — the first in window order (A) wins", () => {
    expect(h.longest).toEqual({ id: "A", task: "T1", wall: 120, t0: jst("2026-09-21T09:00") });
  });

  it("median start / finish (hours after 05:00) over the days with ≥ 60 min: starts 4 and 0 → 2; finishes 24 (9/21 runs to 05:00) and 8.5 → 16.25", () => {
    expect(h.start).toBe(2);
    expect(h.end).toBe(16.25);
    expect(h.workdays).toBe(2);
  });

  it("weekdays: only Monday (360) and Tuesday (90) are in the range — busiest Monday, quietest Tuesday (unreached weekdays ignored)", () => {
    expect(h.wd).toEqual({ best: 0, avg: 360, low: 1, lowAvg: 90 });
  });

  it("costliest priced session: D, $6, unlinked, 215K tokens (B unpriced and F not collected never win)", () => {
    expect(h.costly).toEqual({ id: "D", task: null, cost: 6, t0: jst("2026-09-21T23:30"), tokens: 215000 });
  });

  it("tokens: 415000 in all, 380000 cache read, 7500 output (F has none); active 2 / 2 days, streak 2 from 9/21 to 9/22", () => {
    expect(h.tokens).toEqual({ all: 415000, cacheRead: 380000, output: 7500 });
    expect([h.active, h.days]).toEqual([2, 2]);
    expect(h.streak).toEqual({ len: 2, from: "2026-09-21", to: "2026-09-22" });
  });
});

describe("deriveHeadlines — edges", () => {
  it("a day under an hour stays out of the medians; an idle day breaks the streak; the quietest weekday may be an idle one (0)", () => {
    const { h, days } = run(MINI);
    expect(h.workdays).toBe(2);
    expect(h.start).toBe(2);            // 9/23 08:00 → 3, 9/24 06:00 → 1
    expect(h.end).toBe(10.25);          // 9/23 09:30 → 4.5, 9/24 21:00 → 16
    expect(h.streak).toEqual({ len: 2, from: "2026-09-23", to: "2026-09-24" });
    expect(streakOf(days.slice(0, 2))).toEqual({ len: 1, from: "2026-09-21", to: "2026-09-21" });
    expect(h.wd).toEqual({ best: 3, avg: 180, low: 1, lowAvg: 0 });
    expect([h.active, h.days]).toEqual([3, 4]);
  });

  it("no price and no tokens anywhere: no costliest session, zero tokens", () => {
    const { h } = run(MINI);
    expect(h.costly).toBeNull();
    expect(h.tokens).toEqual({ all: 0, cacheRead: 0, output: 0 });
  });

  it("an odd number of work days takes the middle one", () => {
    const d = { ...MINI, sessions: [...MINI.sessions, one("S5", "2026-09-22T12:00", "2026-09-22T14:00")] };
    const { days } = run(d);
    expect(medians(days)).toEqual({ start: 3, end: 9, n: 3 });  // starts 7 / 3 / 1, finishes 9 / 4.5 / 16
  });

  it("an empty range: nothing to say", () => {
    const { h } = run({ ...MINI, sessions: [] });
    expect(h).toMatchObject({ sessions: 0, wall: 0, summed: 0, peak: null, dense: null, longest: null, start: null, end: null, wd: null, costly: null, active: 0, days: 4, streak: null });
  });
});

describe("viz/fmt", () => {
  it("JST clock, hours after 05:00 as a clock, h/m and percentages", () => {
    expect(hm(jst("2026-09-21T23:30"))).toBe("23:30");
    expect(hm(jst("2026-09-22T04:05"))).toBe("04:05");
    expect([clock5(2), clock5(16.25), clock5(24), clock5(0)]).toEqual(["07:00", "21:15", "05:00", "05:00"]);
    expect([hmin(120), hmin(1214), hmin(5)]).toEqual(["2h00m", "20h14m", "0h05m"]);
    expect([pct(570 / 450 - 1), pct(380000 / 415000, 1), pct(7500 / 415000, 2)]).toEqual(["27%", "91.6%", "1.81%"]);
  });
});

describe("headline lines fit their cell (P4: 里 clipped 同时开着 6 个… and others)", () => {
  // The pixel font in units of a Latin character (up to 5 dots at size 10); a CJK / kana character (and · in the zh font) is 10 dots, two
  // units. A cell at a 1200px window is 230px and a Led w dots wide takes (w + 1) · 3 + 3px: 75 dots, 15 units.
  // Checked in the browser with the real font (shots.md); this keeps the copy inside it at three months' figures.
  const units = (s: string) => [...s].reduce((n, ch) => n + (/[\u00b7\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
  const W = { s: "461.6h", p: "60%", n: 6, d: "9/25", u: "14.2h", h: "6.3h", q: "", l: "0.7h", c: "96.2%", o: "0.3%", k: "686M" };
  const lines: [VStrKey, Record<string, string | number>][] = [
    ["hl.wall.a", W], ["hl.wall.b", W], ["hl.peak.b", W], ["hl.dense.a", W], ["hl.dense.b", W], ["hl.long.a", { d: "9/29 09:46" }],
    ["hl.start.b", W], ["hl.end.b", W], ["hl.med.a", { n: 42 }], ["hl.wd.a", W], ["hl.wd.b", { ...W, q: "WED" }], ["hl.cost.a", { d: "9/4", k: "686M" }],
    ["hl.tok.a", W], ["hl.tok.b", W], ["hl.days.a", { n: 38 }],
  ];
  for (const lang of ["zh", "ja", "en"] as const) it(lang, () => {
    const wd = tv(lang, "wd.name", { d: lang === "en" ? "WED" : lang === "ja" ? "水" : "三" });
    const over = lines.map(([k, v]) => [k, tv(lang, k, k === "hl.wd.b" ? { ...v, q: wd } : v)] as const).filter(([, s]) => units(s) > 15);
    expect(over.map(([k, s]) => `${k} ${units(s)} ${s}`)).toEqual([]);
  });
});
