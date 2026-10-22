import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, ConflictError, UnauthorizedError } from "../../src/api/client";
import { toast } from "../../src/components/Toast";
import {
  createQueryClient,
  keys,
  useCreateNote,
  useCreateTask,
  useDeleteNote,
  useDeleteTask,
  useHideSessions,
  usePatchNote,
  usePatchSession,
  usePatchTask,
  usePlanWrite,
  useRequesters,
  useTask,
  useTaskTotals,
  useTasks,
  useTimeline,
  withEffective,
  type RawSessionRow,
} from "../../src/api/queries";
import type { DayPlan, DayPlanItem, Note, PlanItem, Session, Task, TaskDetail, TaskTotal, Timeline } from "../../src/api/types";

const baseSession: Session = {
  id: "S1",
  machine: "macmini",
  agent: "claude-code",
  session_id: "sess-1",
  cwd: "/x",
  started_at: "2026-09-21T00:00:00Z",
  ended_at: "2026-09-21T01:00:00Z",
  active_minutes: 30,
  turns: 5,
  summary: "did stuff",
  summary_source: "llm",
  task_id: null,
  link_method: "none",
  summary_edited: null,
  minutes_override: null,
  hidden: 0,
  files_written: [],
  tokens: null,
  active_intervals: null,
  ts: "2026-09-21T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z",
  summary_effective: "did stuff",
  minutes_effective: 30,
};

function makeTimeline(session: Session): Timeline {
  return {
    week: "2026-W39",
    days: [{ date: "2026-09-21", minutes: session.active_minutes, sessions: [session], notes: [] }],
    total_minutes: session.active_minutes,
    unassigned: 1,
    hidden: 0,
  };
}

const baseTask: Task = {
  id: "TASK1",
  requester: "田中",
  project: "P1",
  title: "対応",
  status: "open",
  received_at: "2026-09-20T00:00:00Z",
  done_at: null,
  thinking: "",
  deliverables: [],
  hours_manual: null,
  machine: "macmini",
  ts: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z",
};

const baseNote: Note = {
  id: "NOTE1",
  text: "進捗報告",
  task_id: null,
  minutes: 10,
  machine: "web",
  ts: "2026-09-21T05:00:00",
  updated_at: "2026-09-21T00:00:00Z",
};

function makeTimelineWithNote(note: Note): Timeline {
  return {
    week: "2026-W39",
    days: [{ date: "2026-09-21", minutes: 0, sessions: [], notes: [note] }],
    total_minutes: 0,
    unassigned: 0,
    hidden: 0,
  };
}

function makeTaskDetail(task: Task, sessions: Session[] = [], notes: Note[] = []): TaskDetail {
  return { task, sessions, notes, total_minutes: 0 };
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("usePatchSession", () => {
  it("contract 6: success writes the response's updated_at into cache, so a second patch reads the fresh value", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(baseSession));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...baseSession, summary_edited: "a", summary_effective: "a", updated_at: "T1" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...baseSession, summary_edited: "b", summary_effective: "b", updated_at: "T2" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });

    await result.current.mutateAsync({ id: "S1", updatedAt: "2026-09-21T00:00:00Z", patch: { summary_edited: "a" } });

    const afterFirst = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
    expect(afterFirst?.days[0].sessions[0].updated_at).toBe("T1");

    // The second call is driven by the cache's freshest updated_at, not the original stale one.
    const freshUpdatedAt = afterFirst!.days[0].sessions[0].updated_at;
    await result.current.mutateAsync({ id: "S1", updatedAt: freshUpdatedAt, patch: { summary_edited: "b" } });

    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(secondCall[1].body as string);
    expect(body.updated_at).toBe("T1");
  });

  it("contract 7: a 409 replaces the cached row with withEffective(current) and rejects with ConflictError", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(baseSession));

    // `current` is a RAW row: no summary_effective / minutes_effective.
    const rawCurrent = {
      ...baseSession,
      summary: "changed elsewhere",
      summary_edited: null,
      minutes_override: 5,
      updated_at: "T-elsewhere",
    } as Record<string, unknown>;
    delete rawCurrent.summary_effective;
    delete rawCurrent.minutes_effective;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current: rawCurrent }), { status: 409 })),
    );

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });

    const err = await result.current
      .mutateAsync({ id: "S1", updatedAt: "stale", patch: { summary_edited: "mine" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);

    const cached = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
    const row = cached!.days[0].sessions[0];
    expect(row.updated_at).toBe("T-elsewhere");
    expect(row.summary).toBe("changed elsewhere");
    expect(row.summary_effective).toBe("changed elsewhere"); // summary_edited is null -> falls back to summary
    expect(row.minutes_effective).toBe(5); // minutes_override ?? active_minutes, not ||
  });

  it("(c) generic error: the session is put back to its previous row and the mutation rejects (scoped rollback)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(baseSession));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const err = await result.current
      .mutateAsync({ id: "S1", updatedAt: "x", patch: { summary_edited: "attempt" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(ConflictError);

    const cached = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
    expect(cached?.days[0].sessions[0]).toEqual(baseSession);
  });
});

describe("usePatchSession — optimistic hide (policy 6)", () => {
  it("removes the session from a no-include-hidden timeline cache, and marks it hidden (not removed) where include_hidden is fetched", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(baseSession));
    qc.setQueryData(keys.timeline("2026-W39", true), makeTimeline(baseSession));

    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const promise = result.current.mutateAsync({ id: "S1", updatedAt: baseSession.updated_at, patch: { hidden: true } });

    await waitFor(() => {
      const noHidden = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
      expect(noHidden?.days[0].sessions).toHaveLength(0);
    });
    const withHidden = qc.getQueryData<Timeline>(keys.timeline("2026-W39", true));
    expect(withHidden?.days[0].sessions[0].id).toBe("S1");
    expect(withHidden?.days[0].sessions[0].hidden).toBe(1);

    resolveFetch(new Response(JSON.stringify({ ...baseSession, hidden: 1, updated_at: "T1" }), { status: 200 }));
    await promise;
  });
});

describe("withEffective (?? not ||)", () => {
  it("minutes_override: 0 and summary_edited: '' are real values, not falsy fallbacks", () => {
    const row: RawSessionRow = { ...baseSession, minutes_override: 0, summary_edited: "" };
    const effective = withEffective(row);
    expect(effective.minutes_effective).toBe(0);
    expect(effective.summary_effective).toBe("");
  });

  it("the optimistic patch path also computes minutes_effective with ?? for minutes_override: 0", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(baseSession));
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const promise = result.current.mutateAsync({
      id: "S1",
      updatedAt: baseSession.updated_at,
      patch: { minutes_override: 0 },
    });

    await waitFor(() => {
      const cached = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
      expect(cached?.days[0].sessions[0].minutes_effective).toBe(0);
    });

    resolveFetch(
      new Response(JSON.stringify({ ...baseSession, minutes_override: 0, minutes_effective: 0, updated_at: "T1" }), {
        status: 200,
      }),
    );
    await promise;
  });
});

