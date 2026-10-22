import { describe, expect, it } from "vitest";
import { J, machine, session, task } from "../src/predict/fixtures";
import { activeMs, buildSnapshot, minutesOn, type SnapInput } from "../src/predict/snapshot";

const T = (s: string) => Date.parse(J(s));
const input = (now: string, o: Partial<SnapInput> = {}): SnapInput => ({
  now: T(now), machines: [], sessions: [], tasks: [], planItems: [], dayPlan: null, downloads: [], ...o,
});

describe("buildSnapshot", () => {
  it("previous workday skips weekends by default and honours an injected isOff", () => {
    expect(buildSnapshot(input("2026-11-04 10:00"), 10).prevWorkday).toBe("2026-11-03");
    expect(buildSnapshot(input("2026-11-04 10:00"), 10, (d) => d === "2026-11-03" || d === "2026-11-02").prevWorkday).toBe("2026-11-01");   // an injected isOff replaces the whole rule, weekends included
  });
  it("empty input: no sessions, no machines, the calendar still fills in", () => {
    const s = buildSnapshot(input("2026-10-05 09:00"), 10);
    expect(s).toMatchObject({ date: "2026-10-05", week: "2026-W41", reportWeek: "2026-W41", prevWorkday: "2026-10-02", sessions: [], machines: [], running: [] });
  });

  it("dedupes a session listed under two days, drops hidden ones, nulls links to deleted tasks", () => {
    const a = session("A", "2026-10-01 23:30", "2026-10-02 00:20", { task_id: "T1" });
    const s = buildSnapshot(input("2026-10-02 09:00", {
      sessions: [a, a, session("H", "2026-10-02 08:00", "2026-10-02 08:30", { hidden: 1 }), session("G", "2026-10-02 08:00", "2026-10-02 08:10", { task_id: "GONE" })],
      tasks: [task("T1", "one")],
    }), 10);
    expect(s.sessions.map((x) => x.id)).toEqual(["A", "G"]);
    expect(s.sessions.map((x) => x.taskId)).toEqual(["T1", null]);
  });

  it("a cross-midnight session belongs to both days, its minutes split by the time on each", () => {
    const s = buildSnapshot(input("2026-10-02 09:00", { sessions: [session("A", "2026-10-01 23:30", "2026-10-02 00:20")] }), 10);
    const x = s.sessions[0];
    expect(x.days).toEqual(["2026-10-01", "2026-10-02"]);
    expect([minutesOn(x, "2026-10-01"), minutesOn(x, "2026-10-02"), minutesOn(x, "2026-10-03")]).toEqual([30, 20, 0]);
    expect(activeMs(x, T("2026-10-02 00:00"), T("2026-10-03 00:00"))).toBe(20 * 60_000);
  });

  it("without active_intervals the whole start–end span is the activity", () => {
    const s = buildSnapshot(input("2026-10-02 12:00", { sessions: [session("A", "2026-10-02 10:00", "2026-10-02 11:00", { active_intervals: null })] }), 10);
    expect(s.sessions[0].intervals).toEqual([[T("2026-10-02 10:00"), T("2026-10-02 11:00")]]);
  });

  it("without active_intervals all minutes stay on the start day, like the server's split", () => {
    const s = buildSnapshot(input("2026-10-02 09:00", { sessions: [session("A", "2026-10-01 23:30", "2026-10-02 00:20", { active_intervals: null })] }), 10);
    const x = s.sessions[0];
    expect(x.days).toEqual(["2026-10-01"]);
    expect([minutesOn(x, "2026-10-01"), minutesOn(x, "2026-10-02")]).toEqual([50, 0]);
  });

  it("the timeline's per-day minutes win over re-splitting", () => {
    const s = buildSnapshot(input("2026-10-02 09:00", {
      sessions: [session("A", "2026-10-01 23:30", "2026-10-02 00:20")],
      dayMinutes: { A: { "2026-10-01": 31, "2026-10-02": 19 } },
    }), 10);
    expect([minutesOn(s.sessions[0], "2026-10-01"), minutesOn(s.sessions[0], "2026-10-02"), minutesOn(s.sessions[0], "2026-10-03")]).toEqual([31, 19, 0]);
  });

  it("drops a session whose timestamps do not parse", () => {
    const bad = { ...session("B", "2026-10-02 10:00", "2026-10-02 11:00"), started_at: "garbage" };
    expect(buildSnapshot(input("2026-10-02 12:00", { sessions: [bad] }), 10).sessions).toEqual([]);
  });

  describe("running (spec §7.4)", () => {
    const two = [
      session("A", "2026-10-02 13:00", "2026-10-02 13:55", { active_intervals: [[J("2026-10-02 13:00"), J("2026-10-02 13:20")], [J("2026-10-02 13:40"), J("2026-10-02 13:55")]] }),
      session("B", "2026-10-02 13:00", "2026-10-02 13:30"),
    ];
    it("last activity within runningMin of the machine's collection; elapsed from the current cluster", () => {
      const s = buildSnapshot(input("2026-10-02 14:20", { machines: [machine("macmini", "2026-10-02 14:00")], sessions: two }), 10);
      expect(s.running.map((r) => [r.session.id, r.since, r.until])).toEqual([["A", T("2026-10-02 13:40"), T("2026-10-02 13:55")]]);
      expect(buildSnapshot(input("2026-10-02 14:20", { machines: [machine("macmini", "2026-10-02 14:00")], sessions: two }), 30).running.map((r) => r.session.id)).toEqual(["B", "A"]);   // ordered by since: B 13:00, A 13:40
    });
    it("a stale machine runs nothing", () => {
      const s = buildSnapshot(input("2026-10-02 17:00", { machines: [machine("macmini", "2026-10-02 14:00")], sessions: two }), 10);
      expect(s.machines[0]).toMatchObject({ name: "macmini", fresh: false });
      expect(s.running).toEqual([]);
    });
    it("one fresh, one stale: only the fresh machine's sessions run", () => {
      const s = buildSnapshot(input("2026-10-02 16:20", {
        machines: [machine("win11", "2026-10-02 10:00"), machine("macmini", "2026-10-02 16:00")],
        sessions: [session("M", "2026-10-02 15:00", "2026-10-02 16:00"), session("W", "2026-10-02 09:00", "2026-10-02 10:00", { machine: "win11" })],
      }), 10);
      expect(s.machines.map((m) => [m.name, m.fresh])).toEqual([["macmini", true], ["win11", false]]);
      expect(s.running.map((r) => r.session.id)).toEqual(["M"]);
    });
    it("a machine with an unparseable last_seen_at is not fresh", () => {
      const s = buildSnapshot(input("2026-10-02 14:20", { machines: [{ name: "macmini", last_seen_at: "?" }], sessions: two }), 10);
      expect(s.machines[0]).toMatchObject({ lastSeen: null, fresh: false });
    });
  });
});
