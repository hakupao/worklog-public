import type { StrKey } from "../i18n/strings";
import type { World } from "../prefs/types";

/** Modules a page declares for the 表 "hide" setting (spec §5.2). Ids are "<page>.<module>". Later
 *  sub-projects append their pages' modules here. */
export const MODULES: { id: string; page: string; labelKey: StrKey }[] = [
  { id: "now.run", page: "now", labelKey: "mod.now.run" },
  { id: "now.next", page: "now", labelKey: "mod.now.next" },
  { id: "now.plan", page: "now", labelKey: "mod.now.plan" },
  { id: "now.info", page: "now", labelKey: "mod.now.info" },
  { id: "now.cost", page: "now", labelKey: "mod.now.cost" },
  { id: "now.dia", page: "now", labelKey: "mod.now.dia" },
  { id: "now.scene", page: "now", labelKey: "mod.now.scene" },
  { id: "now.time", page: "now", labelKey: "mod.now.time" },
  { id: "timeline.legend", page: "timeline", labelKey: "mod.timeline.legend" },
  { id: "timeline.cost", page: "timeline", labelKey: "mod.timeline.cost" },
  { id: "tasks.cost", page: "tasks", labelKey: "mod.tasks.cost" },
  { id: "plan.judge", page: "plan", labelKey: "mod.plan.judge" },
  { id: "report.warn", page: "report", labelKey: "mod.report.warn" },
  { id: "stats.cost", page: "stats", labelKey: "mod.stats.cost" },
  { id: "stats.review", page: "stats", labelKey: "mod.stats.review" },
];
export const isModuleHidden = (id: string, hide: string[], world: World) => world === "omote" && hide.includes(id);
