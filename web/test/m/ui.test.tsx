import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DayNav } from "../../src/m/ui/DayNav";
import { Sheet } from "../../src/m/ui/Sheet";
import { Empty, ErrorState, Loading } from "../../src/m/ui/State";
import { useSwipe } from "../../src/m/ui/swipe";
import { V2TestProvider } from "../helpers";

function Host({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <V2TestProvider>
      <button type="button" onClick={() => setOpen(true)}>open</button>
      {open && <Sheet title="标题" onClose={() => { setOpen(false); onClose(); }}><p>内容</p></Sheet>}
    </V2TestProvider>
  );
}

describe("Sheet", () => {
  it("opens with focus on close, locks page scroll, and gives both back on Esc", () => {
    render(<Host />);
    const opener = screen.getByText("open");
    opener.focus(); fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "标题" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("button", { name: "关闭" })).toHaveTextContent("[×]");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });
  it("Tab wraps inside the sheet, both ways (B5)", () => {
    render(
      <V2TestProvider>
        <Sheet title="标题" onClose={() => {}}><button type="button">甲</button><button type="button">乙</button></Sheet>
      </V2TestProvider>,
    );
    const close = screen.getByRole("button", { name: "关闭" }), last = screen.getByText("乙");
    last.focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
  it("Esc while an IME is composing does not close", () => {
    render(<Host />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("Esc with keyCode 229 (Safari's confirming keydown) does not close", () => {
    render(<Host />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.keyDown(document, { key: "Escape", keyCode: 229 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("closes on the scrim and on a long downward drag, not a short one", () => {
    const onClose = vi.fn();
    const { container } = render(<Host onClose={onClose} />);
    fireEvent.click(screen.getByText("open"));
    const zone = container.querySelector(".m-grabzone")!;
    fireEvent.pointerDown(zone, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(zone, { clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(zone, { clientY: 150, pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(zone, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(zone, { clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(zone, { clientY: 220, pointerId: 1 });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(container.querySelector(".m-scrim")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("State", () => {
  it("loading, error with retry, empty", () => {
    const retry = vi.fn();
    const { container } = render(<V2TestProvider><Loading rows={2} /><ErrorState onRetry={retry} /><Empty>空</Empty></V2TestProvider>);
    expect(container.querySelectorAll(".m-skel-row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "重新载入" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByText("空")).toBeInTheDocument();
  });
});

describe("DayNav", () => {
  it("titles the day and stops at max", () => {
    const go = vi.fn();
    render(<V2TestProvider><DayNav date="2026-10-13" today="2026-10-13" max="2026-10-13" onGo={go} sub="3 条" /></V2TestProvider>);
    expect(screen.getByText("10/13 周二 · 今天")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "后一天" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "前一天" }));
    expect(go).toHaveBeenCalledWith(-1);
  });
});

describe("useSwipe", () => {
  function Body({ onSwipe }: { onSwipe: (d: 1 | -1) => void }) {
    const sw = useSwipe(onSwipe);
    return <div data-testid="body" {...sw}><div className="m-sheet" data-testid="sheet">s</div><span data-testid="plain">p</span></div>;
  }
  const swipe = (el: Element) => {
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 100, clientY: 105 }] });
  };
  it("fires on a horizontal swipe in the page", () => {
    const h = vi.fn();
    render(<Body onSwipe={h} />);
    swipe(screen.getByTestId("plain"));
    expect(h).toHaveBeenCalledTimes(1);
  });
  it("ignores a touch that starts inside an open sheet", () => {
    const h = vi.fn();
    render(<Body onSwipe={h} />);
    swipe(screen.getByTestId("sheet"));
    expect(h).not.toHaveBeenCalled();
  });
});
