import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, ErrorBoundary } from "../src/App";
import { toast, ToastHost } from "../src/components/Toast";
import { currentWeek, reportWeekOf } from "../src/lib/jst";
import { readRp } from "../src/pages/report/state";
import { readTl } from "../src/pages/timeline/state";
import { UNLINKED_HREF } from "../src/predict/rules";
import { legacyHref } from "../src/route";

/** Routes a stubbed fetch by exact-or-prefix URL match. `{ __status: n }` sends an empty body with that status. */
function routedFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    const hit = Object.entries(routes).find(([path]) => url === path || url.startsWith(path));
    if (!hit) return new Response(JSON.stringify({}), { status: 404 });
    const [, body] = hit;
    if (body && typeof body === "object" && "__status" in (body as Record<string, unknown>)) {
      return new Response(null, { status: (body as { __status: number }).__status });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
  sessionStorage.clear();
});

// The old UI's addresses (bookmarks exist), each with the v2 page it lands on.
const LEGACY: [string, string][] = [
  ["#/dashboard", "#/v2/stats"],
  ["#/timeline", "#/v2/timeline"],
  ["#/timeline/2026-W40", "#/v2/timeline/2026-W40"],
  ["#/unlinked", UNLINKED_HREF],
  ["#/tasks", "#/v2/tasks"],
  ["#/tasks?status=all", "#/v2/tasks?status=all"],
  ["#/tasks/T20260901-01", "#/v2/tasks/T20260901-01"],
  ["#/tasks/T20260901-01?status=open,hold", "#/v2/tasks/T20260901-01?status=open,hold"],
  ["#/report", "#/v2/report"],
  ["#/report/2026-W40", "#/v2/report/2026-W40"],
  ["#/report/2026-W40/agency?sheet=tasks", "#/v2/report/2026-W40?sheet=tasks"],
  ["#/report/2026-W40/site", "#/v2/report/2026-W40"],
  ["#/plan", "#/v2/plan"],
  ["#/plan/2026-10-20", "#/v2/plan/2026-10-20"],
  ["#/usage", "#/v2/usage"],
  // the query travels whole: v2's own overrides (?lang= / ?world=) keep working on an old address
  ["#/tasks?status=all&lang=en", "#/v2/tasks?status=all&lang=en"],
  ["#/timeline/2026-W40?world=omote", "#/v2/timeline/2026-W40?world=omote"],
  ["#/report?sheet=days&lang=ja", "#/v2/report?sheet=days&lang=ja"],
  // a bad param is passed through; the v2 page falls back on it itself (current week / today)
  ["#/timeline/garbage", "#/v2/timeline/garbage"],
  ["#/report/2025-W53/agency", "#/v2/report/2025-W53"],
  ["#/stats", "#/v2/now"],
  ["#/settings", "#/v2/now"],
  ["#/garbage/x?y=1", "#/v2/now"],
];

describe("legacyHref", () => {
  it.each(LEGACY)("%s → %s", (from, to) => expect(legacyHref(from)).toBe(to));
  it("the unlinked target is the timeline's 未关联 filter", () => expect(UNLINKED_HREF).toBe("#/v2/timeline?unlinked=1"));
  it("a passed-through bad week reads as the current week on the v2 timeline and report", () => {
    const now = new Date("2026-10-20T03:00:00Z");
    expect(readTl(legacyHref("#/timeline/garbage"), now).week).toBe(currentWeek(now));
    expect(readRp(legacyHref("#/report/2025-W53/site"), now).week).toBe(reportWeekOf(now));
  });
});

