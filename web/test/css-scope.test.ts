import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync("src/styles/v2.css", "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[^{;]+\{/g, "}");

describe("v2.css", () => {
  it("scopes every selector under html.v2", () => {
    const bad: string[] = []; const re = /(^|})\s*([^{}@]+)\{/g; let m: RegExpExecArray | null;
    while ((m = re.exec(css))) for (const sel of m[2].split(/,(?![^(]*\))/)) { const s = sel.trim(); if (s && !/^(html\.v2|from|to|\d+%)/.test(s)) bad.push(s); }
    expect(bad).toEqual([]);
  });
  it("洞察头条: a line's canvas does not grow in its column cell (flex:1 from .stp canvas.fill made each line ~160px tall, shots 7b)", () => {
    const grow = raw.indexOf("html.v2 .stp canvas.fill{flex:1"), keep = raw.indexOf("html.v2 .stp .sv-hl .hc canvas.fill{flex:none}");
    expect(grow).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(grow);
  });
  it("form-control reset uses :where() so it cannot outrank component classes", () => {
    expect(raw).toContain("html.v2 :where(button,input,select,textarea){font:inherit;color:inherit}");
    expect(css).not.toMatch(/html\.v2 (button|input|select|textarea)\b[^{]*\{/);
  });
  it("narrow screens hide the header date by the class Header renders; no rule is defined twice", () => {
    expect(raw).toMatch(/@media \(max-width:1360px\)\{[^\n]*html\.v2 \.v2-date\{display:none\}/);
    expect(raw).not.toContain("#hDate");
    expect(raw.match(/html\.v2 \.v2-hd \.grow\{/g)).toHaveLength(1);
  });
  it("the 表 preview ink undoes the 里 visually-hidden twin rule and keeps the swap clip after it", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].replace(/\s+/g, "") }));
    const at = (sel: string) => rules.findIndex((r) => r.sel === sel);
    const pvo = rules[at("html.v2 .pvo .ink")];
    for (const d of ["width:auto", "height:auto", "margin:0", "overflow:visible", "clip:auto", "clip-path:none"]) expect(pvo.body).toContain(d);
    const sw = at("html.v2 .pvo .ink.swapping");
    expect(sw).toBeGreaterThan(at("html.v2 .pvo .ink"));
    expect(rules[sw].body).toContain("clip-path:inset(-1px-100vw-1px-100vw)");
  });
  it("表: the 案件 page's / drawer's 完了 lamp is the flat #c4cbd4, not the warm 里 lamp that outranks the global 表 rule", () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].replace(/\s+/g, "") }));
    const at = (sel: string) => rules.findIndex((r) => r.sel === sel);
    const ura = at("html.v2 .tk .lamp.dim,html.v2 .v2-drawer .lamp.dim");
    const omote = at("html.v2[data-world=omote] .tk .lamp.dim,html.v2[data-world=omote] .v2-drawer .lamp.dim");
    expect(ura).toBeGreaterThan(-1);
    expect(omote).toBeGreaterThan(ura);
    expect(rules[omote].body).toBe("background:#c4cbd4;box-shadow:none");
  });
  it("narrow 案件: the hidden 最近 column leaves no track or gap, and the empty-state row keeps its only cell", () => {
    const m = raw.match(/@media \(max-width:1360px\)\{html\.v2 \.tk\{--cols:([^}]*)\}([^\n]*)\}/)!;
    expect(m[1].trim().split(/ (?![^(]*\))/)).toHaveLength(8);
    expect(m[2]).toContain("html.v2 .tk .trow:not(.empty)>:last-child");
    expect(m[2]).not.toMatch(/\.trow>:last-child/);
  });
  it("the 计划 drawers' rules stay under .pl-dw: none reaches the timeline / 案件 drawers (sub5 preflight R6)", () => {
    const sels = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(/,(?![^(]*\))/).map((x) => x.trim()));
    const plan = /\.(segf|tchip|judge|ev|stale|closedNote|wkline)\b|textarea\.inp|input\.inp|badge\.idle|^html\.v2 \.v2-drawer \.fb\[disabled\]/;
    expect(sels.filter((x) => x.includes(".v2-drawer") && plan.test(x) && !x.includes(".pl-dw"))).toEqual([]);
  });
});
