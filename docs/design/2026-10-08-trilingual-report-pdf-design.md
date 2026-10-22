# 三语数据 · 周报精简 · PDF 周报（设计书）

2026-10-08 brainstorming 定稿，待用户审阅。三项需求来自用户在表世界的使用观察。表 / 里两个世界渲染的是同一套 v2 组件，所以本设计一次覆盖两个世界。

用户原话：

1. 周报界面文字太多：每周总结、每天小结各 1–2 句就够，不要细节。
2. 周报导出改成 PDF，内容和版式全部重做。
3. 不只是网页上的界面文字，我录入的文字也要三语：数据库存三份，内容由 AI 生成。切换语言后，所有界面上的所有文字都要变成那种语言。
4. （不进本设计）里世界还有些文字和组件不是 LED 点阵，融入感不够，以后慢慢改。

## 0. 已定决策

| # | 决策 | 来源 |
|---|------|------|
| D1 | 周报新增两层 AI 总结：每周 1–2 句、每天 1 句。session 明细默认收起，点开可看，单元格照旧可编辑 | 用户选择 |
| D2 | 总结可以手改。改过的条目 AI 不再覆盖，可以一键"重新生成" | 用户认可草案 |
| D3 | PDF 只做一种模板，不分派遣元 / 現場。一张 A4 放下全部内容，比网页更简单。风格沉稳严肃、简约高级，不追求酷炫 | 用户原话 |
| D4 | PDF 版式采用"②+③"：标题靠左、信息在右，A1 的表格罫線但不要外框和印章，日别每行带工时横条。期間 / 概要 / 日別 / 案件 四个标签格宽度一致。原型：`docs/design/prototypes/2026-10-08/pdf-weekly.html` | 用户逐轮选定 |
| D5 | PDF 导出时可选中 / 日 / 英，默认日语 | 用户选择 |
| D6 | PDF 由服务端渲染（Cloudflare Browser Run），一键下载 | 用户选择 |
| D7 | 工时按时间轴去重（墙钟）：网页周报、xlsx、PDF 一起改 | 用户选择 |
| D8 | 一天从 05:00 算起。周报一周 = 上周六到本周五，共 7 个整天 | 用户原话 + 选择 |
| D9 | 三语覆盖所有文字：案件、备注、计划、今日安排、session 摘要、周复盘、计划判定、周报手改单元格、新增的周 / 日总结 | 用户原话 |
| D10 | 翻译由 Worker 调 Anthropic API，用 Max 20x 每月附赠的 $200 API 额度 | 用户选择（已核实官方文档） |
| D11 | 在哪种语言下改，哪种就是原文，另外两种重新翻译 | 用户选择 |
| D12 | 存储用通用翻译表（方案 B），原表字段不动 | 用户选择 |

## 1. 拆分与顺序

| 顺序 | 子项目 | 依赖 |
|---|---|---|
| S1 | 三语基础设施（§2） | — |
| S2 | 周报：周期改为周六到周五、墙钟工时、周 / 日总结、页面精简（§3） | S1（新总结要翻译） |
| S3 | PDF 导出 + xlsx 三语（§4） | S1、S2 |

三个子项目各写一份 plan，分别上线、分别验收。按用户规则属于 Tier 3：过程记录放在 `docs/projects/2026-10-08-trilingual-report-pdf/`，包括 PLAN、进度、trace、subagent prompts、抽检矩阵、retro。

不做的事：
- v1 旧界面（`web/src/pages/*`）保持现状，只显示原字段。
- 里世界 LED 打磨。
- 统计页、首页、周复盘的周定义仍然是周一到周日。
- 采集器的 Go 重写。

---

## 2. S1 三语基础设施


