export type Lang = "zh" | "ja" | "en";
/** Which pixel-font cut draws a string: Japanese kanji shapes or Simplified Chinese ones. */
export type Glyph = "zh" | "ja";
export type World = "ura" | "omote";
export type Trigger = "load" | "lang" | "data";
export type LedFx = "flicker" | "morph" | "scan" | "decode" | "flap" | "ripple" | "roll" | "none";
export type InkFx = "rise" | "type" | "scan" | "fade" | "ripple" | "slide" | "roll" | "bleed" | "none";
export type WorldFx = "scan" | "ink" | "flip" | "print";
/** The desktop dock: "auto" sinks below the bottom edge until reached, "pin" always stays up. */
export type DockMode = "auto" | "pin";
export type Speed = 0.25 | 0.5 | 1 | 1.5;
export type FontChoice = "plex" | "inter" | "geist";
export type ModeId = "morning" | "focus" | "weekly" | "wrap";
export type RuleId =
  | "unlinked.yesterday" | "unlinked.stale" | "week.unlinked" | "dayplan.untouched" | "plan.unplaced"
  | "report.undownloaded" | "dayplan.confirm" | "task.waiting" | "plan.stale" | "nextweek.empty";
/** "HH:MM"; `to` = "00:00" runs to midnight, `from === to` is the whole day. days: ISO weekdays, 1 = Monday. */
export interface ModeCfg { from: string; to: string; days: number[] }
/** Only the keys a rule declares in the defaults are kept (see normalize.ts). */
export interface RuleParams { minMinutes?: number; minutes?: number; keywords?: string[]; days?: number }
export interface RuleCfg { on: boolean; weight: number; mode: ModeId | "all"; params: RuleParams }
export interface PredictPrefs { runningMin: number; modes: Record<ModeId, ModeCfg>; rules: Record<RuleId, RuleCfg> }

/** from / to are "MM-DD"; to < from means the break wraps over New Year. */
export type Break = { name: string; from: string; to: string };
export type CalCfg = { payday: number; breaks: Break[] };
/** Same pattern as server/src/prefs/schema.ts MMDD. */
export const MMDD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface Prefs {
  lang: Lang;
  world: World;
  fx: Record<Trigger, LedFx>;
  ofx: Record<Trigger, InkFx>;
  worldFx: WorldFx;
  dock: DockMode;
  speed: Speed;
  omote: { font: FontChoice; hide: string[] };
  predict: PredictPrefs;
  /** 统计页视图 (U20): `order` = view ids in display order, `off` = the ones turned off. Plain strings, not
   *  StatsView: stored rows may hold ids a later version dropped; prefs/statsViews.ts resolveViews reads them. */
  stats: { order: string[]; off: string[] };
  /** 週報 PDF 的 氏名 (S3). */
  report: { name: string };
  /** 営業日 calendar (payday, company breaks) for the 此刻 page. */
  cal: CalCfg;
}

export const LANGS: Lang[] = ["zh", "ja", "en"];
/** Per trigger, in the order the settings page lists them (spec §6.1; the default first). */
export const LED_FX_OPTIONS: Record<Trigger, LedFx[]> = {
  load: ["flicker", "scan", "decode", "ripple", "morph", "flap", "roll", "none"],
  lang: ["morph", "flicker", "scan", "decode", "flap", "ripple", "roll", "none"],
  data: ["roll", "morph", "flap", "decode", "scan", "ripple", "flicker", "none"],
};
export const INK_FX_OPTIONS: Record<Trigger, InkFx[]> = {
  load: ["rise", "type", "scan", "ripple", "fade", "none"],
  lang: ["slide", "roll", "type", "bleed", "scan", "ripple", "fade", "none"],
  data: ["roll", "slide", "fade", "type", "bleed", "ripple", "none"],
};
export const WORLD_FX_OPTIONS: WorldFx[] = ["scan", "ink", "flip", "print"];
export const DOCK_OPTIONS: DockMode[] = ["auto", "pin"];
export const SPEED_OPTIONS: Speed[] = [0.25, 0.5, 1, 1.5];
export const FONT_OPTIONS: FontChoice[] = ["plex", "inter", "geist"];
export const MODE_IDS: ModeId[] = ["morning", "focus", "weekly", "wrap"];
/** Default weight order (highest first); also the tie-break order when two suggestions score the same. */
export const RULE_IDS: RuleId[] = [
  "unlinked.yesterday", "unlinked.stale", "week.unlinked", "dayplan.untouched", "plan.unplaced",
  "report.undownloaded", "dayplan.confirm", "task.waiting", "plan.stale", "nextweek.empty",
];
/** 统计页视图 ids in their default order (sub-project 7b spec §4). */
export const STATS_VIEWS = [
  "headlines", "waterfall", "river", "dial", "stream", "stars", "fingerprint", "hours24", "weekday", "calendar",
  "terrain", "contour", "compute", "density", "sunburst", "sankey", "graph", "parallel", "plans",
  "time", "share", "rhythm", "ai", "review",
] as const;
export type StatsView = (typeof STATS_VIEWS)[number];
export const RUNNING_OPTIONS = [5, 10, 15, 30];
/** Same pattern as server/src/prefs/schema.ts. */
export const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
