import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../src/api/types";
import { TaskSelect } from "../../src/components/TaskSelect";
import * as jst from "../../src/lib/jst";

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "T20260901-01",
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
    ...overrides,
  };
}

const openTask = makeTask({ id: "T20260901-01", title: "対応A", status: "open" });
const holdTask = makeTask({ id: "T20260910-02", title: "対応B", status: "hold" });
const doneTask = makeTask({ id: "T20260815-01", title: "対応C(済)", status: "done" });

function routedFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url}`;
    const hit = Object.entries(routes).find(([k]) => key === k || key.startsWith(k));
    if (!hit) return new Response(JSON.stringify({}), { status: 404 });
    const [, body] = hit;
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

function renderSelect(props: Partial<ComponentProps<typeof TaskSelect>> = {}, tasks: Task[] = [openTask, holdTask]) {
  const fetchMock = routedFetch({
    "GET /api/tasks": tasks,
    "GET /api/requesters": ["田中", "鈴木"],
  });
  vi.stubGlobal("fetch", fetchMock);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const onExit = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <TaskSelect value={null} onChange={onChange} onExit={onExit} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onChange, onExit, fetchMock, qc };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TaskSelect", () => {
  it("lists open/hold tasks (id 标题) sorted by id descending, plus 未关联 and ＋ 新建案件…", async () => {
    renderSelect();
    const select = await screen.findByRole("combobox", { name: "案件" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    const labels = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toEqual(["未关联", "T20260910-02 対応B", "T20260901-01 対応A", "＋ 新建案件…"]);
  });

  it("exclude: tasks already linked elsewhere are not offered again", async () => {
    renderSelect({ exclude: [holdTask.id], emptyLabel: "＋ 案件" });
    const select = await screen.findByRole("combobox", { name: "案件" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(2));
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["＋ 案件", "T20260901-01 対応A", "＋ 新建案件…"]);
  });

  it("includes the currently-linked task even when its status is done (not open/hold)", async () => {
    renderSelect({ value: doneTask.id }, [openTask, holdTask, doneTask]);
    const select = await screen.findByRole("combobox", { name: "案件" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    expect(within(select).getByText(`${doneTask.id} ${doneTask.title}`)).toBeInTheDocument();
  });

  it("shows 未关联 selected when value is null", async () => {
    renderSelect({ value: null });
    const select = (await screen.findByRole("combobox", { name: "案件" })) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    expect(select.value).toBe("");
  });

  it("selecting 未关联 calls onChange(null), never onChange('')", async () => {
    const { onChange } = renderSelect({ value: openTask.id });
    const select = await screen.findByRole("combobox", { name: "案件" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith("");
  });

  it("selecting a task calls onChange(taskId)", async () => {
    const { onChange } = renderSelect();
    const select = await screen.findByRole("combobox", { name: "案件" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: holdTask.id } });
    expect(onChange).toHaveBeenCalledWith(holdTask.id);
  });

  it("disabled disables the select", async () => {
    renderSelect({ disabled: true });
    const select = await screen.findByRole("combobox", { name: "案件" });
    expect(select).toBeDisabled();
  });

  // ============================================================================================
  // F5: ways to leave task-editing mode without a change to send
  // ============================================================================================
  describe("F5: onExit", () => {
    it("Esc calls onExit, not onChange", async () => {
      const { onExit, onChange } = renderSelect({ value: openTask.id });
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.keyDown(select, { key: "Escape" });
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("blurring the select (not into the dialog) calls onExit", async () => {
      const { onExit } = renderSelect();
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.blur(select);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it("the blur caused by opening the ＋ 新建案件… dialog does NOT call onExit", async () => {
      const { onExit } = renderSelect();
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.change(select, { target: { value: "__new__" } });
      await screen.findByRole("dialog");
      fireEvent.blur(select); // the real browser sequence: opening the dialog blurs the select
      expect(onExit).not.toHaveBeenCalled();
    });

    it("re-selecting the value that is already selected calls onExit, not onChange (nothing to send)", async () => {
      const { onChange, onExit } = renderSelect({ value: openTask.id });
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.change(select, { target: { value: openTask.id } });
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("cancelling the ＋ 新建案件… dialog calls onExit", async () => {
      const { onExit } = renderSelect();
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.change(select, { target: { value: "__new__" } });
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("accessibility: Tab from the last field in the dialog wraps to the first, and Shift+Tab from the first wraps to the last", async () => {
      renderSelect({ defaultProject: "worklog-web" });
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.change(select, { target: { value: "__new__" } });
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

  describe("＋ 新建案件…", () => {
    async function openDialog(props: Partial<ComponentProps<typeof TaskSelect>> = {}) {
      const utils = renderSelect(props);
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.change(select, { target: { value: "__new__" } });
      const dialog = await screen.findByRole("dialog");
      return { ...utils, select, dialog };
    }

    it("opens a labelled dialog with 依頼元 (autocomplete), 案件名, 项目 defaulting to defaultProject", async () => {
      const { dialog } = await openDialog({ defaultProject: "worklog-web" });
      expect(dialog).toHaveAccessibleName();
      const projectInput = within(dialog).getByLabelText("项目") as HTMLInputElement;
      expect(projectInput.value).toBe("worklog-web");
      expect(within(dialog).getByLabelText("依頼元")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("案件名")).toBeInTheDocument();
    });

    it("依頼元 field is backed by a datalist populated from useRequesters", async () => {
      const { dialog } = await openDialog();
      const requesterInput = within(dialog).getByLabelText("依頼元") as HTMLInputElement;
      const listId = requesterInput.getAttribute("list");
      expect(listId).toBeTruthy();
      await waitFor(() => {
        const datalist = document.getElementById(listId!) as HTMLDataListElement;
        expect(Array.from(datalist.options).map((o) => o.value)).toEqual(["田中", "鈴木"]);
      });
    });

    it("Esc closes the dialog and calls onExit (F5: leaving the dialog leaves task-editing mode)", async () => {
      const { dialog, onExit } = await openDialog();
      fireEvent.keyDown(dialog, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it("submitting creates the task and immediately links the session to the returned id", async () => {
      // TaskForm (extracted from this dialog) defaults 受領日 to todayJst() and always sends it.
      vi.spyOn(jst, "todayJst").mockReturnValue("2026-09-22");
      const created: Task = makeTask({ id: "T20260922-09", title: "新規案件", status: "open" });
      const requests: Record<string, unknown>[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url === "/api/tasks") return new Response(JSON.stringify([openTask, holdTask]), { status: 200 });
        if (method === "GET" && url === "/api/requesters") return new Response(JSON.stringify(["田中"]), { status: 200 });
        if (method === "POST" && url === "/api/tasks") {
          requests.push(JSON.parse(init!.body as string));
          return new Response(JSON.stringify(created), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const onChange = vi.fn();
      render(
        <QueryClientProvider client={qc}>
          <TaskSelect value={null} onChange={onChange} defaultProject="worklog-web" />
        </QueryClientProvider>,
      );
      const select = await screen.findByRole("combobox", { name: "案件" });
      await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
      fireEvent.change(select, { target: { value: "__new__" } });
      const dialog = await screen.findByRole("dialog");

      fireEvent.change(within(dialog).getByLabelText("依頼元"), { target: { value: "山田" } });
      fireEvent.change(within(dialog).getByLabelText("案件名"), { target: { value: "新規案件" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "创建" }));

      await waitFor(() => expect(onChange).toHaveBeenCalledWith(created.id));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(requests).toEqual([
        { requester: "山田", title: "新規案件", received_at: "2026-09-22", project: "worklog-web" },
      ]);
    });
  });
});
