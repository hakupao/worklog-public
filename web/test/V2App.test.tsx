import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { isWorldBusy, toggleWorld } from "../src/world/transitions";

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
function stub(prefs = DEFAULT_PREFS) {
  const puts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const url = String(u);
    if (url.startsWith("/api/prefs")) {
      if (init?.method === "PUT") { const b = JSON.parse(String(init.body)); puts.push(b); return json(b); }
      return json(prefs);
    }
    if (url.startsWith("/api/machines")) return json([]);
    if (url.startsWith("/api/me")) return json({ kind: "user", email: "me@example.com" });
    return json([]);
  }));
  return puts;
}
// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { vi.unstubAllGlobals(); window.location.hash = ""; localStorage.clear(); });

describe("App → V2App", () => {
  it("#/v2/settings mounts v2: html.v2, the world attribute, the html lang", async () => {
    stub();
    window.location.hash = "#/v2/settings";
    const { unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    const html = document.documentElement;
    expect(html.classList.contains("v2")).toBe(true);
    expect(html.dataset.world).toBe("ura");
    expect(html.lang).toBe("zh-CN");
    unmount();
    expect(html.classList.contains("v2")).toBe(false);
    expect(html.dataset.world).toBeUndefined();
  });

  it("#/v2/usage mounts the 说明 page: the guide under the header's title, its chapter keys, no h1", async () => {
    stub();
    window.location.hash = "#/v2/usage";
    const { container } = render(<App />);
    await screen.findByRole("navigation", { name: "章节" }, { timeout: 5000 });
    expect(container.querySelector(".us .us-doc h2")).not.toBeNull();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("#/v2/timeline mounts the timeline and survives odd API answers", async () => {
    stub();                                  // every unknown URL answers [] — not the shapes the page expects
    window.location.hash = "#/v2/timeline";
    const { container, unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(container.querySelector(".tl .tl-day")).not.toBeNull());   // no days to band: an empty board, no crash
    expect(container.querySelector(".tl")!.textContent).not.toContain("NaN");
    unmount();
  });

  it("#/v2/plan mounts the plan page and survives odd API answers", async () => {
    stub();                                  // every unknown URL answers [] — not the shapes the page expects
    window.location.hash = "#/v2/plan";
    const { container, unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(container.querySelector(".pl .pl-day .sec")).not.toBeNull());
    expect(container.querySelector(".pl")!.textContent).not.toContain("NaN");
    unmount();
  });

  it("#/v2/report mounts the 週報 page and survives odd API answers", async () => {
    stub();                                  // every unknown URL answers [] — not the shapes the page expects
    window.location.hash = "#/v2/report";
    const { container, unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(container.querySelector(".rp .rp-ctl")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".rp")!.textContent).not.toContain("NaN");
    unmount();
  });

  it("#/v2/stats mounts the 统计 page and survives odd API answers", async () => {
    stub();                                  // every unknown URL answers [] — not the shapes the page expects
    window.location.hash = "#/v2/stats";
    const { container, unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(container.querySelector(".stp .st-ctl")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".stp [role=alert]")).not.toBeNull());   // [] is no dashboard: 重试, no crash
    expect(container.querySelector(".stp")!.textContent).not.toContain("NaN");
    unmount();
  });

  it("#/v2/now mounts the now page and survives odd API answers", async () => {
    stub();                                  // every unknown URL answers [] — not the shapes the page expects
    window.location.hash = "#/v2/now";
    const { container, unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(container.querySelector(".now")).not.toBeNull());
    unmount();
  });

  it("?world=omote overrides for this view only and is never saved", async () => {
    const puts = stub();
    window.location.hash = "#/v2/settings?world=omote";
    render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(document.documentElement.dataset.world).toBe("omote"));
    expect(puts).toEqual([]);
  });

  it("?lang=ja switches the interface without saving", async () => {
    const puts = stub();
    window.location.hash = "#/v2/settings?lang=ja";
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "ページ" }, { timeout: 5000 })).toBeTruthy();
    expect(document.documentElement.lang).toBe("ja");
    expect(puts).toEqual([]);
  });

  it("an old-UI address followed from inside v2 lands on its v2 page", async () => {
    stub();
    window.location.hash = "#/v2/settings";
    render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await act(async () => { window.location.hash = "#/usage"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await waitFor(() => expect(window.location.hash).toBe("#/v2/usage"));
    expect(await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 })).toBeTruthy();
    expect(document.documentElement.classList.contains("v2")).toBe(true);
  });

  it("dropping ?world= via replaceState + hashchange keeps the same page mounted", async () => {
    stub();
    window.location.hash = "#/v2/settings?world=omote";
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await act(async () => { history.replaceState(null, "", "#/v2/settings"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(screen.getByRole("navigation", { name: "页面" })).toBe(nav);
    expect(document.documentElement.classList.contains("v2")).toBe(true);
  });

  it("W from ?world=omote: the hash override drops, the router does not apply the world while the toggle runs", async () => {
    const puts = stub({ ...DEFAULT_PREFS, worldFx: "ink" });
    window.location.hash = "#/v2/settings?world=omote";
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    await waitFor(() => expect(document.documentElement.dataset.world).toBe("omote"));
    // a 2d context that accepts everything, and frames that only run when the test says so
    const ctx = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ fontBoundingBoxAscent: 0, width: 0 }) : k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : () => {}), set: () => true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    const changes: string[] = [];
    const on = (e: Event) => changes.push((e as CustomEvent).detail);
    document.addEventListener("worldchange", on);
    await act(async () => { screen.getByRole("button", { name: "切换表世界 / 里世界（W）" }).click(); });
    expect(window.location.hash).toBe("#/v2/settings");   // the override is gone ...
    expect(isWorldBusy()).toBe(true);                     // ... the toggle is mid-flight ...
    expect(changes).toEqual([]);                          // ... and nothing applied the world before ink's own frame
    for (let i = 0; i < 400 && isWorldBusy(); i++) await act(async () => { frames.splice(0).forEach((f) => f(performance.now() + 5000)); });
    document.removeEventListener("worldchange", on);
    expect(isWorldBusy()).toBe(false);
    expect(changes).toEqual(["ura"]);                     // ink applied it once
    expect(document.documentElement.dataset.world).toBe("ura");
    expect(screen.getByRole("navigation", { name: "页面" })).toBe(nav);
    await waitFor(() => expect(puts.length).toBe(1));
    vi.restoreAllMocks();
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it("after unmount a world toggle no longer persists to prefs", async () => {
    const puts = stub();
    window.location.hash = "#/v2/settings";
    const { unmount } = render(<App />);
    await screen.findByRole("navigation", { name: "页面" }, { timeout: 5000 });
    unmount();
    await act(async () => { await toggleWorld().catch(() => {}); });
    expect(puts).toEqual([]);
  });

  it("a failing v2 chunk is caught by the error boundary instead of blanking the app", async () => {
    stub();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../src/V2App", () => { throw new Error("chunk 404"); });
    vi.resetModules();
    const { App: FreshApp } = await import("../src/App");
    window.location.hash = "#/v2/settings";
    render(<FreshApp />);
    expect(await screen.findByRole("alert", undefined, { timeout: 5000 })).toBeTruthy();
    vi.doUnmock("../src/V2App");
  });
});
