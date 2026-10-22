-- Many tasks per plan item / day-plan item (design §9). The old single task_id columns are emptied
-- after the copy so nothing (the task delete guard included) reads a stale link; they stay as
-- unused nullable columns because D1 cannot drop a column cheaply.
CREATE TABLE plan_item_tasks (
  plan_item_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (plan_item_id, task_id)
);
CREATE INDEX idx_plan_item_tasks_task ON plan_item_tasks(task_id);
CREATE TABLE day_plan_item_tasks (
  day_plan_item_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  PRIMARY KEY (day_plan_item_id, task_id)
);
CREATE INDEX idx_day_plan_item_tasks_task ON day_plan_item_tasks(task_id);
INSERT INTO plan_item_tasks (plan_item_id, task_id) SELECT id, task_id FROM plan_items WHERE task_id IS NOT NULL;
INSERT INTO day_plan_item_tasks (day_plan_item_id, task_id) SELECT id, task_id FROM day_plan_items WHERE task_id IS NOT NULL;
UPDATE plan_items SET task_id = NULL;
UPDATE day_plan_items SET task_id = NULL;
