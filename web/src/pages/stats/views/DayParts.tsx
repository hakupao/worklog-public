import { useEffect, useRef, useState, type RefObject } from "react";
import { compactCount, usd } from "../../../lib/format";
import type { StrKey } from "../../../i18n/strings";
import { t } from "../../../i18n/t";
import { mdOf } from "../../../predict/time";
import { useV2 } from "../../../ui/context";
import { useHoverTask } from "../../../ui/hover";
import { Led } from "../../../ui/Led";
import { BADGE_H, TaskBadge } from "../../../ui/TaskBadge";
import { taskCode } from "../../now/format";
import { day5, weekdayOf } from "../viz/day";
import { stepDay, type DaySession } from "../viz/dayview";
import { hm, hmin } from "../viz/fmt";
import { tokensOf } from "../viz/headlines";
import { tv } from "../viz/strings";
import type { DayAgg } from "../viz/wall";

/** Tip header lead (B3 e1): the S badge + the code as text; nothing for no task. */
export function TipBadge({ id }: { id: string | null }) {
  if (!id) return null;
  return <><TaskBadge id={id} height={BADGE_H.tip} /><span className="tcode">{taskCode(id)}</span></>;
}

/** "9/21 一" */
export const dayLabel = (lang: Parameters<typeof t>[0], date: string) => `${mdOf(date)} ${t(lang, `tl.dow.${weekdayOf(date) + 1}` as StrKey)}`;

/** The opened day's keys (并行编队, 大圆表盘) — buttons, so the day is picked from the keyboard too: ◀ ▶ to the
 *  nearest day with sessions, 峰值日, and 今天 where given (`today` null = not in the range, disabled). */
export function DayKeys({ days, date, peak, today, onPick }: {
  days: readonly DayAgg[]; date: string; peak: string | null; today?: string | null; onPick: (date: string) => void;
}) {
  const { lang } = useV2();
  const prev = stepDay(days, date, -1), next = stepDay(days, date, 1);
  const key = (on: boolean) => `key${on ? " on" : " dim"}`;
  return (
    <div className="keys sv-days" role="group" aria-label={tv(lang, "day.pick")}>
      <button type="button" className="key dim" aria-label={tv(lang, "day.prev")} disabled={!prev} onClick={() => prev && onPick(prev)}><Led ui tier={2} fit text="◀" /></button>
      <Led ui size={12} tier={1} fit text={dayLabel(lang, date)} />
      <button type="button" className="key dim" aria-label={tv(lang, "day.next")} disabled={!next} onClick={() => next && onPick(next)}><Led ui tier={2} fit text="▶" /></button>
      <button type="button" className={key(date === peak)} aria-pressed={date === peak} disabled={!peak} onClick={() => peak && onPick(peak)}>
        <Led ui tier={1} fit text={tv(lang, "day.peak")} />
      </button>
      {today !== undefined && (
        <button type="button" className={key(date === today)} aria-pressed={date === today} disabled={!today} onClick={() => today && onPick(today)}>
          <Led ui tier={1} fit text={tv(lang, "day.today")} />
        </button>
      )}
    </div>
  );
}

/** A session under the pointer: its task, its span and minutes that day (`whole`: the session in the range — its
 *  first day, span and range minutes), turns, tokens, the amount only where amounts may show (`cost`), the summary
 *  and where it ran. */
export function SessionTip({ o, title, cost, whole = false }: { o: DaySession; title: string | undefined; cost: boolean; whole?: boolean }) {
  const { lang } = useV2(), s = o.s, tok = tokensOf(s);
  const main = [
    whole ? tv(lang, "sess.whole", { d: mdOf(day5(s.t0)), a: hm(s.t0), b: hm(s.t1), m: hmin(o.wall), n: s.turns })
      : tv(lang, "sess.main", { a: hm(s.t0), b: hm(s.t1), m: hmin(o.wall), n: s.turns }),
    tok === null ? "" : tv(lang, "sess.tok", { k: compactCount(tok) }),
    cost && s.cost_usd !== null ? usd(s.cost_usd) : "",
  ].filter(Boolean).join(" · ");
  return (
    <>
      <div className="h">
        <TipBadge id={s.task_id} />
        <span>{s.task_id ? title ?? s.task_id : t(lang, "tl.unlinked")}</span>
      </div>
      <div className="m">{main}</div>
      <div className="s"><span>{s.summary}</span>{s.summary ? " · " : ""}{s.machine} · {s.agent}</div>
    </>
  );
}

/** Whether the element is in the viewport; `fallback` where there is no IntersectionObserver (false for a view's one
 *  moving thing, so nothing moves in jsdom). */
export function useVisible(ref: RefObject<Element | null>, fallback = false): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => setOn(es[es.length - 1].isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return typeof IntersectionObserver === "undefined" ? fallback : on;
}

/** The page's hover task as a view's canvas draws it (R1): followed while the canvas is on screen, held while it is
 *  off — so a hover change does not redraw the views scrolled away — and caught up when it comes back. `ref` goes to
 *  the canvas (useCanvas' third argument). Always followed where there is no IntersectionObserver. */
export function useViewHover(): [string | null, RefObject<HTMLCanvasElement | null>] {
  const ref = useRef<HTMLCanvasElement>(null), on = useVisible(ref, true), hover = useHoverTask();
  const held = useRef(hover);
  if (on) held.current = hover;
  return [held.current, ref];
}
