import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REFRESH_MS } from "../src/pages/now/useNowData";
import { useStatsSessions } from "../src/pages/stats/useStatsSessions";
import { V2TestProvider } from "./helpers";
import { fail, json, stServer, stTask } from "./st-serve";

const wrapper = ({ children }: { children: ReactNode }) => <V2TestProvider>{children}</V2TestProvider>;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useStatsSessions", () => {
  it("reads the range's sessions and every task", async () => {
    const { calls } = stServer({ tasks: [stTask("T1"), stTask("T2")] });
    const { result } = renderHook(() => useStatsSessions("2026-09-21", "2026-09-22"), { wrapper });
    expect(result.current).toMatchObject({ data: undefined, error: null, stale: false });
    await waitFor(() => expect(result.current.data?.range).toEqual({ from: "2026-09-21", to: "2026-09-22" }));
    await waitFor(() => expect(result.current.tasks?.map((t) => t.id)).toEqual(["T1", "T2"]));
    expect(result.current.data?.day_start).toBe("05:00");
    expect(calls.sort()).toEqual(["/api/stats/sessions?from=2026-09-21&to=2026-09-22", "/api/tasks"]);
  });

  it("another range keeps the previous answer on screen (stale) until the new one lands", async () => {
    const { db, failNext } = stServer();
    const { result, rerender } = renderHook(({ f, t }: { f: string; t: string }) => useStatsSessions(f, t), { wrapper, initialProps: { f: "2026-09-21", t: "2026-09-22" } });
    await waitFor(() => expect(result.current.data?.range.from).toBe("2026-09-21"));
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    failNext((u) => (u.startsWith("/api/stats/sessions?from=2026-08-01") ? gate.then(() => json(db.sessions("2026-08-01", "2026-08-31"))) : null));
    rerender({ f: "2026-08-01", t: "2026-08-31" });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.data?.range.from).toBe("2026-09-21");
    open();
    await waitFor(() => expect(result.current.data?.range.from).toBe("2026-08-01"));
    expect(result.current.stale).toBe(false);
  });

  it("a failure is the error, and refetch recovers", async () => {
    const { failNext } = stServer();
    failNext((u) => (u.startsWith("/api/stats/sessions") ? fail(400) : null));
    const { result } = renderHook(() => useStatsSessions("2026-09-21", "2026-09-22"), { wrapper });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeUndefined();
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.error).toBeNull();
  });

  it("re-reads the sessions every REFRESH_MS", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    const { calls } = stServer();
    const { result } = renderHook(() => useStatsSessions("2026-09-21", "2026-09-22"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const count = () => calls.filter((u) => u.startsWith("/api/stats/sessions")).length;
    expect(count()).toBe(1);
    await act(async () => { vi.advanceTimersByTime(REFRESH_MS); });
    await waitFor(() => expect(count()).toBe(2));
  });
});