describe("useCreateTask", () => {
  it("(a) success invalidates the tasks list and requesters, which refetch", async () => {
    let tasksGetCalls = 0;
    let requestersGetCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url === "/api/tasks") {
        tasksGetCalls++;
        return new Response(JSON.stringify([baseTask]), { status: 200 });
      }
      if (method === "GET" && url === "/api/requesters") {
        requestersGetCalls++;
        return new Response(JSON.stringify(["田中"]), { status: 200 });
      }
      if (method === "POST" && url === "/api/tasks") {
        return new Response(JSON.stringify({ ...baseTask, id: "TASK2" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ create: useCreateTask(), list: useTasks(), requesters: useRequesters() }), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.requesters.isSuccess).toBe(true));
    const tasksBefore = tasksGetCalls;
    const requestersBefore = requestersGetCalls;

    await result.current.create.mutateAsync({ requester: "田中", title: "x" });

    await waitFor(() => {
      expect(tasksGetCalls).toBeGreaterThan(tasksBefore);
      expect(requestersGetCalls).toBeGreaterThan(requestersBefore);
    });
  });

  it("(b) 409 rejects with ConflictError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current: baseTask }), { status: 409 })),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreateTask(), { wrapper: wrapperFor(qc) });
    await expect(result.current.mutateAsync({ requester: "田中", title: "x" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("(c) generic 500 rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreateTask(), { wrapper: wrapperFor(qc) });
    await expect(result.current.mutateAsync({ requester: "田中", title: "x" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("usePatchTask", () => {
  it("(a) success: cache holds the response row and a second patch sends the fresh updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...baseTask, title: "a", updated_at: "T1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...baseTask, title: "b", updated_at: "T2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "TASK1", updatedAt: baseTask.updated_at, patch: { title: "a" } });

    const after1 = qc.getQueryData<Task[]>(keys.tasks());
    expect(after1?.[0].updated_at).toBe("T1");

    await result.current.mutateAsync({ id: "TASK1", updatedAt: after1![0].updated_at, patch: { title: "b" } });
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(secondBody.updated_at).toBe("T1");
  });

  it("(b) 409: cache holds current and the mutation rejects with ConflictError", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);
    const current = { ...baseTask, title: "changed elsewhere", updated_at: "T-elsewhere" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current }), { status: 409 })),
    );

    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    const err = await result.current
      .mutateAsync({ id: "TASK1", updatedAt: "stale", patch: { title: "mine" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(qc.getQueryData<Task[]>(keys.tasks())?.[0]).toEqual(current);
  });

  it("(c) generic error: the task is put back to its previous row and the mutation rejects", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));

    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    const err = await result.current
      .mutateAsync({ id: "TASK1", updatedAt: "x", patch: { title: "attempt" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(qc.getQueryData<Task[]>(keys.tasks())?.[0]).toEqual(baseTask);
  });

  // Final review A-C1: a task's 409 `current` predates the server fix for `deliverables` — some
  // deployed Worker mid-rollout can still ship it as a raw JSON-encoded STRING, not the array
  // every success response decodes it into. Defensive client-side normalization must never let
  // that string reach the cache (TaskDrawer renders `task.deliverables.map(...)` unguarded).
  it("(d) A-C1: a 409 whose current.deliverables is a raw JSON string is normalized to an array in the cache", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);
    const current = { ...baseTask, updated_at: "T-elsewhere", deliverables: '["a.xlsx","b.pdf"]' };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current }), { status: 409 })),
    );

    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    const err = await result.current
      .mutateAsync({ id: "TASK1", updatedAt: "stale", patch: { title: "mine" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    const cached = qc.getQueryData<Task[]>(keys.tasks())?.[0];
    expect(Array.isArray(cached?.deliverables)).toBe(true);
    expect(cached?.deliverables).toEqual(["a.xlsx", "b.pdf"]);
  });

  it("(d) A-C1: an unparseable current.deliverables string falls back to []", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);
    const current = { ...baseTask, updated_at: "T-elsewhere", deliverables: "not json" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current }), { status: 409 })),
    );

    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "TASK1", updatedAt: "stale", patch: { title: "mine" } }).catch((e) => e);
    expect(qc.getQueryData<Task[]>(keys.tasks())?.[0].deliverables).toEqual([]);
  });

  // Final review A-I3: only useCreateTask invalidated ["requesters"] — renaming 依頼元 via the
  // drawer left the create-task autocomplete stale.
  it("(e) A-I3: a successful patch that changes requester invalidates requesters, which refetches", async () => {
    let requestersGetCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url === "/api/requesters") {
        requestersGetCalls++;
        return new Response(JSON.stringify(["田中"]), { status: 200 });
      }
      if (method === "PATCH") return new Response(JSON.stringify({ ...baseTask, requester: "佐藤" }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ patch: usePatchTask(), requesters: useRequesters() }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.requesters.isSuccess).toBe(true));
    const before = requestersGetCalls;

    await result.current.patch.mutateAsync({ id: "TASK1", updatedAt: baseTask.updated_at, patch: { requester: "佐藤" } });

    await waitFor(() => expect(requestersGetCalls).toBeGreaterThan(before));
  });

  it("(f) A-I3: a patch that does not touch requester does not invalidate requesters", async () => {
    let requestersGetCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url === "/api/requesters") {
        requestersGetCalls++;
        return new Response(JSON.stringify(["田中"]), { status: 200 });
      }
      if (method === "PATCH") return new Response(JSON.stringify({ ...baseTask, title: "b" }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ patch: usePatchTask(), requesters: useRequesters() }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.requesters.isSuccess).toBe(true));
    const before = requestersGetCalls;

    await result.current.patch.mutateAsync({ id: "TASK1", updatedAt: baseTask.updated_at, patch: { title: "b" } });
    // Give any (wrongful) invalidation's refetch a real turn to land before asserting its absence.
    await new Promise((r) => setTimeout(r, 20));

    expect(requestersGetCalls).toBe(before);
  });
});