describe("App shell", () => {
  it("v2 is the home: an empty hash (and #, #/) is replaced by #/v2/now on desktop", async () => {
    vi.stubGlobal("fetch", routedFetch({}));
    for (const start of ["", "#", "#/", "#//", "#/?x=1"]) {
      window.history.replaceState(null, "", start === "" ? window.location.pathname : start);
      const { unmount } = render(<App />);
      await waitFor(() => expect(window.location.hash).toBe("#/v2/now"));
      unmount();
    }
  });

  it("an old-UI address is replaced by its v2 page on desktop, without a history entry, and v2 mounts", async () => {
    vi.stubGlobal("fetch", routedFetch({}));
    for (const [from, to] of LEGACY) {
      window.history.replaceState(null, "", from);
      const before = window.history.length;
      const { unmount } = render(<App />);
      await waitFor(() => expect(window.location.hash).toBe(to));
      expect(window.history.length).toBe(before);
      unmount();
    }
    window.history.replaceState(null, "", "#/tasks/T1");
    render(<App />);
    await waitFor(() => expect(document.documentElement.classList.contains("v2")).toBe(true));
    expect(window.location.hash).toBe("#/v2/tasks/T1");
  });

  it("contract 4: an UnauthorizedError from any request shows the persistent banner", async () => {
    vi.stubGlobal("fetch", routedFetch({ "/api/": { __status: 401 } }));
    window.location.hash = "#/v2/usage";
    render(<App />);
    expect(await screen.findByText("登录已过期，请刷新页面")).toHaveAttribute("role", "alert");
  });

  it("contract 5: a toast shows with role=status, auto-dismisses after 5s, and can be closed manually", () => {
    vi.useFakeTimers();
    try {
      render(<ToastHost />);

      act(() => toast.error("失败了"));
      expect(screen.getByRole("status")).toHaveTextContent("失败了");

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      act(() => toast.info("提示"));
      fireEvent.click(screen.getByRole("button", { name: "关闭" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("F3: an actionable toast can be given a longer duration than the default 5s", () => {
    vi.useFakeTimers();
    try {
      render(<ToastHost />);

      act(() => toast.info("已隐藏", { label: "撤销", onClick: () => {} }, 10000));
      expect(screen.getByRole("status")).toHaveTextContent("已隐藏");

      act(() => {
        vi.advanceTimersByTime(5000); // the default duration — must NOT have dismissed yet
      });
      expect(screen.getByRole("status")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000); // now at 10s total
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("contract 8: a vite:preloadError reloads once, then guards against a reload loop within 60s", async () => {
    vi.stubGlobal("fetch", routedFetch({}));
    window.location.hash = "#/v2/usage";
    render(<App />);

    // jsdom's `window.location.reload` is a non-configurable own property (spying on it
    // directly throws "Cannot redefine property"), so swap the whole `location` object for
    // the duration of this test and put the original back afterwards.
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, hash: originalLocation.hash, reload: reloadSpy },
    });
    try {
      window.dispatchEvent(new Event("vite:preloadError"));
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event("vite:preloadError"));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("页面已更新，请手动刷新")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("contract 8 (fix): if sessionStorage is unavailable, a vite:preloadError does NOT reload and shows the banner", async () => {
    vi.stubGlobal("fetch", routedFetch({}));
    window.location.hash = "#/v2/usage";
    render(<App />);

    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, hash: originalLocation.hash, reload: reloadSpy },
    });
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    try {
      window.dispatchEvent(new Event("vite:preloadError"));
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(await screen.findByText("页面已更新，请手动刷新")).toBeInTheDocument();
    } finally {
      getItemSpy.mockRestore();
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  // Final review A-C1: no ErrorBoundary anywhere meant an uncaught render error (the concrete
  // case: a task 409's `current.deliverables` shaped as a raw string) blanked the whole SPA.
  it("A-C1: a child that throws during render shows the boundary message instead of blanking the page", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): never {
      throw new Error("boom");
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("页面出错了，请刷新");
    errorSpy.mockRestore();
  });

  it("A-C1: the boundary's 刷新 button reloads the page", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom(): never {
      throw new Error("boom");
    }
    const originalLocation = window.location;
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByRole("button", { name: "刷新" }));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
      errorSpy.mockRestore();
    }
  });
});
