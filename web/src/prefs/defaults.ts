import { STATS_VIEWS, type Prefs } from "./types";

/** Must equal server/src/prefs/defaults.json (pinned by test/prefs.test.tsx). Used only for the
 *  first paint before the server answers. */
export const DEFAULT_PREFS: Prefs = {
  lang: "zh",
  world: "ura",
  fx: { load: "flicker", lang: "morph", data: "roll" },
  ofx: { load: "rise", lang: "slide", data: "roll" },
  worldFx: "scan",
  speed: 1,
  omote: { font: "plex", hide: ["now.cost", "stats.cost", "stats.review"] },
  predict: {
    runningMin: 10,
    modes: {
      morning: { from: "06:00", to: "11:00", days: [1, 2, 3, 4, 5] },
      focus: { from: "11:00", to: "18:00", days: [1, 2, 3, 4, 5] },
      weekly: { from: "15:00", to: "00:00", days: [5] },
      wrap: { from: "18:00", to: "00:00", days: [1, 2, 3, 4, 5] },
    },
    rules: {
      "unlinked.yesterday": { on: true, weight: 100, mode: "morning", params: { minMinutes: 5 } },
      "unlinked.stale": { on: true, weight: 90, mode: "all", params: { minutes: 30, minMinutes: 5 } },
      "week.unlinked": { on: true, weight: 80, mode: "all", params: { minMinutes: 5 } },
      "dayplan.untouched": { on: true, weight: 70, mode: "focus", params: {} },
      "plan.unplaced": { on: true, weight: 60, mode: "morning", params: {} },
      "report.undownloaded": { on: true, weight: 50, mode: "weekly", params: {} },
      "dayplan.confirm": { on: true, weight: 40, mode: "wrap", params: {} },
      "task.waiting": { on: true, weight: 30, mode: "morning", params: { keywords: ["確認待ち", "待ち", "等待", "waiting"], days: 3 } },
      "plan.stale": { on: true, weight: 20, mode: "focus", params: {} },
      "nextweek.empty": { on: true, weight: 10, mode: "weekly", params: {} },
    },
  },
  stats: { order: [...STATS_VIEWS], off: [] },
  report: { name: "Taro Yamada" },
  cal: {
    payday: 25,
    breaks: [
      { name: "年末年始", from: "12-29", to: "01-03" },
      { name: "GW", from: "04-29", to: "05-05" },
      { name: "お盆", from: "08-13", to: "08-16" },
    ],
  },
};
