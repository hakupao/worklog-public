import { useCallback, useMemo, useSyncExternalStore } from "react";
import { subscribeHash } from "../../lib/hash";
import { todayJst } from "../../lib/jst";
import { type Preset, PRESETS, rangeAt } from "./range";
import { jstDate } from "../../predict/time";
import { readQuery, replaceHash, withQuery } from "../../route";
import { useMinute } from "../now/useNowData";
import { isDate } from "../plan/state";

/** The 统计 page's address: `#/v2/stats?range=<day|week|month|4w|3m>&back=<n>` — the preset and how many of its
 *  ranges back (0 = the current one), on the old page's `rangeAt`. The defaults (4w, back 0) are not written; bad
 *  values fall back silently (range → 4w, back → 0), without touching the address bar. */
export interface StState { preset: Preset; back: number; from: string; to: string }
export interface StPatch { preset?: Preset; back?: number }

const DEFAULT: Preset = "4w";
const isPreset = (s: string | null): s is Preset => PRESETS.some((p) => p.key === s);

export function readSt(hash: string, now: Date = new Date()): StState {
  const q = readQuery(hash), today = todayJst(now), raw = q.get("range"), b = q.get("back") ?? "";
  const preset = isPreset(raw) ? raw : DEFAULT;
  let back = /^(0|[1-9]\d{0,4})$/.test(b) ? Number(b) : 0;
  let r = rangeAt(preset, back, today);
  // so far back that the year leaves four digits: not a range the server takes
  if (!isDate(r.from)) { back = 0; r = rangeAt(preset, 0, today); }
  return { preset, back, ...r };
}

/** The hash for a change; other keys (?world= / ?lang=) stay. Another preset starts at its current range. */
export function stHash(hash: string, p: StPatch, now: Date = new Date()): string {
  const cur = readSt(hash, now);
  const preset = p.preset ?? cur.preset;
  const back = p.back !== undefined ? Math.max(0, Math.floor(p.back)) : preset !== cur.preset ? 0 : cur.back;
  return withQuery(hash, { range: preset === DEFAULT ? null : preset, back: back === 0 ? null : String(back) }, "#/v2/stats");
}

export interface St {
  st: StState;
  /** Another preset, at its current range. Like ‹ ›, no history entry (the old page kept this in state). */
  setPreset: (preset: Preset) => void;
  setBack: (back: number) => void;
}

export function useSt(): St {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  // the ranges end today: re-read at 00:00 Tokyo too, not only when the address changes
  const today = jstDate(useMinute().getTime());
  const st = useMemo(() => readSt(hash), [hash, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const setPreset = useCallback((preset: Preset) => replaceHash(stHash(window.location.hash, { preset, back: 0 })), []);
  const setBack = useCallback((back: number) => replaceHash(stHash(window.location.hash, { back })), []);
  return useMemo(() => ({ st, setPreset, setBack }), [st, setPreset, setBack]);
}
