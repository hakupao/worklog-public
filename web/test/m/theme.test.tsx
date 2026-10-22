import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextChoice, readThemeChoice, resolveTheme, THEME_KEY, useMobileTheme } from "../../src/m/theme";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("m theme", () => {
  it("resolves system by the OS and cycles system → dark → light → system", () => {
    expect([resolveTheme("system", true), resolveTheme("system", false), resolveTheme("light", true), resolveTheme("dark", false)])
      .toEqual(["dark", "light", "light", "dark"]);
    expect([nextChoice("system"), nextChoice("dark"), nextChoice("light")]).toEqual(["dark", "light", "system"]);
  });
  it("reads only known values", () => {
    expect(readThemeChoice()).toBe("system");
    localStorage.setItem(THEME_KEY, "light"); expect(readThemeChoice()).toBe("light");
    localStorage.setItem(THEME_KEY, "neon"); expect(readThemeChoice()).toBe("system");
  });
  it("stores the choice; system removes the key", () => {
    const { result } = renderHook(() => useMobileTheme());
    expect(result.current.resolved).toBe("dark");          // jsdom has no matchMedia: treated as a dark OS
    act(() => result.current.setChoice("light"));
    expect(result.current.resolved).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    act(() => result.current.setChoice("system"));
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
  it("theme without storage: still switches for this page", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useMobileTheme());
    act(() => result.current.setChoice("light"));
    expect(result.current.resolved).toBe("light");
  });
});
