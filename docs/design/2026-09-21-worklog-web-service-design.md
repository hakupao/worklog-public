# worklog Web 服务化 设计书

日期: 2026-09-21
状态: 待用户审阅
前置文档: `2026-09-18-worklog-design.md`（MVP，CLI 版）

## 1. 背景与目标

MVP 做成了 CLI：`wl harvest` 自动收集 session → `data/*.jsonl` → `wl report` 出 xlsx。
实际使用后发现缺口：**收集到的内容看不见、改不了**。确认摘要、纠正案件归属、调整工时只能靠
`wl ls / show / link` 逐条敲命令或直接翻 jsonl，不直观。另外用户有两台工作电脑（Mac mini + Win11），
靠 git 同步 jsonl 容易冲突（`sync.py` 是改动最频繁的文件）。

目标：把 worklog 变成一个**网络服务**——

1. 各电脑后台**自动收集**，无需人工触发
2. 系统**自动填好周报**各栏
3. 用户在**网页上审阅、修改**（任何设备浏览器可用）
4. 满意后**一键下载 xlsx**

非目标（本期不做）：对接外部勤怠/工时系统；Google Sheets 写入；多用户；手机端专门适配；
上传原始对话日志。

## 2. 总体架构

```
[Mac mini] 采集器 (Python, launchd 每小时) ─┐
                                            ├─ HTTPS + Service Token ─▶ Worker API ─▶ D1
[Win11]    采集器 (Python, 任务计划 每小时) ─┘                              │
                                                         Web 界面 (Cloudflare Access 保护)
```

- **采集端（每台电脑，Python）**：读本地 Claude Code / Codex 日志、`claude -p` 生成摘要、计算案件归属，
  把结果推送到 API。原始对话**不上传**，只传摘要与元数据。
- **服务端（Cloudflare Worker，Hono + TypeScript）**：REST API + D1 存储 + 周报聚合 + xlsx 生成。
- **前端（React + Vite）**：作为 Worker 静态资源一并部署。
- **CLI**：`wl new / note / done / hold / harvest` 保留，改为调 API（Claude Code 中 `wl` skill 的起票习惯不变）。

### 仓库结构（monorepo）

```
worklog/
├── src/worklog/          # Python：采集器 + 精简 CLI
│   ├── harvest/          #   保留；输出端由 store 改为 api_client
│   ├── api_client.py     #   新增：HTTP 客户端 + outbox 重发
│   ├── cli.py            #   改调 API
│   └── config.py         #   新增 api_url；凭据从独立文件读取
├── server/               # 新增：Worker
│   ├── src/routes/       #   tasks / sessions / notes / machines / reports
│   ├── src/report/       #   weekly.ts + xlsx.ts（移植自 Python）
│   ├── src/db/           #   D1 查询层
│   └── migrations/       #   D1 schema
├── web/                  # 新增：前端
└── templates/            # agency.toml / site.toml，服务端构建时打包进去
```

退役（第 6 步，验收通过后删除）：`sync.py`、`store.py` 的 jsonl 读写、Python 版 `report/`、
`wl link / unlink / relink / ls / show / report` 等被网页取代的子命令。

## 3. 数据模型（D1）

字段沿用 `models.py`，以下只列新增与关键约束。

**tasks** — 同 `Task`。新增 `updated_at`。

**sessions** — 同 `Session`。
- upsert 键为 `id`（`"S" + session_id[:8]`，与现有 jsonl 的去重键一致）；冲突时不更新 `machine / agent / session_id`。
  不用 `(machine, agent, session_id)`：现有 `wl link` 会把 `machine` 改写为执行命令的机器，三元组会产生重复行
- 新增人工字段：`summary_edited TEXT NULL`、`minutes_override INTEGER NULL`、`hidden INTEGER DEFAULT 0`
- 新增 `updated_at`
- 展示与周报取值规则：`summary_edited ?? summary`，`minutes_override ?? active_minutes`；`hidden=1` 不计入周报

**notes** — 同 `Note`。新增 `updated_at`。网页"手动添加记录"写入此表。

**machines** — `name PK, last_seen_at`。每次上报时更新。

**report_overrides** — `(week, template, sheet, row_key, column) PK, value, updated_at`。
周报页逐格修改的措辞存这里；`row_key` 用稳定标识（task id / 日期 / session id），重新生成周报时按键回填。

### 核心不变式：人工修改不被采集器覆盖

采集器 upsert 只写自动字段（`summary, summary_source, active_minutes, turns, ended_at` 等）。
- 永不触碰 `summary_edited / minutes_override / hidden`
- `link_method = 'manual'` 的行，采集器不再改 `task_id` 和 `link_method`

此规则在服务端 upsert 的 SQL 层强制，不依赖采集器自觉。

### 时间约定

