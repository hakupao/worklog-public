// web/test/m/redirect.test.tsx
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { __resetMobileOptOutForTests, setMobileOptOut } from "../../src/m/route";

function narrow(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: q.includes("max-width") ? matches : false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
}
// every API call fails: the redirect is decided before any data, and the pages fall back to their defaults
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 }))); });
afterEach(() => {
  vi.unstubAllGlobals(); __resetMobileOptOutForTests(); localStorage.clear(); window.location.hash = "";
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("phone redirect", () => {
  it("a narrow screen on a desktop address lands on the phone page", async () => {
    narrow(true); window.location.hash = "#/v2/timeline";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/m/tl"));
    await waitFor(() => expect(document.documentElement.classList.contains("m")).toBe(true));   // the phone shell mounted
  });
  it("a wide screen stays", async () => {
    narrow(false); window.location.hash = "#/v2/timeline";
    render(<App />);
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe("#/v2/timeline");
  });
  it("a device that chose the desktop stays", async () => {
    narrow(true); setMobileOptOut(true); window.location.hash = "#/v2/timeline";
    render(<App />);
    await new Promise((r) => setTimeout(r, 50));
    expect(window.location.hash).toBe("#/v2/timeline");
  });
  it("an old-UI address on a phone goes to its phone page", async () => {
    narrow(true); window.location.hash = "#/unlinked";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/m/tl?un=1"));
  });
  it("an old-UI address on a phone that chose the desktop goes to its v2 page", async () => {
    narrow(true); setMobileOptOut(true); window.location.hash = "#/tasks/T1";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/v2/tasks/T1"));
  });
  it("an empty hash on a phone still goes to the phone UI, not v2", async () => {
    narrow(true); window.location.hash = "";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/m/now"));
  });
  it("an empty hash on a phone that chose the desktop goes to v2", async () => {
    narrow(true); setMobileOptOut(true); window.location.hash = "";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/v2/now"));
  });
});
