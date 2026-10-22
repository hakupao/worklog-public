import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { api } from "../src/api/client";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { __resetPrefsQueueForTests } from "../src/prefs/usePrefs";

// Mounted the way V2App.test.tsx mounts v2: the real App on a #/v2 hash, fetch stubbed.
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
type Call = { url: string; method: string; lang: string | null };
function stub() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, method: init?.method ?? "GET", lang: new Headers(init?.headers).get("X-Lang") });
    if (url.startsWith("/api/prefs")) return json(init?.method === "PUT" ? JSON.parse(String(init.body)) : DEFAULT_PREFS);
    if (url.startsWith("/api/me")) return json({ kind: "user", email: "me@example.com" });
    return json([]);
  }));
  return calls;
}
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); __resetPrefsQueueForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.location.hash = ""; localStorage.clear(); });

describe("v2 language → X-Lang", () => {
  it("switching the language sends the new X-Lang, refetches active queries, and unmount clears it", async () => {
    const calls = stub();
    window.location.hash = "#/v2/settings";
    const { unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(calls.some((c) => c.url === "/api/machines")).toBe(true));
    expect(calls.filter((c) => c.url === "/api/machines").every((c) => c.lang === "zh")).toBe(true);

    const before = calls.length;
    const item = screen.getAllByText("界面语言").map((el) => el.closest(".it")).find(Boolean) as HTMLElement;
    await act(async () => { fireEvent.click(within(item).getByRole("button", { name: "日本語" })); });
    await screen.findByRole("navigation", { name: "ページ" });
    // 2. the active machines query (Header) refetched after the switch ...
    await waitFor(() => expect(calls.slice(before).some((c) => c.url === "/api/machines")).toBe(true));
    // 1. ... and no read after the switch went out in the old language: the header was set before invalidating.
    // (The prefs PUT carrying the switch is chained from the click itself and may leave first; prefs are not localized.)
    const after = calls.slice(before).filter((c) => c.method === "GET");
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((c) => c.lang)).toEqual(after.map(() => "ja"));

    // 3. once v2 is gone, requests carry no X-Lang.
    unmount();
    const n = calls.length;
    await api.machines();
    expect(calls[n].lang).toBeNull();
  });
});