- `sessions.started_at` / `ended_at` 是 ISO-8601 时刻（instant），通常为 UTC（`...Z` 或 `+00:00`）。
- `updated_at`、`machines.last_seen_at` 是服务端写入的 UTC ISO-8601 时刻。
- `ts` 是客户端的本地挂钟时间（naive local wall-clock），仅供参考，不用于按日/周分组。
- `tasks.received_at` / `done_at` 是日历日期（`YYYY-MM-DD`），以 Asia/Tokyo 为准。
- 任何按日或按周对 session 分组的逻辑，**必须先把 instant 转换为 Asia/Tokyo 时区再取日期，绝不能直接对存储的字符串做切片**。现有参考实现见 `src/worklog/report/weekly.py` 的 `_local_date`。

## 4. API

全部在 `/api/` 下，JSON。

| 方法 | 路径 | 用途 | 调用方 |
|---|---|---|---|
| POST | `/api/ingest/sessions` | 批量 upsert session + 更新 machines | 采集器 |
| GET | `/api/tasks?status=` | 案件列表（采集器算归属前拉 open 案件） | 采集器 / Web / CLI |
| POST / PATCH | `/api/tasks`, `/api/tasks/:id` | 新建 / 编辑 / 改状态 | Web / CLI |
| GET | `/api/tasks/:id` | 详情（含关联 session、note、累计工时） | Web |
| GET | `/api/weeks/:week/timeline` | 某周按天分组的 session + note | Web |
| PATCH | `/api/sessions/:id` | 改摘要 / 工时 / 归属 / 隐藏 | Web |
| POST / PATCH / DELETE | `/api/notes` | 手动记录 | Web / CLI |
| GET | `/api/machines` | 各机器最后上报时间 | Web |
| GET | `/api/reports/:week/:template` | 周报预览数据（已应用 overrides） | Web |
| PUT / DELETE | `/api/reports/:week/:template/cells` | 写入 / 清除单格 override | Web |
| GET | `/api/reports/:week/:template/xlsx` | 下载 xlsx | Web |

**并发**：PATCH 携带客户端所见的 `updated_at`；不一致返回 409，前端提示"已在别处被修改"并刷新。

## 5. 认证与数据安全

- 浏览器 → **Cloudflare Access**，策略仅允许用户本人邮箱
- 采集器 / CLI → **Access Service Token**（`CF-Access-Client-Id` / `CF-Access-Client-Secret` 请求头）
- 凭据存放在 `~/.worklog/credentials.toml`（仓库之外），`config.toml` 只放 `api_url` 和 `machine`，避免凭据进 git
- Worker 校验 Access JWT（`Cf-Access-Jwt-Assertion`），不只依赖边缘策略
- **过渡期**：Access 在第 6 步才配置，而采集器第 2 步就要推送到公网 Worker。第 1–5 步期间 `/api/*` 用
  Bearer token 保护（Worker secret `API_TOKEN` + 本机 `credentials.toml` 的 `api_token`）；第 6 步叠加 Access
- 上云的数据范围：摘要、cwd、时间、轮数、案件信息。原始对话留在本地

## 6. 采集端

- `harvest/` 的日志解析、琐碎 session 过滤、并行摘要、hook 触发 session 跳过等逻辑原样保留
- 自动归属（`link.py` 的目录匹配 + 案件时间窗）留在采集端：运行前 `GET /api/tasks?status=open,hold`，本地算好再上报
- **Outbox**：上报失败（断网 / 5xx）→ payload 写入 `~/.worklog/outbox/<ts>.json`，下次运行先重发。
  upsert 幂等，所以重发安全
- 增量状态 `.harvest_state.json` 保留，移到 `~/.worklog/`
- 调度：macOS launchd / Windows 任务计划，由"平日 18:00"改为**每小时**
- 摘要失败 → 沿用现有 fallback，`summary_source=fallback`

## 7. Web 界面

界面文字中文；周报内容日文（与现状一致）。顶栏常驻三个 tab + 机器状态指示
（`macmini ● 12 分前`；超过 24h 未上报变黄）。

### 7.1 时间线（主页）

以周为单位，按天折叠分组。每条 session 卡片显示：时间段、项目、案件下拉、工时、摘要、
agent · 机器 · 轮数。

- 摘要、工时：点击就地编辑，写入 `summary_edited / minutes_override`；已修改的显示标记，可"恢复自动值"
- 案件下拉：改归属 → `link_method='manual'`；下拉底部有"新建案件…"
- `隠す`：设 `hidden=1`（不删除，可在"显示已隐藏"里找回）
- 未归属 session 高亮 ⚠，周标题处显示未归属件数
- `summary_source=fallback` 的显示"待完善"标签
- `+ 手动添加记录`：写 note（用于 Web AI、会议等无日志的工作）
- 周切换 ◀ ▶，显示周合计工时

