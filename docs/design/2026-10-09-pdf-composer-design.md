# PDF 编排页（PDF composer）设计

- 日期：2026-10-09
- 状态：草稿，待用户审阅
- 前置：S3（一页 PDF，`5bd0a73`）、S2c（按案件写的 digest，`ce4e613`）、模板合并（`d47e332`，只剩 `weekly`）
- 相关：`docs/design/2026-10-08-trilingual-report-pdf-design.md`（PDF §4）、`docs/design/2026-10-08-s2c-report-cells-digests-design.md`

## 1. 目标与非目标

**目标**
1. 新增一个专门编排周 PDF 的页面：按**案件**决定在 PDF 里单列、并入「その他」还是不出现，并决定单列案件的顺序。
2. 编排结果**按周保存**；新的一周沿用上一周的编排。
3. 选完后点「生成」，由 Worker 调 Sonnet，按当前编排**一次**写出日 / 中 / 英三语的本周概要和每天的概要。
4. 「↓ PDF」用该周的编排和生成文字出 PDF；从未编排过的周，行为与现在完全一样。

**非目标**
- 不改报表页（週報）上的本周概要 / 当日概要（`report_digests`），两边互不覆盖。
- 不改 PDF 的版式（一页 A4、`renderReportHtml` 的结构、fit / grow 步骤）。只改喂给它的数据。
- 不做按「板块」挑选（本周概要 / 日别 / 案件表的取舍或换序），不逐行挑选 digest 文字（用户 10/9 选了「案件」这一层）。
- xlsx 不受影响（xlsx 美化另行排期）。

## 2. 用户决定（2026-10-09）

| # | 决定 |
|---|---|
| U1 | 挑选对象是**案件**（不是板块，也不是逐行文字）。 |
| U2 | 每个案件三种状态：**单列 / 并入その他 / 不出现**。「不出现」的案件不写进文字，但**工时照算**进合计和表里的「その他」行，合计不会对不上。 |
| U3 | **每周单独保存**；新的一周第一次打开时沿用上周的编排；本周新出现的案件默认单列、排在最后。 |
| U4 | 文字跟随编排：选完后**点「生成」让 AI 重写**（用户原话「选完后 AI 即时生成」；按钮触发，不是每拖一下就生成）。 |
| U5 | 生成用 **Worker 调 Sonnet**（花 API 额度，Max 20x 的 $200/月），网页上直接出结果，Win11 / 手机也能用。 |
| U6 | 页面形态采用方案 A：週報下单开「PDF」页，左边案件列表（拖动排序 + 三态开关 + 工时），右边实时预览。 |
| U7 | 第 2 部分（存储、生成、手改、下载、失败处理）按 §4–§7 认可。 |

## 3. 页面与交互

### 3.1 入口与地址
- 地址：`#/v2/report/<week>/pdf`（例如 `#/v2/report/2026-W41/pdf`）。`web/src/v2/route.ts` 的 report 路由加一个 `pdf` 子页；週報页顶栏「↓ PDF」旁加「编排」键进入，编排页左上「← 週報」返回同一周。
- 编排页自带 ◀ ▶ 翻周和导出语言（中文 / 日本語 / EN，默认日本語，与週報页 D5 一致）。

### 3.2 布局
```
┌ ← 週報   ◀ 10/3–10/9 · 第 41 周 ▶            中文 日本語 EN   [生成]  [↓ PDF] ┐
├──────────── 左：案件 ────────────┬──────────── 右：预览（一页 A4）────────────┤
│ ⠿ 0928-01 帳票修正   3.5h [单列|其他|隐藏] │  iframe：服务端 PDF HTML（同一套 fit）     │
│ ⠿ 1001-01 API 仕様…  2.8h [单列|其他|隐藏] │                                         │
│ …                                         │                                         │
│ ── 并入その他 ──                            │                                         │
│   1006-01 …          0.4h                  │                                         │
│ ── 不出现 ──                                │                                         │
│   …                                        │                                         │
│ 状态行：选择已变更，文字未更新 · 上次生成 10:42 │                                         │
└───────────────────────────────────────────┴─────────────────────────────────────────┘
```
- 左栏只列**本周有工时**的案件（`week_minutes > 0`）加一行「その他・調査」（未関連工时，`LABELS[lang].unassigned`，伪 id `__unassigned`，默认单列，与现在 PDF 一致）。
- 单列的案件按用户顺序排在上面，可拖动；并入 / 不出现的两组排在下面，组内按工时多到少，不可拖动（顺序对它们无意义）。三态开关切换后行移到对应组。
- 每行显示 taskCode、案件名（任务表名，三语按导出语言）、本周工时。
- 单列超过 7 行时，在第 8 行起提示「PDF 最多单列 7 行，多出的会并入その他」（见 §6.3 行数上限）。