> **实施修订（2026-10-08，写 S1 计划时）：** 本节的 §2.1、§2.3、§2.5 被下面三点取代，以 `docs/plans/2026-10-08-trilingual-1-i18n-infra.md` 为准：
> 1. **存储**：一个字段只存一行，`translations(entity, entity_id, field, source_text, source_lang, zh, ja, en, model, failed_text, attempts, next_try_at, last_error, updated_at)`。`source_text` 和原表当前原文不一致，就表示过期。不建 `translation_queue`，也不算 hash。
> 2. **触发**：写入路径不入队。cron 每 5 分钟按注册表扫全部字段，找出没译过或过期的条目，所有写入途径和历史回填都由这一遍扫描覆盖。网页编辑后，用 `waitUntil` 立即译那一条。
> 3. **读取**：不加 `tr` 字段。v2 每个请求都带 `X-Lang` 头，服务端返回前把文字原地换成该语言的新鲜译文。切换语言时，前端先换头、再失效缓存。PATCH 收到"原样回传的译文"时，不当作编辑。
>
> 另外：`tasks.deliverables` 基本都是路径，S1 不翻；xlsx 在 S1 固定用日语，S3 再加语言参数。

### 2.1 存储

新迁移 `0011_translations.sql`：

```sql
CREATE TABLE translations (
  entity      TEXT NOT NULL,   -- 'task' | 'note' | 'plan_item' | 'day_plan_item' | 'session' | 'weekly_review' | 'report_override' | 'digest'
  entity_id   TEXT NOT NULL,   -- 该表主键；report_override 用 week|template|sheet|row_key|column，digest 用 week|day 拼接
  field       TEXT NOT NULL,
  lang        TEXT NOT NULL CHECK (lang IN ('zh','ja','en')),
  text        TEXT NOT NULL,
  is_source   INTEGER NOT NULL DEFAULT 0,  -- 1 = 用户 / 生成器写下的原文，原样保存
  source_hash TEXT NOT NULL,   -- 翻译时原文的 sha-256；和当前原文对不上 = 过期
  model       TEXT,            -- 原文行为 NULL
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (entity, entity_id, field, lang)
);
CREATE TABLE translation_queue (
  entity TEXT NOT NULL, entity_id TEXT NOT NULL, field TEXT NOT NULL,
  source_hash TEXT NOT NULL,   -- 入队时原文的 sha-256，写回前比对
  enqueued_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  next_try_at TEXT NOT NULL, last_error TEXT,
  PRIMARY KEY (entity, entity_id, field)
);
```

**原文的位置不变。** 原表的原字段（例如 `tasks.title`）始终保存最近一次写入的原文，原文可能是任何一种语言。CLI、harvest、v1 界面、现有查询照常读写它。`translations` 只是叠加的一层。

### 2.2 要翻译的字段

| entity | 字段 | 说明 |
|---|---|---|
| task | title, project, thinking, deliverables | deliverables 是 JSON 数组，逐项翻译，结果仍存成 JSON 数组。requester 是人名，不翻 |
| note | text | |
| plan_item | text | |
| day_plan_item | text, detail, ai_progress, ai_note | ai_status 是枚举，ai_evidence 是 id 列表，都不翻 |
| session | summary | 原文 = 有效摘要（`summary_edited ?? summary`）。harvest 刷新 `summary` 且没有手改时，重新入队 |
| weekly_review | text | Markdown，翻译时保留结构 |
| report_override | value | |
| digest | text | S2 新增的周 / 日总结 |

不翻的内容写进 prompt 约束：人名、机器名、路径、代码与标识符、ID、版本号、提交 hash、数字与单位、SDTM 等领域缩写。

### 2.3 写入与触发