### 7.2 案件

列表（対応中 / 保留 / 完了 筛选）+ 详情抽屉：依頼元、项目、案件名、考え方、成果物、
受領日 / 完了日、手动工时、关联 session 与 note、累计工时。可新建、编辑、改状态。
依頼元输入框从已有案件的依頼元去重值中自动补全。`config.toml` 的 `[requesters]` 别名和
`[projects]` 目录映射仍只在本地 CLI / 采集器使用，不迁到服务端。

### 7.3 周报

选周 + 选模板（agency / site）。按模板中启用的 sheet（サマリー / 案件一覧 / 日別作業 / 成果物 / 稼働）
分子 tab 显示表格预览。

- 单元格点击编辑 → 写 `report_overrides`；改过的格子有标记，可单格"恢复自动生成"
- 案件行可展开查看由哪些 session 组成
- 存在未归属 session 时显示警告条，链接跳回时间线
- `⬇ 下载 xlsx`：服务端生成，文件名沿用 `2026-W39-agency.xlsx`

## 8. 周报移植（Python → TypeScript）

`weekly.py`（161 行，聚合）+ `xlsx.py`（175 行，openpyxl 从零绘制）移植为 `weekly.ts` + `xlsx.ts`（ExcelJS）。
模板 toml 在构建期转成 JSON 打包。

**验收**（规则 A：改写率 100%，必须独立核验）：
- 基准：现有 W38 数据 + `reports/2026-W38-{agency,site}.xlsx`
- 对比脚本逐 sheet 逐格比较：单元格值、合并区域、列宽、数字/日期格式、表头样式
- 两个模板全部一致才算通过；结果留 `evidence/`。通过前不得删除 Python 版报表

风险：ExcelJS 在 Workers 运行时的兼容性。**第 5 步开头先做 30 分钟 spike** 验证能在 Worker 内生成并返回 xlsx；
若不可行，降级为浏览器端 ExcelJS 生成（同一份 `xlsx.ts`，调用位置不同），API 只返回预览数据。

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| 采集器上报失败 | 写 outbox，下次重发；进程正常退出，不阻塞调度 |
| 摘要失败 | fallback 摘要 + 网页"待完善"标签 |
| 网页编辑失败 | 乐观更新回滚 + toast 提示 |
| 并发编辑 | `updated_at` 不一致 → 409 → 提示并刷新 |
| 机器长时间未上报 | 顶栏指示变黄 |
| ingest payload 校验失败 | 400 + 具体字段；采集器记日志，该 payload 移入 `outbox/rejected/` 不再重试 |

## 10. 测试

- **Python**（pytest）：现有测试保留；新增 api_client mock 测试、outbox 重发、rejected 分流
- **Server**（vitest + Miniflare 本地 D1）：upsert 幂等；**人工字段与 manual 归属不被覆盖**；
  timeline / report 聚合；override 回填；409 并发
- **xlsx**：第 8 节的逐格对比脚本
- **前端**（Playwright 冒烟）：改摘要 → 改归属 → 周报体现 → 下载 xlsx

## 11. 数据迁移

一次性命令 `wl api-import`（复用 CLI 的配置与 ApiClient）：读 `data/{tasks,sessions,notes}.jsonl` → 调 ingest / tasks / notes API。
幂等，可重跑。迁移后核对三类记录条数一致。`data/` 保留在 git 历史中，第 6 步后不再写入。

## 11.5 修订记录（2026-09-22，计划 1 上线后）

以下修订优先于正文中与之冲突的表述。

1. **Access 提前。** 用户选定网页登录直接用 Cloudflare Access，不做临时的"粘贴 token"登录。Worker 同时接受有效的 Access JWT
   或 Bearer token（带了 JWT 但无效 → 401，不回落）。JWT 校验代码在计划 2A，控制台开启 Access 与采集器服务令牌在计划 2B。
   §5 的"过渡期"相应缩短：Bearer 保留为采集器通道，直到服务令牌全面启用。
2. **案件的事实来源提前切到 API。** 网页能新建/编辑案件之后，CLI 的整条 PUT 会冲掉网页的修改，采集器也看不到网页新建的案件。
   因此配置了 API 时：`wl new` 由服务端分配 id；CLI 与采集器读取案件时以 API 为准（不可达则退回本地）。session 与 note 仍是双写，jsonl 仍是它们的事实来源。
3. **网页上"取消归属"= `task_id=NULL, link_method='manual'`。** 否则采集器下一轮会自动关联回去。
4. **Codex 子 agent fork 不采集。** 首条 `session_meta` 带 `forked_from_id` 或 `source.subagent` 的 rollout 整份跳过
   （它们携带父会话的 `session_id` 并回放父会话历史）。与 Claude Code 跳过 `isSidechain` 对齐。
