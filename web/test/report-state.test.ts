import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeHref, isComposeHash, readRp, rpHash, useRp } from "../src/pages/report/state";
import { J } from "../src/predict/fixtures";
import { reportHref } from "../src/predict/rules";

const NOW = new Date(J("2026-10-02 14:20"));   // Friday of 2026-W40

describe("週報 state (#/v2/report[/<week>]?sheet=&cell=)", () => {
  it("no week in the path is this week; the default sheet is 日別作業; an old ?tpl= is ignored", () => {
    expect(readRp("#/v2/report", NOW)).toEqual({ week: "2026-W40", isThisWeek: true, sheet: "days", cell: null });
    expect(readRp("#/v2/report/2026-W39?tpl=site&sheet=deliverables&world=omote", NOW))
      .toEqual({ week: "2026-W39", isThisWeek: false, sheet: "deliverables", cell: null });
    expect(readRp("#/v2/report?tpl=agency", NOW)).toEqual(readRp("#/v2/report", NOW));
  });
  it("bad values fall back: week → this week, sheet → 日別作業; every one of the five sheets is accepted", () => {
    expect(readRp("#/v2/report/2025-W53", NOW).week).toBe("2026-W40");
    expect(readRp("#/v2/report/%E0", NOW).week).toBe("2026-W40");
    expect(readRp("#/v2/report?sheet=nope", NOW).sheet).toBe("days");
    for (const sheet of ["summary", "tasks", "days", "deliverables", "hours"]) {
      expect(readRp(`#/v2/report?tpl=site&sheet=${sheet}`, NOW).sheet).toBe(sheet);
    }
  });
  it("?cell=<taskId or ->|<date>: 未割当 is null; a malformed one, or a day outside the week, is no cell", () => {
    expect(readRp("#/v2/report?cell=T20260901-01%7C2026-09-30", NOW).cell).toEqual({ taskId: "T20260901-01", date: "2026-09-30" });
    // the report week is Sat 9/26 → Fri 10/2: its weekend is the one before, the next one is W41's
    expect(readRp("#/v2/report?cell=-|2026-09-26", NOW).cell).toEqual({ taskId: null, date: "2026-09-26" });
    expect(readRp("#/v2/report?cell=-|2026-09-27", NOW).cell).toEqual({ taskId: null, date: "2026-09-27" });
    expect(readRp("#/v2/report?cell=T1|2026-10-03", NOW).cell).toBeNull();   // next report week
    expect(readRp("#/v2/report?cell=T1|2026-10-05", NOW).cell).toBeNull();
    expect(readRp("#/v2/report/2026-W41?cell=T1|2026-10-03", NOW).cell).toEqual({ taskId: "T1", date: "2026-10-03" });
    expect(readRp("#/v2/report/2026-W39?cell=T1|2026-09-30", NOW).cell).toBeNull();
    expect(readRp("#/v2/report?cell=T1|2026-02-30", NOW).cell).toBeNull();
    expect(readRp("#/v2/report?cell=|2026-09-30", NOW).cell).toBeNull();
    expect(readRp("#/v2/report?cell=T1", NOW).cell).toBeNull();
    expect(readRp("#/v2/report?sheet=tasks&cell=T1|2026-09-30", NOW).cell).toBeNull();   // the drawer is the matrix's
  });
  it("Saturday opens the next report: on 10/3 this week is W41 (the Sat→Fri report week)", () => {
    const sat = new Date(J("2026-10-03 09:00"));
    expect(readRp("#/v2/report", sat)).toMatchObject({ week: "2026-W41", isThisWeek: true });
    expect(readRp("#/v2/report/2026-W40", sat)).toMatchObject({ week: "2026-W40", isThisWeek: false });
    expect(rpHash("#/v2/report/2026-W40", { week: "2026-W41" }, sat)).toBe("#/v2/report");
    // before 05:00 it is still Friday's day
    expect(readRp("#/v2/report", new Date(J("2026-10-03 04:59"))).week).toBe("2026-W40");
  });
  it("this week is written bare, also after the week turns over in Tokyo", () => {
    expect(rpHash("#/v2/report/2026-W39", { week: "2026-W40" }, NOW)).toBe("#/v2/report");
    // Sunday 15:30 UTC = Monday 00:30 Tokyo: W41 (opened on Saturday) is this week
    const mon = new Date("2026-10-04T15:30:00Z");
    expect(readRp("#/v2/report", mon)).toMatchObject({ week: "2026-W41", isThisWeek: true });
    expect(rpHash("#/v2/report", { week: "2026-W40" }, mon)).toBe("#/v2/report/2026-W40");
  });
  it("another week keeps the sheet and other keys, drops an old ?tpl=, and closes the drawer", () => {
    expect(rpHash("#/v2/report?lang=ja&tpl=site&sheet=tasks", { week: "2026-W39" }, NOW)).toBe("#/v2/report/2026-W39?lang=ja&sheet=tasks");
    expect(rpHash("#/v2/report?cell=T1|2026-09-30&world=omote", { week: "2026-W39" }, NOW)).toBe("#/v2/report/2026-W39?world=omote");
    expect(rpHash("#/v2/report", { week: "bogus" }, NOW)).toBe("#/v2/report");
  });
  it("sheet and cell: 日別作業 is not written; another sheet closes the drawer; a cell is set / cleared in place", () => {
    expect(rpHash("#/v2/report?sheet=tasks", { sheet: "days" }, NOW)).toBe("#/v2/report");
    expect(rpHash("#/v2/report?cell=T1|2026-09-30", { sheet: "summary" }, NOW)).toBe("#/v2/report?sheet=summary");
    expect(rpHash("#/v2/report?lang=en", { cell: { taskId: null, date: "2026-09-29" } }, NOW)).toBe("#/v2/report?lang=en&cell=-%7C2026-09-29");
    expect(rpHash("#/v2/report?cell=T1|2026-09-30", { cell: null }, NOW)).toBe("#/v2/report");
    expect(rpHash("#/v2/report?cell=T1|2026-09-30", { sheet: "days" }, NOW)).toBe("#/v2/report?cell=T1%7C2026-09-30");
  });
});

