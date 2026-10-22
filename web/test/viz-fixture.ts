import type { StatsSession, StatsSessions, StatsTokens, Task } from "../src/api/types";
import { stTask } from "./st-serve";

/** Epoch ms of a Tokyo wall-clock time: `jst("2026-09-21T09:00")`. */
export const jst = (t: string) => Date.parse(`${t}:00+09:00`);
/** UTC ISO string of a Tokyo wall-clock time, as the API spells it. */
const z = (t: string) => new Date(jst(t)).toISOString().replace(".000Z", "Z");

const tok = (input: number, output: number, cache_read: number, cache_write: number): StatsTokens =>
  ({ input, output, cache_read, cache_write });

const sess = (id: string, over: Partial<StatsSession> & { intervals: [string, string][] }): StatsSession => ({
  id, machine: "macmini", agent: "claude-code", task_id: null,
  started_at: over.intervals[0][0], ended_at: over.intervals[over.intervals.length - 1][1],
  active_minutes: 0, turns: 0, files: 0, approx: false,
  tokens: null, subagent_tokens: null, cost_usd: null, cost_partial: false, summary: `summary ${id}`, ...over,
});

/** Shared 7b derivation fixture (prerun brief, assumption 4). Range 2026-09-21 (Mon) – 2026-09-22, i.e. the window
 *  [9/21 05:00, 9/23 05:00) JST. All times below are JST.
 *
 *  | id | task | machine / agent       | interval                | turns | files | tokens (model: in/out/cr/cw)              | sub  | cost        |
 *  |----|------|-----------------------|-------------------------|-------|-------|-------------------------------------------|------|-------------|
 *  | A  | T1   | macmini / claude-code | 9/21 09:00–11:00 (+ a zero-length interval at 11:00) | 10 | 2 | opus 1000/2000/100000/5000    | 0    | 3.00        |
 *  | B  | T2   | macmini / codex       | 9/21 10:00–12:00 (6-digit fraction spelling) | 6 | 1 | gpt-5-codex 5000/1000/20000/0 | null | null, partial |
 *  | C  | T1   | win11 / claude-code   | 9/21 10:30–11:30        | 4     | 0     | sonnet 500/500/10000/1000                 | 1000 | 0.50        |
 *  | D  | null | macmini / claude-code | 9/21 23:30–9/22 01:30   | 12    | 5     | opus 2000/3000/200000/10000               | null | 6.00        |
 *  | E  | T2   | macmini / claude-code | 9/22 04:00–06:00        | 8     | 3     | opus 1000/1000/50000/2000                 | 0    | 2.00        |
 *  | F  | T1   | macmini / claude-code | 9/22 13:00–13:30 approx | 2     | 0     | null (not collected)                      | null | null        |
 *  | X  | T3   | macmini / claude-code | 9/20 20:00–21:00 (outside the window; prepare drops it) | 1 | 0 | opus 100/100/1000/0 | 0 | 0.10 |
 *
 *  In-window totals (A–F): turns 42, files 11, tokens 415000 (A 108000, B 26000, C 12000, D 215000, E 54000),
 *  subagent 1000, cost $11.50 known (B unpriced/partial, F not collected).
 *  Hand-computed wall clock (5:00 days): 9/21 union 360 / sum 480 / peak 3 at 10:30 / ge[2] 90 / ge[3] 30 /
 *  first 09:00 / last 9/22 05:00; by task T1 105, T2 135, "" 120; by machine macmini 330, win11 30.
 *  9/22 union 90 / sum 90 / peak 1. Whole range union 450 / sum 570.
 *  Tasks: T1 田中, T2 佐藤、鈴木 (two requesters), T3 田中.
 *  Plans (calendar dates; Task 10 计划兑现):
 *  | date | text          | tasks   | ai      | manual  |
 *  |------|---------------|---------|---------|---------|
 *  | 9/21 | T1 を仕上げる  | T1      | done    | done    |
 *  | 9/21 | T2 と T3 を調べる | T2, T3 | partial | none   |
 *  | 9/22 | T1 の確認      | T1      | null    | done    |
 *  | 9/22 | T1 の追加      | T1      | none    | null    |
 *  → 4 items; AI done 1 / judged 3; manual done 2; both judged 2, agreeing 1. Day wall clock by task (split evenly):
 *  9/21 T1 105, T2 135, T3 0; 9/22 T1 30, T2 60, T3 0. */
export const VIZ: StatsSessions = {
  range: { from: "2026-09-21", to: "2026-09-22" },
  day_start: "05:00",
  sessions: [
    sess("X", { task_id: "T3", intervals: [[z("2026-09-20T20:00"), z("2026-09-20T21:00")]], active_minutes: 60, turns: 1,
      tokens: { "claude-opus-5": tok(100, 100, 1000, 0) }, subagent_tokens: 0, cost_usd: 0.1 }),
    sess("A", { task_id: "T1", intervals: [[z("2026-09-21T09:00"), z("2026-09-21T11:00")], [z("2026-09-21T11:00"), z("2026-09-21T11:00")]],
      active_minutes: 120, turns: 10, files: 2, tokens: { "claude-opus-5": tok(1000, 2000, 100000, 5000) }, subagent_tokens: 0, cost_usd: 3 }),
    sess("B", { task_id: "T2", agent: "codex", intervals: [["2026-09-21T01:00:00.000000Z", "2026-09-21T03:00:00.000000Z"]],
      active_minutes: 120, turns: 6, files: 1, tokens: { "gpt-5-codex": tok(5000, 1000, 20000, 0) }, cost_usd: null, cost_partial: true }),
    sess("C", { task_id: "T1", machine: "win11", intervals: [[z("2026-09-21T10:30"), z("2026-09-21T11:30")]],
      active_minutes: 60, turns: 4, tokens: { "claude-sonnet-5": tok(500, 500, 10000, 1000) }, subagent_tokens: 1000, cost_usd: 0.5 }),
    sess("D", { intervals: [[z("2026-09-21T23:30"), z("2026-09-22T01:30")]],
      active_minutes: 120, turns: 12, files: 5, tokens: { "claude-opus-5": tok(2000, 3000, 200000, 10000) }, cost_usd: 6 }),
    sess("E", { task_id: "T2", intervals: [[z("2026-09-22T04:00"), z("2026-09-22T06:00")]],
      active_minutes: 120, turns: 8, files: 3, tokens: { "claude-opus-5": tok(1000, 1000, 50000, 2000) }, subagent_tokens: 0, cost_usd: 2 }),
    sess("F", { task_id: "T1", intervals: [[z("2026-09-22T13:00"), z("2026-09-22T13:30")]], approx: true, active_minutes: 30, turns: 2 }),
  ],
  plans: [
    { date: "2026-09-21", text: "T1 を仕上げる", task_ids: ["T1"], ai_status: "done", manual_status: "done" },
    { date: "2026-09-21", text: "T2 と T3 を調べる", task_ids: ["T2", "T3"], ai_status: "partial", manual_status: "none" },
    { date: "2026-09-22", text: "T1 の確認", task_ids: ["T1"], ai_status: null, manual_status: "done" },
    { date: "2026-09-22", text: "T1 の追加", task_ids: ["T1"], ai_status: "none", manual_status: null },
  ],
};

export const VIZ_TASKS: Task[] = [
  stTask("T1", { requester: "田中", title: "案件 一" }),
  stTask("T2", { requester: "佐藤、鈴木", title: "案件 二" }),
  stTask("T3", { requester: "田中", title: "案件 三" }),
];
