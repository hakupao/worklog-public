import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DotBar, DotGrid, DotIcon, DotNum, DotUptime, litCount, textRows } from "../../src/m/ui/dots";
import { Seg } from "../../src/m/ui/Seg";

describe("dots", () => {
  it("textRows: 7 rows, one gap column between characters, unknown chars are blank", () => {
    const r = textRows("4:0");
    expect(r).toHaveLength(7);
    expect(r[0]).toBe("00010s0s01110");          // 4 | : (1 wide) | 0
    expect(textRows("x")[0]).toBe("000");
  });
  it("DotGrid draws lit dots, dim dots at their opacity, never gaps; scales by viewBox", () => {
    const { container } = render(<DotGrid rows={["10s1"]} cell={10} dim={0.1} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 40 10");
    expect(svg.style.maxWidth).toBe("40px");
    const c = svg.querySelectorAll("circle");
    expect(c).toHaveLength(3);
    expect([...c].filter((x) => x.getAttribute("opacity") === "0.1")).toHaveLength(1);
  });
  it("DotGrid with dim 0 skips unlit dots", () => {
    const { container } = render(<DotGrid rows={["100"]} cell={4} dim={0} />);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });
  it("DotNum is one labelled image", () => {
    render(<DotNum text="5:12" />);
    expect(screen.getByRole("img", { name: "5:12" })).toBeInTheDocument();
    render(<DotNum text="39.6" unit="h" />);
    expect(screen.getByRole("img", { name: "39.6h" })).toBeInTheDocument();
  });
  it("litCount: zero is dark, tiny is one dot, full is n, over is clamped", () => {
    expect(litCount(0, 10, 32)).toBe(0);
    expect(litCount(0.1, 36, 32)).toBe(1);
    expect(litCount(36, 36, 32)).toBe(32);
    expect(litCount(50, 36, 32)).toBe(32);
    expect(litCount(5, 0, 32)).toBe(0);
  });
  it("DotBar renders n dots, litCount of them lit", () => {
    const { container } = render(<DotBar value={1} max={2} n={20} />);
    const c = [...container.querySelectorAll("circle")];
    expect(c).toHaveLength(20);
    expect(c.filter((x) => !x.hasAttribute("opacity"))).toHaveLength(10);
  });
  it("DotUptime: 24 dots, lit where the hour ran", () => {
    const hours = Array(24).fill(false); hours[23] = true;
    const { container } = render(<DotUptime hours={hours} />);
    const c = [...container.querySelectorAll("circle")];
    expect(c).toHaveLength(24);
    expect(c.filter((x) => !x.hasAttribute("opacity"))).toHaveLength(1);
  });
  it("DotIcon draws the bitmap", () => {
    const { container } = render(<DotIcon name="now" />);
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(20);
  });
});

describe("Seg", () => {
  it("marks the current option and reports a tap", () => {
    const on = vi.fn();
    render(<Seg value="b" label="L" options={[["a", "A"], ["b", "B"]]} onChange={on} />);
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(on).toHaveBeenCalledWith("a");
  });
});