describe("useCreateNote", () => {
  it("(a) success invalidates the timeline, which refetches", async () => {
    let timelineGetCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.startsWith("/api/weeks/")) {
        timelineGetCalls++;
        return new Response(JSON.stringify(makeTimelineWithNote(baseNote)), { status: 200 });
      }
      if (method === "POST" && url === "/api/notes") return new Response(JSON.stringify(baseNote), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ create: useCreateNote(), timeline: useTimeline("2026-W39", false) }), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.timeline.isSuccess).toBe(true));
    const before = timelineGetCalls;

    await result.current.create.mutateAsync({ text: "hi" });

    await waitFor(() => expect(timelineGetCalls).toBeGreaterThan(before));
  });

  it("(b) 409 rejects with ConflictError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current: baseNote }), { status: 409 })),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapperFor(qc) });
    await expect(result.current.mutateAsync({ text: "hi" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("(c) generic 500 rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCreateNote(), { wrapper: wrapperFor(qc) });
    await expect(result.current.mutateAsync({ text: "hi" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("usePatchNote", () => {
  it("(a) success: cache holds the response row and a second patch sends the fresh updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimelineWithNote(baseNote));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...baseNote, text: "a", updated_at: "T1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...baseNote, text: "b", updated_at: "T2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchNote(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "NOTE1", updatedAt: baseNote.updated_at, patch: { text: "a" } });

    const after1 = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
    expect(after1?.days[0].notes[0].updated_at).toBe("T1");

    await result.current.mutateAsync({ id: "NOTE1", updatedAt: after1!.days[0].notes[0].updated_at, patch: { text: "b" } });
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(secondBody.updated_at).toBe("T1");
  });

  it("(b) 409: cache holds current and the mutation rejects with ConflictError", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimelineWithNote(baseNote));
    const current = { ...baseNote, text: "changed elsewhere", updated_at: "T-elsewhere" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current }), { status: 409 })),
    );

    const { result } = renderHook(() => usePatchNote(), { wrapper: wrapperFor(qc) });
    const err = await result.current
      .mutateAsync({ id: "NOTE1", updatedAt: "stale", patch: { text: "mine" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(qc.getQueryData<Timeline>(keys.timeline("2026-W39", false))?.days[0].notes[0]).toEqual(current);
  });

  it("(c) generic error: the note is put back to its previous row and the mutation rejects", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimelineWithNote(baseNote));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));

    const { result } = renderHook(() => usePatchNote(), { wrapper: wrapperFor(qc) });
    const err = await result.current
      .mutateAsync({ id: "NOTE1", updatedAt: "x", patch: { text: "attempt" } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(qc.getQueryData<Timeline>(keys.timeline("2026-W39", false))?.days[0].notes[0]).toEqual(baseNote);
  });
});

describe("useDeleteTask", () => {
  function seed(qc: QueryClient) {
    qc.setQueryData(keys.tasks(), [baseTask, { ...baseTask, id: "TASK2" }]);
    qc.setQueryData(keys.tasks(["open"]), [baseTask]);
    qc.setQueryData(keys.task(baseTask.id), makeTaskDetail(baseTask));
  }

  it("(a) success: the task is gone from EVERY cached list, its detail query is removed, and siblings are untouched", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(qc);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    const { result } = renderHook(() => useDeleteTask(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: baseTask.id, updatedAt: baseTask.updated_at });

    expect(qc.getQueryData<Task[]>(keys.tasks())?.map((t) => t.id)).toEqual(["TASK2"]);
    expect(qc.getQueryData<Task[]>(keys.tasks(["open"]))).toEqual([]);
    // Removed, not merely emptied: an invalidated `["task", id]` would refetch a row that is gone.
    expect(qc.getQueryData<TaskDetail>(keys.task(baseTask.id))).toBeUndefined();
    expect(qc.getQueryState(keys.task(baseTask.id))).toBeUndefined();
  });

  it("(b) sends updated_at as a query parameter, resolving it from the cache rather than the caller's stale token", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [{ ...baseTask, updated_at: "2026-09-21T00:00:00.000Z" }]);
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDeleteTask(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: baseTask.id, updatedAt: "2026-09-20T00:00:00.000Z" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url).toBe("/api/tasks/TASK1?updated_at=2026-09-21T00%3A00%3A00.000Z");
  });

  // The whole point of routing a delete through `enqueueWrite`: an edit of the SAME task that is
  // still in flight owns the only token the server will accept next, so the delete must wait for
  // it and then send THAT token — not the one the drawer was holding when the user clicked.
  it("(d) waits for an in-flight PATCH on the same task, then sends the token that PATCH produced", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);
    let resolvePatch!: (r: Response) => void;
    const patchPending = new Promise<Response>((res) => {
      resolvePatch = res;
    });
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({ method, url: String(input) });
        return method === "PATCH" ? patchPending : new Response(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => ({ patch: usePatchTask(), del: useDeleteTask() }), { wrapper: wrapperFor(qc) });
    const patching = result.current.patch.mutateAsync({ id: "TASK1", updatedAt: baseTask.updated_at, patch: { title: "a" } });
    // Wait for the PATCH to actually be in flight before confirming the delete — which is the only
    // order the UI can produce anyway (the delete is behind a dialog the user still has to click
    // through) and the only one that puts the delete BEHIND the edit in the queue.
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1));
    const deleting = result.current.del.mutateAsync({ id: "TASK1", updatedAt: baseTask.updated_at });

    await new Promise((r) => setTimeout(r, 20)); // prove the DELETE is genuinely withheld, not just slow
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);

    resolvePatch(new Response(JSON.stringify({ ...baseTask, title: "a", updated_at: "2026-09-22T00:00:00.000Z" }), { status: 200 }));
    await patching;
    await deleting;

    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(calls.find((c) => c.method === "DELETE")!.url).toBe("/api/tasks/TASK1?updated_at=2026-09-22T00%3A00%3A00.000Z");
  });

  it("(c) a refusal leaves every cache exactly as it was and rejects", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(qc);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "linked", sessions: 1, notes: 0 }), { status: 409 })),
    );

    const { result } = renderHook(() => useDeleteTask(), { wrapper: wrapperFor(qc) });
    const err = await result.current.mutateAsync({ id: baseTask.id, updatedAt: baseTask.updated_at }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(ConflictError);

    // No optimistic step means nothing to put back — and nothing that could have gone missing.
    expect(qc.getQueryData<Task[]>(keys.tasks())?.map((t) => t.id)).toEqual(["TASK1", "TASK2"]);
    expect(qc.getQueryData<TaskDetail>(keys.task(baseTask.id))?.task).toEqual(baseTask);
  });
});

describe("useDeleteNote", () => {
  function seed(qc: QueryClient) {
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimelineWithNote(baseNote));
    qc.setQueryData(keys.task(baseTask.id), makeTaskDetail(baseTask, [], [baseNote]));
  }

  it("(a) success: the note is gone from both caches", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(qc);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    const { result } = renderHook(() => useDeleteNote(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: baseNote.id, updatedAt: baseNote.updated_at });

    expect(qc.getQueryData<Timeline>(keys.timeline("2026-W39", false))?.days[0].notes).toHaveLength(0);
    expect(qc.getQueryData<TaskDetail>(keys.task(baseTask.id))?.notes).toHaveLength(0);
  });

  it("(b) CRITICAL: a 409 reinserts the note into BOTH the timeline and the cached TaskDetail, and rejects with ConflictError", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(qc);
    const current = { ...baseNote, text: "someone else edited this", updated_at: "T-elsewhere" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current }), { status: 409 })),
    );

    const { result } = renderHook(() => useDeleteNote(), { wrapper: wrapperFor(qc) });
    const err = await result.current.mutateAsync({ id: baseNote.id, updatedAt: baseNote.updated_at }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);

    // The bug this pins: the optimistic step already removed the note, so a plain
    // find-and-replace of `current` finds nothing and silently does nothing — the note the
    // server REFUSED to delete would otherwise vanish from the UI.
    expect(qc.getQueryData<Timeline>(keys.timeline("2026-W39", false))?.days[0].notes).toEqual([current]);
    expect(qc.getQueryData<TaskDetail>(keys.task(baseTask.id))?.notes).toEqual([current]);
  });

  it("(c) generic error: the note is reinserted to its previous row in both caches, and rejects", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    seed(qc);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })));

    const { result } = renderHook(() => useDeleteNote(), { wrapper: wrapperFor(qc) });
    const err = await result.current.mutateAsync({ id: baseNote.id, updatedAt: baseNote.updated_at }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(qc.getQueryData<Timeline>(keys.timeline("2026-W39", false))?.days[0].notes).toEqual([baseNote]);
    expect(qc.getQueryData<TaskDetail>(keys.task(baseTask.id))?.notes).toEqual([baseNote]);
  });
});

