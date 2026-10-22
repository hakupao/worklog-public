import type { Machine, Session } from "../api/types";
import { dayItem, dayPlan, J, planItem, session, task, taskRef } from "./fixtures";
import type { SnapInput } from "./snapshot";
import { HOUR } from "./time";

// 情境模拟 (spec §3.2, prototype world-now.html:438-475): four moments of one invented Friday. The board
// runs the real rules on them, so these double as an integration test (test/predict-scenarios.test.ts).

export type ScenarioId = "morning" | "day" | "weekly" | "wrap";
export const SCENARIO_IDS: ScenarioId[] = ["morning", "day", "weekly", "wrap"];
export const SCENARIO_AT: Record<ScenarioId, string> = {
  morning: "2026-10-02 09:05", day: "2026-10-02 14:20", weekly: "2026-10-02 16:30", wrap: "2026-10-02 18:45",
};

/** The data as the server held it at `at`. Harvest runs on the hour, so activity is cut at the last whole
 *  hour, a session that had not started by then does not exist yet, and a machine's last_seen_at is the
 *  hour at which its last activity was picked up (an idle hour pushes nothing). Shared with the replay. */
export function collectedAt(sessions: Session[], at: number): { sessions: Session[]; machines: Machine[] } {
  const cut = Math.floor(at / HOUR) * HOUR, out: Session[] = [], last = new Map<string, number>();
  for (const s of sessions) {
    const a = Date.parse(s.started_at);
    if (!(a < cut)) continue;
    const ivs = (s.active_intervals ?? [[s.started_at, s.ended_at]])
      .map(([x, y]) => [Date.parse(x), Math.min(Date.parse(y), cut)] as [number, number])
      .filter(([x, y]) => x < cut && y >= x);
    if (ivs.length === 0) continue;
    const end = Math.max(...ivs.map(([, y]) => y)), full = Date.parse(s.ended_at) - a;
    const minutes = full > 0 ? Math.round((s.minutes_effective * Math.min(1, (end - a) / full))) : s.minutes_effective;
    out.push({
      ...s, ended_at: new Date(end).toISOString(),
      active_intervals: ivs.map(([x, y]) => [new Date(x).toISOString(), new Date(y).toISOString()]),
      active_minutes: minutes, minutes_override: s.minutes_override === null ? null : minutes, minutes_effective: minutes,
    });
    last.set(s.machine, Math.max(last.get(s.machine) ?? 0, end));
  }
  const machines = [...last].map(([name, t]) => ({ name, last_seen_at: new Date(Math.ceil(t / HOUR) * HOUR).toISOString() }))
    .sort((x, y) => (x.name < y.name ? -1 : 1));
  return { sessions: out, machines };
}

const HB2 = "T20260701-01", ORB = "T20261001-01", BEACON = "T20260929-01", LEDGER = "T20260916-01", WL = "T20260918-02";
const TASKS = [
  task(HB2, "HARBOR2 Mapping 仕様書作成"), task(ORB, "ORION-B 統合ファイル作成"), task(BEACON, "BEACON 帳票修正"),
  task(LEDGER, "LEDGER codelist 検証"), task(WL, "worklog 改修"),
];
const title = (id: string) => TASKS.find((t) => t.id === id)?.title ?? id;
const SESSIONS: Session[] = [
  session("S0", "2026-09-30 10:00", "2026-09-30 12:00", { task_id: WL, link_method: "auto-dir", summary: "設計書レビュー" }, 20.0),
  session("S1", "2026-10-01 16:00", "2026-10-01 17:10", { machine: "win11", task_id: ORB, link_method: "auto-dir", summary: "統合ファイル作成を中断。Sam さんの確認待ち。" }, 12.4),
  session("S2", "2026-10-01 19:10", "2026-10-01 19:30", { summary: "scratch の整理" }, 2.1),
  session("S3", "2026-10-01 19:30", "2026-10-01 19:57", { summary: "report-print の試作" }, 3.3),
  session("S4", "2026-10-02 09:30", "2026-10-02 11:40", { task_id: WL, link_method: "auto-dir", summary: "週報テンプレートの列幅修正" }, 18.2),
  session("S8", "2026-10-02 10:00", "2026-10-02 11:30", { machine: "win11", task_id: BEACON, link_method: "auto-dir", summary: "帳票の罫線修正" }, 9.7),
  session("S5", "2026-10-02 13:07", "2026-10-02 13:37", { summary: "ログ確認" }, 1.9),
  session("S6", "2026-10-02 13:40", "2026-10-02 18:50", { task_id: WL, link_method: "auto-dir", summary: "此刻ページの実装" }, 42.0),
  session("S7", "2026-10-02 13:50", "2026-10-02 18:50", { machine: "win11", task_id: ORB, link_method: "auto-dir", summary: "統合ファイル作成を再開" }, 30.5),
];
const PLAN = [
  planItem({ id: "P1", horizon: "daily", text: "BEACON 每天推进一点", tasks: [taskRef(BEACON, title(BEACON))], until_date: "2026-10-09" }),
  planItem({ id: "P2", horizon: "week", text: "LEDGER codelist 検証", tasks: [taskRef(LEDGER, title(LEDGER))], week: "2026-W39", stale: true, effective: false }),
];

/** What the board reads at a scenario's moment. Later in the day the 13:07 session has been linked by
 *  hand and the HARBOR2 item marked done, as a user would have done after the 14:20 board. */
export function scenarioInput(id: ScenarioId): SnapInput {
  const now = Date.parse(J(SCENARIO_AT[id])), later = id === "weekly" || id === "wrap";
  const sessions = SESSIONS.map((s) => (later && s.id === "S5" ? { ...s, task_id: WL, link_method: "manual" as const } : s));
  const c = collectedAt(sessions, now);
  const day = dayPlan("2026-10-02", [
    dayItem({ id: "D1", text: "HARBOR2 Mapping 仕様書作成", tasks: [taskRef(HB2, title(HB2))], manual_status: later ? "done" : null }),
    dayItem({ id: "D2", text: "worklog 改修", tasks: [taskRef(WL, title(WL))], ai_status: "done" }),
  ], { judged_at: J("2026-10-02 14:00"), judge_machine: "macmini" });
  return { now, machines: c.machines, sessions: c.sessions, tasks: TASKS, planItems: PLAN, dayPlan: id === "morning" ? null : day, downloads: [] };
}
