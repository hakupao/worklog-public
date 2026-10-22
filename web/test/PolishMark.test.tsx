import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolishMark, POLISH_REFETCH_SCHEDULE_MS, overridePolishId } from "../src/ui/PolishMark";
import { V2TestProvider } from "./helpers";

let calls: { url: string; body: any }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ pinned: true, raw: "帳票なおす" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const mount = (meta?: { raw: string; pinned: boolean }) =>
  render(<V2TestProvider lang="zh"><PolishMark meta={meta} entity="task" entityId="T1" field="title" /></V2TestProvider>);

describe("PolishMark", () => {
  it("renders nothing without meta", () => {
    const { container } = mount(undefined);
    expect(container.textContent).toBe("");
  });

  it("a polished field shows 润; opening it shows the raw text and 还原 pins it", async () => {
    mount({ raw: "帳票なおす", pinned: false });
    fireEvent.click(screen.getByRole("button", { name: "已润色" }));
    expect(screen.getByText("原文：帳票なおす")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "还原" })); });
    expect(calls).toEqual([{ url: "/api/i18n/pin", body: { entity: "task", entity_id: "T1", field: "title", pinned: true } }]);
  });

  it("a restored field offers 恢复润色", async () => {
    mount({ raw: "帳票なおす", pinned: true });
    fireEvent.click(screen.getByRole("button", { name: "原文（未润色）" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "恢复润色" })); });
    expect(calls[0].body.pinned).toBe(false);
  });

  it("refetches at each step of the schedule after the click", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    mount({ raw: "x", pinned: false });
    fireEvent.click(screen.getByRole("button", { name: "已润色" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "还原" })); });
    expect(POLISH_REFETCH_SCHEDULE_MS).toEqual([5000, 15000, 30000, 60000]);
    let at = 0;
    for (const [i, ms] of POLISH_REFETCH_SCHEDULE_MS.entries()) {
      await act(async () => { vi.advanceTimersByTime(ms - at - 1); });
      expect(spy).toHaveBeenCalledTimes(i);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(spy).toHaveBeenCalledTimes(i + 1);
      at = ms;
    }
    spy.mockRestore();
  });

  it("still refetches at every step when the component unmounts before the first timer fires", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { unmount } = mount({ raw: "x", pinned: false });
    fireEvent.click(screen.getByRole("button", { name: "已润色" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "还原" })); });
    unmount();
    let at = 0;
    for (const [i, ms] of POLISH_REFETCH_SCHEDULE_MS.entries()) {
      await act(async () => { vi.advanceTimersByTime(ms - at); });
      expect(spy).toHaveBeenCalledTimes(i + 1);
      at = ms;
    }
    spy.mockRestore();
  });

  it("overridePolishId mirrors the server's overrideId with the weekly template", () => {
    expect(overridePolishId("2026-W41", "days", "S:1", "text")).toBe("2026-W41\u001fweekly\u001fdays\u001fS:1\u001ftext");
  });
});