// Final review A-I1: useDeleteNote used to send the caller's captured `updatedAt` directly,
// bypassing the per-(kind,id) queue every other note/task/session write goes through, so a
// delete and a concurrent edit of the SAME note could race. Routed through the same
// `enqueueWrite`/`currentUpdatedAt` machinery as `usePatchNote`.
describe("useDeleteNote — routed through the per-note write queue (A-I1)", () => {
  function requestMethod(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): string {
    const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return (call[1]?.method ?? "GET").toUpperCase();
  }

  it("a delete queued right after a patch on the same note waits for it, and carries the patch response's updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimelineWithNote(baseNote));

    let resolvePatch!: (r: Response) => void;
    const patchPending = new Promise<Response>((res) => {
      resolvePatch = res;
    });
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PATCH") return patchPending;
      if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => ({ patch: usePatchNote(), del: useDeleteNote() }), { wrapper: wrapperFor(qc) });
    const pPatch = result.current.patch.mutateAsync({ id: "NOTE1", updatedAt: baseNote.updated_at, patch: { text: "edited" } });
    const pDelete = result.current.del.mutateAsync({ id: "NOTE1", updatedAt: baseNote.updated_at });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Prove the delete is genuinely withheld, not merely not-yet-reached.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestMethod(fetchMock, 0)).toBe("PATCH");

    resolvePatch(new Response(JSON.stringify({ ...baseNote, text: "edited", updated_at: "T1" }), { status: 200 }));
    await pPatch;

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestMethod(fetchMock, 1)).toBe("DELETE");
    const deleteUrl = String((fetchMock.mock.calls[1] as [string, RequestInit])[0]);
    expect(deleteUrl).toContain(`updated_at=${encodeURIComponent("T1")}`);
    await pDelete;
  });
});

describe("cross-hook convergence", () => {
  it('a successful usePatchSession invalidates ["task"], triggering a refetch of a cached TaskDetail', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sessionInDetail: Session = { ...baseSession, task_id: baseTask.id };
    qc.setQueryData(keys.task(baseTask.id), makeTaskDetail(baseTask, [sessionInDetail], []));

    let taskDetailGetCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url === `/api/tasks/${baseTask.id}`) {
        taskDetailGetCalls++;
        return new Response(JSON.stringify(makeTaskDetail(baseTask, [sessionInDetail], [])), { status: 200 });
      }
      if (method === "PATCH") {
        return new Response(JSON.stringify({ ...sessionInDetail, summary_edited: "x", updated_at: "T1" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => ({ patch: usePatchSession(), detail: useTask(baseTask.id) }), {
      wrapper: wrapperFor(qc),
    });
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));
    const before = taskDetailGetCalls;

    await result.current.patch.mutateAsync({
      id: sessionInDetail.id,
      updatedAt: sessionInDetail.updated_at,
      patch: { summary_edited: "x" },
    });

    await waitFor(() => expect(taskDetailGetCalls).toBeGreaterThan(before));
  });

  it("sub4: every write refetches the 案件 totals, and a task patch's optimistic step leaves them alone", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const totals: TaskTotal[] = [{ id: baseTask.id, total_minutes: 90, last_date: "2026-09-21" }];
    qc.setQueryData(keys.tasks(undefined), [baseTask]);
    let totalsGets = 0;
    let release!: () => void;
    const patched = new Promise<void>((r) => { release = r; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url === "/api/tasks/totals") { totalsGets++; return new Response(JSON.stringify(totals), { status: 200 }); }
      if (method === "PATCH") { await patched; return new Response(JSON.stringify({ ...baseTask, title: "x", updated_at: "T1" }), { status: 200 }); }
      if (method === "GET" && url === "/api/tasks") return new Response(JSON.stringify([baseTask]), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    }));
    const { result } = renderHook(() => ({ patch: usePatchTask(), totals: useTaskTotals() }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.totals.isSuccess).toBe(true));
    const before = totalsGets;
    const p = result.current.patch.mutateAsync({ id: baseTask.id, updatedAt: baseTask.updated_at, patch: { title: "x" } });
    // mid-flight: the optimistic step walks the ["tasks"] lists; the totals (another shape) are untouched
    await waitFor(() => expect(qc.getQueryData<Task[]>(keys.tasks(undefined))?.[0].title).toBe("x"));
    expect(qc.getQueryData(keys.taskTotals)).toEqual(totals);
    release();
    await p;
    await waitFor(() => expect(totalsGets).toBeGreaterThan(before));
  });

  it("sub6 R4: a session / note / 案件 write re-reads every cached 週報 (old and v2 page share the key)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let reportGets = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.startsWith("/api/reports/")) { reportGets++; return new Response(JSON.stringify({ week: "2026-W39", template: "agency", sheets: [], unassigned_sessions: 0, unassigned_minutes: 0 }), { status: 200 }); }
      if (method === "PATCH" && url.startsWith("/api/sessions/")) return new Response(JSON.stringify({ ...baseSession, summary_edited: "x", updated_at: "T1" }), { status: 200 });
      if (method === "PATCH" && url.startsWith("/api/notes/")) return new Response(JSON.stringify({ ...baseNote, text: "x", updated_at: "T1" }), { status: 200 });
      if (method === "PATCH" && url.startsWith("/api/tasks/")) return new Response(JSON.stringify({ ...baseTask, title: "x", updated_at: "T1" }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }));
    const { result } = renderHook(() => ({
      report: useQuery({ queryKey: keys.report("2026-W39", "agency"), queryFn: () => api.report("2026-W39", "agency") }),
      session: usePatchSession(), note: usePatchNote(), task: usePatchTask(),
    }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.report.isSuccess).toBe(true));
    let before = reportGets;
    await result.current.session.mutateAsync({ id: baseSession.id, updatedAt: baseSession.updated_at, patch: { summary_edited: "x" } });
    await waitFor(() => expect(reportGets).toBeGreaterThan(before));
    before = reportGets;
    await result.current.note.mutateAsync({ id: baseNote.id, updatedAt: baseNote.updated_at, patch: { text: "x" } });
    await waitFor(() => expect(reportGets).toBeGreaterThan(before));
    before = reportGets;
    await result.current.task.mutateAsync({ id: baseTask.id, updatedAt: baseTask.updated_at, patch: { title: "x" } });
    await waitFor(() => expect(reportGets).toBeGreaterThan(before));
  });

  it("overlap: a later-rejecting patch on S1 does not clobber an earlier-succeeding patch on S2 (scoped, not whole-snapshot, rollback)", async () => {
    const s2: Session = { ...baseSession, id: "S2", summary: "s2 base" };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), {
      week: "2026-W39",
      days: [{ date: "2026-09-21", minutes: 60, sessions: [baseSession, s2], notes: [] }],
      total_minutes: 60,
      unassigned: 2,
      hidden: 0,
    });

    let rejectA!: (e: unknown) => void;
    const aPromise = new Promise<Response>((_res, rej) => {
      rejectA = rej;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions/S1") return aPromise;
      if (url === "/api/sessions/S2") {
        return Promise.resolve(
          new Response(JSON.stringify({ ...s2, summary_edited: "b-done", updated_at: "T-B" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });

    const aResult = result.current
      .mutateAsync({ id: "S1", updatedAt: baseSession.updated_at, patch: { summary_edited: "a-attempt" } })
      .catch((e) => e);
    await waitFor(() => {
      const cached = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
      expect(cached?.days[0].sessions.find((s) => s.id === "S1")?.summary_edited).toBe("a-attempt");
    });

    await result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { summary_edited: "b-done" } });

    rejectA(new Error("network blip"));
    await aResult;

    const final = qc.getQueryData<Timeline>(keys.timeline("2026-W39", false));
    expect(final?.days[0].sessions.find((s) => s.id === "S2")?.summary_edited).toBe("b-done");
    expect(final?.days[0].sessions.find((s) => s.id === "S1")).toEqual(baseSession);
  });
});

