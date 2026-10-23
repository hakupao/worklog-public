import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dock, DOCK_EDGE_PX, DOCK_HIDE_MS } from "../src/ui/Dock";
import type { DockMode } from "../src/prefs/types";
import { V2TestProvider } from "./helpers";

afterEach(() => { vi.useRealTimers(); });

function renderDock(dock: DockMode) {
  const ui = render(<V2TestProvider prefs={{ dock }}><Dock page="now" onNote={() => {}} /></V2TestProvider>);
  const nav = ui.container.querySelector<HTMLElement>("#dock")!;
  return { ...ui, nav, away: () => nav.classList.contains("away") };
}
const moveTo = (y: number, target: Element = document.body) => fireEvent.pointerMove(target, { clientY: y });

describe("Dock auto-hide (prefs.dock)", () => {
  it("auto: starts down with the hint bar, rises in the bottom strip, sinks a second after the pointer leaves", () => {
    vi.useFakeTimers();
    const { nav, away, container } = renderDock("auto");
    expect(away()).toBe(true);
    expect(container.querySelector(".dock-hint")).not.toBeNull();
    act(() => { moveTo(window.innerHeight - DOCK_EDGE_PX + 1); });
    expect(away()).toBe(false);
    act(() => { moveTo(window.innerHeight - 60, nav); });          // up onto the dock, above the strip: stays up
    act(() => { vi.advanceTimersByTime(DOCK_HIDE_MS * 2); });
    expect(away()).toBe(false);
    act(() => { moveTo(100); });
    act(() => { vi.advanceTimersByTime(DOCK_HIDE_MS - 1); });
    expect(away()).toBe(false);
    act(() => { moveTo(window.innerHeight - 10); });                // back before it sank: the timer is dropped
    act(() => { moveTo(200); vi.advanceTimersByTime(DOCK_HIDE_MS); });
    expect(away()).toBe(true);
  });

  it("auto: keyboard focus inside keeps it up; focus leaving lets it sink", () => {
    vi.useFakeTimers();
    const { nav, away } = renderDock("auto");
    const link = nav.querySelector("a")!;
    act(() => { link.focus(); });
    expect(away()).toBe(false);
    act(() => { link.blur(); vi.advanceTimersByTime(DOCK_HIDE_MS); });
    expect(away()).toBe(true);
  });

  it("pin: always up, no hint bar", () => {
    vi.useFakeTimers();
    const { away, container } = renderDock("pin");
    act(() => { moveTo(100); vi.advanceTimersByTime(DOCK_HIDE_MS * 3); });
    expect(away()).toBe(false);
    expect(container.querySelector(".dock-hint")).toBeNull();
  });
});
