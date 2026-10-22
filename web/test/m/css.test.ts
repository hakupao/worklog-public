import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync("src/m/styles/m.css", "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{;]+\{/g, "}");

describe("m.css", () => {
  it("scopes every selector under html.m", () => {
    const bad: string[] = []; const re = /(^|})\s*([^{}@]+)\{/g; let m: RegExpExecArray | null;
    while ((m = re.exec(css))) for (const sel of m[2].split(/,(?![^(]*\))/)) { const s = sel.trim(); if (s && !/^(html\.m\b|from|to|\d+%)/.test(s)) bad.push(s); }
    expect(bad).toEqual([]);
  });
  it("states the seven anti-overflow rules at the top", () => {
    const head = raw.slice(0, raw.indexOf("html.m{"));
    for (const n of ["1 ", "2 ", "3 ", "4 ", "5 ", "6 ", "7 "]) expect(head).toContain(`   ${n}`);
  });
  it("keeps inputs at 16px (no iOS zoom on focus) and the column at 440px", () => {
    expect(raw).toMatch(/html\.m \.m-input\{[^}]*font-size:16px/);
    expect(raw).toMatch(/html\.m \.m-app\{[^}]*max-width:440px/);
  });
  it("defines every colour token for both themes", () => {
    const tokens = (block: string) => [...block.matchAll(/(--[\w-]+):/g)].map((x) => x[1]).sort();
    const light = raw.match(/html\.m\{([^}]*)\}/)![1], dark = raw.match(/html\.m\[data-m-theme=dark\]\{([^}]*)\}/)![1];
    expect(tokens(dark)).toEqual(tokens(light));
  });
  it("animates only the spinner, the cursor and the sheet (spec P8)", () => {
    const names = [...raw.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
    expect(names).toEqual(["m-blink", "m-fade", "m-spin", "m-up"]);
    expect(raw).not.toMatch(/scale\(/);
    expect(raw).not.toMatch(/backdrop-filter|text-shadow|--glow|m-backdrop|border-radius:999px/);
  });
});
