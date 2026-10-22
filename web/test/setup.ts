import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { __resetWriteQueuesForTests } from "../src/api/queries";
import { __resetToastsForTests } from "../src/components/Toast";
import { __resetLedForTests } from "../src/led/testing";
import { __resetPrefsQueueForTests } from "../src/prefs/usePrefs";
import { __resetNoteForTests } from "../src/ui/note";
import { __resetTaskBadgesForTests } from "../src/ui/taskBadges";

// jsdom has no Path2D; the canvas-rec fake records fill(path, rule) and reads the path's `d` (B3b drawGlyph tests).
if (typeof (globalThis as { Path2D?: unknown }).Path2D === "undefined") {
  (globalThis as { Path2D?: unknown }).Path2D = class { constructor(public d?: string) {} };
}

// findBy* / waitFor give up after 1s by default. A page that lazy-loads a chunk (the 统计 views) takes 0.6–0.75s to
// its first draw on an idle machine and well past 1s under load (other suites running), so the default turned a slow
// first paint into an assertion failure (sub7b F6). Waits still end as soon as their condition holds.
configure({ asyncUtilTimeout: 10_000 });

// jsdom has no canvas 2D and prints "Not implemented" on every getContext call; answer null quietly
// (sub-project 1 carry). A test that needs a fake context spies again; restoreAllMocks undoes both.
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  // The per-item write queues (queries.ts) are module-level, shared across every QueryClient —
  // deliberately, but that also means they're shared across tests in the same file. A chain a
  // test leaves pending (an unresolved fetch mock, an assertion that throws before awaiting a
  // write) would otherwise silently couple it to the next test that writes the same
  // session/task/note id.
  __resetWriteQueuesForTests();
  __resetPrefsQueueForTests();
  __resetLedForTests();
  __resetNoteForTests();
  __resetToastsForTests();
  __resetTaskBadgesForTests();
  // The canRaster memo is module-global: a test that fakes getContext must not leak into the next file. Imported lazily:
  // a static import here would load badge/objects before badge-cull.test's vi.mock of ./culled is in place.
  (await import("../src/badge/cache")).__resetBadgeCacheForTests();
});
