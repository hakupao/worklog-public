import { useEffect, useMemo, useRef, useState } from "react";
import { useTasks, useTaskTotals } from "../../api/queries";
import type { TaskStatus } from "../../api/types";
import type { StrKey } from "../../i18n/strings";
import { t } from "../../i18n/t";
import { mdOf } from "../../predict/time";
import { replaceHash } from "../../route";
import { useV2 } from "../../ui/context";
import { BADGE_H, TaskBadge } from "../../ui/TaskBadge";
import { hours1 } from "../format";
import { mHref, type MRoute } from "../route";
import { DotBar } from "../ui/dots";
import { Seg } from "../ui/Seg";
import { Empty, ErrorState, Loading } from "../ui/State";
import { TaskSheet } from "./TaskSheet";

const FILTERS: (TaskStatus | "all")[] = ["open", "hold", "done", "all"];

/** 案件 (spec §5): search + status filter (local), most recently worked first; a task opens in a sheet (#/m/tasks/<id>). */
export function Tasks({ route }: { route: MRoute }) {
  const { lang } = useV2();
  const list = useTasks();
  const totals = useTaskTotals();
  const openedHere = useRef(false);
  useEffect(() => { if (!route.param) openedHere.current = false; }, [route.param]);
  const [q, setQ] = useState("");
  const [st, setSt] = useState<TaskStatus | "all">("open");
  const tot = useMemo(() => new Map((totals.data ?? []).map((x) => [x.id, x])), [totals.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data ?? [])
      .filter((x) => (st === "all" || x.status === st) && (!needle || x.title.toLowerCase().includes(needle) || x.requester.toLowerCase().includes(needle)))
      .sort((a, b) => (tot.get(b.id)?.last_date ?? "").localeCompare(tot.get(a.id)?.last_date ?? "") || a.title.localeCompare(b.title));
  }, [list.data, q, st, tot]);
  const max = Math.max(1, ...rows.map((x) => tot.get(x.id)?.total_minutes ?? 0));

  let body;
  if (list.error && !list.data) body = <ErrorState onRetry={() => void list.refetch()} />;
  else if (!list.data) body = <Loading rows={6} />;
  else if (rows.length === 0) body = <section className="m-grp"><Empty>{t(lang, "m.tasks.empty")}</Empty></section>;
  else body = (
    <section className="m-grp">
      {rows.map((x) => {
        const total = tot.get(x.id)?.total_minutes ?? 0, last = tot.get(x.id)?.last_date;
        return (
          <button key={x.id} type="button" className="m-row m-row-wrap" onClick={() => { openedHere.current = true; window.location.hash = mHref("tasks", x.id); }}>
            <TaskBadge id={x.id} height={BADGE_H.mRow} />
            <span className="m-col"><span className="m-t1">{x.title}</span><span className="m-t2">{x.requester}{last ? ` · ${t(lang, "m.tasks.last", { d: mdOf(last) })}` : ""}</span></span>
            <span className="m-side">{hours1(total)}{t(lang, "m.unit.h")}</span>
            <span className="m-chev">›</span>
            <DotBar value={total} max={max} />
          </button>
        );
      })}
    </section>
  );

  return (
    <div className="m-stack">
      <input type="search" className="m-input" value={q} placeholder={t(lang, "m.tasks.search")} aria-label={t(lang, "m.tasks.search")} onChange={(e) => setQ(e.target.value)} />
      <Seg label={t(lang, "m.tasks.filter")} value={st} options={FILTERS.map((f) => [f, t(lang, `m.tasks.st.${f}` as StrKey)])} onChange={setSt} />
      {body}
      {route.param && <TaskSheet key={route.param} id={route.param} onClose={() => {
        if (openedHere.current) { openedHere.current = false; window.history.back(); } else replaceHash(mHref("tasks"));
      }} />}
    </div>
  );
}
