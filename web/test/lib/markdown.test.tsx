import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../src/lib/markdown";

const md = (text: string) => render(<Markdown text={text} />).container;

describe("Markdown", () => {
  it("renders headings below the page h2", () => {
    const c = md("## 本周概况\n内容\n### 小节");
    expect(c.querySelector("h3")?.textContent).toBe("本周概况");
    expect(c.querySelector("h4")?.textContent).toBe("小节");
    expect(c.querySelector("h2")).toBeNull();
  });
  it("renders unordered and ordered lists", () => {
    const c = md("- 甲\n* 乙\n\n1. 一\n2. 二");
    expect([...c.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["甲", "乙"]);
    expect([...c.querySelectorAll("ol > li")].map((li) => li.textContent)).toEqual(["一", "二"]);
  });
  it("renders bold and inline code", () => {
    const c = md("这是 **重点** 和 `wl review`");
    expect(c.querySelector("strong")?.textContent).toBe("重点");
    expect(c.querySelector("code")?.textContent).toBe("wl review");
  });
  it("splits paragraphs on blank lines and keeps single newlines as breaks", () => {
    const c = md("第一段\n续行\n\n第二段");
    const ps = c.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0].querySelector("br")).not.toBeNull();
  });
  it("shows HTML as text, never as markup", () => {
    const c = md("<script>alert(1)</script> <b>x</b>");
    expect(c.querySelector("script")).toBeNull();
    expect(c.querySelector("b")).toBeNull();
    expect(c.textContent).toContain("<script>alert(1)</script>");
  });
  it("leaves an unclosed ** as literal text", () => {
    expect(md("a **b").textContent).toBe("a **b");
  });
});

// The help page renders docs/guide/usage.md with this same component, so it covers every construct
// that file uses; the review keeps the nested-heading default above.
const page = (text: string) => render(<Markdown text={text} page />).container;