describe("此刻's 打开週報 link", () => {
  it("reportHref opens that week's 週報 on 日別作業 (the rule's own week, even when it is this week)", () => {
    expect(reportHref("2026-W40")).toBe("#/v2/report/2026-W40");
    const st = readRp(reportHref("2026-W40"), new Date(J("2026-10-02 14:20")));
    expect(st).toMatchObject({ week: "2026-W40", isThisWeek: true, sheet: "days", cell: null });
  });
});

describe("useRp", () => {
  afterEach(() => { vi.useRealTimers(); window.location.hash = ""; });

  it("go() adds a history entry and closes the drawer; the setters replace the address", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.location.hash = "#/v2/report?tpl=site&cell=T1|2026-09-30";
    const { result } = renderHook(() => useRp());
    expect(result.current.st.cell).toEqual({ taskId: "T1", date: "2026-09-30" });
    const len = window.history.length;
    act(() => { result.current.setCell(null); });
    expect(window.location.hash).toBe("#/v2/report");
    act(() => { result.current.setSheet("deliverables"); });
    expect(window.location.hash).toBe("#/v2/report?sheet=deliverables");
    act(() => { result.current.setSheet("days"); });
    expect(window.location.hash).toBe("#/v2/report");
    expect(window.history.length).toBe(len);
    act(() => { result.current.setCell({ taskId: "T1", date: "2026-10-01" }); });
    expect(result.current.st.cell).toEqual({ taskId: "T1", date: "2026-10-01" });
    act(() => { result.current.go("2026-W39"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(window.history.length).toBe(len + 1);
    expect(result.current.st).toMatchObject({ week: "2026-W39", isThisWeek: false, cell: null });
  });

  it("a bare #/v2/report moves to the next report at Saturday 05:00 Tokyo, without touching the address", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(J("2026-10-03 04:59")));
    window.location.hash = "#/v2/report";
    const { result } = renderHook(() => useRp());
    expect(result.current.st.week).toBe("2026-W40");
    act(() => { vi.advanceTimersByTime(61_000); });
    expect(result.current.st).toMatchObject({ week: "2026-W41", isThisWeek: true });
    expect(window.location.hash).toBe("#/v2/report");
  });
});

describe("compose address", () => {
  it("#/v2/report/<week>/pdf is the composer; anything else is not", () => {
    expect(isComposeHash("#/v2/report/2026-W41/pdf")).toBe(true);
    expect(isComposeHash("#/v2/report/2026-W41/pdf?world=omote")).toBe(true);
    expect(isComposeHash("#/v2/report/2026-W41")).toBe(false);
    expect(isComposeHash("#/v2/report")).toBe(false);
    expect(composeHref("2026-W41")).toBe("#/v2/report/2026-W41/pdf");
  });
  it("composeHref builds the address of any week, for ◀ ▶ paging", () => {
    for (const w of ["2026-W40", "2026-W52", "2027-W01"]) expect(isComposeHash(composeHref(w))).toBe(true);
  });
});