- **入队**：任何写路径只要改动了上表里的字段（网页编辑、CLI、harvest 上报、AI 生成），就在同一个 D1 batch 里 upsert 一行 `translation_queue`，同时写入当前原文的 `source_hash`。重复入队时覆盖 hash，并把 attempts 清零。删除实体时，同一个 batch 里一起删掉它的 `translations` 和 `translation_queue` 行。
- **网页单条编辑**：响应返回后，用 `ctx.waitUntil` 立刻处理这一条，几秒内补齐三语。失败就留在队列里。
- **批量写入**（harvest ingest、AI 生成）只入队，不在请求里调用 API，避免一次 harvest 同时打出上百个请求。
- **定时排空**：仓库目前没有 `scheduled` handler，`wrangler.jsonc` 里也没有 triggers。S1 新增 `triggers.crons = ["*/5 * * * *"]` 和一个 `scheduled` handler；S2 再加一条 `"2,32 * * * *"`，handler 里按 `event.cron` 分流。翻译 cron 每 5 分钟一次，每次最多处理 30 条，并发 3。失败按 `attempts` 指数退避（5 分 → 1 小时封顶）。如果遇到额度不足（credit balance too low），整轮停止，下一轮再试。
- **历史回填**：上线后跑一次脚本，把现有全部文字入队，由 cron 慢慢排空。现有数据约 281 个 session 和几十条其它文字，大约 400 个字段，按上面的速度约 70 分钟排空，费用在一美元以内。数据量太小，不值得为此走 Batches API 的轮询流程。

### 2.4 一次翻译调用

- 模型 `claude-sonnet-5-5`（Sonnet 5.5），通过 Anthropic Messages API。密钥放在 Worker secret `ANTHROPIC_API_KEY`（用 `wrangler secret put` 设置，本地放 `.dev.vars`），不进仓库。
- 输入：一个字段的原文，加上实体类型作为上下文。输出 JSON：`{"source":"ja","zh":"…","ja":"…","en":"…"}`。
- **原文语言靠检测，不靠界面语言。** 用户在中文界面里输入日文时，日文就是原文。所以 D11 的实际含义是：用户刚写下的那段文字原样存进它所属语言的位置，`is_source=1`；另外两种语言用翻译覆盖。模型输出里原文语言那一项会被丢弃，以服务端保存的原文为准。
- 写回前检查：重新读取当前原文，确认 `sha256(当前原文) == 队列行的 source_hash`。不一致说明翻译途中原文又被改了，丢弃这次结果，队列行保留。成功写回后删除队列行。
- 写翻译不改原表的 `updated_at`，所以不会和乐观锁冲突，也不会引发 409。

### 2.5 读取

- 所有返回上述实体的 API 增加一个 `tr` 字段：`{ "title": {"zh":"…","ja":"…","en":"…"}, … }`，只包含已有的语言。切换语言时前端直接用缓存，不必重新请求。
- 前端新增一个取文字的函数：`tr[field][lang]`，没有就退回原字段。v2 所有显示数据文字的地方（Led、表格、抽屉、图表标签、tooltip）都改用它。
- v2 里所有写死 `lang="ja"` 的地方（目前约 20 个文件，包括 DaysView、CellDrawer、TaskDrawer、ItemDrawer、DayDrawer、SessionDrawer、SessionTip、NoteDrawer、PlanRows、RunChart、Chips、TasksView、DeliverablesView 和统计页的若干视图；以 `grep -rn 'lang="ja"' web/src/v2` 的结果为准）都改成实际显示的语言，同时改用上面的取文字函数。
- 编辑框打开时显示当前语言的版本。保存后乐观更新：当前语言的位置先显示刚输入的文字，另外两种语言等后台翻译回来。

### 2.6 运维

- 在 Console 给 worklog 单独建一个 workspace，设月度花费上限（建议 $20），即使出现失控的循环也有上限。
- 额度用完或 API 出错时，页面显示原文，不影响任何功能。

### 2.7 测试与抽检

