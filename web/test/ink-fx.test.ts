import { afterEach, describe, expect, it, vi } from "vitest";
import { changedMask, enter, swap } from "../src/ink/fx";

afterEach(() => vi.unstubAllGlobals());
const span = (html = "") => { const s = document.createElement("span"); s.innerHTML = html; document.body.appendChild(s); return s; };

describe("changedMask", () => {
  it("marks only the characters that differ, by position", () => {
    expect(changedMask("経過 0:08", "経過 0:09")).toEqual([false, false, false, false, false, false, true]);
  });
  it("treats added characters as changed and handles astral characters", () => {
    expect(changedMask("ab", "abc")).toEqual([false, false, true]);
    expect(changedMask("𠮷a", "𠮷b")).toEqual([false, true]);
  });
});

describe("swap in jsdom (no Element.animate)", () => {
  it("writes the new markup directly", () => {
    const s = span('<span lang="ja">旧</span>');
    swap(s, '<span lang="ja">新</span>', "data", "roll");
    expect(s.innerHTML).toBe('<span lang="ja">新</span>');
    expect(s.classList.contains("swapping")).toBe(false);
  });
  it("same target twice is a no-op", () => {
    const s = span("a");
    swap(s, "b", "data", "fade");
    s.innerHTML = "tampered";
    swap(s, "b", "data", "fade");
    expect(s.innerHTML).toBe("tampered");
  });
});

describe("swap with Element.animate", () => {
  it("animates, then leaves exactly the target markup", async () => {
    const finished: Promise<void>[] = [];
    (Element.prototype as unknown as { animate: unknown }).animate = vi.fn(() => {
      const f = Promise.resolve(); finished.push(f); return { finished: f, cancel() {} };
    });
    (Element.prototype as unknown as { getAnimations: unknown }).getAnimations = () => [];
    try {
      const s = span("0:08");
      swap(s, "0:09", "data", "roll");
      expect(s.classList.contains("swapping")).toBe(true);
      await Promise.all(finished); await Promise.resolve(); await Promise.resolve();
      expect(s.innerHTML).toBe("0:09");
      expect(s.classList.contains("swapping")).toBe(false);
    } finally {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
      delete (Element.prototype as unknown as { getAnimations?: unknown }).getAnimations;
    }
  });
  it("reduced motion writes directly even when animate exists", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const animate = vi.fn();
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      const s = span("a");
      swap(s, "b", "data", "slide");
      expect(s.innerHTML).toBe("b");
      expect(animate).not.toHaveBeenCalled();
    } finally { delete (Element.prototype as unknown as { animate?: unknown }).animate; }
  });
});

describe("enter", () => {
  it("does nothing (and does not throw) without Element.animate", () => {
    expect(() => enter([span("x")], "rise")).not.toThrow();
  });
});
