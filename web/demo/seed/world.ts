// The fictional world of the demo: one contract engineer, two machines, nine requesters and fifteen 案件.
// Every name, project, path and figure here is invented.
import type { Lang, MachineKey, Said, Tri } from "./types";

export const PERSONA = { name: "Taro Yamada" };

export const MACHINES: Record<MachineKey, string> = { mac: "macmini", win: "win11" };

/** A project directory on a machine. win11 lives under C:\Dev (not C:\Work: "work" is a process directory to the 成果物 rule). */
export const cwdOf = (machine: MachineKey, dir: string) => (machine === "mac" ? `/Users/dev/Projects/${dir}` : `C:\\Dev\\Acme\\${dir}`);
/** An absolute path of a file under a project directory, with the machine's separator. */
export const pathOf = (machine: MachineKey, dir: string, rel: string) =>
  machine === "mac" ? `${cwdOf(machine, dir)}/${rel}` : `${cwdOf(machine, dir)}\\${rel.replaceAll("/", "\\")}`;

const t = (ja: string, zh: string, en: string): Tri => ({ ja, zh, en });
const said = (src: Lang, ja: string, zh: string, en: string): Said => ({ src, tri: t(ja, zh, en) });

/** A document a session writes, relative to the task's directory. `model` = the collector's verdict when the rule
 *  leaves it gray (see server/src/deliverables/rules.ts); absent = the rule decides, or nobody judged it yet. */
export interface DocDef { rel: string; model?: { verdict: "in" | "out"; reason: string } }

export interface TaskDef {
  id: string;
  requester: string;
  project: string;
  /** Translations of the project name when it is a word, not a code. */
  projectTr?: Tri;
  dir: string;
  machine: MachineKey | "both";
  title: Tri;
  short: Tri;
  thinking: Said;
  received: string;
  end: { status: "done" | "hold"; date: string } | null;
  /** Relative share of a day while the task is active. */
  weight: number;
  /** What a session works on (technical). */
  objects: Tri[];
  /** The phrases.ts ACTIONS that fit this kind of work. */
  actions: number[];
  /** What moved, in plain words, oldest first (digests, plan progress). */
  milestones: Tri[];
  /** 本周 plan goals, one per week the task is planned. */
  weekGoals: Tri[];
  deliverables: string[];
  docs: DocDef[];
  code: string[];
}