5. **每台机器不同的配置不进仓库。** `machine` 可由 `~/.worklog/local.toml` 覆盖；`config.toml` 里的值只是缺省。
6. **API 增补**（§4 表格之外）：`GET /api/me`、`GET /api/requesters`、`DELETE /api/notes/:id?updated_at=`；
   `GET /api/weeks/:week/timeline` 支持 `?include_hidden=1`，响应含每日 `minutes`、`total_minutes`、`unassigned`、`hidden`。
7. **计划拆分**：计划 2 拆为 2A（采集器修正 + 编辑 API）与 2B（前端 + Access 控制台配置 + Win11 接入）。

8. **进度（2026-09-22 深夜）**：§12 的第 1–4 步与第 6 步的 Access、正式部署、Workers Builds 已上线（计划 1、2A、2B）。
   Workers Builds 的 deploy 命令是 `npx wrangler deploy`，**不含 D1 迁移**（构建令牌无 D1 权限），迁移在 push 前手动执行。
   尚未完成：Win11 接入（清单 `docs/projects/web-service/evidence/checklists/win11-onboarding.md` 已备好，机器不在手边）、
   第 5 步周报移植与周报页、第 6 步的删除 git sync / 旧报表 / 被取代的 CLI 子命令、README 收尾——这些归入计划 3。
9. **计划 3 的裁定。**（a）保留 `wl ls`（改为读 API 的薄命令）：`/wl` 技能靠它找 task id；`show / link / unlink / relink / report / api-import` 按原计划退役。（b）周报模板从 `templates/*.toml` 改为 `server/src/report/templates.ts` 常量（Python 退役后 toml 没有第二个读者）；Task 5 对比通过后删除 toml。
   （c）`report_overrides` 逐格覆盖不做版本检查（单用户可接受的权衡）。（d）上线分两次合并：周报功能（可回滚、无破坏）与切换（不可逆）各一次 hard checkpoint；每次合并前手动执行 D1 迁移。
   （e）采集器不再读回 session：manual 归属由服务端 UPSERT 保证，`new/updated` 计数来自 ingest 响应。（f）`.harvest_state.json` 移到 `~/.worklog/harvest_state.json`，首次运行自动搬迁。
   （g）Win11 接入不再需要 git 免交互 push（git 同步已删），清单相应简化。
10. **最终状态（2026-09-23）。** 服务化完成：周报页与 xlsx 下载上线（M1 合并 `50ebd54`）；采集器与 CLI 仅走 API，jsonl、git 同步与 Python 周报退役（M2 合并 `6bf40ed`，不可逆）。
   保留的 CLI 子命令为 `new / note / done / hold / ls / harvest`；harvest 的状态文件在 `~/.worklog/harvest_state.json`。
   剩余：Win11 接入（清单 `docs/projects/web-service/evidence/checklists/win11-onboarding.md`）。
11. **跨日 session 按天拆分（2026-09-30）。** 此前 session 的全部 `active_minutes` 记在 `started_at` 的东京日期，一个开了一天多的窗口会把今天的工作累加到昨天。现在采集器随 session 发 `active_intervals`（活跃簇的 UTC 起止，迁移 `0006`，`--refresh-meta` 可回填），服务端 `split.ts` 按东京整点切片并把 `minutes_effective` 整数分摊到各天；时间线 / 周报 / dashboard 三处按份额聚合，时间线的 session 条目多带 `minutes_on_day`。周期查询改为 `started_at < 周末 AND ended_at >= 周初`。详见 `docs/projects/2026-09-30-session-day-split/`。

## 12. 交付顺序

Tier 2 项目：建 `PLAN.md`、`_progress.json`、`evidence/checkpoints/`、`evidence/failures/`，收尾写 `RETROSPECTIVE.md`。
每步结束都是可用状态。

1. Server 骨架 + D1 schema + API + jsonl 导入
2. 采集器改推送 + outbox；调度改每小时；CLI 改调 API
3. Web 时间线页 —— **到此核心痛点解决**
4. Web 案件页
5. ExcelJS spike → 周报 TS 移植 → 逐格对比验收 → 周报页
6. Access 配置、正式部署、Win11 接入、删除 git sync / 旧报表 / 被取代的 CLI 子命令、更新 README

**过渡期双写**：第 2–5 步期间，采集器和 CLI 写操作同时写 jsonl（旧）和 API（新），旧流程
（jsonl + git sync + `wl report`）保持可用作为兜底，过渡期的周报不受影响。过渡期内网页上的人工修改
不会反映到旧 `wl report`，这是已知且可接受的限制。第 6 步移除 jsonl 写入与 git sync，完成切换。

**开发隔离**：主工作目录保持在 `main`（定时 harvest 会在此目录自动 commit/push），
实现工作在 git worktree 的功能分支上进行。
