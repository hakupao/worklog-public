# worklog 設計書 — 派遣エンジニアの作業可視化・週報システム

日付: 2026-09-18
状態: 設計確定待ち（ユーザーレビュー）

## 1. 背景と目的

作業の大半を AI agent（Claude Code / Codex / Web AI）に委任し、本人は調査・判断・指示を行う働き方をしている。
成果物は出ているが**過程が他者から見えない**。

このシステムの目的は、記録ではなく **隠れた過程を証拠として可視化すること**:

- 誰が依頼したか（依頼元）
- 自分が何を調べ・何を判断したか（thinking）
- agent が何を作ったか（session / 成果物）
- どれだけ時間がかかったか（工数）

そして週 1 回、現場リーダーと派遣元の 2 受衆に日本語 Excel で報告する。

## 2. 制約と前提

| 項目 | 内容 |
|---|---|
| 環境 | Win11 + Mac mini、両方とも現場。外部サービスへのアクセス制限なし |
| 同期 | GitHub 私有リポジトリ |
| 使用 agent | Claude Code（CLI / Desktop）、Codex CLI、Web AI（ChatGPT / Claude.ai 等） |
| データ取得 | 混合: 手動で案件を起票し、agent ログから過程を自動収集。Web AI は手動補記のみ |
| 報告形式 | 日本語 xlsx。現場向け / 派遣元向けの 2 テンプレート |
| 将来 | Mac mini 上の SQLite + Web フロントへ移行できること（データ形式を SQLite 互換に設計） |

## 3. 全体構成

```
worklog/
├── data/
│   ├── tasks.jsonl        # 案件（起票・更新は追記。同 id の最終行が現在値）
│   ├── sessions.jsonl     # agent session 要約（自動収集）
│   └── notes.jsonl        # 補記（Web AI の作業、口頭調査など）
├── reports/               # 生成した週報 xlsx（git 管理）
│   └── 2026-W38-site.xlsx
├── templates/             # 週報テンプレート定義（site.toml / agency.toml）
├── config.toml            # 依頼元エイリアス、ディレクトリ→project 対応、machine 名
├── src/worklog/
│   ├── cli.py             # `wl` エントリ（typer）
│   ├── store.py           # Store インターフェース + JsonlStore 実装
│   ├── models.py          # Task / Session / Note（pydantic）
│   ├── harvest/
│   │   ├── claude_code.py # ~/.claude/projects/**/*.jsonl パーサ
│   │   ├── codex.py       # ~/.codex/sessions/**/*.jsonl パーサ
│   │   ├── summarize.py   # `claude -p` による一行要約
│   │   └── link.py        # session → task 紐付けルール
│   └── report/
│       ├── weekly.py      # 集計
│       └── xlsx.py        # openpyxl 出力
├── tests/
├── pyproject.toml         # Python 3.11+, uv 管理
└── README.md
```

技術選定: Python 3.11+ / uv / typer / pydantic / openpyxl / tomllib。
Win と Mac で同一コード。常駐サービスは持たない。

## 4. データモデル

全レコード共通: `id`, `kind` (task|session|note), `ts` (記録時刻 ISO8601), `machine` (config の名前), `schema_version` (int, 初期値 1)。

### 4.1 Task

| フィールド | 型 | 説明 |
|---|---|---|
| id | str | `T` + 日付 + 2 桁連番（例 `T20260918-01`）。両機で衝突しないよう、連番は当日の既存件数 + 1。同日同番の衝突は pull 時に検出し末尾に機名を付けて解決 |
| requester | str | 依頼元。config のエイリアスで正規化（"田中" → "田中さん（営業部）"） |
| project | str | プロジェクト / システム名 |
| title | str | 案件名 |
| status | enum | open / done / hold |
| received_at | date | 受領日 |
| done_at | date? | 完了日 |
| thinking | str | 自分の調査・判断メモ。`wl note` で追記され、最終行に連結して保持 |
| deliverables | list[str] | 成果物のパスまたは URL |
| hours_manual | float? | 手動工数。あれば自動推定より優先 |

更新は「同 id で新しい行を追記」。読み取り時は id ごとに最終行を採用（last-write-wins）。
履歴を壊さず、git 衝突も行単位で解決できる。

### 4.2 Session

| フィールド | 型 | 説明 |
|---|---|---|
| id | str | `S` + agent 固有 session_id の先頭 8 桁 |
| agent | enum | claude-code / codex |
| session_id | str | 元の session ID（重複排除キー） |
| cwd | str | 作業ディレクトリ |
| started_at / ended_at | datetime | 最初・最後のメッセージ時刻 |
| active_minutes | int | 隣接メッセージ間隔 ≤ 30 分の合計 |
| turns | int | ユーザーメッセージ数 |
| summary | str | 一行要約（日本語） |
| task_id | str? | 紐付いた Task。null なら未割当 |
| link_method | enum | auto-dir / auto-time / manual / none |

### 4.3 Note

| フィールド | 型 | 説明 |
|---|---|---|
| id | str | `N` + `ts` ベース |
| text | str | 本文 |
| task_id | str? | 紐付け先。null 可 |
| minutes | int? | 手動工数（Web AI 作業など） |

3 種はそのまま SQLite の 3 テーブルに対応する。

## 5. 手動入力（10 秒原則）

```
wl new <依頼元> <案件名> [--project P] [--received YYYY-MM-DD]
wl done <task_id> [--deliverable PATH ...] [--hours H]
wl hold <task_id>
wl note <task_id|-> <本文> [--minutes M]      # "-" で task なし
wl link <session_id> <task_id>
wl unlink <session_id>
wl ls [--all] [--unassigned]
wl show <task_id>
```