describe("Markdown — the constructs docs/guide/usage.md uses", () => {
  it("renders headings at their own level when it is a whole page", () => {
    const c = page("# 标题\n## 一节\n### 小节");
    expect(c.querySelector("h1")?.textContent).toBe("标题");
    expect(c.querySelector("h2")?.textContent).toBe("一节");
    expect(c.querySelector("h3")?.textContent).toBe("小节");
  });
  it("joins consecutive > lines into one blockquote and keeps its inline markup", () => {
    const c = md("> 第一行 `docs/`\n> 第二行\n>\n> 第二段\n\n正文");
    const q = c.querySelectorAll("blockquote");
    expect(q).toHaveLength(1);
    expect(q[0].querySelectorAll("p")).toHaveLength(2);
    expect(q[0].querySelector("code")?.textContent).toBe("docs/");
    expect(c.querySelector(":scope > p")?.textContent).toBe("正文");
  });
  it("turns <https://…> into an external link that opens in a new tab", () => {
    const a = md("网址：<https://worklog.example.com>（登录）").querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://worklog.example.com");
    expect(a?.textContent).toBe("https://worklog.example.com");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noreferrer");
  });
  it("links [text](url) only to https:// and in-app #/ addresses", () => {
    const c = md("[时间线](#/v2/timeline) [站](https://x.example) [坏](javascript:alert(1)) [旧](http://x.example) [相对](a.html) <http://x.example>");
    const links = [...c.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("target")]);
    expect(links).toEqual([["时间线", "#/v2/timeline", null], ["站", "https://x.example", "_blank"]]);
    expect(c.textContent).toContain("[坏](javascript:alert(1))");
    expect(c.textContent).toContain("[旧](http://x.example)");
    expect(c.textContent).toContain("[相对](a.html)");
    expect(c.textContent).toContain("<http://x.example>");
  });
  it("renders a pipe table with column headers, row headers and an escaped pipe inside code", () => {
    const c = page("## 3. 出问题时怎么办\n\n| 现象 | 处理 |\n|---|:--:|\n| 名字变红 | `launchctl list \\| grep worklog` |\n| **慢** | 等 |\n");
    const t = c.querySelector("table")!;
    expect([...t.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["现象", "处理"]);
    const rows = [...t.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.firstElementChild?.tagName).toBe("TH");
      expect(r.firstElementChild).toHaveAttribute("scope", "row");
    }
    expect(rows[0].querySelector("code")?.textContent).toBe("launchctl list | grep worklog");
    expect(rows[1].querySelector("strong")?.textContent).toBe("慢");
  });
  it("wraps each table in a focusable region named after the heading above it", () => {
    const region = page("## 2. 三种写法\n\n| a | b |\n|---|---|\n| c | d |").querySelector("[role=region]");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("aria-label", "2. 三种写法");
    expect(region?.querySelector("table")).not.toBeNull();
  });
  it("leaves a | line without a delimiter row under it as a paragraph", () => {
    const c = md("| 不是表 |\n普通");
    expect(c.querySelector("table")).toBeNull();
    expect(c.querySelector("p")?.textContent).toBe("| 不是表 |普通");
  });
  it("renders a fenced code block verbatim, markup and HTML included", () => {
    const c = md("前\n```toml\n[projects]\n'C:\\Local' = \"**x**\"\n<b>y</b>\n```\n后");
    const pre = c.querySelectorAll("pre");
    expect(pre).toHaveLength(1);
    expect(pre[0].querySelector("code")?.textContent).toBe("[projects]\n'C:\\Local' = \"**x**\"\n<b>y</b>");
    expect(c.querySelector("strong")).toBeNull();
    expect([...c.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["前", "后"]);
  });
  it("reads CRLF text (a Windows checkout) as it reads LF", () => {
    const text = "## 一节\n\n- 甲\n- 乙\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n段落\n续行";
    const lf = md(text).innerHTML, crlf = md(text.replace(/\n/g, "\r\n")).innerHTML;
    expect(crlf).toBe(lf);
    expect(crlf).not.toContain("\r");
  });
  it("does not open a fence on a line whose backtick run is followed by another backtick", () => {
    const c = md("```inline```\n\n后文");
    expect(c.querySelector("pre")).toBeNull();
    expect([...c.querySelectorAll("p")].map((p) => p.textContent)).toContain("后文");
  });
  it("keeps a 3-space indented fence and continuation lines inside their list item", () => {
    const c = md("1. 写 `local.toml`：\n   ```toml\n   machine = \"win11\"\n   ```\n   机器名只写这里。\n   配法见第 5 节。\n2. 手动跑一次");
    const items = c.querySelectorAll("ol > li");
    expect(items).toHaveLength(2);
    expect(items[0].querySelector("pre code")?.textContent).toBe('machine = "win11"');
    expect(items[0].querySelector("p")?.textContent).toBe("机器名只写这里。配法见第 5 节。");
    expect(items[0].firstChild?.textContent).toBe("写 ");
    expect(items[1].textContent).toBe("手动跑一次");
    expect(c.querySelectorAll(":scope > pre, :scope > p")).toHaveLength(0);
  });
  it("nests lists and quotes at most 16 deep; deeper lines are plain text, never a stack overflow", () => {
    const depth = (el: Element, tag: string): number => Math.max(0, ...[...el.children].map((ch) => depth(ch, tag) + (ch.tagName === tag ? 1 : 0)));
    const one = md(`${"- ".repeat(1000)}底`);
    expect(depth(one, "UL")).toBe(17);
    expect(one.textContent!.endsWith("- - 底")).toBe(true);
    const quotes = md(`${"> ".repeat(2000)}底`);
    expect(depth(quotes, "BLOCKQUOTE")).toBe(17);
    expect(quotes.textContent!.endsWith("> > 底")).toBe(true);
    const lines = md(Array.from({ length: 1000 }, (_, i) => `${"  ".repeat(i)}- 第${i}层`).join("\n"));
    expect(depth(lines, "UL")).toBe(17);
    expect(lines.textContent).toContain("第999层");
  });
  it("keeps a list item's text inline when it has no continuation", () => {
    const c = md("- 甲 **重点**\n- 乙");
    const li = c.querySelectorAll("li");
    expect(li[0].querySelector("p")).toBeNull();
    expect(li[0].querySelector("strong")?.textContent).toBe("重点");
  });
});
