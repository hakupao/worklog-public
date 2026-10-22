import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "../src/components/Toast";
import { TimelinePage } from "../src/pages/TimelinePage";
import { J } from "../src/predict/fixtures";
import { V2TestProvider } from "./helpers";
import { note } from "./tl-fixtures";
import { tlServer } from "./tl-serve";

const page = (hash: string) => { window.location.hash = hash; return render(<V2TestProvider><TimelinePage /><ToastHost /></V2TestProvider>); };
const drawer = () => document.querySelector<HTMLElement>(".v2-drawer")!;
const edit = (label: string) => fireEvent.click(drawer().querySelector<HTMLElement>(`[role="button"][aria-label^="${label}："]`)!);

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(J("2026-10-02 14:20"))); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.location.hash = ""; });

describe("NoteDrawer", () => {
  it("opens on ?n=: its day, time, text, minutes; the text saves trimmed and refuses empty", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?n=n1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().querySelector(".dw-when")!.textContent).toContain("10/2（五）12:00");
    expect(drawer().textContent).toContain("打ち合わせ");
    expect(drawer().textContent).toContain("0:30");
    edit("内容");
    fireEvent.change(drawer().querySelector("textarea")!, { target: { value: "" } });
    fireEvent.keyDown(drawer().querySelector("textarea")!, { key: "Enter" });
    await waitFor(() => expect(document.querySelector(".toast")?.textContent).toContain("内容不能为空"));
    expect(api.calls).toEqual([]);
    if (!drawer().querySelector("textarea")) edit("内容");
    fireEvent.change(drawer().querySelector("textarea")!, { target: { value: " 定例 " } });
    fireEvent.keyDown(drawer().querySelector("textarea")!, { key: "Enter" });
    await waitFor(() => expect(api.calls[0]).toMatchObject({ method: "PATCH", url: "/api/notes/n1", body: { text: "定例" } }));
  });
  it("a linked note: the header has the L badge and the code, the current 案件 chip a small badge", async () => {
    tlServer({ notes: [note("n1", "2026-10-02T12:00:00", { task_id: "A", text: "打ち合わせ" })] });
    page("#/v2/timeline/2026-W40?n=n1");
    const head = await waitFor(() => { const h = drawer().querySelector<HTMLElement>(".dw-h"); if (!h) throw new Error("no header"); return h; });
    expect((await within(head).findByRole("img", { name: "A" })).getAttribute("height")).toBe("56");
    expect(head.querySelector(".code")!.textContent).toBe("A");
    expect((await within(drawer().querySelector<HTMLElement>(".fields .cur")!).findByRole("img", { name: "A" })).getAttribute("height")).toBe("16");
  });
  it("用时: hours in, minutes out; 清除用时 sends null", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?n=n1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    edit("用时");
    fireEvent.change(drawer().querySelector("input")!, { target: { value: "2" } });
    fireEvent.keyDown(drawer().querySelector("input")!, { key: "Enter" });
    await waitFor(() => expect(api.calls[0]).toMatchObject({ body: { minutes: 120 } }));
    await waitFor(() => expect(drawer().textContent).toContain("2:00"));
    edit("用时");
    fireEvent.click(screen.getByRole("button", { name: "清除用时" }));
    await waitFor(() => expect(api.calls[1]).toMatchObject({ body: { minutes: null } }));
  });
  it("案件: the picker links it", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?n=n1");
    fireEvent.click(await screen.findByRole("button", { name: "选择案件…" }));
    fireEvent.change(drawer().querySelector("select")!, { target: { value: "B" } });
    await waitFor(() => expect(api.calls[0]).toMatchObject({ url: "/api/notes/n1", body: { task_id: "B" } }));
  });
  it("delete asks first, then deletes and closes", async () => {
    const api = tlServer();
    page("#/v2/timeline/2026-W40?n=n1");
    fireEvent.click(await screen.findByRole("button", { name: "删除这条补记" }));
    expect(drawer().textContent).toContain("删除后无法恢复");
    expect(api.calls).toEqual([]);
    fireEvent.click(screen.getAllByRole("button", { name: "删除这条补记" })[0]);
    await waitFor(() => expect(api.calls[0]).toMatchObject({ method: "DELETE" }));
    await waitFor(() => expect(window.location.hash).toBe("#/v2/timeline/2026-W40"));
    expect(api.db.notes).toEqual([]);
  });
  it("the delete confirm takes focus on 取消; Esc cancels the confirm, not the drawer", async () => {
    tlServer();
    page("#/v2/timeline/2026-W40?n=n1");
    fireEvent.click(await screen.findByRole("button", { name: "删除这条补记" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "取消" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "取消" })).toBeNull());
    expect(drawer().classList.contains("on")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "删除这条补记" }));
  });
});


describe("NoteDrawer — input polish", () => {
  it("shows 润 after a polished text; no mark without meta", async () => {
    const api = tlServer();
    Object.assign(api.db.notes.find((n) => n.id === "n1")!, { _polish: { text: { raw: "うちあわせ", pinned: false } } });
    const a = page("#/v2/timeline/2026-W40?n=n1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().querySelector<HTMLElement>('button[aria-label="已润色"]')).toBeTruthy();
    a.unmount();
    delete (api.db.notes.find((n) => n.id === "n1") as { _polish?: unknown })._polish;
    page("#/v2/timeline/2026-W40?n=n1");
    await waitFor(() => expect(drawer().classList.contains("on")).toBe(true));
    expect(drawer().textContent).toContain("打ち合わせ");
    expect(drawer().querySelector('button[aria-label="已润色"]')).toBeNull();
  });
});
