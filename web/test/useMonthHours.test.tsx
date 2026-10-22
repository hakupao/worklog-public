import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { createQueryClient } from "../src/api/queries";
import type { StatsSession, StatsSessions } from "../src/api/types";
import { hourTier, useMonthHours } from "../src/pages/now/useMonthHours";

const sess = (id: string, a: string, b: string): StatsSession => ({
  id, machine: "m", agent: "claude-code", task_id: null, started_at: a, ended_at: b, active_minutes: 0, turns: 0, files: 0,
  intervals: [[a, b]], approx: false, tokens: null, subagent_tokens: null, cost_usd: null, cost_partial: false, summary: "",
});
const payload = (from: string, to: string): StatsSessions => ({
  range: { from, to }, day_start: "05:00", plans: [],
  sessions: [
    sess("A", "2026-10-02T09:00:00+09:00", "2026-10-02T11:00:00+09:00"),
    sess("B", "2026-10-02T10:00:00+09:00", "2026-10-02T12:00:00+09:00"),
    sess("C", "2026-10-03T01:00:00+09:00", "2026-10-03T02:00:00+09:00"),
  ],
});
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>;

afterEach(() => vi.restoreAllMocks());

describe("hourTier", () => {
  it("cuts at 4h / 7h / 9.5h", () => {
    expect(hourTier(0)).toBe(0);
    expect(hourTier(239)).toBe(1);
    expect(hourTier(240)).toBe(2);
    expect(hourTier(419)).toBe(2);
    expect(hourTier(420)).toBe(3);
    expect(hourTier(569)).toBe(3);
    expect(hourTier(570)).toBe(4);
    expect(hourTier(undefined)).toBe(0);
  });
});

describe("useMonthHours", () => {
  it("is null until loaded, then gives wall minutes per 05:00 day", async () => {
    const spy = vi.spyOn(api, "statsSessions").mockImplementation(async (f, t) => payload(f, t));
    vi.spyOn(api, "tasks").mockResolvedValue([]);
    const { result } = renderHook(() => useMonthHours("2026-10-20"), { wrapper });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(spy).toHaveBeenCalledWith("2026-10-01", "2026-10-20");
    const r = result.current!;
    expect(r.byDate.get("2026-10-02")).toBe(240);
    expect(r.byDate.has("2026-10-03")).toBe(false);
    expect(r.recorded).toBe(1);
    expect(r.pastDays).toBe(20);
  });

  it("is null while another month's data is still on screen (month rollover), then shows the new month", async () => {
    let release: () => void = () => {};
    vi.spyOn(api, "statsSessions").mockImplementation((f, t) => (f === "2026-11-01"
      ? new Promise((res) => { release = () => res(payload(f, t)); })
      : Promise.resolve(payload(f, t))));
    vi.spyOn(api, "tasks").mockResolvedValue([]);
    const { result, rerender } = renderHook(({ d }) => useMonthHours(d), { wrapper, initialProps: { d: "2026-10-31" } });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.pastDays).toBe(31);
    rerender({ d: "2026-11-01" });
    expect(result.current).toBeNull();
    release();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current!.pastDays).toBe(1);
  });

  it("a day change inside the month keeps the previous days on screen while the refetch is pending", async () => {
    let release: () => void = () => {};
    vi.spyOn(api, "statsSessions").mockImplementation((f, t) => (t === "2026-10-21"
      ? new Promise((res) => { release = () => res(payload(f, t)); })
      : Promise.resolve(payload(f, t))));
    vi.spyOn(api, "tasks").mockResolvedValue([]);
    const { result, rerender } = renderHook(({ d }) => useMonthHours(d), { wrapper, initialProps: { d: "2026-10-20" } });
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ d: "2026-10-21" });
    await waitFor(() => expect(api.statsSessions).toHaveBeenCalledWith("2026-10-01", "2026-10-21"));
    expect(result.current).not.toBeNull();
    expect(result.current!.byDate.get("2026-10-02")).toBe(240);
    release();
    await waitFor(() => expect(result.current!.pastDays).toBe(21));
  });

  it("is null when the payload's range does not start on the 1st of the requested month", async () => {
    vi.spyOn(api, "statsSessions").mockImplementation(async (f, t) => payload("2026-09-01", t));
    vi.spyOn(api, "tasks").mockResolvedValue([]);
    const { result } = renderHook(() => useMonthHours("2026-10-20"), { wrapper });
    await waitFor(() => expect(api.statsSessions).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current).toBeNull();
  });
});