- 依頼元は config.toml の `[requesters]` でエイリアス展開。未知の名前はそのまま保存し、警告を出す。
- Claude Code グローバル skill `/wl`（`~/.claude/skills/wl/SKILL.md`）を用意し、自然言語 → 上記コマンドへ変換して実行させる。これにより作業中のセッションから離れずに起票できる。

## 6. 自動収集（`wl harvest`）

### 6.1 入力

| agent | パス | 使うレコード |
|---|---|---|
| Claude Code | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` | `type=user` / `type=assistant` の `message`, `cwd`, `timestamp`, `sessionId` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `type=session_meta` の `payload.cwd`/`session_id`; `type=response_item` かつ `payload.type=message` |

`isSidechain=true`（subagent）のメッセージは turns に数えない。
`~/.claude/projects` の scratch-workspaces 配下は除外設定可能にする（config `harvest.exclude_cwd_patterns`）。

### 6.2 処理

1. `data/.harvest_state.json`（git 管理外）に処理済み `(agent, session_id, last_mtime)` を保持。mtime が進んだ session のみ再処理（進行中セッションの追い掛け更新）。
2. メッセージを時系列に並べ、`active_minutes`, `turns`, `started_at`, `ended_at` を算出。
3. 要約: ユーザーメッセージ全文 + 最終 assistant 返信のみを `claude -p --model haiku` に渡し、日本語 1 行（60 字以内）を得る。失敗時は最初のユーザーメッセージ先頭 60 字をフォールバックとし `summary_source=fallback` を付ける。turns=0 の session はスキップ。
4. 紐付け（link.py）:
   - **auto-dir**: config `[projects]` の `dir → project` 対応で project を特定し、その project の open task が 1 件ならそれに紐付け。
   - **auto-time**: 複数または project 不明の場合、`received_at ≤ started_at` かつ (`done_at` なし or `ended_at ≤ done_at + 1 日`) の open/done task が 1 件ならそれ。
   - どちらも決まらなければ `task_id=null`。`wl ls --unassigned` で一覧、`wl link` で手動。
   - 既に `link_method=manual` の session は再処理でも上書きしない。
5. `sessions.jsonl` に追記（同 session_id は最終行優先）。

### 6.3 実行タイミング

常駐しない。`wl harvest` を

- Mac: launchd で平日 18:00
- Win: タスクスケジューラで平日 18:00
- かつ `wl report` 実行時に自動で先行実行

## 7. 週報生成（`wl report`）

```
wl report [2026-W38] [--for site|agency] [--out PATH]
```

週は ISO 週（月〜日）。省略時は先週。集計後 `reports/<week>-<for>.xlsx` を生成。

### 7.1 工数

task の工数 = `hours_manual` があればそれ、なければ Σ(紐付き session の active_minutes) + Σ(紐付き note の minutes) を時間換算（0.25h 丸め）。
未割当 session の工数は「その他・調査」行に計上し、捨てない。

### 7.2 シート構成

| シート | 内容 | site | agency |
|---|---|---|---|
| サマリー | 週、案件数（新規/完了/継続）、依頼元別件数、総工数 | ○ | ○ |
| 案件一覧 | 依頼元 / 案件名 / project / 状態 / 受領日 / 完了日 / 工数 / 成果物 / 備考(thinking 要約) | ○ | ○ |
| 日別作業 | 日付 / 案件 / 作業内容（session summary + note） / 分 | ○ | 簡略 |
| 成果物 | 案件 / 成果物パス / 完了日 | ○ | × |
| 稼働 | 日別稼働時間、週合計 | × | ○ |

`templates/site.toml` / `agency.toml` にシート ON/OFF、列順、列名を定義。コードは変えずにテンプレートで調整できる。

## 8. 同期

- 両機とも同じ GitHub 私有リポジトリを clone。`wl` の書き込み系コマンドは終了時に `git pull --rebase && git push` を試み、失敗しても記録自体は成功扱い（次回に持ち越し）。`--no-sync` で抑止可。
- JSONL は追記のみなので競合は行単位。競合時は両方の行を残す（union merge）。`.gitattributes` に `data/*.jsonl merge=union` を設定。
- `.harvest_state.json` は機械ごとに異なるため git 管理外。

## 9. エラー処理

- ログファイルが壊れた行: スキップして件数を警告。
- `claude -p` 失敗 / 未インストール: フォールバック要約で続行。
- git 同期失敗: 警告のみ。
- 不正な task_id 参照: コマンド失敗（記録しない）。

## 10. テスト

- `store`: 追記 → 最終行採用の意味論、破損行スキップ。
- `harvest.claude_code` / `harvest.codex`: 実ログを匿名化した fixture で cwd / 時刻 / turns / active_minutes を検証。
- `harvest.link`: auto-dir / auto-time / 未割当 / manual 保護の各ケース。
- `report.weekly`: 固定データで工数計算・週境界。
- `report.xlsx`: 生成ファイルを openpyxl で読み戻し、指定セルを比較。
- `summarize`: `claude -p` はモック。

## 11. 将来の移行（方案 C）

- `Store` を抽象クラスにし、`JsonlStore` と将来の `SqliteStore` を差し替え可能にする。
- `wl migrate --to sqlite` で 3 JSONL → SQLite 3 テーブルへ変換。
- Web フロントは SQLite を読むだけ。CLI / harvest / report は変更不要。

## 12. スコープ外（今回やらない）

- Web UI / ダッシュボード
- Google Sheets 連携
- Web AI（ChatGPT 等）の自動取り込み
- 常駐デーモン、ファイル監視
- 複数ユーザー
