import { createContext, useContext } from "react";
import type { StatsPlan, StatsSessions, Task } from "../../api/types";
import { perDay, prepare, segments, type DayAgg, type Prepared, type Seg } from "./viz/wall";

/** What every new view derives from (brief assumption 5): the range's sessions cut to its 5:00 window, their
 *  concurrency segments and day rows — computed once in Views — the range's day-plan items, the task table by id,
 *  and whether amounts may show (`cost` = stats.cost not hidden). */
export interface Viz { prep: Prepared; segs: Seg[]; days: DayAgg[]; plans: StatsPlan[]; tasks: ReadonlyMap<string, Task>; cost: boolean }

/** The session part, memoised on the sessions alone (a world switch flips `cost` but keeps `prep`, so the views'
 *  own useMemo on it holds). */
export function vizBase(d: StatsSessions): Pick<Viz, "prep" | "segs" | "days" | "plans"> {
  const prep = prepare(d);
  return { prep, segs: segments(prep), days: perDay(prep), plans: d.plans };
}

export const taskMap = (tasks: Task[] | undefined): ReadonlyMap<string, Task> => new Map((tasks ?? []).map((x) => [x.id, x]));

export const VizCtx = createContext<Viz | null>(null);

/** A view's data; only views rendered by Views (which waits for the sessions) call it. */
export function useViz(): Viz {
  const v = useContext(VizCtx);
  if (!v) throw new Error("useViz outside the stats views");
  return v;
}
