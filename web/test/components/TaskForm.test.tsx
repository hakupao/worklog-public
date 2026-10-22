import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../src/api/types";
import { TaskForm } from "../../src/components/TaskForm";
import * as jst from "../../src/lib/jst";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "T20260922-01",
    requester: "田中",
    project: "P1",
    title: "対応",
    status: "open",
    received_at: "2026-09-22",
    done_at: null,
    thinking: "",
    deliverables: [],
    hours_manual: null,
    machine: "web",
    ts: "2026-09-22T00:00:00",
    updated_at: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

type RouteValue = unknown | ((body: Record<string, unknown> | undefined) => Response);

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

function createTaskRoute(captured: Record<string, unknown>[], responder: () => Response = () => new Response(JSON.stringify(makeTask()), { status: 200 })) {
  return (body: Record<string, unknown> | undefined) => {
    captured.push(body ?? {});
    return responder();
  };
}

function renderForm(props: Partial<ComponentProps<typeof TaskForm>> = {}, routes: Record<string, RouteValue> = {}) {
  const fetchMock = routedFetch({
    "GET /api/requesters": ["田中", "鈴木"],
    "POST /api/tasks": makeTask(),
    ...routes,
  });
  vi.stubGlobal("fetch", fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onCreated = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <TaskForm onCreated={onCreated} onCancel={onCancel} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onCreated, onCancel, fetchMock, qc };
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

describe("TaskForm", () => {
  it("is a labelled modal dialog with all five fields, 项目 defaulting to defaultProject, 受領日 defaulting to today JST", async () => {
    vi.spyOn(jst, "todayJst").mockReturnValue("2026-09-22");
    renderForm({ defaultProject: "worklog-web" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("新建案件");
    expect(within(dialog).getByLabelText("依頼元")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("案件名")).toBeInTheDocument();
    expect((within(dialog).getByLabelText("项目") as HTMLInputElement).value).toBe("worklog-web");
    expect((within(dialog).getByLabelText("受領日") as HTMLInputElement).value).toBe("2026-09-22");
    expect(within(dialog).getByLabelText("考え方")).toBeInTheDocument();
  });

  it("prefills the title from defaultTitle", async () => {
    renderForm({ defaultTitle: "いつかやる" });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("案件名")).toHaveValue("いつかやる");
  });

  it("依頼元 is backed by a datalist populated from useRequesters", async () => {
    renderForm();
    const dialog = await screen.findByRole("dialog");
    const requesterInput = within(dialog).getByLabelText("依頼元") as HTMLInputElement;
    const listId = requesterInput.getAttribute("list");
    expect(listId).toBeTruthy();
    await waitFor(() => {
      const datalist = document.getElementById(listId!) as HTMLDataListElement;
      expect(Array.from(datalist.options).map((o) => o.value)).toEqual(["田中", "鈴木"]);
    });
  });

  it("does not submit when 依頼元 is required-but-whitespace-only, and shows a field message", async () => {
    const { fetchMock } = renderForm();
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "   " } });
    fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "标题" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    expect(await screen.findByText("请输入依頼元")).toBeInTheDocument();
    expect(postCalls(fetchMock)).toBe(0);
  });

  it("does not submit when 案件名 is required-but-whitespace-only, and shows a field message", async () => {
    const { fetchMock } = renderForm();
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "田中" } });
    fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    expect(await screen.findByText("请输入案件名")).toBeInTheDocument();
    expect(postCalls(fetchMock)).toBe(0);
  });

  it("request body has only the fields with values plus received_at — empty 项目/考え方 are omitted", async () => {
    vi.spyOn(jst, "todayJst").mockReturnValue("2026-09-22");
    const requests: Record<string, unknown>[] = [];
    renderForm({}, { "POST /api/tasks": createTaskRoute(requests) });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "田中" } });
    fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "新案件" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({ requester: "田中", title: "新案件", received_at: "2026-09-22" });
  });

  it("trims 依頼元/案件名/项目, and includes 项目/考え方 only when non-blank", async () => {
    vi.spyOn(jst, "todayJst").mockReturnValue("2026-09-22");
    const requests: Record<string, unknown>[] = [];
    renderForm({}, { "POST /api/tasks": createTaskRoute(requests) });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "  田中  " } });
    fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "  新案件  " } });
    fireEvent.change(within(dialog).getByLabelText("项目"), { target: { value: "  P1  " } });
    fireEvent.change(within(dialog).getByLabelText("考え方"), { target: { value: "  想法  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      requester: "田中",
      title: "新案件",
      received_at: "2026-09-22",
      project: "P1",
      thinking: "想法",
    });
  });

  it("受領日 is sent exactly as the date input yields it, never routed through new Date(...)", async () => {
    const requests: Record<string, unknown>[] = [];
    renderForm({}, { "POST /api/tasks": createTaskRoute(requests) });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "田中" } });
    fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "新案件" } });
    fireEvent.change(within(dialog).getByLabelText("受領日"), { target: { value: "2026-01-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].received_at).toBe("2026-01-01");
  });

  it("on success calls onCreated with the created row", async () => {
    const created = makeTask({ id: "T20260922-42", title: "新案件" });
    const { onCreated } = renderForm({}, { "POST /api/tasks": () => new Response(JSON.stringify(created), { status: 200 }) });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "田中" } });
    fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "新案件" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  });

  it("a 400 ValidationError shows issues[0].message beside the field named by issues[0].path", async () => {
    const body400 = { error: "invalid", issues: [{ path: "requester", message: "依頼元重复" }] };
    const { fetchMock } = renderForm({}, { "POST /api/tasks": () => new Response(JSON.stringify(body400), { status: 400 }) });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "田中" } });
    fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "新案件" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    expect(await screen.findByText("依頼元重复")).toBeInTheDocument();
    expect(postCalls(fetchMock)).toBe(1);
  });

  it("Esc calls onCancel", async () => {
    const { onCancel } = renderForm();
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("the 取消 button calls onCancel", async () => {
    const { onCancel } = renderForm();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("accessibility: Tab from the last field wraps to the first, Shift+Tab from the first wraps to the last", async () => {
    renderForm();
    const dialog = await screen.findByRole("dialog");
    const requesterInput = within(dialog).getByLabelText("依頼元");
    const createButton = within(dialog).getByRole("button", { name: "创建" });

    createButton.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(requesterInput);

    requesterInput.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(createButton);
  });
});
