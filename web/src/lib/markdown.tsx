import { Fragment, type ReactNode } from "react";

/** A deliberately small Markdown subset, shared by model-written text (the weekly review) and the
 *  help page (docs/guide/usage.md): headings, block quotes, lists (items may hold indented
 *  paragraphs, code blocks and lists), pipe tables, fenced code, paragraphs, **bold**, `code`,
 *  <https://…> and [text](url) links (https:// and in-app #/ only). Everything else — HTML included —
 *  stays literal text: the output is built from React elements only, never from an HTML string. */
type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: Block[][] }
  | { kind: "p"; lines: string[] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

/** A backtick fence's info string may not hold a backtick (CommonMark), so a lone "```x```" line is a paragraph. */
const FENCE = /^(\s*)(`{3,}(?!.*`)|~{3,})/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const ITEM = /^(\s*)([-*]|\d+[.)])(\s+)(.*)$/;
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Lists and quotes nest at most this deep; deeper lines are a plain paragraph, so model-written text nested a
 *  thousand levels renders instead of overflowing the stack. */
const MAX_DEPTH = 16;

const indentOf = (line: string) => /^\s*/.exec(line)![0].length;

/** `| a | b |` → ["a", "b"]; `\|` is a literal pipe (also inside code), not a cell boundary. */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function blocks(text: string, depth = 0): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  if (depth > MAX_DEPTH) { const rest = lines.filter((l) => l.trim()); return rest.length ? [{ kind: "p", lines: rest }] : []; }
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ kind: "p", lines: para }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const [, pad, mark] = fence;
      const close = new RegExp(`^\\s*${mark[0]}{${mark.length},}$`);
      const body: string[] = [];
      // An unclosed fence runs to the end, as in CommonMark.
      while (++i < lines.length && !close.test(lines[i])) {
        body.push(lines[i].slice(Math.min(pad.length, indentOf(lines[i]))));
      }
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: "h", level: h[1].length, text: h[2] }); continue; }

    if (QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) inner.push(QUOTE.exec(lines[i])![1]);
      i--;
      out.push({ kind: "quote", blocks: blocks(inner.join("\n"), depth + 1) });
      continue;
    }

    if (line.trimStart().startsWith("|") && i + 1 < lines.length && DELIMITER_ROW.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trimStart().startsWith("|"); i++) {
        const row = cells(lines[i]).slice(0, head.length);
        rows.push([...row, ...Array<string>(head.length - row.length).fill("")]);
      }
      i--;
      out.push({ kind: "table", head, rows });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      flush();
      const kind = /\d/.test(item[2]) ? "ol" as const : "ul" as const;
      // Lines indented to the item's text column belong to the item, blank lines between them too.
      const col = item[1].length + item[2].length + item[3].length;
      const body = [item[4]];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() && indentOf(lines[j]) < col) break;
        if (!lines[j].trim()) {
          const next = lines.slice(j + 1).find((l) => l.trim());
          if (!next || indentOf(next) < col) break;
        }
        body.push(lines[j].slice(Math.min(col, indentOf(lines[j]))));
        i = j;
      }
      const last = out[out.length - 1];
      const itemBlocks = blocks(body.join("\n"), depth + 1);
      if (last && last.kind === kind) last.items.push(itemBlocks);
      else out.push({ kind, items: [itemBlocks] });
      continue;
    }

    para.push(line);
  }
  flush();
  return out;
}

const SAFE_HREF = /^(https:\/\/|#\/)/;

function link(href: string, text: ReactNode, key: number) {
  return href.startsWith("#/")
    ? <a key={key} href={href}>{text}</a>
    : <a key={key} href={href} target="_blank" rel="noreferrer">{text}</a>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|<(https:\/\/[^\s<>]+)>|\[([^\]]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) out.push(<code key={m.index}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={m.index}>{inline(m[2])}</strong>);
    else if (m[3] !== undefined) out.push(link(m[3], m[3], m.index));
    else if (SAFE_HREF.test(m[5])) out.push(link(m[5], inline(m[4]), m.index));
    else out.push(m[0]);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const lineBreaks = (lines: string[]) =>
  lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>);

/** The heading's text as a screen reader would read it, for naming the table under it. */
const plain = (text: string) => text.replace(/`|\*\*/g, "");

function render(list: Block[], page: boolean, heading = ""): ReactNode[] {
  return list.map((b, k) => {
    if (b.kind === "h") {
      heading = plain(b.text);
      const H = (page ? `h${b.level}` : b.level <= 2 ? "h3" : "h4") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <H key={k}>{inline(b.text)}</H>;
    }
    if ("items" in b) {
      const L = b.kind;
      return (
        <L key={k}>
          {b.items.map((item, j) => {
            // A single-paragraph item stays inline text; the rest of its blocks follow it.
            const [first, ...rest] = item;
            const lead = first?.kind === "p" ? lineBreaks(first.lines) : null;
            return <li key={j}>{lead}{render(lead ? rest : item, page, heading)}</li>;
          })}
        </L>
      );
    }
    if (b.kind === "quote") return <blockquote key={k}>{render(b.blocks, page, heading)}</blockquote>;
    if (b.kind === "code") return <pre key={k}><code>{b.text}</code></pre>;
    if (b.kind === "table") {
      return (
        // Wide tables scroll inside their own box; a scroll box only a mouse can reach would trap
        // keyboard users, so it is a focusable, named region.
        <div key={k} role="region" tabIndex={0} aria-label={heading || undefined}>
          <table>
            <thead><tr>{b.head.map((c, j) => <th key={j} scope="col">{inline(c)}</th>)}</tr></thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => j === 0
                    ? <th key={j} scope="row">{inline(c)}</th>
                    : <td key={j}>{inline(c)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <p key={k}>{lineBreaks(b.lines)}</p>;
  });
}

/** `page` renders headings at their own level (a whole page, e.g. the help page); by default they
 *  nest below the host page's h2 (# and ## → h3, deeper → h4), as the weekly review needs. */
export function Markdown({ text, page = false }: { text: string; page?: boolean }) {
  return <>{render(blocks(text), page)}</>;
}
