import { cloneElement, isValidElement, useState, type ReactNode } from "react";
import type { Review } from "../../api/types";
import { Markdown } from "../../lib/markdown";
import { t } from "../../i18n/t";
import { useV2 } from "../../ui/context";
import { Led } from "../../ui/Led";
import { C } from "../../ui/palette";
import { Failure } from "./parts";
import type { StatsData } from "./useStatsData";

/** A figure in the prose: an amount, a number with its unit (%, h, K / M / B, 分钟 …), or a bare number — not one
 *  inside a latin word or code (W40, claude-opus-4), and never a sentence's closing point. An ISO date or week
 *  (2026-10-05, 2026-10, 2026-W40), a clock time (09:30) or a short date (10/5) is matched first (group 1) and left
 *  unlit, so none of its parts reads as a figure. */
const FIG = /(?<![A-Za-z\d])(\d{4}-(?:W\d{2}|\d{2}(?:-\d{2})?)(?![\d-])|\d{1,2}[/:]\d{1,2}(?![\d/:]))|(?<![A-Za-z\d.,$])(?<![A-Za-z]-)\$?\d+(?:[.,]\d+)*(?:\s?(?:%|分钟|小时|个|天|次|亿|万|[KMB](?![A-Za-z])|h(?![A-Za-z])))?/g;

function litText(s: string): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of s.matchAll(FIG)) {
    if (m[1]) continue;                    // a date: stays in the plain text around it
    if (m.index > at) out.push(s.slice(at, m.index));
    out.push(<span key={m.index} className="n">{m[0]}</span>);
    at = m.index + m[0].length;
  }
  if (!out.length) return s;
  if (at < s.length) out.push(s.slice(at));
  return out;
}

/** The figures of rendered prose lit (prototype .rv .n): a pass over the React nodes' text, so markup in the text
 *  stays text (never a regex over HTML); code is left as written. */
export function lit(node: ReactNode): ReactNode {
  if (typeof node === "string") return litText(node);
  if (Array.isArray(node)) return node.map(lit);
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const c = node.props.children;
    if (node.type === "code" || node.type === "pre" || c === undefined) return node;
    // children given as JSX siblings (a table's thead + tbody) go back as siblings: as one array React wants keys
    return Array.isArray(c) ? cloneElement(node, undefined, ...c.map(lit)) : cloneElement(node, undefined, lit(c));
  }
  return node;
}

/** A row the section can show (the server's answer is not trusted to be the expected shape). */
const usable = (r: Review) => typeof r?.week === "string" && typeof r.text === "string";
/** model · machine · YYYY-MM-DD HH:MM UTC, each part only when the row has it. */
const meta = (r: Review) => [
  typeof r.model === "string" && r.model, typeof r.machine === "string" && r.machine,
  typeof r.generated_at === "string" && r.generated_at && `${r.generated_at.slice(0, 16).replace("T", " ")} UTC`,
].filter(Boolean).join(" · ");

/** 周复盘 (the `review` view; its frame carries the title): a key per week (newest first and pressed by default; a picked week
 *  that a refresh drops falls back to the newest), the review set as type in two columns with its figures lit
 *  (the hybrid: LED head, typeset prose — the text is the model's Chinese), the model · machine · time line. It
 *  loads and fails on its own. */
export function ReviewSec({ data }: { data: StatsData }) {
  const { lang } = useV2();
  const [week, setWeek] = useState<string | null>(null);
  const list = (data.reviews ?? []).filter(usable);
  const r = list.find((x) => x.week === week) ?? list[0];
  const [before, after] = t(lang, "st.rv.none").split("{cmd}");
  return (
    <div className="st-rvs">
      <div className="st-sh">
        {list.length > 0 && (
          <div className="keys" role="group" aria-label={t(lang, "st.rv.week")}>
            {list.map((x) => (
              <button key={x.week} type="button" className={`key${x === r ? " on" : " dim"}`} aria-pressed={x === r} onClick={() => setWeek(x.week)}>
                <Led ui tier={1} fit color={C.AMBER} text={x.week.replace(/^\d{4}-/, "")} />
              </button>
            ))}
          </div>
        )}
        <span className="grow" />
        {r && meta(r) && <Led ui tier={3} fit color={C.DIM} text={meta(r)} />}
      </div>
      {data.reviewsError !== null && <Failure err={data.reviewsError} retry={data.refetchReviews} className="st-fail" text="st.rv.failed" />}
      {r ? <div className="st-rv two">{lit(Markdown({ text: r.text }))}</div>
        : data.reviewsLoading ? <div className="st-wait" role="status"><Led ui tier={2} fit text={t(lang, "now.loading")} /></div>
        : data.reviewsError === null && <p className="st-rv-none">{before}<code>uv run wl review</code>{after}</p>}
    </div>
  );
}