describe("createQueryClient (contract 4)", () => {
  it("never retries UnauthorizedError, ConflictError, or ValidationError", async () => {
    const qc = createQueryClient();
    let attempts = 0;
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["probe-unauthorized"],
          queryFn: () => {
            attempts++;
            return Promise.reject(new UnauthorizedError());
          },
        }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(attempts).toBe(1);
  });

  it("does retry other errors (transient network failures)", async () => {
    const qc = createQueryClient();
    let attempts = 0;
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["probe-transient"],
          retry: 1, // keep the test fast; only asserting that non-listed errors CAN retry
          retryDelay: 0,
          queryFn: () => {
            attempts++;
            return Promise.reject(new Error("network blip"));
          },
        }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(attempts).toBeGreaterThan(1);
  });

  it("fix round 1: does not retry an ApiError 404 or 400 — a stale id or a bad request never succeeds on retry", async () => {
    const qc = createQueryClient();
    let attempts404 = 0;
    const { result: result404 } = renderHook(
      () =>
        useQuery({
          queryKey: ["probe-404"],
          queryFn: () => {
            attempts404++;
            return Promise.reject(new ApiError(404, { error: "not found" }));
          },
        }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result404.current.isError).toBe(true));
    expect(attempts404).toBe(1);

    let attempts400 = 0;
    const { result: result400 } = renderHook(
      () =>
        useQuery({
          queryKey: ["probe-400"],
          queryFn: () => {
            attempts400++;
            return Promise.reject(new ApiError(400, { error: "bad request" }));
          },
        }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(result400.current.isError).toBe(true));
    expect(attempts400).toBe(1);
  });

  it("calls onUnauthorized when ANY query throws UnauthorizedError", async () => {
    const onUnauthorized = vi.fn();
    const qc = createQueryClient(onUnauthorized);
    renderHook(
      () =>
        useQuery({
          queryKey: ["probe-callback"],
          queryFn: () => Promise.reject(new UnauthorizedError()),
        }),
      { wrapper: wrapperFor(qc) },
    );
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
  });
});

// Carried from Task 4's review, required by Task 6: TaskSelect's "新建案件… then link the session"
// flow calls `useCreateTask().mutateAsync(...)` and uses the resolved row's `id` immediately to
// link the session — it must not wait for the tasks-list refetch that `onSettled` also triggers.
describe("useCreateTask — mutateAsync resolves before the tasks refetch completes (REQUIRED)", () => {
  it("resolves with the created row, including its id, while the invalidated tasks GET is still in flight", async () => {
    let resolveRefetch!: (r: Response) => void;
    const refetchPending = new Promise<Response>((res) => {
      resolveRefetch = res;
    });
    let tasksGetCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url === "/api/tasks") {
        tasksGetCalls++;
        // The first call is the initial mount; the second is the refetch `onSettled` triggers
        // after create — deliberately held open so a premature "resolved" would be a false pass.
        if (tasksGetCalls === 1) return new Response(JSON.stringify([baseTask]), { status: 200 });
        return refetchPending;
      }
      if (method === "GET" && url === "/api/requesters") return new Response(JSON.stringify([]), { status: 200 });
      if (method === "POST" && url === "/api/tasks") {
        return new Response(JSON.stringify({ ...baseTask, id: "TASK-NEW" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => ({ create: useCreateTask(), list: useTasks() }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    expect(tasksGetCalls).toBe(1);

    const created = await result.current.create.mutateAsync({ requester: "田中", title: "新規案件" });

    expect(created.id).toBe("TASK-NEW");
    // The refetch was triggered (tasksGetCalls went to 2) but is still unresolved — mutateAsync
    // did not (and must not) wait for it.
    expect(tasksGetCalls).toBe(2);

    resolveRefetch(new Response(JSON.stringify([baseTask, created]), { status: 200 }));
  });
});

// F4 (fix round 1): two writes on the SAME session id must never overlap — the server's strict
// `updated_at >` guarantee means two in-flight writes with the same stale value always 409 the
// second one, for perfectly ordinary gestures (edit a summary, then click 隠す in one motion).
describe("usePatchSession — F4: serialized per-session writes", () => {
  function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): Record<string, unknown> {
    const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return JSON.parse(call[1].body as string);
  }

  it("the second write on the same id is not sent until the first resolves, and carries the FIRST response's updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(baseSession));

    let resolveFirst!: (r: Response) => void;
    const firstPending = new Promise<Response>((res) => {
      resolveFirst = res;
    });
    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length === 1) return firstPending;
      return Promise.resolve(new Response(JSON.stringify({ ...baseSession, summary_edited: "b", updated_at: "T2" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const p1 = result.current.mutateAsync({ id: "S1", updatedAt: "T0", patch: { summary_edited: "a" } });
    const p2 = result.current.mutateAsync({ id: "S1", updatedAt: "T0", patch: { minutes_override: 10 } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Prove the second is genuinely withheld, not merely "not yet reached": give the event loop
    // a real turn before checking it still hasn't been sent.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(new Response(JSON.stringify({ ...baseSession, summary_edited: "a", updated_at: "T1" }), { status: 200 }));
    await p1;
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestBody(fetchMock, 1).updated_at).toBe("T1");
    await p2;
  });

  it("if the first write 409s, the second still runs and carries `current`'s updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(baseSession));

    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "conflict", current: { ...baseSession, updated_at: "T-elsewhere" } }), { status: 409 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ...baseSession, updated_at: "T2" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const p1 = result.current.mutateAsync({ id: "S1", updatedAt: "T0", patch: { summary_edited: "a" } }).catch((e) => e);
    const p2 = result.current.mutateAsync({ id: "S1", updatedAt: "T0", patch: { minutes_override: 10 } });

    expect(await p1).toBeInstanceOf(ConflictError);
    await p2;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1).updated_at).toBe("T-elsewhere");
  });

  it("writes on two different ids run concurrently, not serialized", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const s2: Session = { ...baseSession, id: "S2" };
    qc.setQueryData(keys.timeline("2026-W39", false), {
      week: "2026-W39",
      days: [{ date: "2026-09-21", minutes: 60, sessions: [baseSession, s2], notes: [] }],
      total_minutes: 60,
      unassigned: 2,
      hidden: 0,
    });
    let resolveA!: (r: Response) => void;
    let resolveB!: (r: Response) => void;
    const pendingA = new Promise<Response>((res) => {
      resolveA = res;
    });
    const pendingB = new Promise<Response>((res) => {
      resolveB = res;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sessions/S1") return pendingA;
      if (url === "/api/sessions/S2") return pendingB;
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const pA = result.current.mutateAsync({ id: "S1", updatedAt: baseSession.updated_at, patch: { summary_edited: "a" } });
    const pB = result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { summary_edited: "b" } });

    // Both fetches dispatch immediately — a different id is never held up by S1's in-flight write.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resolveA(new Response(JSON.stringify({ ...baseSession, updated_at: "TA" }), { status: 200 }));
    resolveB(new Response(JSON.stringify({ ...s2, updated_at: "TB" }), { status: 200 }));
    await pA;
    await pB;
  });

  it("falls back to the caller's updatedAt when the row is not cached anywhere (undo-after-hide)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); // nothing cached for S1
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ...baseSession, updated_at: "T1" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "S1", updatedAt: "FALLBACK", patch: { hidden: false } });
    expect(requestBody(fetchMock, 0).updated_at).toBe("FALLBACK");
  });

  // Re-review round 2, New Breakage 1: once 显示已隐藏 has been used, the SAME session can be
  // cached under TWO timeline keys (no-hidden and include-hidden) at once, and a background
  // refetch only ever touches whichever one is currently active — the other can hold a strictly
  // OLDER token. Picking `findOccurrences(...)[0]` (insertion order) rather than the newest let
  // the stale copy win and 409 an ordinary edit whenever it happened to be cached first.
  describe("resolves the NEWEST cached updated_at across multiple cached copies of the same session", () => {
    const older = "2026-09-21T00:00:00.100Z";
    const newer = "2026-09-21T00:00:00.500Z";

    async function patchAndCaptureUpdatedAt(insertOlderFirst: boolean): Promise<string> {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const noHiddenSession: Session = { ...baseSession, updated_at: insertOlderFirst ? older : newer };
      const includeHiddenSession: Session = { ...baseSession, updated_at: insertOlderFirst ? newer : older };
      const first = insertOlderFirst
        ? ([keys.timeline("2026-W39", false), noHiddenSession] as const)
        : ([keys.timeline("2026-W39", true), includeHiddenSession] as const);
      const second = insertOlderFirst
        ? ([keys.timeline("2026-W39", true), includeHiddenSession] as const)
        : ([keys.timeline("2026-W39", false), noHiddenSession] as const);
      qc.setQueryData(first[0], makeTimeline(first[1]));
      qc.setQueryData(second[0], makeTimeline(second[1]));

      const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ...baseSession, updated_at: "T1" }), { status: 200 })));
      vi.stubGlobal("fetch", fetchMock);
      const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
      await result.current.mutateAsync({ id: "S1", updatedAt: "FALLBACK", patch: { summary_edited: "x" } });
      return requestBody(fetchMock, 0).updated_at as string;
    }

    it("no-hidden cached first (older), include-hidden cached second (newer)", async () => {
      expect(await patchAndCaptureUpdatedAt(true)).toBe(newer);
    });

    it("include-hidden cached first (newer), no-hidden cached second (older)", async () => {
      expect(await patchAndCaptureUpdatedAt(false)).toBe(newer);
    });
  });
});

