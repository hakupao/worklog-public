// web/test/m/MobileApp.test.tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../src/api/queries";
import MobileApp, { PAGES } from "../../src/m/MobileApp";
import { __resetMobileOptOutForTests } from "../../src/m/route";
import { DEFAULT_PREFS } from "../../src/prefs/defaults";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  window.location.hash = "#/m/now";
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const url = String(u);
    if (url.startsWith("/api/prefs")) return json(DEFAULT_PREFS);
    if (url.startsWith("/api/weeks/")) return json({ week: "x", days: [], total_minutes: 0, unassigned: 0, hidden: 0 });
    if (url.startsWith("/api/day-plans/")) return new Response(JSON.stringify({ error: "no plan" }), { status: 404, headers: { "Content-Type": "application/json" } });
    return json([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); __resetMobileOptOutForTests(); window.location.hash = ""; });
const app = () => render(<QueryClientProvider client={createQueryClient()}><MobileApp /></QueryClientProvider>);

describe("MobileApp", () => {
  it("owns <html> while mounted: class m and the resolved theme", () => {
    const { unmount } = app();
    expect(document.documentElement.classList.contains("m")).toBe(true);
    expect(document.documentElement.dataset.mTheme).toBe("dark");
    unmount();
    expect(document.documentElement.classList.contains("m")).toBe(false);
    expect(document.documentElement.dataset.mTheme).toBeUndefined();
  });
  it("tabs list only the pages that exist; the current one is marked", () => {
    app();
    const tabs = screen.getByRole("navigation");
    expect(tabs.querySelector('[aria-current="page"]')).toHaveTextContent("此刻");
    expect(tabs.querySelectorAll("a")).toHaveLength(Object.keys(PAGES).length);
    tabs.querySelectorAll("a").forEach((a) => expect(a.querySelector("svg.m-ico")).not.toBeNull());
  });
  it("cycles the theme system → dark → light and remembers it", () => {
    app();
    const btn = screen.getByRole("button", { name: /外观/ });
    expect(btn).toHaveTextContent("[自动]");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent("[深]");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent("[浅]");
    expect(document.documentElement.dataset.mTheme).toBe("light");
    expect(localStorage.getItem("wl-m-theme")).toBe("light");
  });
  it("桌面版 remembers the choice and goes to the desktop page", async () => {
    app();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "[桌面]" })); });
    expect(localStorage.getItem("wl-mobile")).toBe("off");
    await waitFor(() => expect(window.location.hash).toBe("#/v2/now"));
  });
});