### 3.3 即时与非即时
- **即时**：表格部分（单列行、その他行的工时、合计）随每次改动立刻反映到预览。
- **非即时**：文字（本周概要、日别概要）只有点「生成」才变。编排与生成时不一致时，状态行显示「选择已变更，文字未更新」，预览里文字仍是上一次生成的（或从未生成时用现在 digest 的 PDF 版，标「尚未按编排生成」）。

### 3.4 生成
- 点「生成」→ 按钮变「生成中…」并锁住（同一周在服务端也有锁，见 §5.3），约 10–20 秒后预览刷新、状态行显示「已按当前选择生成 · HH:MM」。
- 生成好的文字可在左栏下方的文字区直接手改（沿用 `InlineEdit` 多行编辑，同週報 digest 的手改交互）。手改一种语言后，另外两种语言在后台重新翻译（§5.4）。
- 已有手改时再点「生成」，先确认「重新生成会覆盖手改」。

### 3.5 下载
- 「↓ PDF」与週報页同一个下载流程（`web/src/v2/pages/report/pdf.ts` 的 `downloadPdf`：fetch、生成中…、503 + Retry-After）。
- 下载前若文字过期（§4.3 的 `stale`），弹出提醒「文字还是按旧选择生成的，被隐藏的案件可能还在文字里」，两个按钮：「先生成」/「仍然下载」。

## 4. 数据模型

### 4.1 迁移 `server/migrations/0014_pdf_compose.sql`
```sql
-- The PDF composer (spec 2026-10-09-pdf-composer-design.md): one row per report week. `items` is the selection,
-- `text` the generated week summary + day lines in ja / zh / en; report_digests are never touched.
CREATE TABLE pdf_compose (
  week TEXT PRIMARY KEY,
  items TEXT NOT NULL,            -- JSON [{ "id": "<task id>|__unassigned", "mode": "show"|"other"|"hide" }], show rows in order
  text TEXT,                      -- JSON { ja|zh|en: { summary: string[], days: { "<date>": string[] } } }; NULL = never generated
  source_lang TEXT,               -- the language last hand-edited (NULL = as generated); the other two follow it
  edited INTEGER NOT NULL DEFAULT 0,
  gen_selection_hash TEXT,        -- hash of `items` the text was generated for
  gen_inputs_hash TEXT,           -- hash of the digest inputs the text was generated from
  gen_model TEXT,
  generated_at TEXT,
  generating_at TEXT,             -- the generation lock (UTC ISO); NULL = idle
  translating_at TEXT,            -- set while a hand edit's other two languages are being retranslated; NULL = done
  updated_at TEXT NOT NULL        -- optimistic lock of the selection, as elsewhere
);
```
- 只增表，不改已有表。旧代码看不到这张表，所以**迁移先于 push** 是安全的（§9）。

### 4.2 沿用上周（读时计算，首次改动才写）
`GET` 一个没有行的周时，服务端算出初值，不写库：
1. 取上一个报告周（`reportWeekOf(range.startMs - 1)`，与 `loadDigestContext` 求先周的写法相同）的 `items`；上周也没有，就看再往前最近的一周有行的（最多回看 8 周），都没有则为空。
2. 本周有工时的案件里：在旧 `items` 中的，沿用其 mode，`show` 的按旧顺序；不在旧 `items` 中的（本周新出现），`show`，排在单列最后（新案件之间按工时多到少）。
3. 旧 `items` 里本周没有工时的案件，丢掉。
4. 结果标 `inherited: true` 返回。用户第一次改动（`PUT`）时写入整行。

从未有过任何编排时，初值 = 现在 PDF 的行为：全部 `show`，按工时多到少（`pdfDataOf` 的排序），`__unassigned` 在其中按工时参与排序。