export const TASKS: TaskDef[] = [
  {
    id: "T20260822-01", requester: "Team", project: "開発環境", projectTr: t("開発環境", "开发环境", "Dev environment"),
    dir: "dev-setup", machine: "both", received: "2026-08-22", end: { status: "done", date: "2026-08-28" }, weight: 3,
    title: t("開発環境セットアップ（Docker・CI ランナー）", "开发环境搭建（Docker·CI Runner）", "Development environment setup (Docker, CI runner)"),
    short: t("開発環境の構築", "开发环境搭建", "dev environment setup"),
    thinking: said("ja", "初日に Mac と Windows の両方で同じ手順が通ることを確認する。手順書はチーム全員が使える形で残す。",
      "第一天就确认 Mac 和 Windows 都能按同一套步骤跑通。手册要留成全组都能用的形式。",
      "Confirm on day one that the same steps work on both Mac and Windows, and leave a guide the whole team can use."),
    actions: [1, 9, 10, 12, 14],
    objects: [
      t("Docker Compose の構成", "Docker Compose 配置", "the Docker Compose setup"),
      t("CI ランナーの登録", "CI Runner 注册", "the CI runner registration"),
      t("社内パッケージミラーの設定", "内部包镜像的设置", "the internal package mirror settings"),
      t("VPN 経由の DB 接続", "经 VPN 的数据库连接", "the database connection over VPN"),
    ],
    milestones: [
      t("Mac と Windows の両方で開発用の環境が動くようになった", "Mac 和 Windows 上的开发环境都能运行了", "The development environment now runs on both Mac and Windows"),
      t("テストを自動で回す仕組みを用意した", "准备好了自动运行测试的机制", "Set up automatic test runs"),
      t("社内の部品置き場から部品を取れるようにした", "可以从公司内部的组件仓库获取组件了", "Packages can now be pulled from the internal mirror"),
      t("手順書をまとめ、チーム全員に共有した", "整理好手册并共享给全组", "Wrote up the setup guide and shared it with the team"),
    ],
    weekGoals: [t("開発環境：Mac・Windows の両方で開発を始められる状態にする", "开发环境：让 Mac 和 Windows 都能开始开发", "Dev environment: be ready to develop on both Mac and Windows")],
    deliverables: ["docs/setup/開発環境セットアップ手順.md"],
    docs: [
      { rel: "docs/setup/開発環境セットアップ手順.md" },
      { rel: "docs/setup/troubleshooting.md", model: { verdict: "in", reason: "チームに共有するトラブル対応集" } },
      { rel: "tmp/notes.md" },
    ],
    code: ["docker-compose.yml", "scripts/bootstrap.sh", "scripts/bootstrap.ps1", ".github/workflows/ci.yml"],
  },
  {
    id: "T20260824-01", requester: "高橋リーダー（開発部）", project: "ORION-A", dir: "orion-a-web", machine: "mac",
    received: "2026-08-24", end: { status: "done", date: "2026-09-30" }, weight: 5,
    title: t("受注管理画面のリプレース（一覧・詳細 12 画面）", "订单管理画面重构（列表·详情共 12 个画面）", "Order management screen replacement (12 list/detail screens)"),
    short: t("受注管理画面", "订单管理画面", "order screens"),
    thinking: said("ja", "旧画面の挙動を正とし、見た目の変更は最小限にする。1 日 1 画面を目安に移植し、検索条件とページングは共通部品にまとめる。",
      "以旧画面的行为为准，尽量少改外观。按每天一个画面的节奏移植，检索条件和分页做成公共组件。",
      "Treat the old screens' behaviour as the reference and keep visual changes minimal. Port about one screen a day; search filters and paging become shared components."),
    actions: [0, 2, 3, 6, 11, 12, 14, 15],
    objects: [
      t("受注一覧画面", "订单列表画面", "the order list screen"),
      t("受注詳細画面", "订单详情画面", "the order detail screen"),
      t("検索条件の共通部品", "检索条件公共组件", "the shared search-filter component"),
      t("ページング処理", "分页处理", "the paging logic"),
      t("出荷指示画面", "发货指示画面", "the shipping instruction screen"),
      t("権限による表示制御", "按权限的显示控制", "the role-based visibility rules"),
    ],
    milestones: [
      t("12 画面のうち受注一覧を新しい画面に移し替えた", "12 个画面中已把订单列表移到新画面", "Moved the order list, the first of 12 screens, to the new UI"),
      t("受注詳細を移し替え、12 画面中 2 画面が完了", "移植了订单详情，12 个画面完成 2 个", "Moved the order detail screen; 2 of 12 screens done"),
      t("検索条件を全画面で共通に使える形にまとめた（12 画面中 3 画面完了）", "把检索条件整理成所有画面通用的形式（12 个画面完成 3 个）", "Made the search filters shared by every screen (3 of 12 done)"),
      t("12 画面中 5 画面が完了し、ページ送りの不具合を直した", "12 个画面完成 5 个，修好了翻页的问题", "5 of 12 screens done; fixed the paging bug"),
      t("12 画面中 7 画面が完了し、出荷指示画面の確認を依頼した", "12 个画面完成 7 个，已请对方确认发货指示画面", "7 of 12 screens done; sent the shipping instruction screen for review"),
      t("12 画面中 9 画面が完了し、権限ごとの表示の違いを洗い出した", "12 个画面完成 9 个，梳理了不同权限下的显示差异", "9 of 12 screens done; listed what each role sees differently"),
      t("12 画面中 11 画面が完了し、残り 1 画面は承認待ち", "12 个画面完成 11 个，剩下 1 个等待批准", "11 of 12 screens done; the last one awaits approval"),
      t("全 12 画面の移し替えが完了し、高橋リーダーの確認を受けた", "全部 12 个画面移植完成，并通过了高桥组长的确认", "All 12 screens moved and checked by Takahashi"),
      t("確認で出た指摘 6 件をすべて直した", "确认时提出的 6 条意见全部改完", "Fixed all 6 issues raised in the review"),
      t("新しい画面を公開し、旧画面を止める日を決めた", "新画面上线，并确定了旧画面的停用日期", "Released the new screens and set the date to retire the old ones"),
    ],
    weekGoals: [
      t("ORION-A：受注一覧と受注詳細の 2 画面を移植する", "ORION-A：移植订单列表和订单详情两个画面", "ORION-A: port the order list and order detail screens"),
      t("ORION-A：検索条件の共通部品を完成させる", "ORION-A：完成检索条件公共组件", "ORION-A: finish the shared search-filter component"),
      t("ORION-A：出荷指示画面まで移植を進める", "ORION-A：移植推进到发货指示画面", "ORION-A: get as far as the shipping instruction screen"),
      t("ORION-A：権限ごとの表示を全画面で確認する", "ORION-A：在所有画面上确认各权限的显示", "ORION-A: check role-based display on every screen"),
      t("ORION-A：全 12 画面の確認会を終える", "ORION-A：完成全部 12 个画面的确认会", "ORION-A: finish the review meeting for all 12 screens"),
      t("ORION-A：確認会の指摘を直して公開する", "ORION-A：改完确认会的意见并上线", "ORION-A: fix the review findings and release"),
    ],
    deliverables: ["成果物/ORION-A_画面移行報告書.xlsx"],
    docs: [
      { rel: "成果物/ORION-A_画面移行報告書.xlsx" },
      { rel: "成果物/画面移行一覧.xlsx" },
      { rel: "docs/screens/受注一覧_画面仕様.md", model: { verdict: "in", reason: "依頼元に渡す画面仕様" } },
      { rel: "docs/memo/移植メモ.md", model: { verdict: "out", reason: "自分用の作業メモで、渡すものではない" } },
      { rel: "plans/PLAN.md" },
    ],
    code: ["src/pages/orders/OrderList.tsx", "src/pages/orders/OrderDetail.tsx", "src/components/SearchFilter.tsx", "src/hooks/usePaging.ts",
      "src/pages/shipping/ShippingOrder.tsx", "test/orders/OrderList.test.tsx"],
  },
  {
    id: "T20260826-01", requester: "Alex Wang", project: "HARBOR", dir: "harbor-gateway", machine: "win",
    received: "2026-08-26", end: { status: "done", date: "2026-09-18" }, weight: 4,
    title: t("外部連携 API の結合テスト", "外部对接 API 的集成测试", "External integration API: integration testing"),
    short: t("外部連携 API", "外部对接 API", "integration API"),
    thinking: said("zh", "テストケースは相手先の仕様書の章立てに合わせる。失敗したケースは原因を自社側・相手側に分けて報告する。",
      "测试用例按对方规格书的章节组织。失败的用例按我方原因和对方原因分开报告。",
      "Organise the test cases by the partner spec's chapters. Report failures split into our side and their side."),
    actions: [1, 2, 3, 8, 9, 12, 13],
    objects: [
      t("認証トークンの更新処理", "认证令牌刷新处理", "the token refresh flow"),
      t("受注連携 API", "订单对接 API", "the order sync API"),
      t("在庫照会 API", "库存查询 API", "the stock lookup API"),
      t("リトライとタイムアウトの設定", "重试与超时设置", "the retry and timeout settings"),
      t("テスト用スタブサーバ", "测试用桩服务器", "the test stub server"),
    ],
    milestones: [
      t("結合テスト 64 件の一覧を作り、相手先と範囲を合意した", "整理出 64 条集成测试，并与对方确认了范围", "Listed 64 integration tests and agreed the scope with the partner"),
      t("64 件中 18 件を実施し、失敗 3 件を報告した", "64 条中执行了 18 条，报告了 3 条失败", "Ran 18 of 64 tests and reported 3 failures"),
      t("64 件中 35 件を実施し、認証の失敗は相手側の設定が原因と分かった", "64 条中执行了 35 条，查明认证失败是对方配置导致的", "Ran 35 of 64; the authentication failures came from the partner's settings"),
      t("64 件中 52 件を実施し、こちら側の不具合 2 件を直した", "64 条中执行了 52 条，修复了我方的 2 个缺陷", "Ran 52 of 64 and fixed 2 defects on our side"),
      t("64 件すべてを実施し、残る失敗は 0 件になった", "64 条全部执行完毕，剩余失败为 0", "All 64 tests run; no failures left"),
      t("テスト結果報告書を提出し、Alex Wang さんの承認を得た", "提交了测试结果报告，并获得 Alex Wang 的批准", "Submitted the test report and got Alex Wang's sign-off"),
    ],
    weekGoals: [
      t("HARBOR：結合テストの範囲を相手先と合意する", "HARBOR：与对方确定集成测试范围", "HARBOR: agree the test scope with the partner"),
      t("HARBOR：結合テストを 35 件まで進める", "HARBOR：集成测试推进到 35 条", "HARBOR: get through 35 integration tests"),
      t("HARBOR：結合テストを全件終える", "HARBOR：完成全部集成测试", "HARBOR: finish every integration test"),
      t("HARBOR：テスト結果報告書を提出する", "HARBOR：提交测试结果报告", "HARBOR: submit the test report"),
    ],
    deliverables: ["deliverables/HARBOR_結合テスト結果報告書.xlsx"],
    docs: [
      { rel: "deliverables/HARBOR_結合テスト結果報告書.xlsx" },
      { rel: "docs/test-cases/結合テスト一覧.xlsx", model: { verdict: "in", reason: "相手先と合意したテスト一覧" } },
      { rel: "docs/test-cases/失敗ケース調査メモ.md", model: { verdict: "out", reason: "調査の途中経過のメモ" } },
      { rel: "evidence/run-0911.md" },
    ],
    code: ["src/Gateway/TokenRefresher.cs", "src/Gateway/OrderSyncClient.cs", "src/Gateway/StockClient.cs", "tests/Gateway.Tests/OrderSyncTests.cs", "stub/server.py"],
  },
  {
    id: "T20260901-01", requester: "佐藤", project: "LEDGER", dir: "ledger-batch", machine: "win",
    received: "2026-09-01", end: { status: "done", date: "2026-09-25" }, weight: 4,
    title: t("月次照合バッチの性能改善", "月度对账批处理性能优化", "Monthly reconciliation batch: performance tuning"),
    short: t("月次照合バッチ", "月度对账批处理", "reconciliation batch"),
    thinking: said("ja", "目標は処理時間 4 時間 → 1 時間以内。まず計測してから手を入れる。結果の数値が 1 円でも変わったら即中止。",
      "目标是把处理时间从 4 小时降到 1 小时以内。先测量再动手。结果数值哪怕差 1 日元也立即停止。",
      "Goal: cut the run from 4 hours to under 1. Measure before changing anything; stop at once if any total moves by even 1 yen."),
    actions: [0, 2, 5, 6, 7, 13, 15],
    objects: [
      t("照合 SQL", "对账 SQL", "the reconciliation SQL"),
      t("明細の取り込み処理", "明细导入处理", "the line-item import"),
      t("インデックス設計", "索引设计", "the index design"),
      t("並列実行の設定", "并行执行设置", "the parallel execution settings"),
      t("結果比較スクリプト", "结果比对脚本", "the result comparison script"),
    ],
    milestones: [
      t("今の処理時間を測り、4 時間 10 分かかっていることを確かめた", "测量了当前处理时间，确认需要 4 小时 10 分钟", "Measured the current run: 4 hours 10 minutes"),
      t("時間がかかっている 3 か所を特定した", "找出了耗时最多的 3 个环节", "Found the 3 steps that take the most time"),
      t("明細の取り込みを作り直し、4 時間 10 分から 2 時間 30 分に短くなった", "重做了明细导入，从 4 小时 10 分缩短到 2 小时 30 分", "Rebuilt the line-item import: 4h10m down to 2h30m"),
      t("照合の手順を見直し、1 時間 20 分まで短くなった", "调整了对账步骤，缩短到 1 小时 20 分", "Reworked the matching steps: down to 1h20m"),
      t("並べて動かす設定を入れて 52 分になり、結果は旧処理と一致した", "加入并行执行后缩短到 52 分钟，结果与旧处理一致", "Running steps in parallel brought it to 52 minutes, with results matching the old run"),
      t("本番と同じ量のデータで 3 回確かめ、佐藤さんに報告した", "用与生产同等的数据量验证了 3 次，并向佐藤先生汇报", "Checked three times with production-sized data and reported to Sato-san"),
    ],
    weekGoals: [
      t("LEDGER：今の処理時間を測り、遅い所を特定する", "LEDGER：测量当前处理时间，找出慢的地方", "LEDGER: measure the current run and find the slow parts"),
      t("LEDGER：照合バッチを 2 時間台まで縮める", "LEDGER：把对账批处理缩到 2 小时左右", "LEDGER: get the batch down to about 2 hours"),
      t("LEDGER：1 時間以内を達成し、結果の一致を確認する", "LEDGER：达成 1 小时以内并确认结果一致", "LEDGER: reach under an hour with matching results"),
      t("LEDGER：本番量のデータで確認して報告する", "LEDGER：用生产数据量验证并汇报", "LEDGER: verify with production-sized data and report"),
    ],
    deliverables: ["reports/LEDGER_照合バッチ性能比較.xlsx"],
    docs: [
      { rel: "reports/LEDGER_照合バッチ性能比較.xlsx" },
      { rel: "docs/perf/計測結果_0907.csv", model: { verdict: "out", reason: "計測の生データで、報告書に集約済み" } },
      { rel: "docs/perf/改善方針.md", model: { verdict: "in", reason: "依頼元と合意した改善方針" } },
    ],
    code: ["batch/reconcile.sql", "batch/import_lines.py", "batch/parallel.py", "tools/compare_results.py", "migrations/add_ledger_indexes.sql"],
  },
  {
    id: "T20260903-01", requester: "鈴木", project: "DocMerge", dir: "docmerge", machine: "mac",
    received: "2026-09-03", end: null, weight: 3,
    title: t("帳票テンプレート統合ツールの開発", "报表模板整合工具开发", "Report template consolidation tool"),
    short: t("帳票統合ツール", "报表整合工具", "report template tool"),
    thinking: said("ja", "部署ごとにばらばらな Excel 帳票 40 種を 1 つの定義から出力できるようにする。差し込み項目の名前は鈴木さんの一覧に合わせる。",
      "让各部门零散的 40 种 Excel 报表可以从同一份定义输出。插入字段的名称以铃木先生的清单为准。",
      "Generate the 40 department-specific Excel reports from a single definition. Field names follow Suzuki-san's list."),
    actions: [0, 2, 3, 4, 6, 7, 12, 14, 15],
    objects: [
      t("テンプレート定義ファイルの形式", "模板定义文件格式", "the template definition format"),
      t("差し込み項目の対応表", "插入字段对照表", "the merge field mapping"),
      t("Excel 出力処理", "Excel 输出处理", "the Excel writer"),
      t("罫線と書式の再現", "边框与格式的还原", "border and format reproduction"),
      t("差分チェック機能", "差异检查功能", "the diff checker"),
    ],
    milestones: [
      t("40 種の帳票を集め、共通部分と違う部分を表にまとめた", "收集了 40 种报表，把共同点和差异整理成表", "Collected the 40 reports and tabulated what they share and where they differ"),
      t("1 つの定義から帳票を出す試作ができた（40 種中 3 種）", "完成了从一份定义输出报表的原型（40 种中 3 种）", "Prototype generates reports from one definition (3 of 40)"),
      t("40 種中 12 種を新しい仕組みで出せるようになった", "40 种中已有 12 种可以用新机制输出", "12 of 40 reports now come out of the new tool"),
      t("罫線や書式の崩れを直し、40 種中 20 種が旧帳票と同じ見た目になった", "修好了边框和格式的错乱，40 种中 20 种与旧报表外观一致", "Fixed borders and formatting; 20 of 40 now look the same as the old ones"),
      t("40 種中 27 種が完了し、残りは手書き欄のある帳票になった", "40 种完成 27 种，剩下的是带手写栏的报表", "27 of 40 done; the rest have handwritten fields"),
      t("旧帳票との違いを自動で見つける機能を作った", "做好了自动找出与旧报表差异的功能", "Built a check that finds differences from the old reports automatically"),
      t("40 種中 31 種が完了し、鈴木さんの部署で試用が始まった", "40 种完成 31 种，铃木先生的部门开始试用", "31 of 40 done; Suzuki-san's department started a trial"),
    ],
    weekGoals: [
      t("DocMerge：帳票 40 種の共通部分を整理する", "DocMerge：整理 40 种报表的共同部分", "DocMerge: map what the 40 reports have in common"),
      t("DocMerge：試作で 3 種の帳票を出す", "DocMerge：用原型输出 3 种报表", "DocMerge: produce 3 reports from the prototype"),
      t("DocMerge：20 種まで旧帳票と同じ見た目にする", "DocMerge：让 20 种报表外观与旧版一致", "DocMerge: make 20 reports match the old layout"),
      t("DocMerge：差分チェック機能を作る", "DocMerge：完成差异检查功能", "DocMerge: build the diff checker"),
      t("DocMerge：試用版を鈴木さんの部署に渡す", "DocMerge：把试用版交给铃木先生的部门", "DocMerge: hand the trial build to Suzuki-san's team"),
    ],
    deliverables: ["成果物/DocMerge_帳票対応一覧.xlsx"],
    docs: [
      { rel: "成果物/DocMerge_帳票対応一覧.xlsx" },
      { rel: "docs/template-format.md", model: { verdict: "in", reason: "利用部門向けの定義ファイル説明" } },
      { rel: "docs/design/差分チェック設計.md", model: { verdict: "in", reason: "差分チェック機能の設計書" } },
      { rel: "todo.md" },
    ],
    code: ["src/docmerge/definition.py", "src/docmerge/writer.py", "src/docmerge/styles.py", "src/docmerge/diffcheck.py", "tests/test_writer.py"],
  },
  {
    id: "T20260907-01", requester: "Mia Chen", project: "data-wiki", dir: "data-wiki", machine: "mac",
    received: "2026-09-07", end: { status: "hold", date: "2026-09-29" }, weight: 2,
    title: t("データ定義書の整備（売上・顧客領域）", "数据定义书整理（销售·客户领域）", "Data dictionary cleanup (sales and customer domains)"),
    short: t("データ定義書", "数据定义书", "data dictionary"),
    thinking: said("zh", "定義の正は業務部門の回答。回答が来ていない項目は「確認待ち」と明記して進める。9/29 時点で 22 項目が回答待ちのため保留。",
      "定义以业务部门的回复为准。尚未回复的项目标注「确认待ち」后继续推进。截至 9/29 有 22 项在等回复，暂时搁置。",
      "Business answers are the source of truth; unanswered items are marked as waiting. On hold since 9/29 with 22 items awaiting answers."),
    actions: [1, 4, 10, 17],
    objects: [
      t("売上テーブルの項目定義", "销售表字段定义", "the sales table definitions"),
      t("顧客マスタの項目定義", "客户主数据字段定义", "the customer master definitions"),
      t("コード値の一覧", "代码值列表", "the code value lists"),
      t("定義書の自動生成スクリプト", "定义书自动生成脚本", "the dictionary generator script"),
    ],
    milestones: [
      t("売上と顧客の 2 領域で 180 項目の一覧を作った", "整理出销售和客户两个领域共 180 个字段的清单", "Listed 180 fields across the sales and customer domains"),
      t("180 項目中 70 項目の説明を書いた", "180 个字段中写好了 70 个的说明", "Wrote descriptions for 70 of 180 fields"),
      t("180 項目中 115 項目が完了し、不明な 22 項目を業務部門に質問した", "180 个字段完成 115 个，就不明确的 22 个向业务部门提问", "115 of 180 done; sent 22 open questions to the business side"),
      t("質問 22 件の回答待ちのため一旦止めた", "22 个问题在等回复，暂时停下", "Paused while 22 questions await answers"),
    ],
    weekGoals: [
      t("data-wiki：180 項目の一覧を作る", "data-wiki：整理 180 个字段的清单", "data-wiki: list all 180 fields"),
      t("data-wiki：説明を 100 項目まで書く", "data-wiki：说明写到 100 个字段", "data-wiki: describe 100 fields"),
      t("data-wiki：不明点を業務部門に質問する", "data-wiki：把不明确的地方向业务部门提问", "data-wiki: send the open questions to the business side"),
    ],
    deliverables: [],
    docs: [
      { rel: "docs/definitions/売上_項目定義.xlsx", model: { verdict: "in", reason: "依頼元に渡す定義書" } },
      { rel: "docs/definitions/顧客_項目定義.xlsx", model: { verdict: "in", reason: "依頼元に渡す定義書" } },
      { rel: "docs/questions/業務部門への質問.md", model: { verdict: "out", reason: "質問の下書きで、送付はメール" } },
    ],
    code: ["tools/gen_dictionary.py", "schema/sales.yml", "schema/customer.yml"],
  },
  {
    id: "T20260909-01", requester: "田中先生", project: "技術検証", projectTr: t("技術検証", "技术验证", "Tech evaluation"),
    dir: "llm-review-poc", machine: "mac", received: "2026-09-09", end: { status: "done", date: "2026-10-02" }, weight: 2,
    title: t("LLM による仕様書レビュー補助の検証", "用 LLM 辅助规格书评审的验证", "Evaluating LLM assistance for spec reviews"),
    short: t("レビュー補助の検証", "评审辅助验证", "review-assist trial"),
    thinking: said("ja", "社内の過去レビュー 30 件で、人の指摘をどれだけ拾えるかを測る。費用は 1 件あたりの金額で報告する。",
      "用公司内部过去的 30 次评审，测量能覆盖多少人工指出的问题。费用按每件的金额报告。",
      "Measure how many human findings it catches on 30 past internal reviews; report the cost per review."),
    actions: [0, 1, 7, 13, 15],
    objects: [
      t("評価用データセット", "评估数据集", "the evaluation dataset"),
      t("プロンプトの比較", "提示词对比", "the prompt comparison"),
      t("指摘の一致判定", "指摘的一致性判定", "the finding-match scoring"),
      t("費用の試算", "费用估算", "the cost estimate"),
    ],
    milestones: [
      t("過去レビュー 30 件を評価用に整理した", "把过去的 30 次评审整理成评估用数据", "Prepared 30 past reviews for evaluation"),
      t("30 件中 12 件で試し、人の指摘の 58% を拾えた", "用 30 件中的 12 件试验，覆盖了人工指出问题的 58%", "Tried 12 of 30; it caught 58% of the human findings"),
      t("指示の書き方を変えて 30 件すべてで試し、71% を拾えた", "改写了指示后对全部 30 件试验，覆盖率 71%", "With revised instructions on all 30, it caught 71%"),
      t("1 件あたりの費用を 0.4 ドルと試算した", "估算每件费用为 0.4 美元", "Estimated the cost at $0.40 per review"),
      t("検証結果を田中先生に報告し、試験導入が決まった", "向田中老师汇报了验证结果，决定试行导入", "Reported to Tanaka-sensei; a trial rollout was approved"),
    ],
    weekGoals: [
      t("技術検証：評価用データを 30 件そろえる", "技术验证：准备好 30 件评估数据", "Tech eval: prepare 30 evaluation cases"),
      t("技術検証：全 30 件で拾える割合を測る", "技术验证：在全部 30 件上测量覆盖率", "Tech eval: measure the catch rate on all 30"),
      t("技術検証：結果を田中先生に報告する", "技术验证：向田中老师汇报结果", "Tech eval: report the results to Tanaka-sensei"),
    ],
    deliverables: ["成果物/LLM レビュー補助_検証報告.pptx"],
    docs: [
      { rel: "成果物/LLM レビュー補助_検証報告.pptx" },
      { rel: "docs/eval/評価結果.xlsx", model: { verdict: "in", reason: "報告書の元になる評価結果" } },
      { rel: "prompts/review-prompt-v3.md" },
    ],
    code: ["eval/run_eval.py", "eval/score.py", "eval/cases.jsonl"],
  },
  {
    id: "T20260914-01", requester: "Kevin Liu", project: "ATLAS", dir: "atlas-auth", machine: "mac",
    received: "2026-09-14", end: { status: "done", date: "2026-10-09" }, weight: 3,
    title: t("権限モデルの設計レビュー", "权限模型设计评审", "Permission model design review"),
    short: t("権限モデル", "权限模型", "permission model"),
    thinking: said("en", "ロール数を増やさずに部署横断の閲覧を実現する。既存ユーザー 1,200 人の移行を前提に考える。",
      "在不增加角色数量的前提下实现跨部门浏览。以迁移现有 1,200 名用户为前提来考虑。",
      "Allow cross-department viewing without adding roles, assuming all 1,200 existing users are migrated."),
    actions: [1, 3, 7, 10, 17],
    objects: [
      t("ロールと権限の対応表", "角色与权限对照表", "the role-permission matrix"),
      t("部署横断の閲覧ルール", "跨部门浏览规则", "the cross-department view rules"),
      t("既存ユーザーの移行案", "现有用户迁移方案", "the user migration plan"),
      t("監査ログの要件", "审计日志需求", "the audit log requirements"),
    ],
    milestones: [
      t("今の権限を調べ、ロール 14 種と権限 86 個の対応表を作った", "调查了现有权限，整理出 14 种角色与 86 项权限的对照表", "Mapped the current 14 roles against 86 permissions"),
      t("部署をまたいで見られるようにする案を 2 つ作った", "做了两个实现跨部门浏览的方案", "Drafted two ways to allow cross-department viewing"),
      t("2 案を比べ、ロールを増やさない案に絞った", "比较两个方案后，选定不增加角色的方案", "Compared both and chose the one that adds no roles"),
      t("1,200 人分の移し替え手順の案を書いた", "写好了 1,200 名用户的迁移步骤草案", "Wrote the migration steps for the 1,200 users"),
      t("Kevin Liu さんのレビュー指摘 9 件に対応した", "处理了 Kevin Liu 的 9 条评审意见", "Addressed Kevin Liu's 9 review comments"),
      t("設計書を確定し、開発チームに引き継いだ", "设计书定稿并移交给开发团队", "Finalised the design and handed it to the dev team"),
    ],
    weekGoals: [
      t("ATLAS：今の権限の対応表を作る", "ATLAS：整理现有权限对照表", "ATLAS: map the current permissions"),
      t("ATLAS：部署横断の案を 2 つ比べて決める", "ATLAS：比较两个跨部门方案并定下来", "ATLAS: compare the two cross-department options and decide"),
      t("ATLAS：移行手順の案をレビューに出す", "ATLAS：把迁移步骤草案提交评审", "ATLAS: send the migration steps for review"),
      t("ATLAS：指摘を反映して設計書を確定する", "ATLAS：反映意见后定稿设计书", "ATLAS: finalise the design with the review fixes"),
    ],
    deliverables: ["成果物/ATLAS_権限モデル設計書.docx"],
    docs: [
      { rel: "成果物/ATLAS_権限モデル設計書.docx" },
      { rel: "docs/roles/権限マトリクス.xlsx", model: { verdict: "in", reason: "設計書の付録として渡す対応表" } },
      { rel: "reviews/review-kevin-0930.md" },
    ],
    code: ["policy/roles.yaml", "policy/evaluate.ts", "policy/evaluate.test.ts", "scripts/export_matrix.ts"],
  },
  {
    id: "T20260916-01", requester: "Sam Lee", project: "BEACON", dir: "beacon-notify", machine: "win",
    received: "2026-09-16", end: { status: "done", date: "2026-09-17" }, weight: 9,
    title: t("通知サービスの障害調査（メール遅延）", "通知服务故障调查（邮件延迟）", "Notification service incident: delayed e-mails"),
    short: t("通知の障害調査", "通知故障调查", "notification incident"),
    thinking: said("ja", "まず影響範囲を確定し、恒久対策は別案件に切り出す。", "先确定影响范围，根本对策另立案件。", "Pin down the impact first; split the permanent fix into its own task."),
    actions: [5, 9, 10, 12],
    objects: [
      t("送信キューの滞留", "发送队列积压", "the send-queue backlog"),
      t("再送処理", "重发处理", "the resend job"),
      t("監視アラートの閾値", "监控告警阈值", "the monitoring alert thresholds"),
    ],
    milestones: [
      t("遅れていたメール 3,400 通の範囲を特定し、送り直した", "确定了延迟的 3,400 封邮件的范围并重新发送", "Identified the 3,400 delayed e-mails and resent them"),
      t("原因（送信キューの設定誤り）を直し、報告書を出した", "修正了原因（发送队列配置错误）并提交报告", "Fixed the cause (a send-queue setting) and filed the report"),
    ],
    weekGoals: [t("BEACON：メール遅延の影響範囲を確定して報告する", "BEACON：确定邮件延迟的影响范围并汇报", "BEACON: pin down and report the impact of the delays")],
    deliverables: ["reports/BEACON_障害報告書_0917.pdf"],
    docs: [
      { rel: "reports/BEACON_障害報告書_0917.pdf" },
      { rel: "docs/incident/timeline.md", model: { verdict: "in", reason: "報告書に添付する時系列" } },
    ],
    code: ["worker/queue_config.go", "worker/resend.go", "ops/alerts.yaml"],
  },
  {
    id: "T20260924-01", requester: "高橋リーダー（開発部）、佐藤", project: "ORION-B", dir: "orion-b-migration", machine: "both",
    received: "2026-09-24", end: null, weight: 5,
    title: t("データ移行スクリプト作成（旧 DB → 新スキーマ）", "数据迁移脚本编写（旧库 → 新结构）", "Data migration scripts (legacy DB to new schema)"),
    short: t("データ移行", "数据迁移", "data migration"),
    thinking: said("zh", "テーブル 48 本を 1 日 2 本ペースで。件数と合計金額の一致を毎回確認する。顧客マスタは佐藤さんの承認後に流す。",
      "48 张表按每天 2 张的节奏推进。每次都核对条数和金额合计。客户主数据要等佐藤先生批准后再执行。",
      "48 tables at about two a day. Check row counts and amount totals every time. The customer master runs only after Sato-san approves."),
    actions: [0, 2, 4, 5, 6, 12, 13, 14, 15],
    objects: [
      t("顧客マスタの移行", "客户主数据迁移", "the customer master migration"),
      t("受注明細の移行", "订单明细迁移", "the order line migration"),
      t("コード変換表", "代码转换表", "the code conversion table"),
      t("件数・金額の突き合わせ", "条数·金额核对", "the count and total reconciliation"),
      t("移行リハーサルの手順", "迁移演练步骤", "the rehearsal procedure"),
    ],
    milestones: [
      t("移す 48 テーブルの順番と変換ルールを決めた", "确定了 48 张表的迁移顺序和转换规则", "Set the order and conversion rules for the 48 tables"),
      t("48 テーブル中 8 本を移し替え、件数と金額が一致した", "48 张表中迁移了 8 张，条数和金额一致", "Moved 8 of 48 tables; counts and totals match"),
      t("48 テーブル中 16 本が完了した", "48 张表完成 16 张", "16 of 48 tables done"),
      t("48 テーブル中 22 本が完了し、コードの読み替え表を佐藤さんと確認した", "48 张表完成 22 张，与佐藤先生确认了代码转换表", "22 of 48 done; checked the code conversion table with Sato-san"),
      t("48 テーブル中 28 本が完了し、顧客マスタは承認待ち", "48 张表完成 28 张，客户主数据等待批准", "28 of 48 done; the customer master awaits approval"),
      t("48 テーブル中 31 本が完了し、顧客マスタの移し替えに着手した", "48 张表完成 31 张，开始迁移客户主数据", "31 of 48 done; started on the customer master"),
    ],
    weekGoals: [
      t("ORION-B：48 テーブルの移行順と変換ルールを決める", "ORION-B：确定 48 张表的迁移顺序和转换规则", "ORION-B: decide the order and rules for the 48 tables"),
      t("ORION-B：移行を 16 テーブルまで進める", "ORION-B：迁移推进到 16 张表", "ORION-B: get 16 tables migrated"),
      t("ORION-B：コード変換表を佐藤さんと確定する", "ORION-B：与佐藤先生确定代码转换表", "ORION-B: finalise the code conversion table with Sato-san"),
      t("ORION-B：顧客マスタの移行を承認後に流す", "ORION-B：批准后执行客户主数据迁移", "ORION-B: run the customer master once approved"),
    ],
    deliverables: [],
    docs: [
      { rel: "成果物/ORION-B_移行設計書.xlsx" },
      { rel: "docs/mapping/コード変換表.xlsx", model: { verdict: "in", reason: "依頼元と確認する変換表" } },
      { rel: "docs/mapping/移行メモ.md", model: { verdict: "out", reason: "作業中のメモ" } },
      { rel: "docs/rehearsal/リハーサル手順.md" },
    ],
    code: ["migrate/customers.sql", "migrate/order_lines.sql", "migrate/convert_codes.py", "migrate/reconcile.py", "migrate/run_all.sh"],
  },
  {
    id: "T20260929-01", requester: "Mia Chen、Kevin Liu", project: "analytics-platform", dir: "analytics-platform", machine: "mac",
    received: "2026-09-29", end: null, weight: 3,
    title: t("週次 KPI ダッシュボードの構築", "每周 KPI 仪表盘搭建", "Weekly KPI dashboard"),
    short: t("KPI ダッシュボード", "KPI 仪表盘", "KPI dashboard"),
    thinking: said("en", "指標は 12 個から始める。定義は Mia さん、表示は Kevin さんが確認する。数字の出どころを画面に必ず書く。",
      "指标先从 12 个开始。定义由 Mia 确认，展示由 Kevin 确认。画面上一定要写明数字的来源。",
      "Start with 12 metrics. Mia checks the definitions, Kevin the display. Every number shows where it comes from."),
    actions: [0, 1, 4, 6, 11, 14, 15],
    objects: [
      t("KPI の定義表", "KPI 定义表", "the KPI definition sheet"),
      t("集計クエリ", "汇总查询", "the aggregation queries"),
      t("グラフの配置", "图表布局", "the chart layout"),
      t("データ鮮度のチェック", "数据新鲜度检查", "the data freshness check"),
    ],
    milestones: [
      t("12 個の指標の定義案を作った", "做好了 12 个指标的定义草案", "Drafted definitions for the 12 metrics"),
      t("12 個中 5 個の数字を出せるようになった", "12 个指标中已能算出 5 个", "5 of 12 metrics now computed"),
      t("画面の試作を Kevin Liu さんに見てもらった", "请 Kevin Liu 看了画面原型", "Showed the prototype screen to Kevin Liu"),
      t("12 個中 9 個が完了し、データが古いときに知らせる仕組みを入れた", "12 个完成 9 个，加入了数据过旧时的提醒", "9 of 12 done; added an alert when data goes stale"),
    ],
    weekGoals: [
      t("analytics：12 指標の定義を Mia さんと合意する", "analytics：与 Mia 确定 12 个指标的定义", "analytics: agree the 12 metric definitions with Mia"),
      t("analytics：画面の試作を見せられる状態にする", "analytics：让画面原型可以演示", "analytics: get the prototype ready to show"),
      t("analytics：9 指標まで数字を出す", "analytics：算出 9 个指标", "analytics: compute 9 of the metrics"),
    ],
    deliverables: [],
    docs: [
      { rel: "docs/kpi/KPI定義書.xlsx", model: { verdict: "in", reason: "依頼元と合意する定義書" } },
      { rel: "reports/週次KPI_速報_draft.xlsx" },
    ],
    code: ["queries/weekly_kpi.sql", "dashboard/src/Charts.tsx", "dashboard/src/freshness.ts", "dashboard/src/kpi.test.ts"],
  },
  {
    id: "T20261001-01", requester: "Alex Wang", project: "HARBOR", dir: "harbor-api-docs", machine: "win",
    received: "2026-10-01", end: null, weight: 3,
    title: t("API v2 仕様書の改訂", "API v2 规格书修订", "API v2 specification revision"),
    short: t("API v2 仕様書", "API v2 规格书", "API v2 spec"),
    thinking: said("ja", "v1 との違いを章ごとに明記する。エラーコードは一覧表にして付録に回す。", "按章节写明与 v1 的差异。错误码整理成一览表放到附录。",
      "State the differences from v1 chapter by chapter; move the error codes into an appendix table."),
    actions: [1, 3, 10, 14, 16, 17],
    objects: [
      t("認証の章", "认证章节", "the authentication chapter"),
      t("エラーコード一覧", "错误码一览", "the error code table"),
      t("リクエスト例", "请求示例", "the request examples"),
      t("v1 との差分表", "与 v1 的差异表", "the v1 difference table"),
    ],
    milestones: [
      t("全 9 章のうち 3 章の書き直しが終わった", "全部 9 章中已改写完 3 章", "Rewrote 3 of the 9 chapters"),
      t("9 章中 5 章が完了し、エラーコード 74 個を一覧にした", "9 章完成 5 章，整理出 74 个错误码的一览", "5 of 9 chapters done; listed all 74 error codes"),
      t("9 章中 7 章が完了し、Alex Wang さんに途中版を送った", "9 章完成 7 章，把中间版发给了 Alex Wang", "7 of 9 chapters done; sent a draft to Alex Wang"),
      t("9 章中 8 章が完了し、残るは付録のみ", "9 章完成 8 章，只剩附录", "8 of 9 chapters done; only the appendix is left"),
    ],
    weekGoals: [
      t("HARBOR v2：9 章のうち 5 章まで書き直す", "HARBOR v2：9 章中改写到第 5 章", "HARBOR v2: rewrite 5 of the 9 chapters"),
      t("HARBOR v2：途中版を Alex Wang さんに送る", "HARBOR v2：把中间版发给 Alex Wang", "HARBOR v2: send the draft to Alex Wang"),
      t("HARBOR v2：付録まで書き終える", "HARBOR v2：写完附录", "HARBOR v2: finish through the appendix"),
    ],
    deliverables: [],
    docs: [
      { rel: "deliverables/HARBOR_API_v2仕様書.docx" },
      { rel: "docs/errors/エラーコード一覧.xlsx", model: { verdict: "in", reason: "仕様書の付録" } },
      { rel: "docs/draft/v2-差分メモ.md", model: { verdict: "out", reason: "下書きのメモ" } },
    ],
    code: ["openapi/harbor-v2.yaml", "examples/auth.http", "scripts/gen_error_table.py"],
  },
  {
    id: "T20261006-01", requester: "佐藤", project: "LEDGER", dir: "ledger-audit", machine: "win",
    received: "2026-10-06", end: null, weight: 3,
    title: t("監査ログ出力の追加", "新增审计日志输出", "Add audit log output"),
    short: t("監査ログ", "审计日志", "audit log"),
    thinking: said("ja", "誰が・いつ・何を変えたかを 1 行で追えること。保存期間は 7 年。", "要能用一行追踪谁、何时、改了什么。保存期为 7 年。",
      "Each change must be traceable in one line: who, when, what. Logs are kept for 7 years."),
    actions: [0, 2, 3, 6, 7, 9, 11, 12],
    objects: [
      t("監査ログの項目設計", "审计日志字段设计", "the audit log fields"),
      t("変更前後の差分出力", "变更前后差异输出", "the before/after diff output"),
      t("ログの保存と削除", "日志的保存与清理", "log retention"),
      t("検索画面", "检索画面", "the search screen"),
    ],
    milestones: [
      t("残す項目 18 個を決め、佐藤さんの了承を得た", "确定了要记录的 18 个字段，并得到佐藤先生的同意", "Agreed the 18 fields to record with Sato-san"),
      t("変更の前後が分かる記録を出せるようになった", "已能输出可看出变更前后的记录", "Records now show the before and after of each change"),
      t("7 年保存の仕組みを作った", "做好了保存 7 年的机制", "Built the 7-year retention"),
      t("記録を探す画面の試作ができた", "完成了检索记录画面的原型", "Prototyped the screen for searching the records"),
    ],
    weekGoals: [
      t("LEDGER 監査：残す項目を佐藤さんと決める", "LEDGER 审计：与佐藤先生确定记录字段", "LEDGER audit: agree the fields with Sato-san"),
      t("LEDGER 監査：7 年保存の仕組みまで作る", "LEDGER 审计：做到 7 年保存机制", "LEDGER audit: build up to the 7-year retention"),
    ],
    deliverables: [],
    docs: [{ rel: "docs/audit/監査ログ項目.xlsx" }],
    code: ["src/Audit/AuditWriter.cs", "src/Audit/DiffFormatter.cs", "src/Audit/Retention.cs", "tests/Audit.Tests/AuditWriterTests.cs"],
  },
  {
    id: "T20261008-01", requester: "Team", project: "技術検証", projectTr: t("技術検証", "技术验证", "Tech evaluation"),
    dir: "cli-dist-poc", machine: "win", received: "2026-10-08", end: { status: "hold", date: "2026-10-14" }, weight: 2,
    title: t("Go 製 CLI の Windows 配布検証", "Go 编写的 CLI 在 Windows 上的分发验证", "Windows distribution check for a Go CLI"),
    short: t("CLI 配布検証", "CLI 分发验证", "CLI distribution check"),
    thinking: said("zh", "ウイルス対策ソフトの誤検知と、管理者権限なしでの更新が論点。情報システム部の回答待ち。",
      "关键在杀毒软件误报，以及没有管理员权限时的更新。等待信息系统部回复。",
      "The issues are antivirus false positives and updating without admin rights. Waiting on the IT department."),
    actions: [0, 1, 9, 10, 12],
    objects: [
      t("署名付きビルド", "带签名的构建", "the signed build"),
      t("自動更新の仕組み", "自动更新机制", "the self-update flow"),
      t("ウイルス対策ソフトの除外申請", "杀毒软件排除申请", "the antivirus exclusion request"),
    ],
    milestones: [
      t("社内 PC 3 台で動作を確かめた", "在公司 3 台电脑上确认了运行", "Checked it runs on 3 office PCs"),
      t("管理者権限なしで更新できることを確かめた", "确认了没有管理员权限也能更新", "Confirmed it updates without admin rights"),
      t("ウイルス対策ソフトの扱いを情報システム部に確認中のため一旦止めた", "杀毒软件的处理方式正在向信息系统部确认，暂时停下", "Paused while the IT department reviews the antivirus question"),
    ],
    weekGoals: [t("CLI 配布：社内 PC での動作と更新を確かめる", "CLI 分发：确认在公司电脑上的运行和更新", "CLI distribution: check running and updating on office PCs")],
    deliverables: [],
    docs: [{ rel: "docs/windows-配布検証.md", model: { verdict: "in", reason: "検証結果のまとめ" } }],
    code: ["cmd/tool/main.go", "internal/update/update.go", "build/sign.ps1"],
  },
  {
    id: "T20261013-01", requester: "Sam Lee", project: "BEACON", dir: "beacon-templates", machine: "mac",
    received: "2026-10-13", end: null, weight: 3,
    title: t("通知テンプレートの多言語化", "通知模板多语言化", "Multilingual notification templates"),
    short: t("通知の多言語化", "通知多语言化", "multilingual notices"),
    thinking: said("ja", "まず日本語・英語・中国語の 3 言語。文面は翻訳会社の納品物をそのまま使う。", "先做日语、英语、中文三种语言。文案直接使用翻译公司的交付物。",
      "Start with Japanese, English and Chinese, using the translation vendor's text as delivered."),
    actions: [0, 2, 6, 11, 14, 15],
    objects: [
      t("テンプレートの言語切り替え", "模板语言切换", "the template language switch"),
      t("文言ファイルの読み込み", "文案文件加载", "the message file loader"),
      t("送信前プレビュー", "发送前预览", "the pre-send preview"),
    ],
    milestones: [
      t("通知 26 種の文面を洗い出した", "梳理出 26 种通知的文案", "Listed the text of all 26 notices"),
      t("言語を切り替えて送れる試作ができた（26 種中 4 種）", "完成了可切换语言发送的原型（26 种中 4 种）", "Prototype sends in a chosen language (4 of 26)"),
      t("26 種中 9 種を 3 言語で送れるようになった", "26 种中已有 9 种可以用三种语言发送", "9 of 26 notices now go out in all three languages"),
    ],
    weekGoals: [t("BEACON 多言語：26 種の文面を洗い出し、試作で送る", "BEACON 多语言：梳理 26 种文案并用原型发送", "BEACON multilingual: list the 26 notices and send from the prototype")],
    deliverables: [],
    docs: [{ rel: "docs/notices/通知文面一覧.xlsx" }],
    code: ["templates/loader.go", "templates/render.go", "templates/render_test.go", "preview/server.go"],
  },
];

