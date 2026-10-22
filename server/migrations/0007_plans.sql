-- Plan lists (daily / week / near / far) and the per-day plan judged against harvested sessions.
-- See docs/design/2026-10-02-plan-design.md. Dates are Asia/Tokyo calendar dates; *_at are UTC ISO.
CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,
  horizon TEXT NOT NULL CHECK (horizon IN ('daily','week','near','far')),
  text TEXT NOT NULL,
  task_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','done','dropped')),
  week TEXT,                 -- horizon='week' only: the ISO week it was planned for
  until_date TEXT,           -- daily only, optional: last day it is still in effect
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  done_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_plan_items_task ON plan_items(task_id);

CREATE TABLE day_plans (
  date TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  judged_at TEXT,
  judge_fingerprint TEXT,
  judge_machine TEXT,
  judge_model TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE day_plan_items (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES day_plans(date),
  plan_item_id TEXT,
  task_id TEXT,
  text TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT CHECK (ai_status IN ('done','partial','none')),
  ai_progress TEXT,
  ai_evidence TEXT NOT NULL DEFAULT '[]',
  ai_note TEXT,
  manual_status TEXT CHECK (manual_status IN ('done','partial','none')),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_day_plan_items_date ON day_plan_items(date);
CREATE INDEX idx_day_plan_items_task ON day_plan_items(task_id);
