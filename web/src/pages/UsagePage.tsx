import { useRef } from "react";
import usage from "../../../docs/guide/usage.md?raw";
import { Markdown } from "../lib/markdown";
import { t } from "../i18n/t";
import { useV2 } from "../ui/context";
import { Led } from "../ui/Led";

/** The guide without its `# ` title line (the header's dot-matrix page name is this page's title), and one chapter
 *  key per `## ` heading as the renderer names it (no code / bold marks). Line endings are normalised first: a
 *  Windows checkout (autocrlf) has CRLF. */
export function guideParts(md: string): { body: string; chapters: string[] } {
  const body = md.replace(/\r\n?/g, "\n").replace(/^# .*\n+/, "");
  return { body, chapters: body.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3).replace(/`|\*\*/g, "")) };
}
const { body, chapters } = guideParts(usage);

/** 说明 (spec §3.1, user rulings U2 / U9): docs/guide/usage.md itself, set as prose in Chinese, with a row of keys
 *  that jump to its chapters. The keys are buttons, not #fragment links: the hash is the app's route. */
export function UsagePage() {
  const { lang } = useV2();
  const doc = useRef<HTMLElement>(null);
  const jump = (i: number) => {
    const h = doc.current?.querySelectorAll<HTMLElement>("h2")[i];
    if (!h) return;
    h.scrollIntoView?.({ block: "start" });
    h.tabIndex = -1;                       // focusable from script only: the reader continues from the chapter
    h.focus({ preventScroll: true });
  };
  return (
    <div className="us">
      <nav className="us-toc" aria-label={t(lang, "us.toc")}>
        {chapters.map((c, i) => (
          <button key={c} type="button" className="key dim" onClick={() => jump(i)}>
            <Led ui tier={2} clip className="fill" text={[{ t: c, glyph: "zh" }]} />
          </button>
        ))}
      </nav>
      <div className="us-main">
        {lang !== "zh" && <p className="us-note">{t(lang, "us.zhOnly")}</p>}
        <article ref={doc} className="us-doc" lang="zh-CN">
          <Markdown text={body} page />
        </article>
      </div>
    </div>
  );
}