- 单元测试：入队和删除级联、hash 过期判定、原文语言槽保护、退避、cron 每批上限。测试里 mock Anthropic 的 fetch，不发真实请求。
- **规则 A 抽检**：翻译属于改写率 >50% 的步骤。回填完成后抽 N=20 个样本，按实体类型和语言方向分层抽取（每种实体至少 2 个，zh→ja/en、ja→zh/en 都要有）。由不同 subagent_type 的独立 reviewer 核对四点：意思一致；人名、代码、ID 原样保留；没有增删事实；Markdown 结构完整。结果写进 `evidence/step_NN_audit.md`，并汇总到 audit_matrix。

---

## 3. S2 周报：周期、墙钟工时、两层总结、页面精简

### 3.1 周期（D8）

- 一天 = [D 05:00, D+1 05:00)，JST。
- 周报的一周 = 周六 05:00 → 下周六 05:00。周 key 沿用 `YYYY-Www` 格式，**取这一周周五所在的 ISO 周**。例如 W40 = 2026-09-26（六）到 10-02（五）。URL、`report_overrides`、`report_downloads` 的 key 格式都不变。`report_overrides` 目前 0 行，不需要迁移数据。
- 只有周报相关的页面和导出（网页周报、xlsx、PDF、周 / 日总结）用这个定义。统计、首页、周复盘不变。
- **代码落点**：
  - 服务端：`server/src/jst.ts` 新增 `reportWeekRange(week)` 和 `reportWeekOf(instant)`。现有 `weekRange` 不动，仍给其它模块用。`buildWeek` 和周报路由改用新函数。
  - 前端：`web/src/lib/jst` 新增同名的两个函数。周报页的"本周"按钮、`isThisWeek`、`shiftWeek` 的显示日期、`predict/snapshot.ts` 的 `week` 字段，以及 `rules.ts` 的 `report.undownloaded` 规则，都改用报告周。例如 10/3（六）属于 W41 周报。
  - 前后端用同一组 fixture 测试（周六 04:59 / 05:00、周五 23:59、跨年的 ISO 周）。
- 现有 `split.ts` 是按午夜切分的，周报改用 05:00 日界。统计页已有的 05:00 日界逻辑（`web/src/v2/pages/stats/viz/day.ts`）作为口径参照。

### 3.2 墙钟工时（D7）

新增服务端纯函数模块 `server/src/report/wall.ts`，按以下规则计算：

1. 参与计算的是未隐藏的 session，取它们的 `active_intervals`。缺少区间的 session（目前只有 4 个，都在 2026-05 之前）按 `[started_at, started_at + 有效分钟]` 补成一个区间。
2. 按日界切分后做事件扫描。某一段时间里同时开着若干 session，把它们按**不同的桶**去重：一个桶是一个 task_id，所有未关联的 session 合成一个"未关联"桶。设有 k 个桶，每个桶分得 1/k。同一案件的两个 session 并行时只算一次。
3. 扫描部分的日合计 = 当天区间并集的长度 = 各桶从扫描中分得的时间之和，不会超过 24h。日合计 = 扫描部分 + 第 4、5 条加上的分钟。周合计 = 7 天日合计之和。
   **单个 session 一行显示多少**：某一刻一个桶分得 1/k，再在这个桶里正开着的 session 之间平分。所以同一桶所有 session 行之和 = 这个桶的分钟数，「日別作業」各行加起来和日合计一致。
4. 设置了 `minutes_override` 的 session 不参与扫描。它的覆盖分钟数整份加到自己的桶上，记在开始那一天，代表用户的明确声明，不去重。
5. 备注的 `minutes` 没有区间，整份加到对应案件的当天，不去重。
6. 各字段口径：
   - `summary.total_hours` 改为本周周合计。现在它是各案件累计工时之和，这次改掉。
   - `summary.unassigned_hours` 改为"未关联"桶在本周的分钟数。
   - 「案件一覧」的 `TaskRow.hours`（累计列）保留原含义：有 `hours_manual` 就用它，否则是该案件全部历史 session 的墙钟分配之和。扫描时要带上所有 session，数据量很小，不成问题。
   - 「案件一覧」新增一列"本周"，即本周分配之和。PDF 案件区用的就是这一列。
   - `tasks.hours_manual` 不影响任何按周统计的数字。
