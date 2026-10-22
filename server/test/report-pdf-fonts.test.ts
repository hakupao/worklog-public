// server/test/report-pdf-fonts.test.ts
import { describe, expect, it, vi } from "vitest";
import { staticFonts } from "../src/report/pdf/fonts";
import { renderReportHtml } from "../src/report/pdf/html";
import { PDF_FIXTURES } from "./fixtures/pdf-data";

const HTML = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400&amp;display=block" rel="stylesheet"></head>
<body><div class="sheet"><p>週報 ATLAS&amp;co</p></div></body></html>`;
const CSS = "@font-face{font-family:'Noto Serif JP';src:url(https://fonts.gstatic.com/l/font?kit=x) format('woff')}";
const ok = () => vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(CSS, { status: 200 }));

describe("staticFonts", () => {
  it("asks Google Fonts with an old browser UA for exactly the page's characters and inlines the CSS", async () => {
    const f = ok();
    const out = await staticFonts(HTML, f as unknown as typeof fetch);
    expect(out).not.toContain("<link href=\"https://fonts.googleapis.com");
    expect(out).toContain("<style>@font-face{font-family:'Noto Serif JP'");
    const [url, init] = f.mock.calls[0];
    const u = new URL(String(url));
    expect(u.searchParams.get("family")).toBe("Noto Serif JP:wght@400");
    const text = u.searchParams.get("text")!;
    for (const ch of "週報ATLAS&co") expect(text).toContain(ch);
    expect(text).not.toContain("<");
    expect(String((init!.headers as Record<string, string>)["User-Agent"])).toMatch(/Chrome\/12\./);
  });

  it("keeps the page as is when Google Fonts fails or answers non-200", async () => {
    expect(await staticFonts(HTML, (async () => new Response("no", { status: 500 })) as any)).toBe(HTML);
    expect(await staticFonts(HTML, (async () => { throw new Error("down"); }) as any)).toBe(HTML);
    expect(await staticFonts("<html>no link</html>", vi.fn() as any)).toBe("<html>no link</html>");
  });

  it("ignores script / style contents and \\r\\n\\t, keeps U+0020 and U+2009 (R13), and sends each character once (plus the clamp ellipsis)", async () => {
    const html = HTML.replace("<p>週報 ATLAS&amp;co</p>", "<style>.zzq{color:red}</style><script>var qxw=1</script><p>週報\u2009報 aa\r\n\t</p>");
    const f = ok();
    await staticFonts(html, f as unknown as typeof fetch);
    const text = new URL(String(f.mock.calls[0][0])).searchParams.get("text")!;
    expect([...text].sort().join("")).toBe([..."週報a… \u2009"].sort().join(""));
  });

  it.each(["ja-w40", "zh", "en-long"])("finds and replaces the one real link in renderReportHtml output (%s)", async (name) => {
    const html = renderReportHtml(PDF_FIXTURES[name]);
    expect(html.match(/<link href="https:\/\/fonts\.googleapis\.com/g)).toHaveLength(1);
    const f = ok();
    const out = await staticFonts(html, f as unknown as typeof fetch);
    expect(out).not.toContain("fonts.googleapis.com/css2");
    expect(out).toContain("<style>@font-face");
    const u = new URL(String(f.mock.calls[0][0]));
    expect(u.searchParams.getAll("family").length).toBeGreaterThan(2);
    expect(u.searchParams.get("display")).toBe("block");
    const text = u.searchParams.get("text")!;
    expect(text).toContain(PDF_FIXTURES[name].tasks[0].title[0]);
    expect(text).not.toMatch(/[<>{}]/);
    expect(text).not.toMatch(/[\r\n\t]/);
    expect(text).toContain(" ");        // R13: the space is drawn, so its glyph is asked for (U+2009: the test above)
  });
});
