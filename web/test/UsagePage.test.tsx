import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import usage from "../../docs/guide/usage.md?raw";
import { STRINGS } from "../src/i18n/strings";
import { guideParts, UsagePage } from "../src/pages/UsagePage";
import type { Lang } from "../src/prefs/types";
import { V2TestProvider } from "./helpers";

/** Every expectation is read from docs/guide/usage.md, so the guide can change without touching this test. */
const lines = usage.replace(/\r\n?/g, "\n").split("\n");
const plain = (s: string) => s.replace(/`|\*\*/g, "");
const h1 = plain(lines.find((l) => l.startsWith("# "))!.slice(2));
const h2s = lines.filter((l) => l.startsWith("## ")).map((l) => plain(l.slice(3)));
const inApp = [...usage.matchAll(/\]\((#\/[^)]+)\)/g)].map((m) => m[1]);

const view = (lang: Lang = "zh") => render(<V2TestProvider lang={lang}><UsagePage /></V2TestProvider>);
const page = (lang: Lang = "zh") => view(lang).container;

const scrollIntoView = Element.prototype.scrollIntoView;   // jsdom has none: the page must not need it
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); Element.prototype.scrollIntoView = scrollIntoView; });

describe("v2 UsagePage", () => {
  it("shows the guide without its own title: the header's page name is the only one", () => {
    const c = page();
    expect(h1.length).toBeGreaterThan(0);
    expect(c.querySelector("h1")).toBeNull();
    expect(c.querySelector(".us-doc")!.textContent).not.toContain(h1);
    expect([...c.querySelectorAll(".us-doc h2")].map((h) => h.textContent)).toEqual(h2s);
  });

  it("a CRLF checkout (Windows, autocrlf) parses the same: title stripped, the same chapters, the same rendering", () => {
    const lf = usage.replace(/\r\n?/g, "\n"), crlf = lf.replace(/\n/g, "\r\n");
    const a = guideParts(lf), b = guideParts(crlf);
    expect(b.chapters).toEqual(h2s);
    expect(b.body).toBe(a.body);
    expect(b.body.startsWith("# ")).toBe(false);
    expect(guideParts("# 标题\r\n\r\n## 一\r\n正文\r\n## `二`\r\n")).toEqual({ body: "## 一\n正文\n## `二`\n", chapters: ["一", "二"] });
  });

  it("sets the guide as Chinese prose", () => {
    expect(page().querySelector(".us-doc")).toHaveAttribute("lang", "zh-CN");
  });

  it("has one chapter key per h2, and each key brings its h2 into view and focus", async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    const c = page();
    const toc = screen.getByRole("navigation", { name: STRINGS["us.toc"].zh });
    const keys = within(toc).getAllByRole("button");
    await waitFor(() => expect(keys.map((k) => k.textContent)).toEqual(h2s));
    const heads = [...c.querySelectorAll<HTMLElement>(".us-doc h2")];
    keys.forEach((k, i) => {
      into.mockClear();
      fireEvent.click(k);
      expect(into).toHaveBeenCalledTimes(1);
      expect(into.mock.contexts[0]).toBe(heads[i]);
      expect(document.activeElement).toBe(heads[i]);
    });
  });

  it("says the guide is Chinese only on the ja / en interface, not on zh", () => {
    for (const lang of ["ja", "en"] as const) {
      const { container, unmount } = view(lang);
      expect(container.querySelector(".us-note")!.textContent).toBe(STRINGS["us.zhOnly"][lang]);
      unmount();
    }
    expect(page("zh").querySelector(".us-note")).toBeNull();
  });

  it("links in-app only to v2 addresses, exactly the ones the guide writes", () => {
    const links = [...page().querySelectorAll(".us-doc a")].map((a) => a.getAttribute("href")!).filter((h) => h.startsWith("#/"));
    expect(inApp.length).toBeGreaterThan(0);
    expect(links).toEqual(inApp);
    for (const h of links) expect(h).toMatch(/^#\/v2\//);
  });
});