7. 全程以分钟计算，只在显示时取整（PDF 和网页显示 0.1h，xlsx 沿用现有格式）。周合计显示的是精确分钟和取整后的结果，所以和各行取整后相加可能差 0.1h，这是可以接受的。

服务端单独实现，但用和 `web/.../viz/wall.ts` 同样的测试用例对拍（并行、同一案件并行、跨 05:00、跨午夜、缺区间、覆盖分钟）。web 现在不引用 server 的源码，这次不为共用代码改构建配置。

`buildWeek`（`server/src/report/weekly.ts`）里按天、按案件的分钟数全部换成这个函数的结果。xlsx 各表随之改变。

### 3.3 周 / 日总结

> **实施修订（2026-10-09，S2b / S2c 上线后）：** 本节的输入、长度上限、生成方式已被取代，以 `docs/design/2026-10-08-s2c-report-cells-digests-design.md` 为准：
> - 长度上限：S2 按下表 45 / 100 字上线，S2b（232fc6b）收到日 30 / 周 60 并加超长重试，S2c（C4）撤掉字数上限，只留安全上限，首次真实运行后调到日 800 / 周 1600（R14，328b517）。
> - 输入与写法：按案件分行写进展、对照计划目标，工时、案件状态、目标完成情况按这一周结束时算（S2c §2.1–§2.2、§2.7，R7）；案件名 / 備考 / 计划文字取当前值，所以本机工具默认只处理本周和上一周（R11）。另存一份 PDF 版 `pdf_text`（C6，迁移 0013）。
> - 生成：API 生成开关 `DIGESTS_AUTO` 默认 `off`，cron 不生成，↻ 只标成待更新；现阶段由本机 `scripts/digests-local.mjs` 用 `claude -p --model opus` 生成后经 `GET …/digest-inputs`、`PUT …/digests/:day/generated` 写回（C5，R11、R12）。打开开关时 cron 用 `claude-sonnet-5-5`（与翻译同一模型），不是下文的 haiku。
> - cron 时刻：第 2、32 分（0e8ef66）。

> 和 brainstorming 时说的相比有一处变化，请审阅：生成位置从"本机采集器 harvest 时"改为 **Worker cron**。理由：做这个决定时 Worker 还没有 API key；现在 S1 给了 Worker 调 API 的能力。在 Worker 生成可以避免 Mac 和 Win11 两台机器每小时重复生成、互相覆盖，也不依赖电脑开着。

- 新迁移 `0012_report_digests.sql`：

  ```sql
  CREATE TABLE report_digests (
    week TEXT NOT NULL,          -- 周报周 key（§3.1）
    day  TEXT NOT NULL,          -- 'YYYY-MM-DD'；整周总结写 ''
    text TEXT NOT NULL,          -- 最近一次的原文：AI 生成时是日语，用户手改后是手改所用的语言
    inputs_hash TEXT NOT NULL,   -- 生成时输入的 hash
    edited INTEGER NOT NULL DEFAULT 0,
    model TEXT, generated_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (week, day)
  );
  ```
- **输入**：
  - 日总结：当天的 session 有效摘要、备注、对应案件名，以及各案件当天的墙钟分钟。
  - 周总结：7 条日总结，加各案件的周工时。
- **生成**：cron 每小时第 2、32 分（避开 */5 同刻只触发一个 cron 的问题）检查本周和上一周。某天或整周的 `inputs_hash` 变了，且 `edited=0`，就重新生成。用 `claude-haiku-5-5`（S2 再定模型） 生成日语，写入后按 §2.3 入队翻译。当天没有任何工作的日子不生成，显示「—」。
- **长度上限**（写进 prompt，并在服务端校验，超出就截断并标记）：

  | | 日总结 | 周总结 |
  |---|---|---|
  | ja | 1 句，≤30 字 | ≤2 句，≤60 字 |
  | zh | ≤27 字 | ≤54 字 |
  | en | ≤15 词 | ≤30 词 |

  要求只写做成了什么，不写过程细节。
  2026-10-08 用户要求再精简（原 45/100）。
