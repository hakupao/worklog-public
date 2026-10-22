import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_MS } from "../src/pages/now/useNowData";
import { useStatsData } from "../src/pages/stats/useStatsData";
import { V2TestProvider } from "./helpers";
import { fail, json, stServer } from "./st-serve";

const wrapper = ({ children }: { children: ReactNode }) => <V2TestProvider>{children}</V2TestProvider>;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useStatsData", () => {
  it("reads the range's dashboard and the reviews on the old page's cache keys", async () => {
    const { calls } = stServer();
    const { result } = renderHook(() => useStatsData("2026-09-10", "2026-10-07"), { wrapper });
    expect(result.current).toMatchObject({ loading: true, dash: undefined, reviewsLoading: true });
    await waitFor(() => expect(result.current.dash?.range).toEqual({ from: "2026-09-10", to: "2026-10-07" }));
    await waitFor(() => expect(result.current.reviews?.map((r) => r.week)).toEqual(["2026-W40", "2026-W39"]));
    expect(result.current).toMatchObject({ loading: false, updating: false, stale: false, error: null, reviewsError: null, reviewsLoading: false });
    expect(calls.sort()).toEqual(["/api/dashboard?from=2026-09-10&to=2026-10-07", "/api/reviews?limit=8"]);
  });

  it("another range keeps the previous dashboard on screen (stale, updating) until the new one lands", async () => {
    const { db, failNext } = stServer();
    const { result, rerender } = renderHook(({ f, t }: { f: string; t: string }) => useStatsData(f, t), { wrapper, initialProps: { f: "2026-09-10", t: "2026-10-07" } });
    await waitFor(() => expect(result.current.dash?.range.from).toBe("2026-09-10"));
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    failNext((u) => (u.startsWith("/api/dashboard?from=2026-08-13") ? gate.then(() => json(db.dash("2026-08-13", "2026-09-09"))) : null));
    rerender({ f: "2026-08-13", t: "2026-09-09" });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current).toMatchObject({ updating: true, loading: false, dash: { range: { from: "2026-09-10" } } });
    open();
    await waitFor(() => expect(result.current.dash?.range.from).toBe("2026-08-13"));
    await waitFor(() => expect(result.current.updating).toBe(false));
    expect(result.current.stale).toBe(false);
  });

  // 400: not retried by the app's shouldRetry, so the one failure lands as the error
  it("a failed dashboard is an error (not loading) and refetch recovers", async () => {
    const { failNext } = stServer();
    failNext((u) => (u.startsWith("/api/dashboard") ? fail(400) : null));
    const { result } = renderHook(() => useStatsData("2026-09-10", "2026-10-07"), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current).toMatchObject({ loading: false, dash: undefined });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.dash).toBeDefined());
    expect(result.current.error).toBeNull();
  });

  it("the reviews fail on their own: the dashboard is unaffected, and refetchReviews recovers", async () => {
    const { failNext } = stServer();
    failNext((u) => (u.startsWith("/api/reviews") ? fail(400) : null));
    const { result } = renderHook(() => useStatsData("2026-09-10", "2026-10-07"), { wrapper });
    await waitFor(() => expect(result.current.reviewsError).not.toBeNull());
    await waitFor(() => expect(result.current.dash).toBeDefined());
    expect(result.current).toMatchObject({ error: null, reviews: null, reviewsLoading: false });
    act(() => result.current.refetchReviews());
    await waitFor(() => expect(result.current.reviews).toHaveLength(2));
    expect(result.current.reviewsError).toBeNull();
  });

  it("re-reads the dashboard and the reviews every REFRESH_MS", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    const { calls } = stServer();
    const { result } = renderHook(() => useStatsData("2026-09-10", "2026-10-07"), { wrapper });
    await waitFor(() => expect(result.current.dash).toBeDefined());
    await waitFor(() => expect(result.current.reviews).not.toBeNull());
    const count = (prefix: string) => calls.filter((u) => u.startsWith(prefix)).length;
    expect([count("/api/dashboard"), count("/api/reviews")]).toEqual([1, 1]);
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    await waitFor(() => expect([count("/api/dashboard"), count("/api/reviews")]).toEqual([2, 2]));
  });

  it("an odd reviews answer (not a list) is no reviews, not a crash", async () => {
    stServer();
    vi.mocked(fetch).mockImplementation(async (u) => (String(u).startsWith("/api/reviews") ? json({ nope: 1 }) : json({})));
    const { result } = renderHook(() => useStatsData("2026-09-10", "2026-10-07"), { wrapper });
    await waitFor(() => expect(result.current.reviewsLoading).toBe(false));
    expect(result.current.reviews).toBeNull();
  });
});
