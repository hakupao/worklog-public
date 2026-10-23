import { DEFAULT_PREFS } from "./defaults";
import {
  DOCK_OPTIONS, FONT_OPTIONS, HM_RE, INK_FX_OPTIONS, LANGS, LED_FX_OPTIONS, MMDD_RE, MODE_IDS, RULE_IDS, SPEED_OPTIONS, WORLD_FX_OPTIONS,
  type Break, type ModeCfg, type PredictPrefs, type Prefs, type RuleCfg, type RuleParams, type Trigger,
} from "./types";

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const int = (v: unknown, lo: number, hi: number, fallback: number) =>
  (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
const TRIGGERS: Trigger[] = ["load", "lang", "data"];

function normMode(x: unknown, d: ModeCfg): ModeCfg {
  const o = obj(x);
  const days = Array.isArray(o.days) && o.days.length <= 7 && new Set(o.days).size === o.days.length
    && o.days.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 7) ? (o.days as number[]) : [...d.days];
  return {
    from: typeof o.from === "string" && HM_RE.test(o.from) ? o.from : d.from,
    to: typeof o.to === "string" && HM_RE.test(o.to) ? o.to : d.to,
    days,
  };
}
/** Only the params the default declares survive; each one falls back on its own. */
function normParams(x: unknown, d: RuleParams): RuleParams {
  const p = obj(x), out: RuleParams = {};
  if (d.minMinutes !== undefined) out.minMinutes = int(p.minMinutes, 0, 600, d.minMinutes);
  if (d.minutes !== undefined) out.minutes = int(p.minutes, 1, 1440, d.minutes);
  if (d.days !== undefined) out.days = int(p.days, 1, 7, d.days);       // two weeks of data (assumption 8)
  if (d.keywords !== undefined) {
    const k = p.keywords;
    const ok = Array.isArray(k) && k.length >= 1 && k.length <= 20
      && k.every((s) => typeof s === "string" && s.trim().length >= 1 && s.trim().length <= 20);
    out.keywords = ok ? (k as string[]).map((s) => s.trim()) : [...d.keywords];
  }
  return out;
}
function normRule(x: unknown, d: RuleCfg): RuleCfg {
  const o = obj(x);
  return {
    on: typeof o.on === "boolean" ? o.on : d.on,
    weight: int(o.weight, 0, 100, d.weight),
    mode: pick(o.mode, [...MODE_IDS, "all"] as const, d.mode),
    params: normParams(o.params, d.params),
  };
}
function normPredict(x: unknown): PredictPrefs {
  const o = obj(x), m = obj(o.modes), r = obj(o.rules), D = DEFAULT_PREFS.predict;
  return {
    runningMin: int(o.runningMin, 1, 120, D.runningMin),
    modes: Object.fromEntries(MODE_IDS.map((id) => [id, normMode(m[id], D.modes[id])])) as PredictPrefs["modes"],
    rules: Object.fromEntries(RULE_IDS.map((id) => [id, normRule(r[id], D.rules[id])])) as PredictPrefs["rules"],
  };
}

/** Ids of the server's shape only (prefs/schema.ts VIEW_ID: a–z0–9, at most 24, at most 64 of them — anything else
 *  would make every later save a 400); unknown ids are kept here and dropped where they are read (statsViews.ts
 *  resolveViews). */
function normStats(x: unknown): Prefs["stats"] {
  const o = obj(x), D = DEFAULT_PREFS.stats;
  const strs = (v: unknown, d: string[]) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && /^[a-z0-9]{1,24}$/.test(s)).slice(0, 64) : [...d]);
  return { order: strs(o.order, D.order), off: strs(o.off, D.off) };
}

function normReport(x: unknown): Prefs["report"] {
  const n = obj(x).name, t = typeof n === "string" ? n.trim() : "";
  return { name: t.length >= 1 && t.length <= 60 ? t : DEFAULT_PREFS.report.name };
}

/** Payday falls back alone; a breaks list that is not an array falls back to the defaults, otherwise only the
 *  valid entries survive (an empty list is a real choice). Same bounds as the server's schema. */
function normCal(x: unknown): Prefs["cal"] {
  const o = obj(x), D = DEFAULT_PREFS.cal;
  const breaks = Array.isArray(o.breaks)
    ? o.breaks.flatMap((b): Break[] => {
      const e = obj(b), name = typeof e.name === "string" ? e.name.trim() : "";
      const ok = name.length >= 1 && name.length <= 40 && typeof e.from === "string" && MMDD_RE.test(e.from)
        && typeof e.to === "string" && MMDD_RE.test(e.to);
      return ok ? [{ name, from: e.from as string, to: e.to as string }] : [];
    }).slice(0, 20)
    : D.breaks.map((b) => ({ ...b }));
  return { payday: int(o.payday, 1, 31, D.payday), breaks };
}

/** Lenient: whatever came out of localStorage, return a whole valid Prefs, field by field. */
export function normalizePrefs(x: unknown): Prefs {
  const o = obj(x), fx = obj(o.fx), ofx = obj(o.ofx), om = obj(o.omote), D = DEFAULT_PREFS;
  return {
    lang: pick(o.lang, LANGS, D.lang),
    world: pick(o.world, ["ura", "omote"] as const, D.world),
    fx: Object.fromEntries(TRIGGERS.map((k) => [k, pick(fx[k], LED_FX_OPTIONS[k], D.fx[k])])) as Prefs["fx"],
    ofx: Object.fromEntries(TRIGGERS.map((k) => [k, pick(ofx[k], INK_FX_OPTIONS[k], D.ofx[k])])) as Prefs["ofx"],
    worldFx: pick(o.worldFx, WORLD_FX_OPTIONS, D.worldFx),
    dock: pick(o.dock, DOCK_OPTIONS, D.dock),
    speed: pick(o.speed, SPEED_OPTIONS, D.speed),
    omote: {
      font: pick(om.font, FONT_OPTIONS, D.omote.font),
      hide: Array.isArray(om.hide) ? om.hide.filter((h): h is string => typeof h === "string" && /^[a-z]+\.[a-z]+$/.test(h)) : [...D.omote.hide],
    },
    predict: normPredict(o.predict),
    stats: normStats(o.stats),
    report: normReport(o.report),
    cal: normCal(o.cal),
  };
}
