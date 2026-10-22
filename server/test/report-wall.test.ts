import { describe, expect, it } from "vitest";
import { UNLINKED, bucketTotal, daySum, dayTotal, wallSplit, wallWindow, type WallSession } from "../src/report/wall";

const z = (s: string) => new Date(`${s}+09:00`).toISOString();
const S = (id: string, task: string | null, ivs: [string, string][], over?: number): WallSession => ({
  id, task_id: task, started_at: z(ivs[0][0]), intervals: ivs.map(([a, b]) => [z(a), z(b)]),
  minutes: over ?? 0, override: over !== undefined,
});

describe("wallSplit", () => {
  it("累計 (sum): every session's own minutes, parallel ones each in full; overrides and notes add whole", () => {
    const w = wallSplit([
      S("a", "T1", [["2026-09-28T10:00:00", "2026-09-28T12:00:00"]]),
      S("b", "T1", [["2026-09-28T11:00:00", "2026-09-28T13:00:00"]]),
      S("c", "T2", [["2026-09-28T12:00:00", "2026-09-28T14:00:00"]]),
      S("o", "T2", [["2026-09-28T15:00:00", "2026-09-28T15:00:00"]], 45),
    ], [{ id: "n", task_id: null, ts: "2026-09-28T16:00:00", minutes: 20 }]);
    expect(dayTotal(w, "2026-09-28")).toBeCloseTo(240 + 45 + 20);
    expect(daySum(w, "2026-09-28")).toBeCloseTo(120 * 3 + 45 + 20);
    expect(daySum(wallWindow(w, "2026-09-28", "2026-09-28"), "2026-09-28")).toBeCloseTo(425);
  });

  it("dayStartHour 0: calendar days instead of 05:00 days", () => {
    const ss = [S("a", "T1", [["2026-09-28T03:00:00", "2026-09-28T06:00:00"]])];
    const five = wallSplit(ss, []), zero = wallSplit(ss, [], undefined, 0);
    expect([dayTotal(five, "2026-09-27"), dayTotal(five, "2026-09-28")].map(Math.round)).toEqual([120, 60]);
    expect([dayTotal(zero, "2026-09-27"), dayTotal(zero, "2026-09-28")].map(Math.round)).toEqual([0, 180]);
    const win = wallSplit(ss, [], { from: "2026-09-28", to: "2026-09-28" }, 0);
    expect(Math.round(dayTotal(win, "2026-09-28"))).toBe(180);
    expect(Math.round(daySum(win, "2026-09-28"))).toBe(180);
  });

  it("same task in parallel counts once; different tasks split 1/k", () => {
    const w = wallSplit([
      S("a", "T1", [["2026-09-28T10:00:00", "2026-09-28T12:00:00"]]),
      S("b", "T1", [["2026-09-28T11:00:00", "2026-09-28T13:00:00"]]),   // same task overlaps 11–12
      S("c", "T2", [["2026-09-28T12:00:00", "2026-09-28T14:00:00"]]),   // T2 overlaps T1 12–13
    ], []);
    // T1: 10–12 (120) + 12–13 half (30) = 150; T2: 12–13 half (30) + 13–14 (60) = 90; union 10–14 = 240
    expect(bucketTotal(w, "T1")).toBeCloseTo(150);
    expect(bucketTotal(w, "T2")).toBeCloseTo(90);
    expect(dayTotal(w, "2026-09-28")).toBeCloseTo(240);
    // within T1, 11–12 is shared by a and b: a = 60 + 30 = 90, b = 30 + 30 (12–13 half) = 60
    expect(w.sessions.get("a")!.get("2026-09-28")).toBeCloseTo(90);
    expect(w.sessions.get("b")!.get("2026-09-28")).toBeCloseTo(60);
  });

  it("unlinked is one bucket and shares with a task", () => {
    const w = wallSplit([
      S("u1", null, [["2026-09-28T10:00:00", "2026-09-28T11:00:00"]]),
      S("u2", null, [["2026-09-28T10:00:00", "2026-09-28T11:00:00"]]),
      S("t", "T1", [["2026-09-28T10:00:00", "2026-09-28T11:00:00"]]),
    ], []);
    expect(bucketTotal(w, UNLINKED)).toBeCloseTo(30);
    expect(bucketTotal(w, "T1")).toBeCloseTo(30);
  });

  it("cuts at 05:00 JST: 04:00–06:00 is 60 on each 05:00-day", () => {
    const w = wallSplit([S("a", "T1", [["2026-10-03T04:00:00", "2026-10-03T06:00:00"]])], []);
    expect(dayTotal(w, "2026-10-02")).toBeCloseTo(60);
    expect(dayTotal(w, "2026-10-03")).toBeCloseTo(60);
  });

  it("override minutes are added whole to the start day, outside the sweep", () => {
    const w = wallSplit([
      S("a", "T1", [["2026-09-28T10:00:00", "2026-09-28T11:00:00"]]),
      S("o", "T2", [["2026-09-28T10:00:00", "2026-09-28T18:00:00"]], 15),
    ], []);
    expect(bucketTotal(w, "T1")).toBeCloseTo(60);   // not halved by the overridden session
    expect(bucketTotal(w, "T2")).toBeCloseTo(15);
  });

  it("a session without intervals runs from started_at for its minutes; notes add whole minutes", () => {
    const w = wallSplit(
      [{ id: "x", task_id: "T1", started_at: z("2026-09-28T09:00:00"), intervals: null, minutes: 30, override: false }],
      [{ id: "N1", task_id: "T1", ts: "2026-09-29T02:00:00", minutes: 20 }],   // naive JST 02:00 → 9/28's 05:00-day
    );
    expect(dayTotal(w, "2026-09-28")).toBeCloseTo(50);
    expect(w.notes.get("N1")).toEqual({ date: "2026-09-28", minutes: 20 });
  });

  it("window keeps only its 05:00-days", () => {
    const w = wallSplit([S("a", "T1", [["2026-10-02T23:00:00", "2026-10-03T07:00:00"]])], [], { from: "2026-09-26", to: "2026-10-02" });
    expect([...w.days.keys()]).toEqual(["2026-10-02"]);
    expect(dayTotal(w, "2026-10-02")).toBeCloseTo(360);   // 23:00 → 05:00
  });

  it("an interval over several days is cut at every 05:00", () => {
    const w = wallSplit([S("a", "T1", [["2026-09-28T03:00:00", "2026-10-01T07:00:00"]])], []);
    expect(Object.fromEntries([...w.days.keys()].map((d) => [d, dayTotal(w, d)]))).toEqual({
      "2026-09-27": 120, "2026-09-28": 1440, "2026-09-29": 1440, "2026-09-30": 1440, "2026-10-01": 120,
    });
  });

  it("a piece starting exactly at 05:00 belongs wholly to that day", () => {
    const w = wallSplit([S("a", "T1", [["2026-09-29T05:00:00", "2026-09-29T06:00:00"]])], []);
    expect([...w.days.keys()]).toEqual(["2026-09-29"]);
    expect(dayTotal(w, "2026-09-29")).toBeCloseTo(60);
  });

  it("touching and nested pieces of one session are not counted twice", () => {
    const w = wallSplit([S("a", "T1", [
      ["2026-09-28T10:00:00", "2026-09-28T11:00:00"],
      ["2026-09-28T11:00:00", "2026-09-28T12:00:00"],   // touches the first
      ["2026-09-28T10:15:00", "2026-09-28T10:45:00"],   // nested in the first
    ])], []);
    expect(dayTotal(w, "2026-09-28")).toBeCloseTo(120);
    expect(w.sessions.get("a")!.get("2026-09-28")).toBeCloseTo(120);
  });

  it("a note whose ts carries an offset or Z is read as that instant", () => {
    const w = wallSplit([], [
      { id: "Noff", task_id: "T1", ts: "2026-09-21T09:00:00+09:00", minutes: 10 },
      { id: "Nz", task_id: "T1", ts: "2026-09-21T19:30:00Z", minutes: 5 },    // 9/22 04:30 JST → 9/21's day
      { id: "Nnaive", task_id: "T1", ts: "2026-09-22T04:30:00", minutes: 1 },
    ]);
    expect(w.notes.get("Noff")).toEqual({ date: "2026-09-21", minutes: 10 });
    expect(w.notes.get("Nz")).toEqual({ date: "2026-09-21", minutes: 5 });
    expect(w.notes.get("Nnaive")).toEqual({ date: "2026-09-21", minutes: 1 });
  });

  it("skips a note or an overridden session whose time does not parse, instead of throwing", () => {
    const w = wallSplit(
      [
        { id: "o", task_id: "T1", started_at: "not a date", intervals: null, minutes: 30, override: true },
        { id: "x", task_id: "T1", started_at: "garbage", intervals: null, minutes: 30, override: false },
        S("ok", "T1", [["2026-09-28T10:00:00", "2026-09-28T11:00:00"]]),
      ],
      [{ id: "Nbad", task_id: "T1", ts: "2026-13-45Tzz", minutes: 10 }],
    );
    expect(w.sessions.has("o")).toBe(false);
    expect(w.sessions.has("x")).toBe(false);
    expect(w.notes.has("Nbad")).toBe(false);
    expect(bucketTotal(w, "T1")).toBeCloseTo(60);
  });

  it("sweep matches a per-minute reference on 300 random sessions and stays fast", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const base = Date.parse("2026-09-28T00:00:00+09:00");
    const MIN = 60_000, span = 3 * 1440;                      // 3 days of minutes, crossing two 05:00 boundaries
    const ss: WallSession[] = [];
    for (let i = 0; i < 300; i++) {
      const a = Math.floor(rnd() * span), len = 1 + Math.floor(rnd() * 240);
      const task = rnd() < 0.2 ? null : `T${Math.floor(rnd() * 5)}`;
      ss.push({ id: `s${i}`, task_id: task, started_at: new Date(base + a * MIN).toISOString(),
        intervals: [[new Date(base + a * MIN).toISOString(), new Date(base + (a + len) * MIN).toISOString()]], minutes: 0, override: false });
    }
    const t0 = performance.now();
    const w = wallSplit(ss, []);
    expect(performance.now() - t0).toBeLessThan(200);

    const ref = new Map<string, number>();                    // `${date}|${session}` → minutes
    for (let m = 0; m < span + 240; m++) {
      const t = base + m * MIN, date = new Date(t + 9 * 3_600_000 - 5 * 3_600_000).toISOString().slice(0, 10);
      const open = ss.filter((s) => Date.parse(s.intervals![0][0]) <= t && Date.parse(s.intervals![0][1]) > t);
      if (!open.length) continue;
      const per = new Map<string, WallSession[]>();
      for (const s of open) (per.get(s.task_id ?? "") ?? per.set(s.task_id ?? "", []).get(s.task_id ?? "")!).push(s);
      for (const group of per.values()) for (const s of group) ref.set(`${date}|${s.id}`, (ref.get(`${date}|${s.id}`) ?? 0) + 1 / per.size / group.length);
    }
    for (const [k, v] of ref) {
      const [date, id] = k.split("|");
      expect(w.sessions.get(id)!.get(date)).toBeCloseTo(v, 6);
    }
    const sum = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
    expect([...w.sessions.values()].reduce((x, m) => x + sum(m), 0)).toBeCloseTo([...ref.values()].reduce((x, y) => x + y, 0), 6);
  });

  it("wallWindow: the all-time sweep cut to a week equals the windowed sweep, exactly (every 05:00 is a sweep point)", () => {
    const window = { from: "2026-09-26", to: "2026-10-02" };   // W40: Sat 05:00 9/26 → Sat 05:00 10/3
    const sessions = [
      S("pre", "T1", [["2026-09-20T10:00:00", "2026-09-20T11:00:00"]]),                         // an earlier week only
      S("in", "T1", [["2026-09-26T03:00:00", "2026-09-26T07:30:00"]]),                          // over the week's opening 05:00
      S("par", "T2", [["2026-09-26T04:00:00", "2026-09-26T06:00:00"], ["2026-09-29T04:20:00", "2026-09-29T05:40:00"]]),
      S("un", null, [["2026-09-29T04:50:00", "2026-09-29T05:10:00"]]),                          // over a mid-week 05:00, 3 buckets
      S("out", "T2", [["2026-10-03T03:00:00", "2026-10-03T09:00:00"]]),                         // over the week's closing 05:00
      S("ov", "T1", [["2026-10-01T10:00:00", "2026-10-01T10:00:00"]], 25),                      // override, in the week
      S("ov2", "T1", [["2026-10-05T10:00:00", "2026-10-05T10:00:00"]], 25),                     // override, after it
      { id: "nf", task_id: "T1", started_at: z("2026-09-30T23:00:00"), intervals: null, minutes: 7.5, override: false },
    ];
    const notes = [
      { id: "n1", task_id: "T1", ts: "2026-09-26T04:59:00", minutes: 10 },                      // Fri 9/25: out
      { id: "n2", task_id: "T2", ts: "2026-09-26T05:00:00", minutes: 10 },                      // Sat 9/26: in
      { id: "n3", task_id: null, ts: "2026-10-03T04:00:00", minutes: null },                    // Fri 10/2: in
    ];
    const all = wallSplit(sessions, notes);
    expect(all.days.has("2026-09-20") && all.days.has("2026-10-03")).toBe(true);   // the fixture does cross the week
    expect(wallWindow(all, window.from, window.to)).toEqual(wallSplit(sessions, notes, window));
  });
});
