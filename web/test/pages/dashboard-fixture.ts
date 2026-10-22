import type { Dashboard, Overview } from "../../src/api/types";

export const ZERO_OVERVIEW: Overview = { minutes: 0, active_days: 0, sessions: 0, tasks_done: 0, tokens: 0, cost_usd: 0, cost_partial: false };

export const EMPTY: Dashboard = {
  range: { from: "2026-09-03", to: "2026-09-30" },
  prev_range: { from: "2026-08-06", to: "2026-09-02" },
  overview: ZERO_OVERVIEW,
  overview_prev: ZERO_OVERVIEW,
  time: { by_project: [], by_requester: [], by_task: [], unlinked_minutes: 0, unlinked_note_minutes: 0, weekly: [] },
  ai: {
    by_model: [], by_agent: [], subagent_share: null, cost_per_hour: null, cache_hit_rate: null,
    by_task_cost: [], top_sessions: [], uncollected_sessions: 0,
  },
  rhythm: {
    daily: [], heatmap: Array.from({ length: 7 }, () => Array(24).fill(0)),
    late_night_share: null, weekend_share: null, focus_blocks: [], avg_start: null, avg_end: null,
  },
  output: { done_tasks: [], avg_lead_days: null, deliverables_count: 0, estimate_gaps: [] },
  requesters: [],
  hints: [],
};

const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
heatmap[0][22] = 40; // 周一 22 时 40 分钟
heatmap[2][10] = 80;

export const FULL: Dashboard = {
  ...EMPTY,
  overview: { minutes: 600, active_days: 5, sessions: 12, tasks_done: 3, tokens: 5_000_000, cost_usd: 12.5, cost_partial: true },
  overview_prev: { ...ZERO_OVERVIEW, minutes: 300, active_days: 5 },
  requesters: [
    { requester: "Alex Wang", minutes: 300, tokens: 3_000_000, cost_usd: 12, cost_partial: false },
    { requester: "Team", minutes: 120, tokens: 500_000, cost_usd: 2, cost_partial: true },
    { requester: "Kevin Liu", minutes: 60, tokens: 200_000, cost_usd: 1, cost_partial: false },
    { requester: "未关联", minutes: 60, tokens: 1_000_000, cost_usd: 4, cost_partial: false },
    { requester: "佐藤", minutes: 30, tokens: 100_000, cost_usd: 0.5, cost_partial: false },
    { requester: "田中先生", minutes: 20, tokens: 100_000, cost_usd: 0.5, cost_partial: false },
    { requester: "Mia Chen", minutes: 10, tokens: 100_000, cost_usd: 0.5, cost_partial: false },
  ],
  hints: [
    { id: "a", level: "info", text: "INFO-HINT", links: [{ label: "查看周", href: "#/timeline/2026-W39" }], params: {} },
    { id: "b", level: "warn", text: "WARN-HINT", links: [{ label: "去关联", href: "#/timeline/2026-W39" }], params: {} },
  ],
  time: {
    by_project: [{ key: "Alpha项目", minutes: 300 }, { key: "Beta项目", minutes: 150 }],
    by_requester: [{ key: "山田", minutes: 450 }],
    by_task: [
      { task_id: "t1", title: "看板开发", minutes: 300 },
      { task_id: "t2", title: "报表修正", minutes: 90 },
    ],
    unlinked_minutes: 60,
    unlinked_note_minutes: 0,
    weekly: [
      { week: "2026-W38", by_project: [{ key: "Alpha项目", minutes: 120 }] },
      { week: "2026-W39", by_project: [{ key: "Alpha项目", minutes: 180 }, { key: "Beta项目", minutes: 60 }] },
    ],
  },
  ai: {
    by_model: [
      { model: "claude-opus", input: 1, output: 1, cache_read: 1, cache_write: 1, total: 2_000_000 },
      { model: "gpt-5", input: 1, output: 1, cache_read: 1, cache_write: 1, total: 500_000 },
    ],
    by_agent: [
      { agent: "claude", sessions: 8, minutes: 400, cost_usd: 9, cost_partial: false },
      { agent: "codex", sessions: 4, minutes: 200, cost_usd: null, cost_partial: false },
    ],
    subagent_share: 0.35,
    cost_per_hour: 3,
    cache_hit_rate: 0.9,
    by_task_cost: [{ task_id: "t1", title: "看板开发", cost_usd: 7.5, cost_partial: true, minutes: 300 }],
    top_sessions: [
      { id: "s1", summary: "重构统计模块", cost_usd: 4.2, tokens: 900_000, started_at: "2026-09-28T15:30:00Z" }, // JST 09-29 -> 2026-W40
    ],
    uncollected_sessions: 2,
  },
  rhythm: {
    daily: [{ date: "2026-09-28", minutes: 120 }, { date: "2026-09-29", minutes: 90 }],
    heatmap,
    late_night_share: 0.12,
    weekend_share: 0.05,
    focus_blocks: [{ bucket: "0-30", count: 3 }, { bucket: "30-60", count: 5 }],
    avg_start: "09:30",
    avg_end: "18:45",
  },
  output: {
    done_tasks: [{ task_id: "t1", title: "看板开发", received_at: "2026-09-01", done_at: "2026-09-04", lead_days: 3, deliverables: 2 }],
    avg_lead_days: 3,
    deliverables_count: 2,
    estimate_gaps: [{ task_id: "t1", title: "看板开发", manual_hours: 3, actual_hours: 3.5 }],
  },
};
