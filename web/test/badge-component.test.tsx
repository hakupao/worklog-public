import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "../src/badge/Badge";
import { __resetBadgeCacheForTests, badgeCacheStats, badgeSvgUrl, resolveBadge } from "../src/badge/cache";
import { BADGE_OBJECTS } from "../src/badge/objects";
import { LINE_PALETTE, lineColor } from "../src/ui/palette";
import { applyWorld, resetWorldStore } from "../src/world/store";

const ID = "T20261001-01";
afterEach(() => { __resetBadgeCacheForTests(); resetWorldStore(); });

describe("resolveBadge", () => {
  it("uses the stored object and palette colour", () => {
    expect(resolveBadge({ id: ID, obj: "phosphor:cat", color: 3 })).toEqual({ obj: "phosphor:cat", color: LINE_PALETTE[3] });
  });
  it("falls back for a missing / unknown object or an out-of-range colour (before B1, culled icons)", () => {
    for (const spec of [{ id: ID }, { id: ID, obj: "no-such", color: 99 }, { id: ID, obj: "cat" }, { id: ID, obj: "constructor" }, { id: ID, obj: "toString" }, { id: ID, obj: "__proto__" }, { id: ID, obj: null, color: null }, { id: ID, color: -1 }]) {
      const r = resolveBadge(spec);
      expect(BADGE_OBJECTS).toContain(r.obj);
      expect(r.color).toBe(lineColor(ID));
    }
  });
});

describe("badgeSvgUrl", () => {
  it("is memoised per key and differs by level and world", () => {
    const a = badgeSvgUrl({ id: ID }, "S", "ura");
    expect(badgeSvgUrl({ id: ID }, "S", "ura")).toBe(a);
    expect(badgeCacheStats().svg).toBe(1);
    expect(badgeSvgUrl({ id: ID }, "L", "ura")).not.toBe(a);
    expect(badgeSvgUrl({ id: ID }, "S", "omote")).not.toBe(a);
    expect(a.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(a)).toContain('viewBox="0 0 320 100"');
    expect(decodeURIComponent(a)).toContain('width="320" height="100"');
  });
});

describe("<Badge>", () => {
  it("renders an image sized to the capsule ratio with the title as alt", () => {
    render(<Badge spec={{ id: ID, obj: "phosphor:cat", color: 1 }} height={18} title="ORION-B" />);
    const img = screen.getByRole("img", { name: "ORION-B" }) as HTMLImageElement;
    expect(img.getAttribute("height")).toBe("18"); expect(img.getAttribute("width")).toBe("58");
    expect(img.src.startsWith("data:image/svg+xml,")).toBe(true);
  });
  it("redraws in the other material when the world switches", () => {
    render(<Badge spec={{ id: ID }} height={36} title="x" />);
    const before = (screen.getByRole("img") as HTMLImageElement).src;
    act(() => applyWorld("omote"));
    const after = (screen.getByRole("img") as HTMLImageElement).src;
    expect(after).not.toBe(before);
    expect(decodeURIComponent(after)).toContain("sand-");
  });
  it("200 badges of 20 tasks render 20 SVGs, not 200", () => {
    render(<>{Array.from({ length: 200 }, (_, i) => <Badge key={i} spec={{ id: `T20261001-${String(i % 20).padStart(2, "0")}` }} height={18} />)}</>);
    expect(badgeCacheStats().svg).toBe(20);
  });
});

describe("<Badge> with a canvas", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("never mounts the SVG <img> first: a sized placeholder until the bitmap, then the bitmap", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
    Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: () => Promise.resolve() });
    const { container } = render(<Badge spec={{ id: ID }} height={18} alt="1001-01" />);
    expect(container.querySelector("img")).toBeNull();                 // first frame: no SVG <img>
    const ph = screen.getByRole("img", { name: "1001-01" });
    expect(ph.tagName).toBe("SPAN"); expect(ph.style.width).toBe("58px"); expect(ph.style.height).toBe("18px");
    await waitFor(() => expect((container.querySelector("img") as HTMLImageElement | null)?.src).toBe("data:image/png;base64,AAAA"));
    // a second badge of the same key paints the cached bitmap in its first frame
    const again = render(<Badge spec={{ id: ID }} height={18} alt="b" />);
    expect((again.container.querySelector("img") as HTMLImageElement).src).toBe("data:image/png;base64,AAAA");
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });
  it("falls back to the SVG when rasterising fails", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() { throw new Error("x"); } } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: () => Promise.resolve() });
    render(<Badge spec={{ id: ID }} height={18} alt="z" />);
    await waitFor(() => expect((screen.getByRole("img", { name: "z" }) as HTMLImageElement).src.startsWith("data:image/svg+xml,")).toBe(true));
    delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
  });
  it("the world prop overrides the store", () => {
    render(<Badge spec={{ id: ID }} height={36} alt="w" world="omote" />);
    expect(decodeURIComponent((screen.getByRole("img", { name: "w" }) as HTMLImageElement).src)).toContain("sand-");
  });
});
