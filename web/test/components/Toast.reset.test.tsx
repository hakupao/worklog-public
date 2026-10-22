import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { __resetToastsForTests, toast, ToastHost } from "../../src/components/Toast";

describe("toast store between tests", () => {
  it("__resetToastsForTests empties the queue a test left behind", () => {
    render(<ToastHost />);
    act(() => { toast.info("leftover"); });
    expect(screen.getByText("leftover")).toBeTruthy();
    act(() => { __resetToastsForTests(); });
    expect(screen.queryByText("leftover")).toBeNull();
  });
});