// F1 (task 9's fix round 1): the same false-conflict Task 6 fixed for sessions — two writes on the
// SAME task/note issued a few ms apart (e.g. editing 案件名 then immediately clicking 保留 in
// TaskDrawer) both carry whatever `updated_at` was in the cache when each was CALLED, and if the
// first hasn't resolved yet, the second always 409s. Generalized `enqueueWrite`/`currentUpdatedAt`
// (queries.ts) now cover tasks and notes the same way `usePatchSession` already did.
describe("usePatchTask — F1: serialized per-task writes", () => {
  function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): Record<string, unknown> {
    const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return JSON.parse(call[1].body as string);
  }

  it("the second write on the same id is not sent until the first resolves, and carries the FIRST response's updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);

    let resolveFirst!: (r: Response) => void;
    const firstPending = new Promise<Response>((res) => {
      resolveFirst = res;
    });
    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length === 1) return firstPending;
      return Promise.resolve(new Response(JSON.stringify({ ...baseTask, title: "b", updated_at: "T2" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    const p1 = result.current.mutateAsync({ id: "TASK1", updatedAt: "T0", patch: { title: "a" } });
    const p2 = result.current.mutateAsync({ id: "TASK1", updatedAt: "T0", patch: { status: "hold" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Prove the second is genuinely withheld, not merely "not yet reached": give the event loop
    // a real turn before checking it still hasn't been sent.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(new Response(JSON.stringify({ ...baseTask, title: "a", updated_at: "T1" }), { status: 200 }));
    await p1;
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestBody(fetchMock, 1).updated_at).toBe("T1");
    await p2;
  });

  it("if the first write 409s, the second still runs and carries `current`'s updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.tasks(), [baseTask]);

    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "conflict", current: { ...baseTask, updated_at: "T-elsewhere" } }), { status: 409 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ...baseTask, updated_at: "T2" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    const p1 = result.current.mutateAsync({ id: "TASK1", updatedAt: "T0", patch: { title: "a" } }).catch((e) => e);
    const p2 = result.current.mutateAsync({ id: "TASK1", updatedAt: "T0", patch: { status: "hold" } });

    expect(await p1).toBeInstanceOf(ConflictError);
    await p2;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1).updated_at).toBe("T-elsewhere");
  });

  it("resolves the NEWEST cached updated_at across multiple cached copies of the same task (list vs detail)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const older = "2026-09-20T00:00:00.100Z";
    const newer = "2026-09-20T00:00:00.500Z";
    // The tasks-list copy is OLDER; the task-detail copy (e.g. from having the drawer open) is
    // NEWER — insertion order must not decide which token wins.
    qc.setQueryData(keys.tasks(), [{ ...baseTask, updated_at: older }]);
    qc.setQueryData(keys.task(baseTask.id), makeTaskDetail({ ...baseTask, updated_at: newer }));

    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ...baseTask, updated_at: "T1" }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePatchTask(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: baseTask.id, updatedAt: "FALLBACK", patch: { title: "x" } });
    expect(requestBody(fetchMock, 0).updated_at).toBe(newer);
  });
});

describe("usePatchNote — F1: serialized per-note writes", () => {
  function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number): Record<string, unknown> {
    const call = fetchMock.mock.calls[callIndex] as [string, RequestInit];
    return JSON.parse(call[1].body as string);
  }

  it("the second write on the same id is not sent until the first resolves, and carries the FIRST response's updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimelineWithNote(baseNote));

    let resolveFirst!: (r: Response) => void;
    const firstPending = new Promise<Response>((res) => {
      resolveFirst = res;
    });
    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length === 1) return firstPending;
      return Promise.resolve(new Response(JSON.stringify({ ...baseNote, text: "b", updated_at: "T2" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchNote(), { wrapper: wrapperFor(qc) });
    const p1 = result.current.mutateAsync({ id: "NOTE1", updatedAt: "T0", patch: { text: "a" } });
    const p2 = result.current.mutateAsync({ id: "NOTE1", updatedAt: "T0", patch: { minutes: 15 } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFirst(new Response(JSON.stringify({ ...baseNote, text: "a", updated_at: "T1" }), { status: 200 }));
    await p1;
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestBody(fetchMock, 1).updated_at).toBe("T1");
    await p2;
  });

  it("if the first write 409s, the second still runs and carries `current`'s updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimelineWithNote(baseNote));

    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "conflict", current: { ...baseNote, updated_at: "T-elsewhere" } }), { status: 409 }),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ ...baseNote, updated_at: "T2" }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePatchNote(), { wrapper: wrapperFor(qc) });
    const p1 = result.current.mutateAsync({ id: "NOTE1", updatedAt: "T0", patch: { text: "a" } }).catch((e) => e);
    const p2 = result.current.mutateAsync({ id: "NOTE1", updatedAt: "T0", patch: { minutes: 15 } });

    expect(await p1).toBeInstanceOf(ConflictError);
    await p2;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1).updated_at).toBe("T-elsewhere");
  });
});

