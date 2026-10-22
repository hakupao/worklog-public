# Dashboard 设计书

2026-09-29。与用户逐段确认后整理。

## 1. 目的

给使用者本人一个首页，回答四类问题，并把数字转成可执行的改进点：

1. **时间花在哪**：按项目 / 依頼元 / 案件的工时分布与趋势。
2. **AI 使用效率**：token 与 API 等价费用按模型、按案件、子 agent 占比、单位成本。
3. **工作节奏**：每天工时、开始/结束时刻、深夜与周末、专注时长。
4. **记录质量 / 待办**：未关联的 session、久未推进的案件、缺成果物等，提示去补。

另加：产出（完了数、交付周期、成果物）、工时估算偏差、环比、异常。

改进建议来自两处：**规则提示**（确定、即时、可测）和**每周 AI 复盘**（LLM 基于该周统计写的建议）。

### 范围

- 做：统计接口、规则提示、每周 AI 复盘（生成 + 存储 + 展示）、一个朴素的 dashboard 页面。
- 不做：图表库、正式视觉设计（10 月设计系统时再做，本页届时作为改版的第一个页面）、导出、多用户。
- 用户原话："现在可以不用做的那么好看，做个框架和样子就行，之后再美化改进，看看效果"。

## 2. 架构

统计在服务端算好，前端只负责展示。

```
D1 (sessions / tasks / notes / machines / weekly_reviews)
   │
   ├─ GET /api/dashboard?from&to ── routes/dashboard.ts ── dashboard/stats.ts (纯函数)
   │                                                   └── dashboard/hints.ts (纯函数 + 阈值常量)
   ├─ GET /api/reviews?limit    ── 读复盘
   └─ POST /api/reviews         ── 写复盘 (冲突不覆盖, 除非 force)
                                        ▲
   wl harvest (本机) ── 收集完 session 后: 上一周无复盘 → 拉该周 /api/dashboard → claude -p → POST
   wl review [--week YYYY-Www] [--force] ── 手动补生成 / 重新生成

web: #/dashboard (新默认首页) ── 调 /api/dashboard 与 /api/reviews
```

不选的方案：前端拉原始数据自己算（规则提示与 AI 复盘都需要同一份统计，逻辑会重复两份）；SQL 视图聚合（东京时区换算与 tokens JSON 在 SQL 里难写难测）。数据量小（2026-09-29 时 189 个 session、13 个案件），Worker 内存中计算足够。

## 3. 口径（必须与现有页面一致）

- session 时长 = `minutes_effective`（`minutes_override ?? active_minutes`，见 `server/src/effective.ts`）。
- `hidden = 1` 的 session **不计入**任何统计（与案件合计、周报一致）。
- note 的 `minutes` 计入所属案件和总工时（与 `routes/tasks.ts` 的 `total_minutes` 一致）；无案件的 note 计入「未关联」。
- 日/周归属一律用 `server/src/jst.ts` 把 instant 换成 Asia/Tokyo，**禁止截取存储的字符串**。
- session 的分钟按**日份额**归属（2026-09-30 修订）：采集器随 session 发 `active_intervals`（活跃簇的 UTC 起止），`server/src/split.ts` 按东京整点切片，把 `minutes_effective` 用最大余数法整数分摊到各天 / 各小时格，所以手改的工时按同样比例缩放，每天的数字仍是整数且和恰等于 `minutes_effective`。`active_intervals` 为 NULL（回填前的旧行）时退回到全部记在 `started_at` 的东京日期与开始小时。一个 session 在区间内的份额 = 落在区间内各天的分钟之和；token / 费用乘 `份额 / minutes_effective`；session 计数、专注段、Top session 按「区间内有份额」计一次。
- 周 = 东京时区 ISO 周。
- 费用 = `tokens.cost_usd` 之和；任一 session 的 `cost_partial` 为真或 `cost_usd` 为 null → 汇总标 `cost_partial`。`tokens IS NULL` 的 session 计为「未采集」，数量单独给出。
- **一致性不变量**：区间取某一 ISO 周时，dashboard 的 `overview.minutes` = `GET /api/weeks/<week>/timeline` 的 `total_minutes`（逐日 session + note 分钟）。不与周报 xlsx 比：周报的案件工时累计该案件全部历史 session，不是周内分钟。
- tokens JSON 只有会话级 `cost_usd`，没有按模型的费用；因此按模型只给 token 数，子 agent 占比按 token 计算。

## 4. 接口

### 4.1 `GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`

