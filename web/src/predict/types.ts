import type { StrKey } from "../i18n/strings";
import type { ModeId, RuleId } from "../prefs/types";

export type Action = "link" | "plan" | "reply" | "start" | "schedule" | "report" | "nextweek" | "confirm";
export type WhenKey = "yesterday" | "today" | "week" | "lastweek" | "nextweek";
/** The 时刻 column of a 下一步 row. */
export type When = { kind: "label"; key: WhenKey } | { kind: "time"; hm: string } | { kind: "date"; md: string };
/** Language-free values only (numbers, dates, times, keywords). Data text goes in Hit.subject. */
export type Vars = Record<string, string | number>;

/** One thing a rule found. `urgency` (1..3, a few rules go slightly above 1 by design) times the
 *  rule's weight is the score. `target` names the thing, so two rules about it collapse into one row. */
export interface Hit {
  target: string; urgency: number; action: Action; href: string; when: When;
  taskId: string | null; machine: string | null;
  textKey: StrKey; whyKey: StrKey; vars: Vars; subject?: string;
}
export interface Suggestion extends Hit { rule: RuleId; alert: boolean; score: number }
/** 依据 14:20 · 2 个会话运行中 · 今日安排 1/2 · 未关联 3 */
export interface Basis { hm: string; running: number; plan: { a: number; b: number } | null; unlinked: number }
export interface Prediction { mode: ModeId | null; suggestions: Suggestion[]; alerts: Suggestion[]; basis: Basis }
