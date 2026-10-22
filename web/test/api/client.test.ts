import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ConflictError, isLinkedError, UnauthorizedError, ValidationError } from "../../src/api/client";

const respond = (status: number, body?: unknown, raw?: string) =>
  vi.fn(async () => new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status }));
const lastCall = (f: ReturnType<typeof vi.fn>) => f.mock.calls.at(-1) as [string, RequestInit];

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("never sends credentials of its own", async () => {
    const f = respond(200, { kind: "user", email: "me@example.com" });
    vi.stubGlobal("fetch", f);
    await api.machines();
    const [, init] = lastCall(f);
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
    expect(init.credentials).toBe("same-origin");
  });

  it("machineRuns GETs /api/machines/runs and returns the parsed array", async () => {
    const body = [{ name: "mac", hours: Array(24).fill(false), last_run_at: null }];
    const f = respond(200, body);
    vi.stubGlobal("fetch", f);
    await expect(api.machineRuns()).resolves.toEqual(body);
    expect(lastCall(f)[0]).toBe("/api/machines/runs");
    expect(lastCall(f)[1].method).toBe("GET");
  });

  it("statsSessions GETs /api/stats/sessions with the range, encoded", async () => {
    const f = respond(200, { range: { from: "2026-09-21", to: "2026-09-22" }, day_start: "05:00", sessions: [], plans: [] });
    vi.stubGlobal("fetch", f);
    const b = await api.statsSessions("2026-09-21", "2026-09-22");
    expect(lastCall(f)[0]).toBe("/api/stats/sessions?from=2026-09-21&to=2026-09-22");
    expect(lastCall(f)[1].method).toBe("GET");
    expect(b.day_start).toBe("05:00");
  });

  it("dayPlan maps only the 404 {error:\"no plan\"} to null; any other 404 rethrows", async () => {
    vi.stubGlobal("fetch", respond(404, { error: "no plan" }));
    await expect(api.dayPlan("2026-10-02")).resolves.toBeNull();
    vi.stubGlobal("fetch", respond(404, { error: "not found" }));
    await expect(api.dayPlan("2026-10-02")).rejects.toBeInstanceOf(ApiError);
  });

  it("PATCH session sends updated_at alongside the patch, and null stays null", async () => {
    const f = respond(200, { id: "S1" });
    vi.stubGlobal("fetch", f);
    await api.patchSession("S1", "2026-09-22T00:00:00.000Z", { task_id: null });
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/sessions/S1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ updated_at: "2026-09-22T00:00:00.000Z", task_id: null });
  });

  it("DELETE note carries updated_at as an encoded query parameter and resolves on 204", async () => {
    const f = respond(204);
    vi.stubGlobal("fetch", f);
    await expect(api.deleteNote("N1", "2026-09-22T00:00:00.000Z")).resolves.toBeUndefined();
    expect(lastCall(f)[0]).toBe("/api/notes/N1?updated_at=2026-09-22T00%3A00%3A00.000Z");
  });

  it("DELETE task carries updated_at as an encoded query parameter and resolves on 204", async () => {
    const f = respond(204);
    vi.stubGlobal("fetch", f);
    await expect(api.deleteTask("T20260922-01", "2026-09-22T00:00:00.000Z")).resolves.toBeUndefined();
    const [url, init] = lastCall(f);
    expect(url).toBe("/api/tasks/T20260922-01?updated_at=2026-09-22T00%3A00%3A00.000Z");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("timeline adds include_hidden only when asked", async () => {
    const f = respond(200, { week: "2026-W39", days: [] });
    vi.stubGlobal("fetch", f);
    await api.timeline("2026-W39", false);
    expect(lastCall(f)[0]).toBe("/api/weeks/2026-W39/timeline");
    await api.timeline("2026-W39", true);
    expect(lastCall(f)[0]).toBe("/api/weeks/2026-W39/timeline?include_hidden=1");
  });

  it("409 becomes ConflictError carrying the current row", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "conflict", current: { id: "S1", summary: "now" } }));
    const err = await api.patchSession("S1", "stale", { hidden: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.current).toEqual({ id: "S1", summary: "now" });
  });

  // A delete refused because sessions/notes still point at the 案件 also answers 409, but with no
  // `current` at all. Treating it as a ConflictError would hand every caller `current: undefined`
  // and lose the counts that say what has to be unlinked.
  it("a 409 that is not a conflict stays a plain ApiError, and isLinkedError recognises the linked shape", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "linked", sessions: 2, notes: 1 }));
    const err = await api.deleteTask("T20260922-01", "2026-09-22T00:00:00.000Z").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(err.status).toBe(409);
    expect(err.body).toEqual({ error: "linked", sessions: 2, notes: 1 });
    expect(isLinkedError(err)).toBe(true);
  });

  it("isLinkedError says no to a conflict 409, to a non-409, and to a linked body missing its counts", async () => {
    vi.stubGlobal("fetch", respond(409, { error: "conflict", current: { id: "T1" } }));
    expect(isLinkedError(await api.deleteTask("T1", "x").catch((e) => e))).toBe(false);
    vi.stubGlobal("fetch", respond(500, { error: "linked", sessions: 1, notes: 0 }));
    expect(isLinkedError(await api.deleteTask("T1", "x").catch((e) => e))).toBe(false);
    vi.stubGlobal("fetch", respond(409, { error: "linked" }));
    expect(isLinkedError(await api.deleteTask("T1", "x").catch((e) => e))).toBe(false);
    expect(isLinkedError(new Error("nope"))).toBe(false);
  });

  it("400 becomes ValidationError with the issues", async () => {
    vi.stubGlobal("fetch", respond(400, { error: "invalid", issues: [{ path: "task_id", message: "unknown task" }] }));
    const err = await api.patchSession("S1", "x", { task_id: "T1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues[0].path).toBe("task_id");
  });

  it("asks the browser not to follow redirects", async () => {
    const f = respond(200, { kind: "token" });
    vi.stubGlobal("fetch", f);
    await api.machines();
    expect(lastCall(f)[1].redirect).toBe("manual");
  });

  it("an expired Access session (opaque redirect), a 401 and a 200 HTML page all become UnauthorizedError", async () => {
    const opaque = { type: "opaqueredirect", status: 0, ok: false, text: async () => "" } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => opaque));
    await expect(api.machines()).rejects.toBeInstanceOf(UnauthorizedError);
    vi.stubGlobal("fetch", respond(401, { error: "unauthorized" }));
    await expect(api.machines()).rejects.toBeInstanceOf(UnauthorizedError);
    vi.stubGlobal("fetch", respond(200, undefined, "<html>Sign in</html>"));
    await expect(api.machines()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("a 5xx with an HTML body is a plain ApiError, not a login problem", async () => {
    vi.stubGlobal("fetch", respond(502, undefined, "<html>Bad gateway</html>"));
    const err = await api.machines().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(UnauthorizedError);
    expect(err.status).toBe(502);
  });

  it("other errors are ApiError with status", async () => {
    vi.stubGlobal("fetch", respond(500, { error: "boom" }));
    const err = await api.machines().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });
});

describe("composePreview errors", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("parses a JSON error body so err.body.error works", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "bad items" }), { status: 400 }));
    const err: any = await api.composePreview("2026-W40", "zh", []).catch((e) => e);
    expect(err.status).toBe(400);
    expect(err.body.error).toBe("bad items");
  });
  it("keeps a non-JSON error body as text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const err: any = await api.composePreview("2026-W40", "zh", []).catch((e) => e);
    expect(err.body).toBe("boom");
  });
});
