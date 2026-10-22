import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../src/api/client";
import { useReportData } from "../src/pages/report/useReportData";
import { V2TestProvider } from "./helpers";
import { dayRow, fail, preview, rpServer } from "./rp-serve";
import { weekTl } from "./tl-fixtures";
import { session } from "../src/predict/fixtures";

const wrapper = ({ children }: { children: ReactNode }) => <V2TestProvider>{children}</V2TestProvider>;
afterEach(() => { vi.unstubAllGlobals(); });
const urls = () => vi.mocked(fetch).mock.calls.map(([u]) => String(u));

describe("useReportData", () => {
  it("reads the preview, the week's timeline, the task list and the downloads on the shared cache keys", async () => {
    rpServer({
      previews: { "2026-W40/weekly": preview("2026-W40") },
      timelines: { "2026-W40": weekTl("2026-W40", "2026-09-28", []) },
      downloads: { "2026-W40": [
        { week: "2026-W40", template: "weekly", at: "2026-10-01T03:00:00Z" },
        { week: "2026-W40", template: "site", at: "2026-10-02T08:40:00Z" },   // from before the templates merged
      ] },
    });
    const { result } = renderHook(() => useReportData("2026-W40"), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.preview?.template).toBe("weekly"));
    await waitFor(() => expect(result.current.downloads).toHaveLength(2));
    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    await waitFor(() => expect(result.current.timeline?.week).toBe("2026-W40"));
    expect(result.current).toMatchObject({ loading: false, error: null, stale: false });
    // the newest row of any template counts
    expect(result.current.lastDownload).toEqual({ week: "2026-W40", template: "site", at: "2026-10-02T08:40:00Z" });
    expect(urls().sort()).toEqual([
      "/api/report-downloads?week=2026-W40", "/api/reports/2026-W40/weekly", "/api/tasks", "/api/weeks/2026-W39/timeline", "/api/weeks/2026-W40/timeline",
    ]);
  });

  it("the timeline is the report week's two ISO weeks, every day kept (the matrix re-places them on 05:00 days)", async () => {
    rpServer({
      previews: { "2026-W40/weekly": preview("2026-W40") },
      timelines: {
        "2026-W39": weekTl("2026-W39", "2026-09-21", [session("sun", "2026-09-27 10:00", "2026-09-27 11:00")]),
        "2026-W40": weekTl("2026-W40", "2026-09-28", [session("mon", "2026-09-28 10:00", "2026-09-28 10:30"), session("sat", "2026-10-03 10:00", "2026-10-03 11:00")]),
      },
    });
    const { result } = renderHook(() => useReportData("2026-W40"), { wrapper });
    await waitFor(() => expect(result.current.timeline?.week).toBe("2026-W40"));
    const tl = result.current.timeline!;
    expect(tl.days.map((d) => d.date)).toEqual([
      "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27",
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(tl.days.flatMap((d) => d.sessions.map((x) => x.id))).toEqual(["sun", "mon", "sat"]);
  });

  it("another week keeps the previous preview on screen (stale, updating) until the new one lands", async () => {
    const { db, failNext } = rpServer({ previews: { "2026-W40/weekly": preview("2026-W40") } });
    const { result, rerender } = renderHook(({ w }: { w: string }) => useReportData(w), { wrapper, initialProps: { w: "2026-W40" } });
    await waitFor(() => expect(result.current.preview?.week).toBe("2026-W40"));
    expect(result.current.lastDownload).toBeNull();
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    db.previews["2026-W39/weekly"] = preview("2026-W39");
    failNext((m, u) => (u === "/api/reports/2026-W39/weekly" ? gate.then(() => new Response(JSON.stringify(db.previews["2026-W39/weekly"]), { status: 200 })) : null));
    rerender({ w: "2026-W39" });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current).toMatchObject({ updating: true, loading: false, preview: { week: "2026-W40" } });
    open();
    await waitFor(() => expect(result.current.preview?.week).toBe("2026-W39"));
    await waitFor(() => expect(result.current.updating).toBe(false));
    expect(result.current.stale).toBe(false);
  });

  it("group review A3: downloads are only the asked week's — a kept list of another week, or rows of another week, are none", async () => {
    const { db, failNext } = rpServer({
      previews: { "2026-W40/weekly": preview("2026-W40"), "2026-W39/weekly": preview("2026-W39") },
      downloads: {
        "2026-W40": [{ week: "2026-W40", template: "weekly", at: "2026-10-02T08:40:00Z" }],
        // a list that is not for the week asked (a proxy, a server bug): never counts
        "2026-W39": [{ week: "2026-W40", template: "weekly", at: "2026-10-02T08:40:00Z" }],
      },
    });
    const { result, rerender } = renderHook(({ w }: { w: string }) => useReportData(w), { wrapper, initialProps: { w: "2026-W40" } });
    await waitFor(() => expect(result.current.lastDownload?.at).toBe("2026-10-02T08:40:00Z"));
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    failNext((_m, u) => (u === "/api/report-downloads?week=2026-W39" ? gate.then(() => new Response(JSON.stringify(db.downloads["2026-W39"]), { status: 200 })) : null));
    rerender({ w: "2026-W39" });
    // W40's list, kept while W39's loads, is not W39's
    await waitFor(() => expect(result.current.preview?.week).toBe("2026-W39"));
    expect(result.current.downloads).toBeNull();
    expect(result.current.lastDownload).toBeNull();
    open();
    await waitFor(() => expect(result.current.downloads).toEqual([]));
    expect(result.current.lastDownload).toBeNull();
  });

  it("a week the server cannot build is a 400 / 404 error without retries; other failures are errors too", async () => {
    rpServer();
    const { result } = renderHook(() => useReportData("2026-W40"), { wrapper });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect((result.current.error as ApiError).status).toBe(404);
    expect(result.current.loading).toBe(false);
    expect(urls().filter((u) => u.startsWith("/api/reports/"))).toHaveLength(1);

    const s = rpServer({ previews: { "2026-W40/weekly": preview("2026-W40") } });
    s.failNext((_m, u) => (u.startsWith("/api/reports/") ? fail(500) : null));
    const r2 = renderHook(() => useReportData("2026-W40"), { wrapper });
    // a 500 is retried (the app's shouldRetry) and then lands
    await waitFor(() => expect(r2.result.current.preview?.week).toBe("2026-W40"), { timeout: 4000 });
  });
});