### 4.3 过期判定
- `selection_stale` = `gen_selection_hash ≠ hash(当前 items)`。
- `inputs_stale` = `gen_inputs_hash ≠ hash(当前 digest 输入)`（周数据在生成后变了，例如后来又采集到会话）。状态行显示「本周数据已更新，文字可能过时」。
- `stale` = 二者任一为真。`text IS NULL` 视为未生成，不算 stale。

## 5. API（`server/src/routes/reports.ts`）

全部注册在 `/:week/:template` 之前（同 `/:week/pdf` 的注释所说，否则 `pdf` 会被当成 template）。

### 5.1 `GET /api/reports/:week/pdf/compose?lang=ja|zh|en`
返回：
```ts
{
  week: string; inherited: boolean; updated_at: string | null;
  items: { id: string; mode: "show" | "other" | "hide"; title: string; requester: string; minutes: number }[];
  text: { summary: string[]; days: Record<string, string[]> } | null;   // 该 lang 的
  edited: boolean; generated_at: string | null; generating: boolean;
  stale: { selection: boolean; inputs: boolean };
}
```
`items` 已合并本周工时（只含本周有工时的案件 + `__unassigned`），title / requester 为该 lang 的译文（`localize`）。

### 5.2 `PUT /api/reports/:week/pdf/compose`
body `{ items: {id, mode}[], updated_at: string | null }`（`null` = 首次写入）。校验：id 必须属于本周的案件或 `__unassigned`，不重复，mode 合法；`updated_at` 不符 → 409（同其他乐观锁）。只写 `items` / `updated_at`，不动文字。

### 5.3 `POST /api/reports/:week/pdf/compose/generate`
1. 抢锁：`UPDATE pdf_compose SET generating_at = now WHERE week = ? AND (generating_at IS NULL OR generating_at < now − 3 min)`；0 行 → 409 `{ error: "generating" }`。无行时先按 §4.2 的初值插入一行再抢锁。
2. `loadInputs(db, week)`（`server/src/report/digests.ts`）取每日输入 `inputs.days` 和本周输入（`weekInputOf(inputs, 已存的 day digest 文字)`，与 cron / 预览算 hash 的方式一致）。
3. 按 §6 拼 prompt，`client.messages.create`（`MODEL` = `claude-sonnet-5-5`，从 `server/src/i18n/translator.ts` 导入；`new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, … })`，同 `digests.ts:146`），`output_config.format` 用 JSON schema，`max_tokens` 8000，timeout 120 s。请求同步等待（Worker 等 I/O 不耗 CPU 时间）。
4. 校验输出（§6.4）。通过 → 写 `text`、`gen_selection_hash`、`gen_inputs_hash`、`gen_model`、`generated_at`，`edited = 0`、`source_lang = NULL`，释放锁；失败 → 只释放锁，旧文字不动，返回 502 `{ error: "generate failed", reason }`。
5. 没有 `ANTHROPIC_API_KEY` → 503 `{ error: "generation unavailable" }`。

### 5.4 `PUT /api/reports/:week/pdf/compose/text`
body `{ lang, summary: string[], days: Record<string,string[]> }`。写入该 lang，`edited = 1`、`source_lang = lang`，然后 `waitUntil` 调 `translate(client, joined, "digest", "pdf_compose")` 把另外两种语言重新翻译后写回同一行（不登记到 `SOURCES` / sweep：sweep 的 D1 预算已是 48/50，见 `server/src/i18n/registry.ts` 的注释）。翻译失败时另外两种语言保留旧文字，下一次手改或生成再覆盖；写入时置 `translating_at`，翻译写回（或失败）后清空；`GET` 返回 `translating: boolean`（`translating_at` 非空且不超过 3 分钟），界面据此显示「翻译中」。

### 5.5 `POST /api/reports/:week/pdf/preview?lang=…`
body `{ items }`（可以是未保存的草稿）。返回 `renderReportHtml(pdfDataOf…)` 的 HTML 字符串（`text/html`），前端放进 `<iframe srcdoc>`，页面里的 `window.__fit()` 照常跑，所以预览与下载的排版一致。不调用 Browser Run，不计下载。

### 5.6 `GET /api/reports/:week/pdf`（改）
有 `pdf_compose` 行且 `text` 非空 → 用编排数据（§6.3）；否则完全走现在的路径。下载记录仍写 `pdf`。

## 6. 文字生成与 PDF 数据

