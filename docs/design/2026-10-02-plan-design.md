# 计划 / 今日安排 设计书

2026-10-02。与用户逐段确认后整理。目标：今天（10/2）做完上线；10/3–4 UI 重构时本页随其他页面一起换皮。

## 1. 目的

两件事：

1. **计划清单**，分四档：每日 / 本周 / 近期 / 远期。
2. **今日安排**：开工前写今天要干的活，比「每日」更细（从每日条目继承过来，补具体要求，例如「和 agent 至少两轮，把导入模块的 DB 写入做完」）。

今日安排写完后要能 **计划 vs 实际对账**：系统根据当天已采集的 session / 补记判断每条完成没有。完成条件 **不预先结构化**——用户写自然语言，由模型在对账时自行判断量化指标（用户原话："不同项目干的事情不一样"）。

### 范围

- 做：计划四档的增删改、今日安排（开始今天 / 写细节 / 改判）、harvest 时的模型对账、首页「今日」卡片、`wl plan judge`。
- 不做：正式视觉（10/3–4 重构时做）、提醒/通知、多用户、对账结果进周报 xlsx。

## 2. 概念

### 2.1 计划条目（四档）

| 档位 | 含义 | 结束 |
|---|---|---|
| 每日 `daily` | 主要是「某项目完成前每天推进一点」；也容纳每天重复的例行事务 | 挂了案件 → 案件 `done` 后自动不再出现；可设截止日 `until_date`，过期不再出现；可手动完成/放弃 |
| 本周 `week` | 这周要完成的事 | 手动完成；带 `week`（放进本周时的 ISO 周）。周已过还未完成的标「上周遗留」，给两个按钮：留在本周（`week` 改成当前周）/ 下放近期 |
| 近期 `near` | 未来几周 | 手动完成；可升到本周 |
| 远期 `far` | 想做没排期 | 可「转成案件」（打开现有案件表单预填文字），转完该条标完成并挂上新案件 |

条目可选挂一个案件（`task_id`）。改档位只改 `horizon`，不丢历史。

「当前有效的每日条目」= `horizon='daily' AND status='active' AND (task_id IS NULL OR 案件.status <> 'done') AND (until_date IS NULL OR until_date >= 今天)`。

### 2.2 今日安排

每天（JST 日期）一份。

- **开始今天**：服务端生成草稿 = 当前有效的每日条目 + 最近一份之前的今日安排里「最终状态不是完成」的条目（按 `plan_item_id` 去重；无 `plan_item_id` 的按文字去重）。每条的标题、案件从来源继承，`detail` 留空（遗留条目连 detail 一起带过来）。
- 用户在每条下写 `detail`，可增删条目、排序；可以从计划里任意挑一条加进来，也可以写一条不挂计划的临时条目。
- 每条对账字段：模型给的 `ai_status`（`done` / `partial` / `none`）、`ai_progress`（短文字，如「2/2 轮」「约 1.5h / 2h」）、`ai_evidence`（引用的 session id 列表）、`ai_note`（一句理由）；用户的 `manual_status`（同三值，可清空）。**显示与「最终状态」= manual_status ?? ai_status ?? 'none'。**

## 3. 数据（迁移 0007）

```sql
CREATE TABLE plan_items (
  id TEXT PRIMARY KEY,                 -- "P20261002-101530-a3f9"：JST 时间戳 + 4 位随机尾（day_plan_items 用 "D" 前缀）
  horizon TEXT NOT NULL CHECK (horizon IN ('daily','week','near','far')),
  text TEXT NOT NULL,
  task_id TEXT,                        -- 可空
  status TEXT NOT NULL CHECK (status IN ('active','done','dropped')),
  week TEXT,                           -- horizon='week' 时的 ISO 周 "2026-W40"，其它为 NULL
  until_date TEXT,                     -- daily 的截止日 YYYY-MM-DD（JST），可空
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,            -- UTC ISO
  done_at TEXT,                        -- UTC ISO
  updated_at TEXT NOT NULL
);

CREATE TABLE day_plans (
  date TEXT PRIMARY KEY,               -- YYYY-MM-DD，JST
  started_at TEXT NOT NULL,            -- UTC ISO
  judged_at TEXT,                      -- 最近一次对账写入
  judge_fingerprint TEXT,              -- 最近一次对账的输入指纹
  judge_machine TEXT,
  judge_model TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE day_plan_items (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES day_plans(date),
  plan_item_id TEXT,                   -- 来源计划条目，可空（临时条目）
  task_id TEXT,                        -- 默认继承计划条目，可改
  text TEXT NOT NULL,                  -- 标题（继承计划条目文字，可改）
  detail TEXT NOT NULL DEFAULT '',     -- 今天的具体要求，自然语言
  sort INTEGER NOT NULL DEFAULT 0,
  ai_status TEXT CHECK (ai_status IN ('done','partial','none')),
  ai_progress TEXT,
  ai_evidence TEXT NOT NULL DEFAULT '[]',  -- JSON: session id 数组
  ai_note TEXT,
  manual_status TEXT CHECK (manual_status IN ('done','partial','none')),
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_day_plan_items_date ON day_plan_items(date);
```

