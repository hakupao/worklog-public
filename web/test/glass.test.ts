import { describe, expect, it } from "vitest";
import { applyGlass, canRefract, installGlassPointer } from "../src/ui/glass";
import { ensureWebFonts } from "../src/ui/webfonts";

describe("glass in jsdom", () => {
  it("cannot refract and applying is a no-op", () => {
    expect(canRefract()).toBe(false);
    const el = document.createElement("div"); el.className = "lg2"; document.body.appendChild(el);
    expect(() => applyGlass(el)).not.toThrow();
    expect(el.style.backdropFilter).toBe("");
  });
  it("pointer tracking sets the rim angle/opacity while installed and stops after uninstall", () => {
    const el = document.createElement("div"); el.className = "lg2"; document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const off = installGlassPointer();
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 150 }));
    // pointer straight below the centre: atan2(100, 0) = 90deg, +90 = 180deg
    expect(el.style.getPropertyValue("--la")).toBe("180.0deg");
    expect(Number(el.style.getPropertyValue("--ro"))).toBeGreaterThan(0.35);
    off();
    el.style.removeProperty("--la");
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 150 }));
    expect(el.style.getPropertyValue("--la")).toBe("");
    el.remove();
  });
});

describe("ensureWebFonts", () => {
  it("adds the stylesheet links once", () => {
    ensureWebFonts(); ensureWebFonts();
    expect(document.querySelectorAll('link[data-v2-fonts]')).toHaveLength(2);
  });
});