### 6.1 输入
- 每日：`inputs.days[date]`（案件块、当日计划与判定、作業記録），只保留**单列 + 并入**案件相关的作業記録行；「不出现」案件的行不送进模型（不出现就不该被写到，最稳的办法是不给模型看）。
- 本周：`weekInputOf(...)` 同样去掉「不出现」案件的块。
- 附一个编排块：
```
## 編成
単独行（この順で）：1. 帳票修正 2. API 仕様書レビュー …
その他にまとめる：削除確認用の空き案件 …
```
案件名一律用任务表名（R15/R16：zh / en 的名字也取任务表译文，不让模型自造）。

### 6.2 输出要求（prompt 要点，沿用 `digests.ts` 的 `PLAIN`）
- 读者是不懂技术的人；平实的话；不写操作步骤、工具名、文件名；不编数字。
- **本周概要**：单列案件**按编排顺序**各一行「■ 案件名：今週どこまで進んだか」；并入案件里本周有进展的，合成最后一行「■ その他：A では…。B では…」；没有并入案件时不写その他行。「不出现」的案件一个字都不提。
- **每日概要**：每天一行（PDF 日别栏是一行一天，同现在 `pdf_lines` 的要求），写当天最大的成果；只提单列案件和「その他」，按编排顺序取舍；当天没有单列案件的工作时，只写その他里的事。
- **不设字数上限**，以 PDF 的 fit 步骤兜底。R14 / R18 的教训：任何上限都必须先拿一周真实数据跑过再定。如果审计（§8）发现装不下，再按真实一周定上限，写进本 spec。
- 一次调用返回三语：`{ ja: {summary: string[], days: {date: string[]}}, zh: {…}, en: {…} }`，三语行数和顺序一致。

### 6.3 PDF 数据（`server/src/report/pdf/data.ts` 加 `pdfDataComposed`）
- `summary` / `days[].text` 取 `pdf_compose.text[lang]`。
- `tasks`：`show` 的案件按 `items` 顺序（**不再按工时排序**）；「その他」行 = 所有 `other` + `hide` 案件的工时之和（U2）。
- 行数上限：`renderReportHtml` 现在最多显示 `MAX_ROWS = 7` 行，fit 走到 `trim` 时只留 `TRIM_ROWS = 5` 行，多出的进 `restRow`。编排后：
  - 传给 `renderReportHtml` 的 `tasks` = 单列行（按顺序） + 末尾一条 synthetic「その他」行（`other` + `hide` 的工时，`requester` 空），并标记它是 rest；
  - `restRow` 的合并逻辑改为：溢出的单列行与编排的「その他」**合成同一行**（不出现两条「その他」），件数 = 合并进来的案件数。
  - `taskCount`（「対応案件 N 件」）= 本周有工时的真实案件总数，与编排无关（不出现的案件也在合计里，U2）。
- 单列行超过 7 行时界面已提示（§3.2），PDF 里照上面规则并入，不报错。

### 6.4 输出校验（服务端，生成后）
- JSON 结构合法；三语都在；三语 `summary` 行数相同、每天的行数相同。
- 每个单列案件的名字（该语言的任务表名）至少出现在本周概要的一行里，且出现顺序与编排一致。
- 「不出现」案件的名字（三语任一）不得出现在任何文字里。
- 有并入案件且其中有本周工作时，本周概要最后一行以「■ その他」（zh「■ 其他」/ en「■ Other」，按 `LABELS` 定）开头；没有并入案件时不得有其他行。
- 校验失败 → 视为生成失败（§7），原因写进 `reason`（例如 `hidden-mentioned:<id>`），不写库。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 模型超时 / 报错 / 输出校验失败 | 502，旧文字不动，状态行「生成失败：原因」，按钮可再点。 |
| 正在生成（另一个标签页或连点） | 409 `generating`，界面显示「正在生成…」并在 20 s 后重新读取。锁 3 分钟过期，防止 Worker 中途被杀后永远锁住。 |
| 没有 API key | 503，按钮置灰并提示「生成不可用」。 |
| 编排保存冲突 | 409，重新读取后提示「已在别处修改」。 |
| 手改后的翻译失败 | 另外两种语言保留旧文字，界面标「翻译未完成」。 |
| PDF 渲染忙 / 失败 | 沿用现在的 503 + Retry-After / 502。 |
| 下载时文字过期 | 下载前提醒（§3.5），用户可以继续。 |

## 8. 测试与审计

