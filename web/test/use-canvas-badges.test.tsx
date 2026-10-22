import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/chart/canvas", () => ({ surface: () => ({ ctx: {}, w: 10, h: 10 }) }));
vi.mock("../src/chart/dots", () => ({ latticeOffset: () => ({ offX: 0, offY: 0 }) }));
import { useCanvas } from "../src/chart/useCanvas";
import { noteTaskBadges, __resetTaskBadgesForTests } from "../src/ui/taskBadges";

afterEach(() => __resetTaskBadgesForTests());

describe("useCanvas", () => {
  it("redraws when the badge registry changes, with unchanged deps", () => {
    const draw = vi.fn();
    function C() { const ref = useCanvas(draw, []); return <canvas ref={ref} />; }
    render(<C />);
    expect(draw).toHaveBeenCalledTimes(1);
    act(() => noteTaskBadges([{ id: "T1", badge_obj: "phosphor:cat", badge_color: 3 }]));
    expect(draw).toHaveBeenCalledTimes(2);
  });
});