- **还没结束的本周**：照常生成，随输入变化刷新。页面标注「进行中」。
- **手改**：网页上可以编辑总结，保存后 `edited=1`，cron 不再覆盖。"重新生成"按钮把 `edited` 改回 0，下一轮 cron 会重新生成；也可以立即在 `waitUntil` 里生成一次。
- **API**：`GET /api/reports/:week/:template` 的返回里增加 `digests: { week, days: [{date, text, tr, edited, stale}] }`；`PATCH /api/reports/:week/digests/:day` 用于编辑或重新生成。
- **规则 A 抽检**：总结的压缩率远超 50%。S2 上线后抽 N=10 个日总结和 3 个周总结，由独立 reviewer 对照原始 session 摘要核对：没有编造的事实，没有漏掉当天最主要的工作，长度符合上限。

### 3.4 页面

- 周报页顶部显示周总结（当前语言），下面是各 sheet 的标签页。
- 「日別作業」默认每天一行：日期、日总结、当天墙钟工时（带横条）。点某一天展开当天的 session / 备注行，现有单元格编辑保留。
- 表 / 里两个世界共用这些组件，里世界里总结文字用 `Led` 渲染。

### 3.5 测试

- `wall.ts` 单元测试覆盖 §3.2 的全部规则和边界。
- `buildWeek` 回归测试：用周六到周五的 fixture，核对各 sheet 数字。
- digest 测试：hash 变化才重新生成；`edited` 的条目不会被覆盖；长度截断。
- 线上核对：
  - 新的 W40（9/26–10/2）周合计，对比同一区间内所有未隐藏 session 有效分钟的简单相加。新周期要重新计算后附上新旧对照。
  - 每天扫描部分的合计不超过 24h。

---

## 4. S3 PDF 导出 + xlsx 三语

> **实施修订（2026-10-09，S3 / S2c 上线后）：** 与下文不同的点，以 `docs/plans/2026-10-08-trilingual-3-pdf-xlsx-i18n.md` 和 `docs/design/2026-10-08-s2c-report-cells-digests-design.md` §2.6、§2.8 为准：
> - PDF 不读 `report_overrides`（手改单元格属于某个模板，PDF 不分模板）。
> - 発行日 = 下载当天的 JST 日期，不是周五。
> - xlsx 文件名带语言：`<week>-<template>-<lang>.xlsx`；PDF 是 `<week>-<lang>.pdf`。
> - 一页保证：缩小方向是 `fit1 → fit2 → fit3 → trim → clamp`，第五级 `clamp` 用行数截断兜底（手改的长总结能走到这里）。S2c 加了放大方向 `grow1–3` 和把剩余高度分给各行的 `spread`（R10）；除了走到 `clamp`，不再用单行省略号。
> - 概要和日別读总结的 PDF 版 `pdf_text`，没有时退回 `text`（S2c C6）。
> - 字体：spike 选方案 A（直接 `<link>` Google Fonts，`evidence/s3_spike.md`）；zh 用 Noto Serif SC / Noto Sans SC，各字体栈带另一种 CJK 作后备。可变字体在 PDF 里被嵌成 Type 3、显得发虚，S2c 改为渲染前用旧浏览器 UA 请求 Google Fonts CSS 拿静态字体（92d3b43），线上 `pdffonts` Type 3 = 0。
> - 汉字 / 假名与半角字母、数字之间插入细空格 U+2009（只改显示）。

### 4.1 版式

以原型 `docs/design/prototypes/2026-10-08/pdf-weekly.html` 为准，ja 和 en 两页都放得下 A4，并留有余量：