describe("rp-serve (the stub later tasks write through)", () => {
  it("a PUT is applied like the server: every row with that row_key, the computed value kept as auto; DELETE restores, 404 when nothing to remove", async () => {
    const { calls } = rpServer({ previews: { "2026-W40/weekly": preview("2026-W40", { days: [
      dayRow("S:m1", "2026-09-30", "beta 調査", "夜間", 60), dayRow("S:m1", "2026-10-01", "beta 調査", "夜間", 60),
    ] }) } });
    await api.putOverride("2026-W40", "weekly", { sheet: "days", row_key: "S:m1", column: "minutes", value: "45" });
    const p = await api.report("2026-W40", "weekly");
    const mins = p.sheets.find((g) => g.key === "days")!.rows.map((r) => r.cells.find((c) => c.column === "minutes"));
    expect(mins).toEqual([
      { column: "minutes", value: 45, kind: "int", auto: 60, overridden: true },
      { column: "minutes", value: 45, kind: "int", auto: 60, overridden: true },
    ]);
    await api.deleteOverride("2026-W40", "weekly", { sheet: "days", row_key: "S:m1", column: "minutes" });
    const back = await api.report("2026-W40", "weekly");
    expect(back.sheets.find((g) => g.key === "days")!.rows[0].cells[3]).toEqual({ column: "minutes", value: 60, kind: "int" });
    await expect(api.deleteOverride("2026-W40", "weekly", { sheet: "days", row_key: "S:m1", column: "minutes" })).rejects.toMatchObject({ status: 404 });
    expect(calls.map((c) => c.method)).toEqual(["PUT", "DELETE", "DELETE"]);
    expect(calls[0].body).toEqual({ sheet: "days", row_key: "S:m1", column: "minutes", value: "45" });
  });
});