describe("write queues are isolated per kind (a task and a session/note never share a queue slot)", () => {
  it("a task write and a session write that happen to use the same id string run concurrently, not serialized", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sharedId = "SHARED1";
    const sessionWithSharedId: Session = { ...baseSession, id: sharedId };
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(sessionWithSharedId));
    qc.setQueryData(keys.tasks(), [{ ...baseTask, id: sharedId }]);

    let resolveTask!: (r: Response) => void;
    let resolveSession!: (r: Response) => void;
    const pendingTask = new Promise<Response>((res) => {
      resolveTask = res;
    });
    const pendingSession = new Promise<Response>((res) => {
      resolveSession = res;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/tasks/${sharedId}`) return pendingTask;
      if (url === `/api/sessions/${sharedId}`) return pendingSession;
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => ({ task: usePatchTask(), session: usePatchSession() }), { wrapper: wrapperFor(qc) });
    const pTask = result.current.task.mutateAsync({ id: sharedId, updatedAt: baseTask.updated_at, patch: { title: "x" } });
    const pSession = result.current.session.mutateAsync({ id: sharedId, updatedAt: sessionWithSharedId.updated_at, patch: { summary_edited: "y" } });

    // Both fetches dispatch immediately — the task's queue and the session's queue are keyed by
    // kind as well as id, so neither one is held up waiting for the other.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resolveTask(new Response(JSON.stringify({ ...baseTask, id: sharedId, updated_at: "TA" }), { status: 200 }));
    resolveSession(new Response(JSON.stringify({ ...sessionWithSharedId, updated_at: "TB" }), { status: 200 }));
    await pTask;
    await pSession;
  });
});

/** The cross-week 未关联 list as the v2 timeline's 未关联 filter reads it (useTimelineData). */
const useUnlinkedList = () => useQuery({ queryKey: keys.unlinked, queryFn: api.unlinkedSessions });

describe("the 未关联 list (keys.unlinked) is a write-hook occurrence like any timeline", () => {
  const s1: Session = { ...baseSession, id: "S1" };
  const s2: Session = { ...baseSession, id: "S2", updated_at: "2026-09-21T00:00:00Z" };
  const s3: Session = { ...baseSession, id: "S3" };
  const seed = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.unlinked, [s1, s2, s3]);
    return qc;
  };
  const ids = (qc: QueryClient) => qc.getQueryData<Session[]>(keys.unlinked)?.map((s) => s.id);

  it("is keyed outside the timeline prefix", () => {
    expect(keys.unlinked[0]).not.toBe("timeline");
  });

  it("the list GETs /api/sessions?unlinked=1", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([s1]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUnlinkedList(), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/api/sessions?unlinked=1");
    expect(result.current.data?.map((s) => s.id)).toEqual(["S1"]);
  });

  it("assigning a task drops the session from the list optimistically; a failure puts it back at the same index", async () => {
    const qc = seed();
    let rejectFetch!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { rejectFetch = res; })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const p = result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { task_id: "TASK1" } }).catch((e) => e);
    await waitFor(() => expect(ids(qc)).toEqual(["S1", "S3"]));
    rejectFetch(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    expect(await p).toBeInstanceOf(ApiError);
    expect(qc.getQueryData<Session[]>(keys.unlinked)).toEqual([s1, s2, s3]);
  });

  it("hiding drops it optimistically; a 409 reinserts withEffective(current)", async () => {
    const qc = seed();
    const rawCurrent = { ...s2, summary: "elsewhere", updated_at: "T-else" } as Record<string, unknown>;
    delete rawCurrent.summary_effective;
    delete rawCurrent.minutes_effective;
    let respond!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { respond = res; })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const p = result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { hidden: true } }).catch((e) => e);
    await waitFor(() => expect(ids(qc)).toEqual(["S1", "S3"]));
    respond(new Response(JSON.stringify({ error: "conflict", current: rawCurrent }), { status: 409 }));
    expect(await p).toBeInstanceOf(ConflictError);
    const list = qc.getQueryData<Session[]>(keys.unlinked)!;
    expect(list.map((s) => s.id)).toEqual(["S1", "S2", "S3"]);
    expect(list[1].summary_effective).toBe("elsewhere");
    expect(list[1].updated_at).toBe("T-else");
  });

  it("a successful assign keeps it out of the list, and invalidates the list (refetch)", async () => {
    const qc = seed();
    let listGets = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && String(input) === "/api/sessions?unlinked=1") {
        listGets++;
        return new Response(JSON.stringify([s1, s3]), { status: 200 });
      }
      return new Response(JSON.stringify({ ...s2, task_id: "TASK1", updated_at: "T1" }), { status: 200 });
    }));
    const { result } = renderHook(() => ({ patch: usePatchSession(), list: useUnlinkedList() }), { wrapper: wrapperFor(qc) });
    const before = listGets;
    await result.current.patch.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { task_id: "TASK1" } });
    expect(ids(qc)).not.toContain("S2");
    await waitFor(() => expect(listGets).toBeGreaterThan(before));
  });

  it("an edit that keeps it unlinked (summary) is written in place, not removed", async () => {
    const qc = seed();
    let respond!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { respond = res; })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const p = result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { summary_edited: "直した" } });
    await waitFor(() => expect(qc.getQueryData<Session[]>(keys.unlinked)![1].summary_effective).toBe("直した"));
    respond(new Response(JSON.stringify({ ...s2, summary_edited: "直した", updated_at: "T1" }), { status: 200 }));
    await p;
    const list = qc.getQueryData<Session[]>(keys.unlinked)!;
    expect(list.map((s) => s.id)).toEqual(["S1", "S2", "S3"]);
    expect(list[1].updated_at).toBe("T1");
  });

  it("a session whose task_id points at a deleted 案件 stays in the list when edited", async () => {
    const dangling: Session = { ...baseSession, id: "SD", task_id: "T-GONE" };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.unlinked, [s1, dangling]);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ ...dangling, summary_edited: "x", updated_at: "T1" }), { status: 200 })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "SD", updatedAt: dangling.updated_at, patch: { summary_edited: "x" } });
    expect(ids(qc)).toEqual(["S1", "SD"]);
    expect(qc.getQueryData<Session[]>(keys.unlinked)![1].summary_effective).toBe("x");
  });

  it("a 409 whose current is linked elsewhere does NOT put it back in the list", async () => {
    const qc = seed();
    const rawCurrent = { ...s2, task_id: "T-ELSE", updated_at: "T-else" } as Record<string, unknown>;
    delete rawCurrent.summary_effective;
    delete rawCurrent.minutes_effective;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current: rawCurrent }), { status: 409 })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const err = await result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { task_id: "TASK1" } }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(ids(qc)).toEqual(["S1", "S3"]);
  });

  it("a 409 on a summary edit whose current is hidden elsewhere removes it from the list", async () => {
    const qc = seed();
    const rawCurrent = { ...s2, hidden: 1, updated_at: "T-else" } as Record<string, unknown>;
    delete rawCurrent.summary_effective;
    delete rawCurrent.minutes_effective;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current: rawCurrent }), { status: 409 })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { summary_edited: "x" } }).catch(() => undefined);
    expect(ids(qc)).toEqual(["S1", "S3"]);
  });

  it("useHideSessions: a 409 whose current is already linked removes it from the list", async () => {
    const qc = seed();
    const rawCurrent = { ...s2, task_id: "T-ELSE", updated_at: "T-else" } as Record<string, unknown>;
    delete rawCurrent.summary_effective;
    delete rawCurrent.minutes_effective;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current: rawCurrent }), { status: 409 })));
    const { result } = renderHook(() => useHideSessions(), { wrapper: wrapperFor(qc) });
    const res = await result.current.mutateAsync({ items: [{ id: "S2", updatedAt: s2.updated_at }] });
    expect(res.conflicted).toEqual(["S2"]);
    expect(ids(qc)).toEqual(["S1", "S3"]);
  });

  it("race: a refetch that lands while a link is pending puts it back; the link's success takes it out again", async () => {
    const qc = seed();
    let respond!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { respond = res; })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    const p = result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { task_id: "TASK1" } });
    await waitFor(() => expect(ids(qc)).toEqual(["S1", "S3"]));
    qc.setQueryData(keys.unlinked, [s1, s2, s3]); // a stale server list arrives mid-flight
    respond(new Response(JSON.stringify({ ...s2, task_id: "TASK1", updated_at: "T1" }), { status: 200 }));
    await p;
    expect(ids(qc)).toEqual(["S1", "S3"]);
  });

  it("every write converges the dashboard too", async () => {
    const qc = seed();
    qc.setQueryData(keys.dashboard("2026-09-01", "2026-09-30"), { stale: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...s2, updated_at: "T1" }), { status: 200 })));
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "S2", updatedAt: s2.updated_at, patch: { summary_edited: "x" } });
    expect(qc.getQueryState(keys.dashboard("2026-09-01", "2026-09-30"))?.isInvalidated).toBe(true);
  });

  it("resolves its updated_at from the list when that is the only cached copy", async () => {
    const qc = seed();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ...s2, updated_at: "T1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "S2", updatedAt: "STALE", patch: { summary_edited: "x" } });
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).updated_at).toBe(s2.updated_at);
  });

  it("useHideSessions removes a hidden session from the list", async () => {
    const qc = seed();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...s2, hidden: 1, updated_at: "T1" }), { status: 200 })));
    const { result } = renderHook(() => useHideSessions(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ items: [{ id: "S2", updatedAt: s2.updated_at }] });
    expect(ids(qc)).toEqual(["S1", "S3"]);
  });

  it("an unlink from the timeline invalidates the list too", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const linked = { ...baseSession, task_id: "TASK1" };
    qc.setQueryData(keys.timeline("2026-W39", false), makeTimeline(linked));
    let listGets = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && String(input) === "/api/sessions?unlinked=1") {
        listGets++;
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ ...linked, task_id: null, updated_at: "T1" }), { status: 200 });
    }));
    const { result } = renderHook(() => ({ patch: usePatchSession(), list: useUnlinkedList() }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const before = listGets;
    await result.current.patch.mutateAsync({ id: "S1", updatedAt: linked.updated_at, patch: { task_id: null } });
    await waitFor(() => expect(listGets).toBeGreaterThan(before));
  });
});

describe("usePlanWrite (the v2 计划 page)", () => {
  const item: DayPlanItem = {
    id: "D1", date: "2026-10-02", plan_item_id: null, tasks: [], text: "a", detail: "", sort: 0, ai_status: null, ai_progress: null,
    ai_evidence: [], ai_note: null, manual_status: null, updated_at: "U0", final_status: "none",
  };
  const plan: DayPlan = { date: "2026-10-02", started_at: "S", judged_at: null, judge_machine: null, judge_model: null, updated_at: "S", items: [item] };
  const pItem: PlanItem = {
    id: "P1", horizon: "daily", text: "x", tasks: [], status: "active", week: null, until_date: null, sort: 0,
    created_at: "C", done_at: null, updated_at: "V0", effective: true, stale: false,
  };
  it("resolves to the server's row and writes it through, so the next write reads the fresh updated_at", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(keys.dayPlan("2026-10-02"), plan);
    qc.setQueryData(keys.planItems(false), [pItem]);
    vi.stubGlobal("fetch", vi.fn(async (u: string) => new Response(JSON.stringify(String(u).includes("day-plan-items")
      ? { ...item, detail: "d", updated_at: "U1" } : { ...pItem, text: "y", updated_at: "V1" }), { status: 200 })));
    const { result } = renderHook(() => usePlanWrite(), { wrapper: wrapperFor(qc) });
    const row = await result.current(() => api.patchDayPlanItem("D1", "U0", { detail: "d" }));
    expect(row.updated_at).toBe("U1");
    expect(qc.getQueryData<DayPlan>(keys.dayPlan("2026-10-02"))!.items[0].updated_at).toBe("U1");
    await result.current(() => api.patchPlanItem("P1", "V0", { text: "y" }));
    expect(qc.getQueryData<PlanItem[]>(keys.planItems(false))![0].updated_at).toBe("V1");
  });

  it("throws the ConflictError and shows no toast of its own (the page reports it in its language)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "conflict", current: { ...item, updated_at: "U9" } }), { status: 409 })));
    const shown = vi.spyOn(toast, "error");
    const { result } = renderHook(() => usePlanWrite(), { wrapper: wrapperFor(qc) });
    const err = await result.current(() => api.patchDayPlanItem("D1", "U0", { detail: "d" })).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(shown).not.toHaveBeenCalled();
  });

  it("refetches every plan view after a write, even a failed one", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let gets = 0;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") { gets++; return new Response(JSON.stringify(plan), { status: 200 }); }
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    }));
    const { result } = renderHook(() => ({ q: useQuery({ queryKey: keys.dayPlan("2026-10-02"), queryFn: () => api.dayPlan("2026-10-02") }), w: usePlanWrite() }), { wrapper: wrapperFor(qc) });
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    const before = gets;
    await result.current.w(() => api.deleteDayPlanItem("D1", "U0")).catch(() => {});
    await waitFor(() => expect(gets).toBeGreaterThan(before));
  });
});

describe("the stats-sessions cache (sub7b)", () => {
  it("has its own top-level key prefix, outside tasks / timeline", () => {
    expect(keys.statsSessions("2026-09-21", "2026-09-22")).toEqual(["stats-sessions", "2026-09-21", "2026-09-22"]);
  });

  it("every write hook's convergence (invalidateAll) invalidates it", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...baseSession, updated_at: "T1" }), { status: 200 })));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePatchSession(), { wrapper: wrapperFor(qc) });
    await result.current.mutateAsync({ id: "S1", updatedAt: "T0", patch: { summary_edited: "a" } });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["stats-sessions"] }));
  });

  it("a plan write invalidates it too (the plans view follows the day plans)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => usePlanWrite(), { wrapper: wrapperFor(qc) });
    await result.current(() => api.deleteDayPlanItem("D1", "U0"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["stats-sessions"] }));
  });
});