东京日历日，含首尾。缺省 = 以今天为止的近 28 天。`from > to`、格式错误、跨度超过 366 天 → 400。服务端同时计算 `prev_range`（紧邻的前一个等长区间）。

```
{
  range: {from, to}, prev_range: {from, to},
  overview: Overview, overview_prev: Overview,
  time: {
    by_project:   [{key, minutes}],        // 前 10 + "其他"
    by_requester: [{key, minutes}],
    by_task:      [{task_id, title, minutes}],
    unlinked_minutes,
    weekly: [{week, by_project: [{key, minutes}]}]
  },
  ai: {
    by_model: [{model, input, output, cache_read, cache_write, total}],   // 只有 token, 无按模型费用
    by_agent: [{agent, sessions, minutes, cost_usd}],
    subagent_share,                          // 子 agent token / 总 token, 0..1, 无数据时 null
    cost_per_hour, cache_hit_rate,           // 无数据时 null
    by_task_cost: [{task_id, title, cost_usd, cost_partial, minutes}],
    top_sessions: [{id, summary, cost_usd, tokens, started_at}],   // 前 5
    uncollected_sessions
  },
  rhythm: {
    daily: [{date, minutes}],                // 区间内每一天, 无工作的日子为 0
    heatmap: number[7][24],                  // 周一..周日 × 0..23 时 (东京时间), 9/30 起按 active_intervals 切到各整点, 之前的行（未回填）整段记在开始那一格; 分钟为各会话之和, 并行会使单格 >60
    late_night_share, weekend_share,         // 22:00–05:00 开始的 session 分钟占比; 周六日占比
    focus_blocks: [{bucket, count}],         // 单个 session 时长分桶: <15, 15–30, 30–60, 60–120, ≥120 分
    avg_start, avg_end                       // 有工作的日子里, 首个 session 开始 / 最后结束的东京时刻均值 "HH:MM"
  },
  output: {
    done_tasks: [{task_id, title, received_at, done_at, lead_days, deliverables}],
    avg_lead_days, deliverables_count,
    estimate_gaps: [{task_id, title, manual_hours, actual_hours}]   // 仅 hours_manual 非空者
  },
  hints: [{id, level: "info" | "warn", text, links: [{label, href}]}]   // links 最多 3 个, 可为空
}
Overview = {minutes, active_days, sessions, tasks_done, tokens, cost_usd, cost_partial}
```

比值类指标在分母为 0 时返回 `null`，前端显示「—」。

### 4.2 规则提示（`server/src/dashboard/hints.ts`）

输入：本期统计 + 区间内原始行 + machines。每条带 `href` 跳去可以处理的页面。阈值集中在文件顶部常量表。

| id | 条件（默认阈值） | level | href |
|----|------|------|------|
| `unlinked` | 区间内有未关联案件的 session（N 个、M 分钟） | warn | `#/timeline/<该周>` |
| `stale-open` | open 案件 14 天内无新 session / note | info | `#/tasks/<id>` |
| `done-no-deliverable` | 已完了且 deliverables 为空 | warn | `#/tasks/<id>` |
| `candidates-pending` | 有候选成果物（关联 session 的 files_written 中文档类，且文件名不在 deliverables 的文件名里——按 basename 近似）未挑选 | info | `#/tasks/<id>` |
| `summary-fallback` | 区间内 summary_source = fallback 的 session | info | `#/timeline/<该周>` |
| `machine-silent` | 某机器 last_seen 超过 3 天 | warn | — |
| `late-night` | late_night_share > 20% | info | — |
| `weekend` | weekend_share > 20% | info | — |
| `costly-session` | 单个 session cost_usd > $100 | info | session 所在周时间线 |
| `subagent-heavy` | 单个 session 子 agent token 占比 > 80% 且总 token > 1000 万 | info | 同上 |

同类多条合并为一条（例："3 个案件 open 超过 14 天"），最多展示 3 个链接。

### 4.3 每周复盘

**表**（migration 0005）：

```sql
CREATE TABLE weekly_reviews (
  week TEXT PRIMARY KEY,          -- "2026-W39", 东京 ISO 周
  text TEXT NOT NULL,             -- markdown
  model TEXT NOT NULL,
  stats_json TEXT NOT NULL,       -- 生成时喂给 LLM 的统计原文, 事后可核对
  generated_at TEXT NOT NULL,     -- UTC ISO
  machine TEXT NOT NULL
);
```

