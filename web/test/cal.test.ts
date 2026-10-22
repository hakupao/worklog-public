import { describe, expect, it } from "vitest";
import { makeCalendar, periodOf, sunTimes } from "../src/cal/calendar";
import { DEFAULT_PREFS } from "../src/prefs/defaults";

const cfg = DEFAULT_PREFS.cal;
const c = makeCalendar(cfg);

describe("calendar core (prototype reference 2026-10-20)", () => {
  it("business days of the month", () => {
    expect(c.bizOfMonth("2026-10-20")).toEqual({ index: 13, total: 21, left: 8 });
  });
  it("countdowns", () => {
    const list = c.countdowns("2026-10-20");
    const cd = Object.fromEntries(list.map((x) => [x.kind, x]));
    expect(cd.payday).toMatchObject({ date: "2026-10-23", days: 3, biz: 2, moved: true });
    expect(cd.weekend).toMatchObject({ date: "2026-10-24", days: 4, biz: 3 });
    expect(cd.monthEnd).toMatchObject({ date: "2026-10-30", days: 10, biz: 7 });
    expect(cd.holiday).toMatchObject({ date: "2026-11-03", days: 14, biz: 9 });
    expect(cd.holiday.name!.ja).toBe("文化の日");
    expect(cd.holiday.name!.zh).toBe("文化日");
    expect(cd.holiday.name!.en).toBe("National Culture Day");
    expect(cd.break).toMatchObject({ date: "2026-12-29", days: 70, biz: 47, len: 6 });
    expect(cd.break.name).toEqual({ ja: "年末年始", zh: "年末年始", en: "年末年始" });
    expect(list.map((x) => x.kind)).toEqual(["payday", "weekend", "monthEnd", "holiday", "break"]);
  });
  it("ephemeris", () => {
    expect(c.ephemeris("2026-10-20")).toEqual({ isoWeek: 43, fy: 2026, fq: 3, wareki: "令和8年" });
  });
  it("sun and period", () => {
    const st = sunTimes("2026-10-20");
    expect(Math.abs(st.rise - 351)).toBeLessThanOrEqual(1.5); // 05:51
    expect(Math.abs(st.set - 1020)).toBeLessThanOrEqual(1.5); // 17:00
    expect(periodOf(18 * 60 + 45, st)).toBe("night");
    expect(periodOf(9 * 60 + 5, st)).toBe("day");
    expect(periodOf(5 * 60 + 40, st)).toBe("dawn");
    expect(periodOf(17 * 60 + 20, st)).toBe("dusk");
    expect(periodOf(3 * 60, st)).toBe("night");
  });
});

describe("offDay", () => {
  it("a Saturday is off, the weekend countdown is today", () => {
    expect(c.bizOfMonth("2026-10-24").index).toBe(0);
    expect(c.countdowns("2026-10-24").find((x) => x.kind === "weekend")).toMatchObject({ date: "2026-10-24", days: 0 });
  });
  it("holidays and the Labor Thanksgiving day are off", () => {
    expect(c.isOff("2026-11-03")).toBe(true);
    expect(c.isOff("2026-11-23")).toBe(true);
    expect(c.isOff("2026-10-23")).toBe(false);
  });
  it("holiday names per language, ja fallback", () => {
    expect(c.holidayName("2026-11-03", "ja")).toBe("文化の日");
    expect(c.holidayName("2026-11-03", "zh")).toBe("文化日");
    expect(c.holidayName("2026-11-03", "en")).toBe("National Culture Day");
    expect(c.holidayName("2026-11-04", "zh")).toBeNull();
    expect(c.holidayName("2027-03-22", "zh")).toBe("春分日 补休");
    expect(c.holidayName("2027-03-22", "ja")).toBe("春分の日 振替休日");
  });
});

describe("monthGrid", () => {
  it("rows and padding", () => {
    expect(c.monthGrid("2026-08-10").length).toBe(6);
    const oct = c.monthGrid("2026-10-20");
    expect(oct.length).toBe(5);
    expect(oct[0].slice(0, 3)).toEqual([null, null, null]);
    expect(oct[0][3]).toMatchObject({ date: "2026-10-01", d: 1, dow: 4 });
    expect(oct.every((w) => w.length === 7)).toBe(true);
  });
  it("marks today, future, off and holiday", () => {
    const cells = c.monthGrid("2026-10-20").flat().filter((x) => x !== null);
    expect(cells.length).toBe(31);
    expect(cells.filter((x) => x!.today).map((x) => x!.date)).toEqual(["2026-10-20"]);
    expect(cells.find((x) => x!.date === "2026-10-19")).toMatchObject({ future: false, today: false, off: false });
    expect(cells.find((x) => x!.date === "2026-10-21")!.future).toBe(true);
    expect(cells.find((x) => x!.date === "2026-10-12")).toMatchObject({ off: true, holiday: "スポーツの日" });
    expect(cells.find((x) => x!.date === "2026-10-25")).toMatchObject({ off: true, dow: 7, holiday: null });
  });
});

describe("payday", () => {
  const c31 = makeCalendar({ ...cfg, payday: 31 });
  it("clamps to the month end and moves off weekends", () => {
    expect(c31.countdowns("2026-11-10").find((x) => x.kind === "payday")!.date).toBe("2026-11-30");
    expect(c31.countdowns("2027-02-01").find((x) => x.kind === "payday")!.date).toBe("2027-02-26");
  });
  it("rolls to next month once the moved payday has passed", () => {
    // 25th is Sunday, moved payday is Fri 10-23; on Sat 10-24 the next one is November's (25th is Wed)
    expect(c.countdowns("2026-10-24").find((x) => x.kind === "payday")).toMatchObject({ date: "2026-11-25", moved: false });
    expect(c.countdowns("2026-10-23").find((x) => x.kind === "payday")).toMatchObject({ date: "2026-10-23", days: 0 });
  });
});

describe("breaks", () => {
  it("year-wrapping break is off on both sides of New Year", () => {
    expect(c.isOff("2027-01-02")).toBe(true);
    expect(c.isOff("2026-12-30")).toBe(true);
    expect(c.isOff("2026-12-28")).toBe(false);
    expect(c.isOff("2027-01-04")).toBe(false);
    expect(c.isOff("2027-08-14")).toBe(true);
  });
  it("inside a break the next one is shown", () => {
    expect(c.countdowns("2026-12-30").find((x) => x.kind === "break")).toMatchObject({ date: "2027-04-29", name: { ja: "GW" } });
  });
  it("after the last business day the month end is next month's", () => {
    expect(c.countdowns("2026-10-31").find((x) => x.kind === "monthEnd")!.date).toBe("2026-11-30");
  });
});

describe("calendar bounds", () => {
  it("breaks covering every day do not hang countdowns", () => {
    const all = makeCalendar({ payday: 25, breaks: [{ name: "x", from: "01-01", to: "12-31" }] });
    const list = all.countdowns("2026-10-20");
    expect(list.find((x) => x.kind === "payday")!.date).toBe("2026-10-25");
    expect(list.find((x) => x.kind === "monthEnd")!.date).toBe("2026-10-31");
  });
});