编辑走现有的乐观锁约定（`WHERE id=? AND updated_at=?`，冲突 409 + `current`，`nextUpdatedAt`）。删除案件时，现有「被引用就拒绝」规则扩展到 `plan_items.task_id` / `day_plan_items.task_id`。

## 4. 接口

所有 `/api/*` 走现有统一认证（浏览器 Access JWT / 采集端 Bearer token），下面按主要调用方分组。

浏览器：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/plan-items?status=active` | 四档清单（含案件标题、案件状态；daily 附 `effective` 标志） |
| POST | `/api/plan-items` | 新增 |
| PATCH | `/api/plan-items/:id` | 改文字/档位/案件/状态/周/截止日/排序 |
| GET | `/api/day-plans/:date` | 当天安排 + 条目 + 对账元数据；没开始 → 404 |
| POST | `/api/day-plans/:date/start` | 开始今天：生成草稿（已存在则 409） |
| POST | `/api/day-plans/:date/items` | 加条目（可带 `plan_item_id`） |
| PATCH | `/api/day-plan-items/:id` | 改 text/detail/task/sort/manual_status |
| DELETE | `/api/day-plan-items/:id` | 删条目 |

采集端：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/day-plans/:date/judge-input` | 对账输入：条目 + 当天 session 切片 + 当天补记 + `fingerprint` + 上次 `judge_fingerprint` |
| POST | `/api/day-plans/:date/judgement` | 写对账结果 `{fingerprint, model, machine, items:[{id, status, progress, evidence, note}]}` |

**judge-input 由服务端组装**，复用 `split.ts` 的按日切分，Python 端不重复实现：每个 session 给 `id、agent、task_id、案件标题、项目/cwd 末段、summary（有 summary_edited 用它）、当天分钟、当天轮数`。当天轮数：session 完全在当天 → `turns`；跨日 → `turns × 当天分钟 / 总分钟` 取整并标 `turns_estimated: true`。`hidden=1` 的 session 不给。补记按现有规则（`notes.ts` 的日期前缀即 JST 日）。

**fingerprint** = sha256(条目的 id/text/detail/task_id + session 的 id/当天分钟/轮数/summary + 补记的 id/text/minutes)。不含 manual_status——改判不触发重判。

**judgement 写入规则**：fingerprint 与当前 judge-input 不一致 → 409（输入在模型思考期间变了，下次再来）；`evidence` 里不属于当天 session 的 id 丢弃；只更新 `ai_*`，不碰 `manual_status`；未知条目 id 忽略。

## 5. 对账（采集端）

新模块 `src/worklog/plan_judge.py`，结构照 `review.py`：

1. harvest 完成后作为副任务运行（异常只记 harvest.log，不影响 harvest 退出码）。
2. 对 **今天** 和 **昨天**（JST）各做一次：昨天的 session 可能在过了零点后才被采集，所以昨天也要补判。
3. GET judge-input；没有安排（404）→ 跳过；`fingerprint == judge_fingerprint` → 跳过（Mac / Win11 两台同时跑时，只有第一台真正调模型）。
4. `claude -p --setting-sources "" --no-session-persistence --model <cfg> --system-prompt …`，prompt 里给条目和当天数据，要求只输出 JSON：`[{id, status, progress, evidence, note}]`。
5. 解析失败 / 非法值 → 本次放弃（记日志），不写半截结果。
6. POST judgement。

提示词要点：只根据给的数据判断，不编造；`detail` 里的量化要求（轮数、时长）要逐项对照并写进 progress；没提量化要求的按 summary 判断是否做到；`evidence` 只能填给出的 session id。