export const taskById = new Map(TASKS.map((x) => [x.id, x]));

/** Session summaries pinned to a task's first (or last) session of a day; the 「待ち」 words feed the 等回复 rule. */
export const SPECIAL_SUMMARIES: { task: string; date: string; last?: true; s: Said }[] = [
  { task: "T20260907-01", date: "2026-09-29", last: true, s: said("ja", "業務部門への質問 22 件を送付し、回答待ちの項目に印を付けた", "向业务部门发出 22 个问题，并标记了等待回复的项目", "Sent the 22 questions to the business side and flagged the items waiting for answers") },
  { task: "T20260924-01", date: "2026-10-14", last: true, s: said("ja", "顧客マスタの移行スクリプトを仕上げた。流すのは佐藤さんの承認待ち", "完成了客户主数据迁移脚本，执行前在等佐藤先生批准", "Finished the customer master migration script; running it is waiting on Sato-san's approval") },
  { task: "T20261008-01", date: "2026-10-14", last: true, s: said("zh", "署名付きビルドの誤検知を再現し、情報システム部の回答待ちの状態で整理した", "复现了带签名构建的误报问题，整理好后等待信息系统部回复", "Reproduced the antivirus false positive on the signed build; now waiting for the IT department") },
  { task: "T20260916-01", date: "2026-09-16", s: said("ja", "メール遅延の障害連絡を受け、送信キューの滞留状況と影響範囲を調査した", "收到邮件延迟的故障通知，调查了发送队列的积压情况和影响范围", "Got the delayed e-mail alert and investigated the send-queue backlog and the impact") },
  { task: "T20260824-01", date: "2026-09-30", s: said("ja", "確認会の指摘 6 件を修正し、公開用のビルドを作成した", "修改了确认会提出的 6 条意见，并生成了上线用的构建", "Fixed the 6 review findings and produced the release build") },
];

