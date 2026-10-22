import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Tip, type TipState } from "./Tip";

interface TipApi { set: (owner: object, t: TipState | null) => void; drop: (owner: object) => void }
const Ctx = createContext<TipApi>({ set: () => {}, drop: () => {} });

/** The page's one tooltip (one persistent .tip: applyGlass caches a filter per element). Every caller of
 *  useTip() owns what it shows: when that caller unmounts while its content is up — a row replaced by a
 *  refetch under a still mouse gets no pointerleave — the tip goes away with it instead of going stale. */
export function TipHost({ children }: { children: ReactNode }) {
  const [cur, setCur] = useState<{ owner: object; tip: TipState } | null>(null);
  const api = useMemo<TipApi>(() => ({
    set: (owner, tip) => setCur((c) => (tip ? { owner, tip } : c && c.owner !== owner ? c : null)),
    drop: (owner) => setCur((c) => (c && c.owner === owner ? null : c)),
  }), []);
  return <Ctx.Provider value={api}>{children}<Tip tip={cur?.tip ?? null} /></Ctx.Provider>;
}

/** This component's tip setter. Clearing (null) only clears what this component itself put up. */
export function useTip(): (t: TipState | null) => void {
  const api = useContext(Ctx), me = useRef({});
  useEffect(() => { const owner = me.current; return () => api.drop(owner); }, [api]);
  return useCallback((t: TipState | null) => api.set(me.current, t), [api]);
}