CLI：`wl plan judge [--date YYYY-MM-DD]` 手动触发，忽略指纹跳过（强制重判）。

## 6. 网页

- 新路由 `#/plan`，导航加「计划」。两栏（窄屏上下叠）：
  - **左：今日安排**。没开始 → 「开始今天」按钮 + 预览将带入的每日条目（上一份的遗留条目不预览，开始后出现）。开始后每条：状态点、标题（案件标签）、detail（多行，保留换行）、progress、「依据」可展开（列出 session 摘要，点击跳时间线对应周）、改判下拉（自动 / 完成 / 部分 / 未做）。底部「上次对账 10:00 · macmini」或「尚未对账（下次 harvest 时）」。可切换日期看前几天。
  - **右：计划**。四组折叠面板，每组内拖动或上下按钮排序；条目行内编辑文字、档位下拉、案件选择、完成 / 放弃；本周组顶部显示「上周遗留」条目及两个按钮；远期条目有「转成案件」。底部「已完成 / 已放弃」可展开查看。
- 首页顶部「今日」卡片：`完成 x / y`，列出最多 3 条未完成；没开始 → 「还没写今日安排 → 去写」。
- 样式用现有 `styles.css` 的类，不做新视觉。

## 7. 边界与出错

- 今天没开始安排：不对账、不调模型；首页卡片提示。
- 开始今天的并发：两处同时点 → 第二个 409，前端重新拉取。
- 条目编辑后指纹变化 → 下次 harvest 重判；改判保留并优先显示。
- 案件被删：被计划/安排引用时拒绝（沿用现有规则）。
- 案件 done：每日条目自动不再「有效」，但条目本身状态不变（重新打开案件会重新出现）。
- 模型输出缺某条目：该条 `ai_*` 保持原值。

## 8. 测试

- 服务端（vitest）：迁移；plan-items CRUD 与乐观锁；有效每日条目判定（案件 done / until_date）；上周遗留标记；开始今天的草稿（每日 + 遗留去重 + 409）；judge-input 的跨日分摊与 hidden 过滤；fingerprint 稳定性（改 manual_status 不变、改 detail 变）；judgement 的指纹 409 / 丢弃虚构 id / 不碰 manual_status；删除案件被引用时拒绝。
- Python（pytest）：prompt 构造、跳过逻辑、模型输出解析与校验，用假 runner；harvest 副任务异常不影响退出码。
- 端到端：本地 dev 上走一遍「加计划 → 开始今天 → 写 detail → `wl plan judge` → 页面显示状态与依据 → 改判」，prod 部署后用真实数据再走一遍。

## 9. 追加：一条计划 / 今日条目挂多个案件（2026-10-02 下午，用户确认）

用户原话：「希望一个 todo，可以关联多个案件」；「每日的计划完成不代表案件完成。不能划等号」；今日条目也要能挂多个。

- **关联**：`plan_items` 与 `day_plan_items` 各自和案件多对多（迁移 0008：`plan_item_tasks`、`day_plan_item_tasks`，主键为两列组合）。旧的 `task_id` 列的数据搬进关联表后清成 NULL，之后不再读写。
- **有效的每日条目**：进行中、未过截止日，且（没挂案件 **或** 挂的案件里至少一个未完成）。挂的案件**全部**完成才不再带入。
- **单向**：案件状态只影响每日条目是否有效；完成或放弃计划条目、今日条目，**绝不**改动案件状态。
- **带入 / 从计划添加**：今日条目继承计划条目当时的全部案件；遗留条目带上它自己的案件集合。今日条目可以单独增减案件，不影响计划条目。
- **对账**：每条给模型 `task_ids` + `task_titles`，任一关联案件的 session 都可以当依据；指纹包含排序后的 `task_ids`。
- **接口**：条目返回 `tasks: [{id, title, status}]`（不再返回 `task_id` / `task_title` / `task_status`）；创建接受 `task_ids`（缺省 []），修改以 `task_ids` 整体替换，和其它字段一样走乐观锁、原子写入。
- **删除案件**：被任一关联表引用时拒绝，计入 `plans`。
- **页面**：案件显示成标签，标签带 × 可移除，末尾一个「＋ 案件」下拉追加（含「＋ 新建案件…」）。