**单元 / 路由测试（vitest，server）**
- 沿用上周：上周有行 / 回看到更早 / 全无；新案件排末尾；旧案件丢弃；`inherited` 标记；首次 `PUT` 才写库。
- `PUT` 校验：未知 id、重复、非法 mode、409。
- generate：抢锁与 409、过期锁可抢、无 key 503、模型输出不合法 / 提到隐藏案件 / 顺序不对 / 缺その他 → 502 且旧文字不动；成功写 hash 和时间。模型用注入的 fake client（同 `digests` 测试）；**vitest 里的 `env.BROWSER` 是本机真实 Chrome，不得调用**（S3 spike 记录）。
- `pdfDataComposed`：顺序、その他 = other + hide 工时、合计不变、溢出单列与その他合成一行、taskCount。
- `GET /:week/pdf`：有行走编排，无行字节级与现在相同（回归）。

**前端测试（vitest，web）**：三态切换移组、拖动排序、即时预览请求、stale 状态行、生成锁按钮、手改确认、下载前过期提醒。

**规则 A 抽检（改写率 > 50%，必须做）**
- N = **8**：4 个真实周（含 W39、W41）× 每周 2 种编排（一种默认、一种「至少 2 个案件并入 + 1 个不出现 + 调换前两名顺序」），每次生成用生产只读数据在本地跑 Worker（`wrangler dev`，D1 用导出的本地副本，**不连生产写**）。
- 每个样本逐条核对：不出现的案件完全没被提到；その他行恰好覆盖并入且有进展的案件，不多不少；单列顺序与编排一致；没有输入里不存在的事实；三语意思一致；PDF 一页装得下（看 `__fit` 返回的 steps，记录走到哪一步）。
- 结果写 `docs/projects/2026-10-09-pdf-composer/evidence/step_NN_audit.md`；失败的样本归档到 `failures/`，不删除。

## 9. 上线顺序

1. 本地：`npx wrangler d1 migrations apply DB --local`，全部测试通过，本地抽检完成。
2. **生产迁移先于 push**：`npx wrangler d1 migrations apply DB --remote`（memory：Workers Builds 在 push 时部署，迁移必须先跑）。只增表，旧代码不受影响。
3. push → Workers Builds 部署 → 生产检查：一周走一遍「编排 → 生成 → 手改一种语言 → 下载三语 PDF」，记录生成耗时和 PDF `cpuTime`（S2c 时 37–85 ms，Workers Free 下观察）。
4. 采集端（Mac / Win11）无变化，不需要 pull。

## 10. Workers Free 的限制

- **D1 查询数**（每次调用 50 条）：generate ≈ `buildWeek` + `loadDigestContext`（1 个 batch）+ 读 / 写 / 锁 4 条，远低于上限；`GET /pdf` 只多 1 条。
- **CPU**（10 ms 上限，已观察到 PDF 37–85 ms 仍放行）：等模型、等 Browser Run 都是 I/O，不计 CPU；新增的 JSON 解析和校验是毫秒级以下。preview 只拼 HTML，不调 Browser Run。
- **Browser Run**（Free：1 个浏览器 / 20 s）：只有下载用，preview 不占用。

## 11. 本 spec 里替用户做的决定（请审阅时确认）

1. 「その他・調査」（未関連工时）也作为一行可编排的条目，默认单列，与现在一致。
2. 并入 / 不出现两组内部不可排序，按工时排列。
3. 每日概要保持一天一行（PDF 日别栏的现有形式），只是按编排取舍。
4. 沿用上周最多回看 8 周。
5. 手改后的翻译直接在请求的 `waitUntil` 里调用 `translate`，不登记进 sweep（避免超出 sweep 的 D1 预算）。
6. 「不出现」案件的作業記録不送进模型，而不是送进去再要求模型别写。
7. 编排页的预览在从未生成时，用现有 digest 的 PDF 版文字，并标「尚未按编排生成」。
8. 生成锁 3 分钟过期。

## 12. 未决问题

- Sonnet 一次写三语、带一整周的输入，耗时是否能在 20 s 左右（估计），要在本地第一次跑真实周时测出来；明显更慢时，改为界面上显示进度而不是缩小输入。
- その他行在 zh / en 的开头文字（「■ 其他」/「■ Other」）以 `LABELS` 现有的 others 文案为准，实现时核对。
