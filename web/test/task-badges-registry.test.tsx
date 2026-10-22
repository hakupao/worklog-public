import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { App } from "../src/App";
import { resolveBadge } from "../src/badge/cache";
import { BADGE_OBJECTS, pickFallbackObject } from "../src/badge/objects";
import { fnv1a } from "../src/badge/rng";
import { DEFAULT_PREFS } from "../src/prefs/defaults";
import { LINE_PALETTE, lineColor } from "../src/ui/palette";
import { noteTaskBadges, subscribeTaskBadges, taskBadgeOf, taskBadgesVersion } from "../src/ui/taskBadges";

// The hash colour, computed here from the formula in palette.ts (not by calling lineColor).
const hashColor = (id: string) => { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return LINE_PALETTE[h % LINE_PALETTE.length]; };
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const task = (id: string, extra: object = {}) => ({ id, requester: "r", project: "p", title: "t", status: "open", received_at: "2026-10-14T00:00:00+09:00", done_at: null, thinking: "", deliverables: [], hours_manual: null, machine: "m", ts: "x", updated_at: "u", ...extra });
afterEach(() => { vi.unstubAllGlobals(); window.location.hash = ""; localStorage.clear(); });

describe("task badge registry", () => {
  it("1: a noted colour wins in lineColor; an unknown id keeps the hash colour", () => {
    expect(lineColor("T2")).toBe(hashColor("T2"));
    noteTaskBadges([{ id: "T1", badge_obj: "phosphor:cat", badge_color: 3 }]);
    expect(lineColor("T1")).toBe(LINE_PALETTE[3]);
    expect(lineColor("T2")).toBe(hashColor("T2"));
  });

  it("2: an invalid colour falls back to the hash colour and reads as null", () => {
    for (const bad of [12, -1, 1.5, null, undefined]) {
      noteTaskBadges([{ id: "Tx", badge_obj: "phosphor:cat", badge_color: bad }]);
      expect(lineColor("Tx")).toBe(hashColor("Tx"));
      expect(taskBadgeOf("Tx")?.color ?? null).toBeNull();
    }
  });

  it("3: a row without badge keys does not erase an earlier value (undefined = unknown); null = explicitly unassigned", () => {
    noteTaskBadges([{ id: "T1", badge_obj: "phosphor:cat", badge_color: 3 }]);
    noteTaskBadges([{ id: "T1" }]);
    expect(taskBadgeOf("T1")).toEqual({ obj: "phosphor:cat", color: 3 });
    noteTaskBadges([{ id: "T1", badge_obj: null, badge_color: null }]);
    expect(taskBadgeOf("T1")).toEqual({ obj: null, color: null });
  });

  it("4: resolveBadge reads the registry; explicit spec wins; unknown object falls back", () => {
    const [a, b] = BADGE_OBJECTS;
    noteTaskBadges([{ id: "T1", badge_obj: a, badge_color: 3 }]);
    expect(resolveBadge({ id: "T1" })).toEqual({ obj: a, color: LINE_PALETTE[3] });
    expect(resolveBadge({ id: "T1", obj: b, color: 5 })).toEqual({ obj: b, color: LINE_PALETTE[5] });
    expect(resolveBadge({ id: "T1", obj: null, color: null })).toEqual({ obj: pickFallbackObject(fnv1a("T1")), color: hashColor("T1") });
    noteTaskBadges([{ id: "T9", badge_obj: "nosuch:thing", badge_color: 2 }]);
    expect(resolveBadge({ id: "T9" }).obj).toBe(pickFallbackObject(fnv1a("T9")));
  });

  it("5: the version bumps on change only, and so does the subscriber", () => {
    const fn = vi.fn();
    const off = subscribeTaskBadges(fn);
    const v0 = taskBadgesVersion();
    noteTaskBadges([{ id: "T1", badge_obj: "phosphor:cat", badge_color: 3 }]);
    expect(taskBadgesVersion()).toBe(v0 + 1);
    expect(fn).toHaveBeenCalledTimes(1);
    noteTaskBadges([{ id: "T1", badge_obj: "phosphor:cat", badge_color: 3 }]);
    expect(taskBadgesVersion()).toBe(v0 + 1);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    noteTaskBadges([{ id: "T1", badge_obj: "phosphor:cat", badge_color: 4 }]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("6: tasks / task / createTask / patchTask feed the registry; a non-array tasks answer is harmless", async () => {
    const t = (id: string, c: number) => task(id, { badge_obj: "phosphor:cat", badge_color: c });
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u), m = init?.method ?? "GET";
      if (m === "POST") return json(t("C1", 1));
      if (m === "PATCH") return json(t("P1", 2));
      if (url.startsWith("/api/tasks/D1")) return json({ task: t("D1", 4), sessions: [], notes: [], total_minutes: 0 });
      if (url.startsWith("/api/tasks")) return json([t("L1", 5)]);
      return json([]);
    }));
    await api.tasks(); expect(taskBadgeOf("L1")?.color).toBe(5);
    await api.task("D1"); expect(taskBadgeOf("D1")?.color).toBe(4);
    await api.createTask({ id: "C1" } as never); expect(taskBadgeOf("C1")?.color).toBe(1);
    await api.patchTask("P1", "u", {}); expect(taskBadgeOf("P1")?.color).toBe(2);
    vi.stubGlobal("fetch", vi.fn(async () => json({ oops: true })));
    await expect(api.tasks()).resolves.toEqual({ oops: true });
  });

  it("7: a page that painted before the list keeps its DOM and repaints in the stored colour", async () => {
    let rows: object[] = [task("T1", { badge_obj: null, badge_color: null })];
    const hits: Record<string, number> = {};
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const url = String(u), ep = url.split("?")[0];
      hits[ep] = (hits[ep] ?? 0) + 1;
      if (url.startsWith("/api/prefs")) return json(DEFAULT_PREFS);
      if (url.startsWith("/api/me")) return json({ kind: "user", email: "me@example.com" });
      if (url.startsWith("/api/tasks")) return json(rows);
      return json([]);
    }));
    window.location.hash = "#/v2/tasks";
    const { container } = render(<App />);
    const row = await waitFor(() => { const r = container.querySelector<HTMLElement>(".trow[data-task='T1']"); expect(r).not.toBeNull(); return r!; }, { timeout: 5000 });
    expect(row.style.getPropertyValue("--lc")).toBe(hashColor("T1"));
    const before = { ...hits };
    rows = [task("T1", { badge_obj: "phosphor:cat", badge_color: 3 })];
    await api.tasks();                                   // the registry fills from a later answer
    await waitFor(() => expect(row.style.getPropertyValue("--lc")).toBe(LINE_PALETTE[3]));
    expect(row.isConnected).toBe(true);                  // re-rendered, not remounted
    for (const [ep, n] of Object.entries(before)) if (ep !== "/api/tasks") expect(hits[ep]).toBe(n);   // no other query refetched
  });

  describe("9: odd rows and the version", () => {
  it("a: a null row in a tasks answer is skipped, not a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([null, { id: "T1", badge_color: 3, badge_obj: null }])));
    await expect(api.tasks()).resolves.toBeDefined();
    expect(taskBadgeOf("T1")?.color).toBe(3);
  });

  it("b: an identical answer does not re-render subscribers (version unchanged)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([task("T1", { badge_obj: "phosphor:cat", badge_color: 3 })])));
    await api.tasks();
    const v = taskBadgesVersion();
    await api.tasks();
    expect(taskBadgesVersion()).toBe(v);
  });
});

describe("8: the setup reset keeps tests apart", () => {
    it("a: notes a badge", () => {
      noteTaskBadges([{ id: "LEAK", badge_obj: "phosphor:cat", badge_color: 3 }]);
      expect(lineColor("LEAK")).toBe(LINE_PALETTE[3]);
    });
    it("b: sees none of it", () => {
      expect(taskBadgeOf("LEAK")).toBeUndefined();
      expect(lineColor("LEAK")).toBe(hashColor("LEAK"));
    });
  });
});
