import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "../../src/api/client";
import { InlineEdit } from "../../src/components/InlineEdit";
import { toast } from "../../src/components/Toast";

afterEach(() => vi.restoreAllMocks());

describe("InlineEdit", () => {
  // ---- entering / leaving edit mode --------------------------------------------------------

  it("shows the display content when not editing, and enters edit mode on click", () => {
    render(<InlineEdit value="hello" display="hello (shown)" onSave={vi.fn()} ariaLabel="摘要" />);
    expect(screen.getByText("hello (shown)")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/摘要/));

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box).toBeInTheDocument();
    expect(box.value).toBe("hello");
  });

  it("an empty value still shows a clickable hint, so an unset field can be filled in", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit value="" onSave={onSave} ariaLabel="项目" />);
    fireEvent.click(screen.getByText("点击填写"));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "LEDGER" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("LEDGER"));
  });

  it("an empty value's hint is the caller's placeholder when one is given", () => {
    render(<InlineEdit value="" placeholder="未设置" onSave={vi.fn()} ariaLabel="项目" />);
    expect(screen.getByText("未设置")).toBeInTheDocument();
  });

  it("autofocuses and selects all text on entering edit mode", () => {
    render(<InlineEdit value="hello" onSave={vi.fn()} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
  });

  it("Esc cancels the edit without calling onSave and reverts to the display value", () => {
    const onSave = vi.fn();
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "changed" } });
    fireEvent.keyDown(box, { key: "Escape" });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  // ---- contract 1-alike: unchanged content sends no request --------------------------------

  it("does not call onSave when the draft is saved unchanged (Enter)", () => {
    const onSave = vi.fn();
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not call onSave when blurred unchanged", () => {
    const onSave = vi.fn();
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onSave).not.toHaveBeenCalled();
  });

  // ---- Enter saves, Shift+Enter newline (multiline), blur saves -----------------------------

  it("Enter saves the new draft", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "world" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("world"));
  });

  it("Shift+Enter inserts a newline in a multiline field instead of saving", () => {
    const onSave = vi.fn();
    render(<InlineEdit value="hello" onSave={onSave} multiline ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "hello\nworld" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(box.value).toBe("hello\nworld");
    expect(box).toBeInTheDocument(); // still editing
  });

  it("blur saves the new draft", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "world" } });
    fireEvent.blur(screen.getByRole("textbox"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("world"));
  });

  it("exits edit mode once onSave resolves", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "world" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  // ---- IME safety -----------------------------------------------------------------------

  it("does not save when Enter confirms an IME composition", () => {
    const onSave = vi.fn();
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "こんにちは" } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(box);
    expect(onSave).not.toHaveBeenCalled();
    // A real Enter, after composition has ended, does save.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("こんにちは");
  });

  it("F1: Esc during an IME composition does not cancel the edit — the draft survives, and a real Esc afterward still cancels", () => {
    const onSave = vi.fn();
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "しんちょ" } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: "Escape", keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(box);
    // Still editing, draft intact — an Esc that only cleared the IME's reading must not
    // discard everything typed in the box.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("しんちょ");

    // A real Esc (composition already ended) cancels as before.
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("F1: Safari ordering on Enter — compositionend fires before the confirming keydown (keyCode 229 alone still blocks the save)", () => {
    const onSave = vi.fn();
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "こんばんは" } });
    fireEvent.compositionStart(box);
    fireEvent.compositionEnd(box); // Safari: compositionend already fired...
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 }); // ...before this keydown, isComposing false/absent
    expect(onSave).not.toHaveBeenCalled();
    expect(box.value).toBe("こんばんは");
    // A genuine Enter (no keyCode 229) now does save.
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("こんばんは");
  });

  // ---- parse / validation ------------------------------------------------------------------

  it("with a parse prop: an invalid draft is not saved, and its reason is shown beside the field", () => {
    const onSave = vi.fn();
    const parse = (text: string) => (text === "bad" ? { ok: false as const, reason: "格式不对" } : { ok: true as const });
    render(<InlineEdit value="1" onSave={onSave} parse={parse} ariaLabel="工时" />);
    fireEvent.click(screen.getByLabelText(/工时/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "bad" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("格式不对")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument(); // stays in edit mode
  });

  it("a valid draft (per parse) is saved", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const parse = () => ({ ok: true as const });
    render(<InlineEdit value="1" onSave={onSave} parse={parse} ariaLabel="工时" />);
    fireEvent.click(screen.getByLabelText(/工时/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "2.5" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("2.5"));
  });

  // ---- rejection handling -------------------------------------------------------------------

  it("contract 9: a ValidationError rejection shows issues[0].message beside the field and stays in edit mode with the draft intact", async () => {
    const onSave = vi.fn().mockRejectedValue(new ValidationError([{ path: "x", message: "太长了" }]));
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "world" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("太长了")).toBeInTheDocument());
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("world");
  });

  it("contract 7: a ConflictError rejection shows the fixed toast message and keeps the typed draft in the box", async () => {
    const errorSpy = vi.spyOn(toast, "error");
    const onSave = vi.fn().mockRejectedValue(new ConflictError({ id: "x" }));
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "my draft" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith("这条记录已在别处被修改，已刷新为最新内容，请确认后再保存"),
    );
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("my draft");
  });

  it("a generic rejection keeps the draft intact and stays in edit mode", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network blip"));
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "my draft" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.value).toBe("my draft");
  });

  it("accessibility: refocuses the field once a rejected save clears its disabled state", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network blip"));
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "my draft" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const box = screen.getByRole("textbox") as HTMLInputElement;
    await waitFor(() => expect(box).not.toBeDisabled());
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  // ---- contract 8: saving state ---------------------------------------------------------------

  it("contract 8: disables the field and does not send a second save while one is in flight", async () => {
    let resolveSave!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSave = res;
        }),
    );
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "world" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(box).toBeDisabled());
    // A concurrent blur while saving must not fire a second save.
    fireEvent.blur(box);
    expect(onSave).toHaveBeenCalledTimes(1);

    resolveSave();
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  // ---- restore ------------------------------------------------------------------------------

  it("restore: clicking the restore button calls onRestore instead of onSave and does not trigger blur-save", async () => {
    const onSave = vi.fn();
    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineEdit
        value="edited text"
        onSave={onSave}
        ariaLabel="摘要"
        restore={{ label: "↺ 恢复自动摘要", onRestore }}
      />,
    );
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "further edit" } });

    const restoreButton = screen.getByRole("button", { name: "↺ 恢复自动摘要" });
    fireEvent.mouseDown(restoreButton); // typical browser order: mousedown (steals focus) then blur then click
    fireEvent.blur(screen.getByRole("textbox"));
    fireEvent.click(restoreButton);

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("restore button is absent when the `restore` prop is not given", () => {
    render(<InlineEdit value="hello" onSave={vi.fn()} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    expect(screen.queryByRole("button", { name: /恢复/ })).not.toBeInTheDocument();
  });

  // ---- type="date" (task 9: 受領日) -----------------------------------------------------------

  it('type="date" renders a native date input in edit mode, defaulting to "text"', () => {
    render(<InlineEdit value="2026-09-22" onSave={vi.fn()} ariaLabel="受領日" type="date" />);
    fireEvent.click(screen.getByLabelText(/受領日/));
    const box = screen.getByLabelText("受領日") as HTMLInputElement;
    expect(box.type).toBe("date");
    expect(box.value).toBe("2026-09-22");

    cleanup();
    render(<InlineEdit value="hello" onSave={vi.fn()} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    expect((screen.getByRole("textbox") as HTMLInputElement).type).toBe("text");
  });

  it('type="date" saves the exact string the date input yields, never routed through new Date(...)', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit value="2026-09-22" onSave={onSave} ariaLabel="受領日" type="date" />);
    fireEvent.click(screen.getByLabelText(/受領日/));
    const box = screen.getByLabelText("受領日") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "2026-01-01" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("2026-01-01"));
  });

  // ---- disabled -------------------------------------------------------------------------------

  it("disabled: clicking the display does not enter edit mode", () => {
    render(<InlineEdit value="hello" onSave={vi.fn()} ariaLabel="摘要" disabled />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // ---- returning focus when the edit ends -----------------------------------------------------

  it("accessibility: Enter returns focus to the display the edit was opened from", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "edited" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/摘要/)));
  });

  it("accessibility: Esc returns focus to the display too", () => {
    render(<InlineEdit value="hello" onSave={vi.fn()} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(document.activeElement).toBe(screen.getByLabelText(/摘要/));
  });

  it("accessibility: a blur-save does NOT pull focus back from wherever the user clicked", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />
        <button type="button">elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "edited" } });

    // What a real click on another control does: focus moves first, then the field blurs.
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    elsewhere.focus();
    fireEvent.blur(box);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(elsewhere);
  });

  it("accessibility: a rejected save keeps focus in the field instead of returning it to the display", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network blip"));
    render(<InlineEdit value="hello" onSave={onSave} ariaLabel="摘要" />);
    fireEvent.click(screen.getByLabelText(/摘要/));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "edited" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it("a multiline field keeps its line breaks at rest", () => {
    render(<InlineEdit ariaLabel="考え方" multiline value={"- 甲\n- 乙"} onSave={vi.fn()} />);
    const display = screen.getByRole("button", { name: /考え方/ });
    expect(display.className).toContain("inline-edit__text--multiline");
    expect(display.textContent).toBe("- 甲\n- 乙");
  });
});
