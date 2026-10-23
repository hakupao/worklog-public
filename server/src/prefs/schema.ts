import { z } from "zod";
import D from "./defaults.json";

// Each trigger offers only the effects the spec lists for it (§6.1); ink "load" has no slide/roll/bleed.
const LED = ["flicker", "morph", "scan", "decode", "flap", "ripple", "roll", "none"] as const;
const INK_LOAD = ["rise", "type", "scan", "ripple", "fade", "none"] as const;
const INK_LANG = ["slide", "roll", "type", "bleed", "scan", "ripple", "fade", "none"] as const;
const INK_DATA = ["roll", "slide", "fade", "type", "bleed", "ripple", "none"] as const;

// Prediction (spec §7.3): four modes with their own windows, ten rules with on / weight / mode / params.
const RULE_MODES = ["morning", "focus", "weekly", "wrap", "all"] as const;
/** "HH:MM"; "00:00" as `to` means midnight. Same pattern as web/src/prefs/types.ts HM_RE. */
const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const P = D.predict;
const mode = (d: { from: string; to: string; days: number[] }) => z.object({
  from: HM.default(d.from),
  to: HM.default(d.to),
  days: z.array(z.number().int().min(1).max(7)).max(7)
    .refine((a) => new Set(a).size === a.length, "duplicate day").default(d.days),
}).default({});
const rule = <S extends z.ZodRawShape>(d: { on: boolean; weight: number; mode: string }, params: S) => z.object({
  on: z.boolean().default(d.on),
  weight: z.number().int().min(0).max(100).default(d.weight),
  mode: z.enum(RULE_MODES).default(d.mode as (typeof RULE_MODES)[number]),
  // `{} as never`: S is generic here, so TS cannot see that every param has its own default. At runtime a
  // ZodDefault parses `{}` through the inner object, which fills each param from its default.
  params: z.object(params).default({} as never),
}).default({} as never);
const R = P.rules;
const Predict = z.object({
  runningMin: z.number().int().min(1).max(120).default(P.runningMin),
  modes: z.object({
    morning: mode(P.modes.morning), focus: mode(P.modes.focus), weekly: mode(P.modes.weekly), wrap: mode(P.modes.wrap),
  }).default({}),
  rules: z.object({
    "unlinked.yesterday": rule(R["unlinked.yesterday"], {
      minMinutes: z.number().int().min(0).max(600).default(R["unlinked.yesterday"].params.minMinutes),
    }),
    "unlinked.stale": rule(R["unlinked.stale"], {
      minutes: z.number().int().min(1).max(1440).default(R["unlinked.stale"].params.minutes),
      minMinutes: z.number().int().min(0).max(600).default(R["unlinked.stale"].params.minMinutes),
    }),
    "week.unlinked": rule(R["week.unlinked"], {
      minMinutes: z.number().int().min(0).max(600).default(R["week.unlinked"].params.minMinutes),
    }),
    "dayplan.untouched": rule(R["dayplan.untouched"], {}),
    "plan.unplaced": rule(R["plan.unplaced"], {}),
    "report.undownloaded": rule(R["report.undownloaded"], {}),
    "dayplan.confirm": rule(R["dayplan.confirm"], {}),
    "task.waiting": rule(R["task.waiting"], {
      keywords: z.array(z.string().trim().min(1).max(20)).min(1).max(20).default(R["task.waiting"].params.keywords),
      days: z.number().int().min(1).max(7).default(R["task.waiting"].params.days),   // the snapshot holds two weeks (assumption 8)
    }),
    "plan.stale": rule(R["plan.stale"], {}),
    "nextweek.empty": rule(R["nextweek.empty"], {}),
  }).default({}),
}).default({});

const MMDD = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const VIEW_ID = z.string().regex(/^[a-z0-9]+$/).max(24);

/** PUT body: missing keys get defaults (a ZodDefault parses its default through the inner schema, so
 *  a partial nested object is filled leaf by leaf), unknown keys are stripped, illegal values fail. */
export const PrefsIn = z.object({
  lang: z.enum(["zh", "ja", "en"]).default(D.lang as "zh"),
  world: z.enum(["ura", "omote"]).default(D.world as "ura"),
  fx: z.object({
    load: z.enum(LED).default(D.fx.load as "flicker"),
    lang: z.enum(LED).default(D.fx.lang as "morph"),
    data: z.enum(LED).default(D.fx.data as "roll"),
  }).default({}),
  ofx: z.object({
    load: z.enum(INK_LOAD).default(D.ofx.load as "rise"),
    lang: z.enum(INK_LANG).default(D.ofx.lang as "slide"),
    data: z.enum(INK_DATA).default(D.ofx.data as "roll"),
  }).default({}),
  worldFx: z.enum(["scan", "ink", "flip", "print"]).default(D.worldFx as "scan"),
  // The desktop dock: sinks below the bottom edge until the pointer or keyboard focus reaches it, or stays up.
  dock: z.enum(["auto", "pin"]).default(D.dock as "auto"),
  speed: z.union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(1.5)]).default(D.speed as 1),
  omote: z.object({
    font: z.enum(["plex", "inter", "geist"]).default(D.omote.font as "plex"),
    // Module ids are "<page>.<module>" (e.g. now.cost); see web/src/world/modules.ts.
    hide: z.array(z.string().regex(/^[a-z]+\.[a-z]+$/).max(40)).max(64).default(D.omote.hide),
  }).default({}),
  predict: Predict,
  // 统计页视图 (U20). Ids are checked for shape only, not against an enum: a row naming a view a later
  // version removed must not send the whole prefs back to the defaults. The web resolves the list.
  stats: z.object({
    order: z.array(VIEW_ID).max(64).default(D.stats.order),
    off: z.array(VIEW_ID).max(64).default([]),
  }).default({}),
  // 週報 PDF (design 2026-10-08 §4.2): the 氏名 printed on the report.
  report: z.object({
    name: z.string().trim().min(1).max(60).default(D.report.name),
  }).default({}),
  // 此刻 calendar: payday and company breaks ("MM-DD"; to < from wraps over New Year).
  cal: z.object({
    payday: z.number().int().min(1).max(31).default(D.cal.payday),
    breaks: z.array(z.object({ name: z.string().trim().min(1).max(40), from: MMDD, to: MMDD })).max(20).default(D.cal.breaks),
  }).default({}),
});
export type Prefs = z.infer<typeof PrefsIn>;

/** A stored row is trusted only if it still validates; anything else (an older shape, a hand edit)
 *  reads as the defaults rather than failing the page. */
export function parseStoredPrefs(json: string | null | undefined): Prefs {
  if (json) {
    try {
      const r = PrefsIn.safeParse(JSON.parse(json));
      if (r.success) return r.data;
    } catch { /* fall through to defaults */ }
  }
  return PrefsIn.parse({});
}