**接口**：`GET /api/reviews?limit=N`（新到旧，默认 8）；`POST /api/reviews {week, text, model, stats_json, machine, force?}` —— 已存在且 `force` 不为真 → 200 `{stored:false}` 不覆盖；否则写入 → `{stored:true}`。

**生成**（`src/worklog/review.py`，harvest 末尾调用）：

1. 上一周 = 东京时区当前 ISO 周的前一周。
2. `GET /api/reviews` 已有该周 → 跳过。
3. `GET /api/dashboard?from=<周一>&to=<周日>`，只取统计与 hints（不传任何对话原文）；同时取上一周的已有复盘文本（若有）用于对照。`rhythm.heatmap`（7×24 原始矩阵）不进提示词：`digest_rhythm` 把它换成带标签的 `rhythm.time_of_day`（高峰整点、时段占比、每天带日期/星期的连续工作时段），`stats_json` 记的也是这份（2026-10-12，见 `docs/projects/2026-10-12-dashboard-heatmap/`）。API 本身不变，网页热力图照旧读原矩阵。
4. `claude -p`（复用 `harvest/summarize.py` 的调用方式与 `summarize_model`），提示要求输出中文 markdown：本周概况（3 行内）、做得好的 1–2 点、可改进的 2–3 条**具体可执行**建议（引用具体数字）、对照上周建议是否改善。
5. `POST /api/reviews`。

多台机器都跑 harvest 时，以主键先写入者为准，不会重复。

**手动**：`wl review [--week 2026-W39] [--force]`。

## 5. 页面 `#/dashboard`

成为默认路由（空 hash 进入 dashboard；现有 `#/timeline` 等不变）。顶部区间选择：本周 / 本月 / 近 4 周（默认）/ 近 3 个月。

自上而下：

1. 概览卡片一行（6 张），每张带环比箭头与百分比；上期为 0 时显示「新」而非无穷大。
2. 规则提示列表（warn 在前）。
3. 本周 AI 复盘（最近一期；可展开往期列表）。无复盘时显示「尚未生成，下次 harvest 时生成」及 `wl review` 提示。
4. 时间花在哪 / AI 使用效率 / 工作节奏 / 产出 四个区块。

图形用手写的 SVG / CSS：横向条形、折线、热力格子；表格用于排行。不引入图表库。窄屏单列。无数据时各区块显示「暂无数据」。沿用现有 `styles.css` 的变量与类名风格，不做新视觉。

## 6. 出错处理

- 复盘生成失败（claude 不可用、超时、服务端不可达）：harvest 仍返回成功，stderr 打印一行警告；不进 outbox，下次 harvest 自然重试。
- `/api/dashboard` 失败：页面显示错误与重试按钮，其余页面不受影响。
- 迁移 0005 须在 push 前 remote 执行（`GET/POST /api/reviews` 依赖新表；`/api/dashboard` 不依赖）。

## 7. 测试

- `stats.ts` / `hints.ts` 单元测试（手工构造行）：跨东京午夜、hidden、minutes_override、note 分钟、无案件 note、未定价 / 未采集、零数据、上期为 0、区间边界含首尾、每条 hint 的触发与不触发、合并规则。
- **一致性测试**：同一 fixture 周的 dashboard `overview.minutes` = `/api/weeks/<week>/timeline` 的 `total_minutes`。
- 路由测试（miniflare D1）：参数校验 400、默认区间、`/api/reviews` 冲突不覆盖与 `force` 覆盖。
- Python：上一周计算（东京时区、跨年 ISO 周）、已存在跳过、claude 失败不影响 harvest 结果、`wl review --force`、喂给 LLM 的输入不含对话原文。
- web：各区块渲染、空数据、区间切换重新请求、hint 链接、默认路由为 dashboard、现有路由不回归。
- 用真实 D1 数据抽检：近 4 周每一周的 dashboard 总分钟 = 该周 timeline `total_minutes`（规则 A 抽检，结果留 evidence）。

## 8. 已知近似

- 时段热力图、深夜占比与周末占比按活跃区间切到东京整点后计入（2026-09-30 起）；区间内的空闲间隔（>30 分钟）不计。`active_intervals` 未回填的旧 session 仍整段记在开始时刻。
- token 与费用没有按天的原始数据，按分钟份额比例分摊到各天：一个跨日 session 昨天 3 小时、今天 1 小时，则今天视图显示它 1/4 的 token。`avg_start / avg_end` 仍按 session 的开始 / 结束时刻。
- 专注段 = 单个 session 时长，不合并相邻 session。
- 费用是 API 等价估算，不是实际订阅支出；Codex 模型未定价。