- **抬头**：左边标题（週次作業報告書 / 周工作报告 / Weekly Work Report），右边周次和发行日。
- **信息行**：期間、氏名。
- **概要**：周总结。
- **日別**：7 行，每行是日期、日总结、工时横条、工时。周末的横条用浅色。
- **案件**：最多 7 行，其余合并成「その他 N 件」。每行是案件名、依頼元、横条、工时。末行汇总对应案件数、稼働日数、合计。
- **配色**：墨蓝 `#1a2238` 加浅灰底的标签格。四个标签格宽度相同（15mm）。英文页的标签横排。
- **字体**：Shippori Mincho（标题、概要）、Noto Serif JP（正文）、Noto Sans JP（标签和数字）。
- **一页保证**：渲染后在页面里测量内容高度。超出可用高度时，逐级缩小正文字号（最多 3 级）。仍然超出就把案件行数减到 5。测试要覆盖英文长文本的 fixture。

### 4.2 渲染

- 路由：`GET /api/reports/:week/pdf?lang=ja|zh|en`，返回 `<week>-<lang>.pdf`。必须注册在现有的 `/:week/:template` 之前（`reports.ts`），否则会被它先匹配。在 `report_downloads` 里记一条，template 记为 `pdf`。`recordDownload` 的参数类型要从 `TemplateKey` 放宽到 `TemplateKey | "pdf"`。
- 服务端用纯函数 `renderReportHtml(data, lang)` 生成完整 HTML。用 Browser Run binding（`@cloudflare/puppeteer`）执行 `page.setContent(html)`，等 `document.fonts.ready` 后调用 `page.pdf({format:'A4', printBackground:true})`。**不要让无头浏览器打开受 Access 保护的站点 URL。**
- **字体风险**：Browser Run 能否拉到 Google Fonts，以及中日文字体能否正常显示（否则会出现豆腐块），是 S3 plan 的第一个 spike。拉不到时，改为把字体子集放在一个公开、不受 Access 保护的位置（R2 公共桶或独立的 workers.dev 路径）。
- **配额**：Browser Run 免费计划每天 10 分钟，付费计划每月 10 小时。一次 PDF 大约几秒，每周导出几次远在额度内。
- 氏名来自 prefs 新增的 `report.name` 字段，在设置页可以改，默认 `Taro Yamada`。
- 标签文字三语，放在服务端的小字典里。

### 4.3 xlsx

- xlsx 下载也增加 `lang` 参数，默认 ja。sheet 名、表头、状态标签、「その他・調査」等全部走同一份字典；数据文字取所选语言的译文，没有就用原文。
- 两个模板（agency / site）保留，内容随 §3 改为周六到周五和墙钟工时。

### 4.4 页面

周报页的下载区改为：语言选择（默认 ja），加上「↓ PDF」和「↓ xlsx」两个按钮，旁边显示上次下载信息。PDF 按钮不分模板。

### 4.5 测试

- `renderReportHtml` 的快照测试（三种语言）。
- 页数检查：用 en 长文本 fixture 生成 PDF，断言只有 1 页。
- 线上核对：下载 W40 的三语 PDF，用户确认版式和原型一致、中日文字体正常、只有一页。

---

## 5. 风险与待确认

| 风险 | 应对 |
|---|---|
| Browser Run 里字体加载失败 | S3 第一步做 spike，备选方案是自托管字体 |
| 翻译质量（领域术语、人名被翻） | prompt 约束 + 规则 A 抽检；不合格就调 prompt 后重跑受影响的条目 |
| API 额度用完 | 页面退回原文；Console 设 workspace 上限；cron 遇到额度错误就停这一轮 |
| 周期改成周六到周五后，过去周的数字和已下载的 xlsx 对不上 | 预期内的变化，在 S2 上线说明里写明 |
| 墙钟口径让工时比以前少很多 | 预期内的变化，这才是真实的在岗时间；线上核对时附上新旧对照 |
