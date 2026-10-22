import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import type { Lang } from "../../prefs/types";
import { unplacedPlanItems } from "../../predict/rules";
import type { Snapshot } from "../../predict/snapshot";
import { useV2 } from "../../ui/context";
import { Led, type LedSeg } from "../../ui/Led";
import { lineColor } from "../../ui/palette";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { useTip } from "../../ui/TipHost";
import { elapsed, taskCode } from "./format";
import { MAX_PLAN_ROWS, planRows, shownPlanRows, type PlanRow } from "./plan";

/** The row's lamp: green done, amber partly, unlit not yet (the board's lamp grammar; the pixel font has no ✓). */
const LAMP = { done: "live", partial: "amber", none: "" } as const;

/** 今日安排: one board row per item — mark, code, item, today's time on its tasks, the AI's progress. */
export function PlanRows({ snap }: { snap: Snapshot }) {
  const { lang } = useV2();
  const dp = snap.dayPlan, rows = planRows(snap);
  const done = rows.filter((r) => r.status === "done").length;
  const head = rows.length ? `${t(lang, "mod.now.plan")} ${t(lang, "now.plan.done", { a: done, b: rows.length })}` : t(lang, "mod.now.plan");
  const empty = !dp ? t(lang, "now.plan.notStarted", { n: unplacedPlanItems(snap).length }) : rows.length === 0 ? t(lang, "now.plan.empty") : null;
  // The rows that fit (T10 F2): the box is the column's flexible part; it always holds the first four rows, so its
  // height is what the column leaves and does not depend on how many are shown. Rows that do not fit whole stay in the
  // layout unseen, and 还有 N 条 counts every row not shown.
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ boxH: 0, rowH: 0 });
  const n = rows.length, firstId = rows[0]?.id;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const row = el.querySelector(".row.prow");
    const read = () => {
      const boxH = el.getBoundingClientRect().height, rowH = row ? row.getBoundingClientRect().height : 0;
      setFit((p) => (p.boxH === boxH && p.rowH === rowH ? p : { boxH, rowH }));
    };
    read();
    if (typeof ResizeObserver !== "function") return;
    // the first row too: a row-height change (language, font) without a box resize must re-measure
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (row) ro.observe(row);
    return () => ro.disconnect();
  }, [n, empty, firstId]);
  const shown = empty !== null ? 0 : shownPlanRows(n, fit.boxH, fit.rowH), more = n - shown;
  return (
    <div className="plan">
      <div className="sec"><Led ui size={12} tier={2} fit text={head} /></div>
      <div className="plan-rows" ref={box}>
        {empty !== null
          ? <div className="row prow empty"><span className="nm"><Led ui tier={3} clip className="fill" text={empty} /></span></div>
          : rows.slice(0, MAX_PLAN_ROWS).map((r, i) => <PlanItemRow key={r.id} r={r} unseen={i >= shown} />)}
      </div>
      {/* outside the rows box, so the column's next hairline never slices it (T10 verdict 9a) */}
      {empty === null && more > 0 && <div className="row prow more"><span className="nm"><Led ui tier={3} fit text={t(lang, "now.plan.more", { n: more })} /></span></div>}
    </div>
  );
}

export function progressText(lang: Lang, r: PlanRow): string {
  const p = r.progress;
  if (p.kind === "ai") return t(lang, "now.plan.ai", { s: p.text });
  if (p.kind === "manual" || p.kind === "judged") return t(lang, `now.plan.${p.kind}`, { s: t(lang, `now.plan.st.${p.status}` as StrKey) });
  return t(lang, `now.plan.${p.kind}` as StrKey);
}

function PlanItemRow({ r, unseen }: { r: PlanRow; unseen: boolean }) {
  const { lang } = useV2(), setTip = useTip();
  // a refetch that changes this row under a still mouse: the tip showed the old numbers (sub3 review A)
  const sig = `${r.minutes}|${r.status}|${JSON.stringify(r.progress)}|${r.note}|${r.text}`;   // primitives: rows are rebuilt each render
  useEffect(() => { setTip(null); }, [sig, setTip]);
  const k = r.taskIds[0], lc = lineColor(k ?? null);
  const prog = progressText(lang, r);
  // the AI's words are data (JP glyphs); the fallback sentences are interface text
  const progSegs: LedSeg[] = r.progress.kind === "ai" ? [{ t: t(lang, "now.plan.aiLabel") }, { t: r.progress.text }]
    : [{ t: prog, kind: r.progress.kind === "manual" || r.progress.kind === "judged" ? undefined : "dim" }];
  const body = (
    <>
      <div className="h">
        {k && <><TaskBadge id={k} height={BADGE_H.tip} /><span className="code" style={{ "--lc": lc } as CSSProperties}>{taskCode(k)}</span></>}
        <span>{r.text}</span>
      </div>
      <div className="m">{t(lang, `now.plan.st.${r.status}` as StrKey)} · {t(lang, "now.plan.today", { t: r.minutes ? elapsed(r.minutes * 60_000) : "--" })}</div>
      <div className="s">{prog}</div>
      {r.detail && <div className="s">{r.detail}</div>}
      {r.note && <div className="s">{r.note}</div>}
    </>
  );
  return (
    <div className={`row prow${unseen ? " unseen" : ""}`} aria-hidden={unseen || undefined} data-task={k} data-status={r.status} style={{ "--lc": k ? lc : "transparent" } as CSSProperties}
      onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, body })} onPointerLeave={() => setTip(null)}>
      <span className="mk"><span className={LAMP[r.status] ? `lamp ${LAMP[r.status]}` : "lamp"} /><span className="v2-sr">{t(lang, `now.plan.st.${r.status}` as StrKey)}</span></span>
      {k ? <TaskBadge id={k} height={BADGE_H.row} /> : <Led tier={1} fit text={[{ t: taskCode(null), kind: "dim" }]} />}
      <span className="nm"><Led tier={1} clip className="fill" task={k} text={r.text} /></span>
      <span className="end"><Led tier={2} fit text={r.minutes ? elapsed(r.minutes * 60_000) : "--"} /></span>
      <span className="nm"><Led ui tier={2} clip className="fill" text={progSegs} /></span>
    </div>
  );
}