/** Work that belongs to no 案件 (shown under 未关联 until someone links it). */
export const MISC_SUMMARIES: Said[] = [
  said("ja", "社内勉強会の資料用に Go の並行処理サンプルを書いた", "为公司内部学习会的资料写了 Go 并发处理示例", "Wrote Go concurrency samples for an internal study session"),
  said("zh", "Excel マクロが遅い件の相談に乗り、原因の候補を挙げた", "帮人看了 Excel 宏运行慢的问题，列出了可能的原因", "Helped with a slow Excel macro and listed likely causes"),
  said("ja", "新しいノート PC の初期設定とシェル環境の移行", "新笔记本电脑的初始设置和 shell 环境迁移", "Set up a new laptop and moved the shell configuration"),
  said("en", "正規表現でログから日付を抜き出す方法を調べた", "研究了用正则表达式从日志中提取日期的方法", "Looked up how to pull dates out of logs with a regular expression"),
  said("ja", "チーム共有のスニペット集を整理した", "整理了团队共享的代码片段集", "Tidied up the team's shared snippet collection"),
  said("zh", "SQL のウィンドウ関数の書き方を確認し、メモにまとめた", "确认了 SQL 窗口函数的写法并整理成笔记", "Reviewed SQL window function syntax and wrote a note"),
  said("ja", "CSV の文字コード変換スクリプトを作った（依頼元不明）", "写了 CSV 字符编码转换脚本（不清楚是谁的需求）", "Wrote a CSV encoding conversion script (requester unclear)"),
  said("en", "週末の障害訓練の手順を下読みした", "预读了周末故障演练的步骤", "Read through the steps for the weekend incident drill"),
];

