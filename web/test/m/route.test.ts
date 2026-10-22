import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetMobileOptOutForTests, desktopHref, isDate, isMobileHash, mHref, mobileOptedOut, mobileTarget, parseMRoute,
  setMobileOptOut, shouldRedirect,
} from "../../src/m/route";

afterEach(() => { __resetMobileOptOutForTests(); localStorage.clear(); vi.restoreAllMocks(); });

describe("m routes", () => {
  it("recognises the phone entrance", () => {
    expect(["#/m", "#/m/", "#/m/now", "#/m/tl/2026-10-12?un=1"].map(isMobileHash)).toEqual([true, true, true, true]);
    expect(["", "#/", "#/v2/now", "#/mx", "#/m2"].map(isMobileHash)).toEqual([false, false, false, false, false]);
  });
  it("parses page, param and query", () => {
    expect(parseMRoute("#/m/tl/2026-10-12?un=1")).toEqual({ page: "tl", param: "2026-10-12", unlinked: true, range: "week" });
    expect(parseMRoute("#/m/plan/2026-10-14")).toMatchObject({ page: "plan", param: "2026-10-14" });
    expect(parseMRoute("#/m/tasks/T20261001-01")).toMatchObject({ page: "tasks", param: "T20261001-01" });
    expect(parseMRoute("#/m/stats?range=month")).toMatchObject({ page: "stats", range: "month", param: null });
  });
  it("falls back without throwing", () => {
    expect(parseMRoute("#/m")).toEqual({ page: "now", param: null, unlinked: false, range: "week" });
    expect(parseMRoute("#/m/bogus/x")).toMatchObject({ page: "now", param: null });
    expect(parseMRoute("#/m/tl/2026-02-30")).toMatchObject({ page: "tl", param: null });
    expect(parseMRoute("#/m/tl/yesterday")).toMatchObject({ page: "tl", param: null });
    expect(parseMRoute("#/m/tasks/%E0")).toMatchObject({ page: "tasks", param: null });
    expect(parseMRoute("#/m/stats?range=year")).toMatchObject({ range: "week" });
    expect(parseMRoute("#/m/now/x?un=1")).toMatchObject({ param: null, unlinked: false });
  });
  it("validates calendar dates", () => {
    expect(["2026-10-12", "2028-02-29"].map(isDate)).toEqual([true, true]);
    expect(["2026-02-29", "2026-13-01", "2026-1-1", ""].map(isDate)).toEqual([false, false, false, false]);
  });
  it("builds addresses that parse back", () => {
    expect(mHref("now")).toBe("#/m/now");
    expect(mHref("tasks", "T 1/2")).toBe("#/m/tasks/T%201%2F2");
    expect(parseMRoute(mHref("tasks", "T 1/2")).param).toBe("T 1/2");
    expect(mHref("tl", "2026-10-12", { un: "1" })).toBe("#/m/tl/2026-10-12?un=1");
    expect(mHref("tl", null, { un: "1" })).toBe("#/m/tl?un=1");
  });
  it("maps desktop addresses to their phone page", () => {
    expect(mobileTarget("")).toBe("#/m/now");
    expect(mobileTarget("#/v2")).toBe("#/m/now");
    expect(mobileTarget("#/v2/timeline")).toBe("#/m/tl");
    expect(mobileTarget("#/v2/tasks/T1?world=omote")).toBe("#/m/tasks/T1");
    expect(mobileTarget("#/v2/plan/2026-10-14")).toBe("#/m/plan/2026-10-14");
    expect(mobileTarget("#/v2/stats")).toBe("#/m/stats");
    expect(mobileTarget("#/v2/report/2026-W42")).toBe("#/m/now");
    expect(mobileTarget("#/v2/settings")).toBe("#/m/now");
    expect(mobileTarget("#/tasks/T1?status=all")).toBe("#/m/tasks/T1");
    expect(mobileTarget("#/tasks")).toBe("#/m/tasks");
    expect(mobileTarget("#/plan/2026-10-14")).toBe("#/m/plan/2026-10-14");
    expect(mobileTarget("#/plan/bad")).toBe("#/m/plan");
    expect(mobileTarget("#/unlinked")).toBe("#/m/tl?un=1");
    expect(mobileTarget("#/timeline/2026-W42")).toBe("#/m/tl");
    expect(mobileTarget("#/dashboard")).toBe("#/m/now");
    expect(mobileTarget("#/usage")).toBe("#/m/now");
  });
  it("maps the desktop 未关联 timeline link to the phone 未关联 filter", () => {
    expect(mobileTarget("#/v2/timeline?unlinked=1")).toBe("#/m/tl?un=1");
    expect(mobileTarget("#/v2/timeline/2026-10-12?unlinked=1")).toBe("#/m/tl/2026-10-12?un=1");
    expect(mobileTarget("#/v2/timeline/bad?unlinked=1")).toBe("#/m/tl?un=1");
    expect(mobileTarget("#/v2/timeline?unlinked=0")).toBe("#/m/tl");
    expect(mobileTarget("#/v2/tasks?unlinked=1")).toBe("#/m/tasks");
    expect(parseMRoute(mobileTarget("#/v2/timeline?unlinked=1"))).toMatchObject({ page: "tl", unlinked: true });
  });
  it("maps phone pages back to the desktop", () => {
    expect((["now", "tl", "tasks", "plan", "stats"] as const).map(desktopHref))
      .toEqual(["#/v2/now", "#/v2/timeline", "#/v2/tasks", "#/v2/plan", "#/v2/stats"]);
  });
  it("redirects only narrow screens that did not choose the desktop", () => {
    expect(shouldRedirect("#/v2/now", true, false)).toBe(true);
    expect(shouldRedirect("", true, false)).toBe(true);
    expect(shouldRedirect("#/v2/now", false, false)).toBe(false);
    expect(shouldRedirect("#/v2/now", true, true)).toBe(false);
    expect(shouldRedirect("#/m/now", true, false)).toBe(false);
  });
  it("remembers the desktop choice", () => {
    expect(mobileOptedOut()).toBe(false);
    setMobileOptOut(true);
    expect(localStorage.getItem("wl-mobile")).toBe("off");
    expect(mobileOptedOut()).toBe(true);
    setMobileOptOut(false);
    expect(localStorage.getItem("wl-mobile")).toBeNull();
    expect(mobileOptedOut()).toBe(false);
  });
  it("storage blocked: the desktop choice still holds for this page (no redirect loop)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(mobileOptedOut()).toBe(false);
    setMobileOptOut(true);
    expect(mobileOptedOut()).toBe(true);
    expect(shouldRedirect("#/v2/now", true, mobileOptedOut())).toBe(false);
  });
});
