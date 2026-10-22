import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Note, Task } from "../../src/api/types";
import { NoteForm } from "../../src/components/NoteForm";
import { toast } from "../../src/components/Toast";
import * as jst from "../../src/lib/jst";

const WEEK = "2026-W39"; // 2026-09-21 .. 2026-09-27
const OTHER_WEEK_DATE = "2026-09-14"; // W38 — outside WEEK

const baseTask: Task = {
  id: "TASK1",
  requester: "田中",
  project: "P1",
  title: "対応",
  status: "open",
  received_at: "2026-09-01",
  done_at: null,
  thinking: "",
  deliverables: [],
  hours_manual: null,
  machine: "macmini",
  ts: "2026-09-01T00:00:00",
  updated_at: "2026-09-01T00:00:00Z",
};

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "NOTE1",
    text: "补记内容",
    task_id: null,
    minutes: null,
    machine: "web",
    ts: "2026-09-21T09:00:00",
    updated_at: "2026-09-21T00:00:00Z",
    ...overrides,
  };
}

type RouteValue = unknown | ((body: Record<string, unknown> | undefined) => Response);

/** Routes a stubbed fetch by exact-or-prefix "METHOD /path" key. A function value is called with
 *  the parsed JSON body (or undefined) and must return the Response itself — this is how POST
 *  /api/notes captures the exact request body for assertions in the TEST body (never inside the
 *  mock — a thrown expectation there is swallowed by the mutation's error path, per task 6's
 *  review lesson). */
function routedFetch(routes: Record<string, RouteValue>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    const hit = Object.entries(routes).find(([k]) => key === k || key.startsWith(k));
    if (!hit) return new Response(JSON.stringify({}), { status: 404 });
    const [, value] = hit;
    if (typeof value === "function") {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      return value(body);
    }
    return new Response(JSON.stringify(value), { status: 200 });
  });
}

/** POST /api/notes route that pushes every parsed body into `captured`, in order, and responds
 *  with `responder(body)` (defaulting to a plain created row). Assertions happen on `captured`
 *  from the test body — never inside this function. */
function createNoteRoute(captured: Record<string, unknown>[], responder: (body: Record<string, unknown>) => Note = () => makeNote()) {
  return (body: Record<string, unknown> | undefined) => {
    captured.push(body ?? {});
    return new Response(JSON.stringify(responder(body ?? {})), { status: 200 });
  };
}

function renderForm(props: Partial<ComponentProps<typeof NoteForm>> = {}, routes: Record<string, RouteValue> = {}) {
  const fetchMock = routedFetch({
    "GET /api/tasks": [baseTask],
    "GET /api/requesters": ["田中"],
    "POST /api/notes": makeNote(),
    ...routes,
  });
  vi.stubGlobal("fetch", fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <NoteForm initialDate="2026-09-21" week={WEEK} directoryFilterActive={false} onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, fetchMock, qc };
}

function postCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return (fetchMock.mock.calls as [RequestInfo | URL, RequestInit | undefined][]).filter(
    ([, init]) => (init?.method ?? "GET").toUpperCase() === "POST",
  ).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NoteForm", () => {
  // ============================================================================================
  // contract 1: prefilled date, autofocus
  // ============================================================================================
  it("contract 1: prefills the date field from initialDate and autofocuses the text field", () => {
    renderForm({ initialDate: "2026-09-23" });
    expect((screen.getByLabelText("日期") as HTMLInputElement).value).toBe("2026-09-23");
    expect(document.activeElement).toBe(screen.getByLabelText("内容"));
  });

  // ============================================================================================
  // contract 2: fields + body shape
  // ============================================================================================
  describe("contract 2: request body", () => {
    it("sends { text, date, task_id: null } with no minutes key when the hours box is left empty", async () => {
      const requests: Record<string, unknown>[] = [];
      const { fetchMock } = renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "开了个会" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toEqual({ text: "开了个会", date: "2026-09-21", task_id: null });
      expect("minutes" in requests[0]).toBe(false);
      expect(postCalls(fetchMock)).toBe(1);
    });

    it("sends minutes: 0 exactly (a real value) when the user types 0", async () => {
      const requests: Record<string, unknown>[] = [];
      renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "打了个电话" } });
      fireEvent.change(screen.getByLabelText("用时"), { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].minutes).toBe(0);
      expect(requests[0].minutes).not.toBe(undefined);
    });

    it("sends a real duration parsed via the shared hours rule ('2,5' -> 150)", async () => {
      const requests: Record<string, unknown>[] = [];
      renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "远程支持" } });
      fireEvent.change(screen.getByLabelText("用时"), { target: { value: "2,5" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].minutes).toBe(150);
    });

    it("sends the picked task's id, never an empty string, when a task is chosen", async () => {
      const requests: Record<string, unknown>[] = [];
      renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "跟进案件" } });
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.change(select, { target: { value: baseTask.id } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].task_id).toBe(baseTask.id);
    });

    it("trims the text before sending", async () => {
      const requests: Record<string, unknown>[] = [];
      renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "  两边有空格  " } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].text).toBe("两边有空格");
    });

    it("sends the date field's exact string, never routed through new Date(...)", async () => {
      const requests: Record<string, unknown>[] = [];
      renderForm({ initialDate: "2026-01-01" }, { "POST /api/notes": createNoteRoute(requests) });
      // A `new Date("2026-01-01")` parse-and-reformat round trip is a no-op for this particular
      // date, so the date field is changed to one where any UTC/local reinterpretation would
      // visibly shift the day — the point is that the string passes through untouched.
      fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-09-22" } });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].date).toBe("2026-09-22");
    });
  });

  // ============================================================================================
  // contract 5: empty content does not submit
  // ============================================================================================
  describe("contract 5: empty content", () => {
    it("does not submit whitespace-only text and shows a field message", async () => {
      const { fetchMock } = renderForm();
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "   " } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("请输入内容");
      expect(postCalls(fetchMock)).toBe(0);
    });

    it("does not submit truly empty text", () => {
      const { fetchMock } = renderForm();
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      expect(postCalls(fetchMock)).toBe(0);
    });
  });

  // ============================================================================================
  // date validation (controller addition): reject more than 1 day ahead, tomorrow is fine
  // ============================================================================================
  describe("date validation", () => {
    it("rejects a date more than 1 day ahead of a fixed today with a field message, and sends no request", async () => {
      vi.spyOn(jst, "todayJst").mockReturnValue("2026-09-20");
      const { fetchMock } = renderForm({ initialDate: "2026-09-20" });
      fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-09-22" } }); // 2 days ahead
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "打错日期了" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/日期/);
      expect(postCalls(fetchMock)).toBe(0);
    });

    it("allows tomorrow (time-zone skew), with a fixed today", async () => {
      vi.spyOn(jst, "todayJst").mockReturnValue("2026-09-20");
      const requests: Record<string, unknown>[] = [];
      renderForm({ initialDate: "2026-09-20" }, { "POST /api/notes": createNoteRoute(requests) });
      fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-09-21" } }); // tomorrow
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0].date).toBe("2026-09-21");
    });
  });

  // ============================================================================================
  // contract 3: success — closes the form, and toasts when the date lands outside the week
  // ============================================================================================
  describe("contract 3: after a successful submit", () => {
    it("closes the form when the date is inside the displayed week and no filter is active", async () => {
      const infoSpy = vi.spyOn(toast, "info");
      const { onClose } = renderForm({ initialDate: "2026-09-21", week: WEEK, directoryFilterActive: false });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("shows '已添加到 <dayLabel>' with a 前往 action that navigates to that week when the date is outside the displayed week", async () => {
      const infoSpy = vi.spyOn(toast, "info");
      renderForm({ initialDate: OTHER_WEEK_DATE, week: WEEK, directoryFilterActive: false });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(infoSpy).toHaveBeenCalledWith("已添加到 9/14 (月)", expect.objectContaining({ label: "前往" })));
      const action = infoSpy.mock.calls.find((c) => c[0] === "已添加到 9/14 (月)")![1] as { onClick: () => void };
      window.location.hash = "#/v2/now";
      action.onClick();
      expect(window.location.hash).toBe("#/v2/timeline/2026-W38");
      // in the phone shell it opens the phone timeline on that day (its week comes with it)
      window.location.hash = "#/m/now";
      action.onClick();
      expect(window.location.hash).toBe(`#/m/tl/${OTHER_WEEK_DATE}`);
    });

    it("shows the filtered-notes toast instead when the date is inside the week but the directory filter is active", async () => {
      const infoSpy = vi.spyOn(toast, "info");
      renderForm({ initialDate: "2026-09-21", week: WEEK, directoryFilterActive: true });
      fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      await waitFor(() => expect(infoSpy).toHaveBeenCalledWith("已添加（筛选中不显示补记）"));
    });
  });

  // ============================================================================================
  // Esc cancels; IME safety
  // ============================================================================================
  it("Esc cancels the form without sending a request", () => {
    const { onClose, fetchMock } = renderForm();
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "discarded" } });
    fireEvent.keyDown(screen.getByLabelText("内容"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(postCalls(fetchMock)).toBe(0);
  });

  it("the 取消 button cancels the form", () => {
    const { onClose } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ============================================================================================
  // fix round 1 (LOST INPUT): Escape inside the "＋新建案件…" sub-dialog must not also cancel
  // the whole note form — the two Escapes are handled by different components at different
  // levels and must stay scoped to what they each opened.
  // ============================================================================================
  it("fix: Esc inside the ＋新建案件… dialog closes only that dialog, keeps the form mounted with the typed text intact, and does not call onClose", async () => {
    const { onClose } = renderForm();
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "还没保存的内容" } });
    const select = await screen.findByRole("combobox", { name: "案件" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: "__new__" } });
    const dialog = await screen.findByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("内容")).toBeInTheDocument(); // the note form itself is still here
    expect((screen.getByLabelText("内容") as HTMLInputElement).value).toBe("还没保存的内容");
    expect(onClose).not.toHaveBeenCalled();
  });

  // Final review B-C2 (generalized): the SAME shape of bug, one level up — TaskSelect's own Esc
  // handler (leave task-editing mode; here it's just a plain resting <select>) never stopped
  // propagation either, so it bubbled up to THIS form's container Escape handler and cancelled
  // the whole form, discarding whatever was typed.
  it("fix B-C2: Esc on the 案件 select (not the sub-dialog) does not cancel the whole form", async () => {
    const { onClose } = renderForm();
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "还没保存的内容" } });
    const select = await screen.findByRole("combobox", { name: "案件" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));

    fireEvent.keyDown(select, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText("内容") as HTMLInputElement).value).toBe("还没保存的内容");
  });

  it("IME safety: an Enter that confirms a composition in the text field does not submit", () => {
    const { fetchMock } = renderForm();
    const box = screen.getByLabelText("内容");
    fireEvent.change(box, { target: { value: "しんちょく" } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(box);
    expect(postCalls(fetchMock)).toBe(0);
    expect((box as HTMLInputElement).value).toBe("しんちょく");
  });

  it("a real Enter in the text field submits", async () => {
    const requests: Record<string, unknown>[] = [];
    renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
    fireEvent.keyDown(screen.getByLabelText("内容"), { key: "Enter" });
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  // Final review B-I3: before the `<form>` -> `<div role="group">` refactor, a native form
  // submitted on Enter from ANY field; 日期 and 用时 silently lost that when the container stopped
  // being a real <form> — only 内容 had its own hand-rolled Enter handler.
  it("fix B-I3: a real Enter in the 日期 field submits", async () => {
    const requests: Record<string, unknown>[] = [];
    renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
    fireEvent.keyDown(screen.getByLabelText("日期"), { key: "Enter" });
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  it("fix B-I3: a real Enter in the 用时 field submits", async () => {
    const requests: Record<string, unknown>[] = [];
    renderForm({}, { "POST /api/notes": createNoteRoute(requests) });
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
    fireEvent.keyDown(screen.getByLabelText("用时"), { key: "Enter" });
    await waitFor(() => expect(requests).toHaveLength(1));
  });

  it("fix B-I3: an Enter that confirms an IME composition in the 用时 field does not submit", () => {
    const { fetchMock } = renderForm();
    fireEvent.change(screen.getByLabelText("内容"), { target: { value: "内容" } });
    const hoursBox = screen.getByLabelText("用时");
    fireEvent.change(hoursBox, { target: { value: "２" } });
    fireEvent.compositionStart(hoursBox);
    fireEvent.keyDown(hoursBox, { key: "Enter", keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(hoursBox);
    expect(postCalls(fetchMock)).toBe(0);
  });
});