/** Chats that are not work at all: the user hides them. */
export const CHAT_SUMMARIES: Said[] = [
  said("ja", "キーボードの配列設定について質問した", "询问了键盘布局的设置方法", "Asked how to change the keyboard layout"),
  said("zh", "週末の旅行の持ち物リストを作った", "做了周末旅行的携带物品清单", "Made a packing list for a weekend trip"),
  said("ja", "Markdown の表の書き方を試した", "试了试 Markdown 表格的写法", "Tried out Markdown table syntax"),
  said("en", "コーヒー豆の挽き方について雑談した", "闲聊了咖啡豆的研磨方法", "Chatted about grinding coffee beans"),
  said("ja", "動作確認のための空のセッション", "用于确认运行的空会话", "An empty session to check the tool works"),
];

/** First prompt of a session whose summary could not be generated (summary_source 'fallback'). */
export const FALLBACK_SUMMARIES: string[] = [
  "受注一覧の検索条件が効かない件、原因を調べて",
  "照合バッチの実行ログを貼るので遅い所を見てほしい",
  "移行スクリプトの件数が合わない、どのテーブルか特定して",
];

/** Artifact pages published from a task's longest session on (or after) a date. */
export const ARTIFACTS: { task: string; date: string; title: string }[] = [
  { task: "T20260826-01", date: "2026-09-10", title: "HARBOR 結合テスト 消化状況" },
  { task: "T20260901-01", date: "2026-09-17", title: "LEDGER 照合バッチ 処理時間の推移" },
  { task: "T20260824-01", date: "2026-09-18", title: "ORION-A 画面移行 進捗ボード" },
  { task: "T20260914-01", date: "2026-10-01", title: "ATLAS ロール×権限マトリクス" },
  { task: "T20260929-01", date: "2026-10-08", title: "週次 KPI ダッシュボード モック" },
  { task: "T20261001-01", date: "2026-10-14", title: "HARBOR API v2 エラーコード早見表" },
];
