# Go collector (`wl`) — design

Date: 2026-10-12, revised 2026-10-13 (user decisions + critic review) · Status: decisions recorded, ready for planning · Plan: `docs/plans/2026-10-12-go-collector.md`

Reference implementation: `src/worklog/` at `01ecf82` (includes `3dbcb0b`, the weekly-review `digest_rhythm`), run by **CPython 3.14.4** under uv (pydantic 2.13.5,
httpx 0.28.1, typer 0.27.2). Every "Python does X" below is a statement about that interpreter and those
library versions, not about the `requires-python = ">=3.11"` floor. Line references are to `01ecf82`.

## 1. Why

`wl` is the only Python part of the repo. On the Win11 PC every `uv run wl …` costs 1–3 s and ~100 MB before
any work starts (memory `collector-go-rewrite-direction`). That launch cost is paid by the hourly harvest, by
every `/wl` skill call from Claude Code, and would be paid every few minutes by the 立即收集 polling idea. A Go
binary starts in milliseconds, needs no runtime, and is cross-compiled for both machines from the Mac.

## 2. User decisions (2026-10-12)

| # | Decision |
|---|----------|
| U1 | Rewrite the collector/CLI `wl` in Go **directly**. The earlier "measure Python first (call `wl.exe` without `uv run`, lazy imports)" step is skipped. |
| U2 | `server/` and `web/` are untouched. The HTTP API contract stays what the Python collector sends (at the levels defined in §5.2), so Python and Go collectors can run at the same time on different machines during the migration. |
| U3 | `claude -p` stays the summarizer and judge (shelled out). No speedup is promised for summarizing or judging, only for start-up and parsing. |
| U4 | Go is not yet installed on the Mac; installing it is part of the plan. |

### 2.1 Decisions on the open questions (2026-10-13)

| # | Decision |
|---|----------|
| Q1 | Win11 is x64: one Windows target, `windows/amd64`. |
| Q2 | Distribution: GitHub Release on the private repo; `scripts/update-wl.ps1` downloads into `<repo>\bin\`; `gh auth login` once on Win11. |
| Q3 | Scheduled task keeps `conhost --headless` + `.cmd`; no `windowsgui` build for now. |
| Q4 | The legacy `data/.harvest_state.json` move is dropped. Win11's absence of `<repo>\data\` is a precondition checked before its cutover. |
| Q5 | 7-day soak per machine, Mac first. |
| Q6 | Python is deleted in one separate commit after both soaks pass and the retrospective is written. |
| Q7 | User-Agent `worklog-cli/<version> (go)`. |
| Q8 | Collector feature freeze during the port; an urgent Python change lands in Go in the same commit, enforced by the CI golden-drift check. |
| Q9 | The intentional divergences in §6 are accepted. |

## 3. Goals / non-goals

Goals
- Same commands, flags, exit codes, stdout/stderr lines, config files and precedence, `~/.worklog/` layout.
- Same request bodies for every write as **ordered JSON values** (same keys in the same order, same strings, numbers
  equal by value), with datetime strings spelled exactly as Python spells them (§5.2 says what must be byte-exact and why).
- **Hand-off without re-work**: Go reads the `harvest_state.json` and outbox Python wrote and reaches the same
  decisions, so switching a machine re-summarizes nothing and loses nothing. Rolling back to Python is the same
  in the other direction.
- One static binary per OS (darwin/arm64, windows/amd64 — see Q1), no runtime, no `uv`.

Non-goals
- New features (立即收集 polling, a `--dry-run`, batching ingest). They become cheap after the port; they are not part of it.
- Changing what is summarized, judged or priced. Prompts are copied byte-for-byte.
- Speeding up `claude -p`.
- Porting Python crashes (§6).

## 4. Behaviour inventory

### 4.1 Commands, flags, output, exit codes

Command set is exactly: `new`, `done`, `hold`, `note`, `ls`, `harvest`, `review`, `plan judge`
(`tests/test_cli.py:105` pins the set). Options may appear before or after positionals (click semantics):
`wl new 田中 帳票修正 --project order` is the documented form.

| Command | Args / flags | Behaviour | stdout | stderr | Exit |
|---|---|---|---|---|---|
| `new` (`cli.py:99-119`) | `REQUESTER TITLE [--project P] [--received YYYY-MM-DD]` | resolve requester (§4.1.1); `received` default `date.today()` (**local** date); `POST /api/tasks` with 4 s timeout; never parks. An invalid `--received` is parsed only **after** config and client setup and raises (traceback, exit 1) — §6 D13 | the server id | `error: the case was not created; the server did not answer or refused the request` | 0 / 1 |
| `done` (`cli.py:122-141`) | `TASK_ID [--deliverable PATH]… [--hours H≥0]` | GET task (§4.3 `get_task`); status=`done`, `done_at`=local today, deliverables = server list + flags (appended, no dedupe), `hours_manual` only when given; `ts`=now (naive local), `machine`; PUT with `park=False` | — | `error: unknown task id '…' (or the server could not be reached)` / `error: the server did not accept the update to '…'` | 0 / 1; `--hours -1` → usage error, 2, before any network call (`tests/test_cli.py:371`) |
| `hold` (`cli.py:144-153`) | `TASK_ID` | as `done` with status=`hold` only | — | same as done | 0 / 1 |
| `note` (`cli.py:156-235`) | `TASK_ID\|- TEXT [--minutes M]` | see §4.1.2 | — | see §4.1.2 | 0 / 1 |
| `ls` (`cli.py:238-251`) | `[--all]` | GET `/api/tasks`; without `--all` keep status `open`/`hold`; server order | header `id \| 依頼元 \| project \| 状態 \| 受領日 \| 案件名` then `{id} \| {requester} \| {project} \| {status} \| {received_at} \| {title}` | `error: could not read the cases from the server` | 0 / 1 |
| `harvest` (`cli.py:254-359`) | `[--claude-root P] [--codex-root P] [--since N] [--refresh-meta\|--files-only]` | §4.5; side jobs §4.13–4.15 | count line | outbox line, warnings | 0 / 2 |
| `review` (`cli.py:362-386`) | `[--week YYYY-Www] [--force]` | §4.13 | `review: {week} {outcome}` | warn | 0; 2 on bad week or outcome ∈ {unreachable, llm-failed, rejected} |
| `plan judge` (`cli.py:393-413`) | `[--date YYYY-MM-DD]` | §4.14, always `force=True`; default day = JST today | `plan: {day} {outcome}` | warn | 0; 2 on bad date or outcome ∈ {unreachable, llm-failed, bad-output, rejected} |

Common to every command except the pure-validation failures:
- `_load_cfg` (`cli.py:29-34`): a config error prints its message to stderr, exit 1.
- `_client` (`cli.py:37-48`): missing `api_url` or `api_token` → `error: api_url (config.toml) and api_token (~/.worklog/credentials.toml) are required`, exit 1.
- Usage errors (unknown command/option, missing argument, bad int/float) → exit 2 (click). Help text wording is not part of the contract; the command names in `--help` are (`tests/test_cli.py:109`).
- Validation order matters for `review` (`cli.py:370-380`): the regex check runs **before** config is loaded, the ISO-week check after.

#### 4.1.1 Requester resolution (`cli.py:51-65`)
Split on `[、,，]`, strip each part, drop empties; map through `[requesters]` or warn
`warning: unknown requester alias '{part}', saving as-is` (stderr); dedupe preserving order; join with `、`;
if the result is empty, send the input unchanged.

#### 4.1.2 `wl note` (`cli.py:156-235`)
1. `target = None if TASK_ID == "-"`.
2. If target: `get_task`; if `None` **and** `list_tasks()` is not `None` → `error: unknown task id '{target}'`, exit 1 (server up, id wrong). Otherwise continue (server down: the note may still be parked).
3. Note id `N{local now:%Y%m%d-%H%M%S}-{4 hex}` (`cli.py:93-96`); PUT `/api/notes/{id}` with park=True.
4. Outcome `lost` → `error: note {id} could not be written to {home}/outbox (disk full or read-only?); it was NOT saved anywhere`, exit 1. `rejected` → `error: the server rejected note {id}; it was moved to {home}/outbox/rejected and will not be sent again`, exit 1. `retry` → `worklog: server unreachable; note {id} is queued in {home}/outbox and will be sent by the next wl harvest` (exit 0, continue).
5. No target → done. Task unreadable → `worklog: could not read '{target}', so its 備考 was not updated; the note itself is saved, and the text can be added on the web`, exit 0.
6. Append `- {text}` to `thinking` (prefixed by `\n` when thinking is non-empty), `ts`, `machine`; PUT task with **park=False**; failure → `worklog: 備考 was not written for {target}; the note itself is saved, so add the text on the web rather than re-running wl note`, exit 0.

#### 4.1.3 `wl harvest` output (`cli.py:278-359`)
- First, `flush()`; if `sent or remaining`: stderr `outbox: sent={s} remaining={r}`.
- Roots: `--claude-root` / `--codex-root` build a dict of **only the roots given**; passing one root drops the other agent entirely; neither → defaults `~/.claude/projects`, `~/.codex/sessions` (`cli.py:282-286`, `run.py:50-51`).
- `--refresh-meta` (alias `--files-only`): §4.12; stdout `meta: sent={n} updated={m}`; on a non-landing outcome stderr `worklog: the server was unreachable; nothing was queued, re-running it is safe` (retry) or `worklog: the server refused the update (is it deployed with migration 0004?); nothing was queued, re-running it is safe`, exit 2. Default `since` = all logs.
- Normal run: default `--since 14`. `ApiUnavailable` (task list unreadable) → stderr `worklog: api unreachable, harvest skipped (outbox will be flushed next run)`, exit 2.
- stdout: `new={new} updated={updated} parked={parked} skipped={skipped} fallback={fallback}` + ` rejected={n}` / ` lost={n}` only when non-zero + `, unassigned={n}` only when the current Tokyo ISO week's timeline answered an int (`cli.py:309-321`, `api_store.py:46-52`). The runbook and `docs/guide/usage.md` check this exact shape.
- Then three side jobs, each wrapped so **no exception fails harvest**: weekly review of the previous JST week (`review: {week} generated` on stored), plan judge for JST today and yesterday (`plan: {day} judged`), deliverable judge (`deliverables: judged`); each failure prints `worklog: … skipped: {exc}` and its `warn()` text (§4.13–4.15). All on stderr. Exit stays 0.

### 4.2 Configuration (`config.py`)

| Item | Source and precedence |
|---|---|
| Root dir | `$WORKLOG_ROOT` (must contain `config.toml`, else `worklog: config.toml not found in WORKLOG_ROOT={root}`) → first ancestor of cwd (inclusive) with `config.toml` → the package's repo root (`config.py:37-53`) → error `worklog: config.toml not found. Set WORKLOG_ROOT or create a config.toml in the current directory or an ancestor.` Go replaces "package repo root" with "first ancestor of the executable's directory with `config.toml`" (§9). |
| `config.toml` | parsed strictly; a malformed file is a hard error, exit 1 (Python: uncaught `TOMLDecodeError` traceback — Go prints one line, see §6). Keys: `machine`, `summarize_model` (default `haiku`), `api_url`, `[requesters]`, `[projects]`, `[pricing."model"]`, `[harvest] exclude_cwd_patterns` (default `[]`), `exclude_prompt_patterns` (default `["Review this change for security vulnerabilities"]`), `min_active_minutes` (default 3, `int()`-coerced). An `api_token` in config.toml is ignored (`tests/test_config_api.py:24`). |
| Home | `$WORKLOG_HOME` or `~/.worklog` (`config.py:72`). |
| `credentials.toml` | `api_token`, `access_client_id`, `access_client_secret`; each kept only if a non-empty string. Unreadable/malformed → stderr `worklog: ignoring unreadable credentials file {path} ({err})` and all three None (`config.py:76-91`). |
| Machine | `local.toml` `machine` (non-empty string) > `config.toml` `machine` > hostname (`platform.node()`). Malformed local.toml → `worklog: ignoring unreadable local config {path} ({err})` (`config.py:93-103`). |
| State file | `{home}/harvest_state.json` (`config.py:27-30`). Legacy `{root}/data/.harvest_state.json` is moved there once if the new file is absent (`run.py:54-62`) — see Q4. |

### 4.3 API client (`api_client.py`)

Outcomes (`api_client.py:16-25`): `ok`, `retry`, `rejected`, `lost`. Retryable 4xx = {401, 403, 408, 429}
(`:28`). All other 4xx → `rejected`; 5xx, 3xx and transport errors → `retry`.

- Headers: `Authorization: Bearer {token}`, `User-Agent: worklog-cli/{version}` (`:52-56`; CF error 1010 blocks default library UAs — memory `followups-done-2026-09-23`), plus `CF-Access-Client-Id/Secret` **only when both** are set (`:72-74`). JSON bodies with `Content-Type: application/json`, encoded as httpx 0.28 does: `json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False)` — compact, raw UTF-8, Python float repr. (Outbox files use the default `", "`/`": "` separators instead, §4.4.)
- Base URL: `api_url.rstrip("/")`.
- Timeouts: 10 s for writes and flush; 4 s (`INTERACTIVE_TIMEOUT`) for every GET helper and `create_task` (`:32`, `tests/test_api_client.py:447-477`). An httpx `Timeout(10)` is **per phase** — connect, each read, each write and pool acquisition each get 10 s — not a deadline for the whole request; a slow but steadily streaming response never times out. Go reproduces this at the transport level (dial timeout, TLS handshake timeout, response-header timeout, and a `net.Conn` wrapper that sets a fresh read/write deadline before every `Read`/`Write`, with the 4 s or 10 s value chosen per request), not with an overall `context` deadline.
- Query strings: `deliverable_pending` encodes the machine with `urllib.parse.quote(machine)` (safe `/`, space → `%20`, `~` kept). Go's `url.QueryEscape` differs (space → `+`, `/` → `%2F`); Go uses its own `pyquote`.
- **Redirects are not followed** (httpx default). A 302 (e.g. an Access login redirect) is `retry` for writes and "cannot be had" for reads.
- **Circuit breaker** (`:83-87`): the first transport-level error (connect, DNS, timeout, TLS) sets `offline`; from then on every call short-circuits (`retry` / `None`) and `flush()` returns `(0, len(files))`. An HTTP status — any status — never opens it.
- A 2xx whose `Content-Type` does not contain `json` (case-insensitive) is `retry` (Access login page) (`:100-106`).
- `_get_json` (`:111-123`): any non-2xx, non-JSON body or decode error → `None`.

| Method | Request | Interpretation |
|---|---|---|
| `put_task(task, park)` | `PUT /api/tasks/{id}` full Task body | Outcome |
| `put_note(note, park)` | `PUT /api/notes/{id}` | Outcome |
| `ingest(machine, sessions, park)` | `POST /api/ingest/sessions` `{"machine", "sessions": [Session]}` — **always exactly one session per request** (`api_store.py:44`) | `IngestResult(inserted, updated)` from the body; unreadable counts → `(0, 0)` (`:185-190`) |
| `put_session_meta(items)` | `POST /api/ingest/session-meta` `{"sessions": items}`, never parked | int `updated` (unreadable → 0) or Outcome |
| `flush()` | replays `sorted(outbox/*.json)` | §4.4 |
| `list_tasks()` | `GET /api/tasks` | `{id: Task}` in server order, or `None` if not a list or **any** row fails Task validation (`:248-256`) |
| `get_task(id)` | `GET /api/tasks/{id}` → `payload["task"]` | Task or `None` |
| `week_timeline(week)` | `GET /api/weeks/{week}/timeline` | dict or `None` |
| `dashboard(from, to)` | `GET /api/dashboard?from=&to=` | dict or `None` |
| `review(week)` | `GET /api/reviews/{week}` | non-JSON → `None`; 404 with `{"error":"no review"}` → `"missing"`; 200 dict → dict; else `None` (`:278-305`) |
| `put_review(body)` | `POST /api/reviews`, never parked | `bool(body.stored)`; unreadable body → `retry` |
| `judge_input(day)` | `GET /api/day-plans/{day}/judge-input` | 404 `{"error":"no plan"}` → `"missing"`; 200 dict → dict; else `None` (`:317-336`) |
| `post_judgement(day, body)` | `POST /api/day-plans/{day}/judgement`, 10 s | non-JSON → retry; 200 ok; 409 stale; other non-retryable 4xx rejected; else retry (`:338-357`) |
| `deliverable_pending(machine, limit)` | `GET /api/ingest/deliverables/pending?machine={urlquote}&limit=` | dict or `None` |
| `post_deliverable_verdicts(v)` | `POST /api/ingest/deliverables/verdicts`, never parked | int `inserted` (unreadable → 0) or Outcome |
| `create_task(...)` | `POST /api/tasks` `{requester,title,project,received_at,machine}`, 4 s | non-empty string `id` or `None` |

Task validation (pydantic, lax mode, `models.py:13-23`): required `id, ts, machine, requester, title, received_at`;
`status ∈ {open, done, hold}` (default open); `kind` must be `task` if present; `received_at`/`done_at` dates;
`deliverables` list of strings; `hours_manual` number or null; unknown keys dropped. One bad row makes the
whole list `None`, which makes harvest exit 2 — Go must be exactly as strict, not more and not less.

### 4.4 Outbox (`api_client.py:125-246`)

- Layout: `{home}/outbox/*.json` (queue), `{home}/outbox/rejected/*.json` (record, never replayed).
- File body: `{"method", "path", "body"}`, `json.dumps(..., ensure_ascii=False)`, UTF-8.
- Name: `{stamp:019d}-{6 hex}.json`, stamp = `max(time_ns(), last+1)` per process (`:134-149`). Sorting names sorts replay order; ingest UPSERTs by id so oldest-first replay is required.
- `_send(park=True)`: non-ok → parked (rejected ones to `rejected/`); a failed park → `lost` and stderr `worklog: could not write outbox ({e}); record not queued`.
- `flush()`: no dir → `(0,0)`; breaker open → `(0, n)`; for each file in order: unreadable/corrupt JSON/missing key → moved to `rejected/` and skipped (a file whose JSON is valid but not an object, e.g. an array, raises `TypeError`, which is not caught: §6 D14); `retry` → stop, return `(sent, n - i)`; `rejected` → moved to `rejected/` (not counted as sent); ok → unlink (warning if that fails) and `sent += 1`.

### 4.5 Harvest pipeline (`harvest/run.py:120-258`)

1. `tasks = store.tasks()` **before** any parsing; `None` → `ApiUnavailable` (`run.py:132-136`).
2. Load state (`run.py:72-81`): missing/unparseable/non-dict → `{}`; a bare float value is upgraded to `{"mtime": v}`.
3. Phase 1, sequential, per agent in roots order, per session in parser order:
   - `key = "{agent}:{session_id}"`.
   - `prev.mtime == raw.mtime` (float equality) → `skipped`, nothing else.
   - `exclude_cwd_patterns` substring match on cwd → `skipped` (no bookmark).
   - Trivial: `turns == 0` or first user text contains any `exclude_prompt_patterns` or (`turns <= 1` and `active_minutes < min_active_minutes`) → `skipped`, bookmark `{"mtime"}` only.
   - Link (§4.11) against the server tasks.
   - Fingerprint (§5.3); `prev.fp == fp` → `skipped`, bookmark `{"mtime", "fp"}`.
   - Otherwise a candidate.
   - Save state once after phase 1 (`run.py:186`).
4. Phase 2: summarize candidates on a pool of 4 workers; results consumed **in completion order on one thread**. Per result: count `fallback`; build Session (§5.2) with `id = "S" + session_id[:8]`, `ts = datetime.now()` (naive local, microsecond precision — Go truncates `time.Now()` to µs before formatting; the same for note ids, `done`/`hold`/`note` task `ts`); `store.append` (one ingest request); `IngestResult` → `new += inserted`, `updated += updated`; `retry` → `parked += 1`; `rejected` → `rejected += 1` + stderr `worklog: the server refused session {id}; it is in {outbox}/rejected/ and will not be sent. The next harvest will try it again.`; `lost` → `lost += 1` + stderr `worklog: session {id} could not be saved anywhere; the next harvest will try it again.`
   - Bookmark only on `IngestResult` or `retry`: `{"mtime"}` plus `"fp"` unless the summary fell back; save state after each.
5. `--since N`: a log participates only if its (combined, §4.6/§4.7) mtime ≥ now − N·86400.

### 4.6 Claude Code parser (`harvest/claude_code.py`)

- Files: `sorted(root.rglob("*.jsonl"))` — `Path` ordering compares the path **component by component**; on Windows (`WindowsPath`) each component is compared **lower-cased** (`_str_normcase`), on POSIX case-sensitively. The same ordering applies to the Codex bases (§4.7) and decides which duplicate wins. Skipping any path with a `subagents` directory component below root (`:303-309`); `since` filter on combined mtime (`:310`).
- Combined mtime = max(own, every `<session>/subagents/**/*.jsonl`) (`:205-216`).
- Records: `read_text(utf-8).splitlines()`, strip, `json.loads`, keep dicts (`:192-202`).
- For every `user`/`assistant` record: feed the Artifact tracker; for assistant records collect written paths (`Write/Edit/MultiEdit.file_path`, `NotebookEdit.notebook_path`) and add the response usage (subagent = `isSidechain`) — **before** the sidechain/text filters (`:246-258`).
- Sidechain records stop there. First `sessionId` and first `cwd` win. Text = string content, or the concatenation of `type=="text"` blocks. User text that is empty or starts with `<` is dropped; any empty text is dropped; records without `timestamp` are dropped.
- No `sessionId` → no session.
- Subagent logs (sorted by `(mtime, name)`): artifacts, written paths, usage as subagent (`:219-232`).
- `files_written = clean_paths(own + subagent paths, cwd)` (§4.8).
- Tokens (`:104-189`): one entry per `message.id`, keeping the record with the largest `output_tokens` (ties → later record; the entry keeps its **first insertion position**); records without id are all kept. Per response: skip `<synthetic>`; model `+":fast"` when `usage.speed=="fast"`; with `usage.iterations`, count each iteration (type `message` → the main model, else `it.model or model`), and put the top-level `thinking_tokens` reasoning on the first iteration of the main model; cache writes split into `cache_write_1h = min(ephemeral_1h, total)` and the rest as 5m.
- Artifacts (`:42-101`): `Artifact` tool_use with `action ∈ {None, "publish"}` and no truthy `asset` registers its id; a non-error `tool_result` for a registered id records `toolUseResult.{url,title,artifact_id}` + the record `timestamp`, only if `url` contains `/artifact/`; one entry per url, newest wins, an older publish read later only fills missing title/id; output sorted by parsed ts.

### 4.7 Codex parser (`harvest/codex.py`)

- Bases: `root`, then `root.parent / "archived_sessions"`; each `sorted(rglob("*.jsonl"))` (`:329-339`).
- First `session_meta` payload per file (`_first_meta`, line-by-line, `:207-222`). A **fork** = `forked_from_id` truthy or `source` is a dict containing `subagent`; its parent = `session_id` when it differs from its own `id` (`:225-234`). Forks are grouped under the parent, keyed by the fork's own `id` (first path wins), so a fork in both bases counts once. Non-fork subagents (memory consolidation: parent == own id) are dropped entirely.
- Per rollout: combined mtime = max(own, its forks); `since` filter; `_parse`; a session id already yielded is skipped (sessions/ wins over archived_sessions/).
- `_parse` (`:251-312`): every record feeds usage. First `session_meta` that is a fork → no session. `session_id`/`cwd` = last non-empty seen in any session_meta. `response_item` payloads: written paths from patches (below) first; then `type=="message"`, role user/assistant, text = concat of `input_text`/`output_text` blocks; user text skipped when empty, starts with `<`, or contains `# AGENTS.md` or `<environment_context>`; no timestamp → dropped.
- Patches (`:12-124`): `custom_tool_call.input` or `function_call.arguments` (JSON; every string value, argv lists flattened, that contains `*** Begin Patch`). A `*** Begin Patch` at line start (after spaces/tabs) is taken raw up to `*** End Patch`; one immediately after a JS quote is a JS string literal, decoded (`\n \r \t \b \f \v \0`, `\xHH`, `\uHHHH`, `\u{…}`, escaped newline = continuation, surrogate pairs joined, unpaired → U+FFFD). Headers `*** Add File: / Update File: / Move to:` at line start; `Move to` replaces the previous path; `Delete File` ignored; trailing `\r` stripped.
- Usage (`:144-191`): `turn_context.model` sets the current model (initial `"unknown"`); each `token_count` event with a `total_token_usage` different from the previous one adds `last_token_usage`: input = max(0, input − cached), cache_read = cached, cache_write_5m = `cache_write_input_tokens`, reasoning = `reasoning_output_tokens`. No event at all → tokens `None`. Fork usage is added as subagent usage of the parent (`add_subagent`).
- Artifacts are always `[]` for Codex.

### 4.8 Paths (`harvest/base.py:34-93`)

`clean_paths(paths, cwd)`: strip; drop empty; a relative path is joined to cwd with **cwd's flavour** (POSIX if it starts with `/`, else Windows) and dropped if cwd is not absolute; `normpath` with the path's own flavour; drop noise; dedupe first-wins. Windows-absolute = `^[A-Za-z]:[\\/]` or `\\\\`. Noise: (after `\`→`/`, case-folded for Windows paths) prefixes `/tmp/ /private/tmp/ /var/folders/ /private/var/folders/ {HOME}/.claude/ {HOME}/.codex/ {HOME}/.worklog/`, anything containing `/.claude/worktrees/`, and Windows paths containing `/appdata/local/temp/`. `{HOME}` is **this machine's** home, noise-keyed.

### 4.9 Active intervals, minutes, JST day split

- `active_intervals(messages, gap=30)` (`base.py:112-132`): sort by ts; consecutive messages ≤ 30 min apart (float minutes) share a cluster; a lone message is `(t, t)`. Instants, not days.
- `active_minutes = int(sum(seconds) // 60)` (`base.py:135-137`).
- `turns` = user message count; `started_at`/`ended_at` = min/max ts.
- The JST day split is **server-side** (`server/src/split.ts`, memory `session-day-split-shipped`); the collector only sends the instants. Nothing JST-specific happens in the collector except: link dates (§4.11), the current week for `unassigned`, the review week, and the plan-judge days.

### 4.10 Tokens and cost (`harvest/tokens.py`)

- Fields order: `input, output, cache_read, cache_write_5m, cache_write_1h, reasoning`; billed = all but `reasoning`.
- `Tally.as_dict()` = `{"by_model": {...}, "subagent": {...}}`, models in **insertion order**.
- `normalize_model`: repeatedly strip a trailing `[…]` then a trailing `-\d{8}`.
- `price_for`: `:fast` models only match `<base>:fast`; others match `normalize(model)` exactly.
- `with_cost`: iterate by_model in insertion order; skip models with no billed tokens; unpriced → partial; a used field missing from the rates → partial; `cost += tokens * rate / 1_000_000` in field order; `cost_usd = round(cost, 6)` if any model priced or nothing billed, else `None`; output = tokens + `cost_usd`, `cost_partial`.

### 4.11 Link (`harvest/link.py`)

Dates are JST dates of `started_at`/`ended_at`. Window: `received_at <= start_date` and (`done_at` is None or `end_date <= done_at + 1 day`). If cwd is under any `[projects]` dir (path-prefix, host semantics — `Path.relative_to`: component-wise; on Windows case-insensitive and `/` ≡ `\`; on the Mac a `C:\…` key never matches), take the deepest (most parts; on a tie `max()` keeps the **first in `config.toml` order**, so Go must read `[projects]` keys in file order, e.g. via `toml.MetaData.Keys()`) and require exactly one `open`/`done` task of that project in the window → `auto-dir`, else `none` (never falls back to time). Otherwise exactly one `open`/`done` task in the window → `auto-time`, else `none`. No messages → `none`.

### 4.12 `--refresh-meta` (`run.py:261-304`)

Re-parse every log (default no `since`), skip excluded cwds (no trivial filter, no bookmarks, no summaries), send
`{agent, session_id, files_written, tokens(with cost), active_intervals, artifacts}` in batches of 500
(`META_BATCH`) to `/api/ingest/session-meta`; first non-landing batch returns its Outcome (earlier batches stay applied).

### 4.13 Weekly review (`review.py`)

`previous_week()` = ISO week of (JST today − weekday − 7). Flow (`:123-163`): `review(week)`; `None` → unreachable;
exists and not force → `exists`; `dashboard(mon, sun)`; drop `params` from each `hints[]` dict; if `rhythm` is a dict,
replace it with `digest_rhythm(rhythm, monday)` (below); no sessions and no minutes → `no-data`; previous week's review text (if dict); prompt (`build_prompt`, `:41-46`, `json.dumps(stats,
ensure_ascii=False, indent=1)`); `claude -p` 180 s; store `{week, text, model, stats_json: json.dumps(stats,
ensure_ascii=False), machine, force}`; True → stored; False → stored if force else exists; rejected / else
unreachable. `warn` texts at `:166-173`. The `INSTRUCTION` (`:17-29`) now ends with a paragraph on reading
`rhythm.time_of_day`; it is copied byte-for-byte like every prompt.

`digest_rhythm` (`review.py:45-82`), all of which reaches the prompt and `stats_json`:
- Output = `rhythm` without `heatmap` (other keys in their order), then `time_of_day` appended **last**.
- The heatmap is used only if it is a list of 7 lists of 24 values each passing `isinstance(x, int | float)` —
  **`bool` passes** (it is an `int` subclass; `True` counts as 1). Otherwise `heatmap` is dropped and nothing added.
- `by_hour[h]` = sum over the 7 days; `total` = sum of `by_hour`. Sums keep Python's int/float distinction (all ints →
  int; any float → float).
- `peak_hours`: hours with `by_hour > 0`, sorted by (−minutes, hour), first 3; each `{"hour": "HH:00-HH+1:00",
  "minutes": round(by_hour[h])}`.
- `share_by_period`: keys `00:00-05:00, 05:00-09:00, 09:00-12:00, 12:00-18:00, 18:00-22:00, 22:00-24:00`, value
  `round(100 * sum / total, 1)` (a float), or `0.0` (float, printed `0.0`) when `total` is 0.
- `by_day[d]`: `date` = monday + d (ISO), `weekday` = `周一…周日`, `session_minutes` = `round(sum(row))`,
  `work_ranges` = runs of consecutive hours with value > 0 as `"HH:00-HH+1:00"` strings.
- `note` = `_TOD_NOTE` verbatim.
- **Rounding**: `round(x)` and `round(x, 1)` are round-half-to-even on the exact binary value (`round(2.5) == 2`,
  `round(0.25, 1) == 0.2`); `round(x)` returns an `int`, `round(x, 1)` a `float`. Go: `math.RoundToEven` for the
  former, `strconv.FormatFloat(x, 'f', 1, 64)` + `ParseFloat` for the latter — never `math.Round`.

### 4.14 Plan judge (`plan_judge.py`)

Days = [JST today, yesterday]. `judge_input`: None → unreachable; missing → no-plan; no items → no-items;
`judged_fingerprint == fingerprint` and not force → unchanged; prompt (`:38-48`, four `indent=1` blocks with
`ensure_ascii=False`); `claude -p` 180 s; `parse_output` (`:51-77`: greedy `\[.*\]` DOTALL, rows for known ids,
any bad status → whole answer `None`, progress[:200], evidence strings[:50], note[:500]); post `{fingerprint, model,
machine, items}`; ok → stored; stale/rejected pass through; else unreachable.

### 4.15 Deliverable judge (`deliverable_judge.py`)

Up to 2 batches of 40 per harvest. `pending` None → unreachable (or partial after a batch); empty → nothing (or
stored); prompt with `F{i}` ids, path, task title, project and the excerpt (first 1200 **characters**, text-mode
read with `errors="replace"`, binary suffixes `.pdf .docx .doc .xlsx .xlsm .xls .pptx .ppt` → `""`); `claude -p`
300 s; `parse_output` (greedy array, fallback to per-object `\{[^{}]*\}` parse, bare int or digit-string ids →
`F{n}`, verdict in/out, reason[:500], dedupe by key last-wins); files the model skipped get
`{"verdict": "in", "reason": "模型未作答，按拿不准处理"}`; post; rejected → rejected; non-int → unreachable/partial;
`0` stored → stop.

### 4.16 Summarize (`harvest/summarize.py`)

User texts truncated to 500 chars each; transcript = `<transcript>`, `[user] …` lines, the **last** assistant text
truncated to 1000, `</transcript>`, the instruction. Argv: `claude -p --setting-sources "" --no-session-persistence
--model {model} --system-prompt {SYSTEM_PROMPT}`, stdin = prompt (UTF-8), cwd = a fresh temp dir, timeout 90 s.
All four `claude -p` calls use `text=True` (`subprocess.run(..., text=True, encoding="utf-8", errors="replace")`), which
translates newlines (§5.10): on Windows every `\n` written to stdin becomes `\r\n`; on every platform stdout's `\r\n`
and `\r` become `\n` before `.strip()`. Go does the same (decision: replicate, not a divergence).
Fallback (first user text [:30], `"fallback"`) on spawn error, timeout, non-zero exit, empty stdout or stdout starting
with `Not logged in`; else stdout stripped and cut to 60 chars, `"llm"`.
Pipes (plan Task 12 A3; not a divergence): after the child exits normally, `communicate` keeps reading stdout and
stderr to EOF until the overall deadline (90/180/300 s per caller), so a grandchild that inherited them delays the
result but does not fail it; Go reads its own `os.Pipe`s the same way. Only on the kill-at-the-deadline path does Go
stop waiting for the pipes after a short bound (`waitDelay`, 2 s), where Python does not wait for them at all on POSIX.
Either way that call fails. The earlier `cmd.WaitDelay` port, which also cut the normal-exit case short, was a Go-only
behaviour and is gone.

### 4.17 Windows specifics

- Python forces UTF-8 on stdout/stderr (`cli.py:16-22`). Go writes UTF-8 bytes to pipes/files and uses
  `WriteConsoleW` for a real console. Belt and braces: plan Task 10 owns `internal/cli/console_windows.go` (and a
  no-op `console_other.go`), which sets the console output code page to UTF-8 (65001). This pair is the **only**
  build-tag split in the module. Verified on Win11 in plan Task 14 C1.
- Newlines on pipes and files: Python's `sys.stdout`/`sys.stderr` are text-mode (`newline=None`), so on Windows every
  `\n` reaches a pipe or `harvest.log` as `\r\n`. Go wraps both streams in `windowsText` (`internal/cli/newline.go`,
  a pure writer tested on every OS) when they are not a console; `console_windows.go` makes that choice. The parity
  harness compares the `\r` too (plan Task 12 A8).
- Line order in a merged log: `typer.echo` flushes after every write (`typer/_click/utils.py`, `echo`), and the
  `print(..., file=sys.stderr)` lines are unbuffered, so `>> harvest.log 2>&1` (Win11) shows lines in the order they
  were produced: the count line, then the side jobs' lines. Go must keep that order: no buffered stdout writer that
  flushes only at exit. The harness compares the merged stream's order, not just each stream.
- Scheduled task: `conhost.exe --headless "%USERPROFILE%\.worklog\harvest-task.cmd"`, the `.cmd` appends stdout+stderr
  to `harvest.log`; `LastTaskResult` is always 0 (memory `harvest-fingerprint-and-silent-schedule`). The `.ps1` needs
  a UTF-8 BOM and must be run in Windows PowerShell 5.1.

## 5. Parity-critical semantics

These are the places where a straightforward Go port would silently produce different bytes or different
decisions. Each needs a dedicated test against Python-generated goldens.

### 5.1 Ordered JSON
Python dicts keep insertion order and that order reaches the wire and the prompts: server JSON dumped into prompts
(`plan_judge.py:39-48`, `review.py:41-46`), `stats_json`, `tokens.by_model` (also the **summation order** of the
cost), artifacts, state file, outbox bodies. Go needs one ordered-map type (insertion order, updating an existing key
keeps its position) and a decoder that preserves the server's key order. Never `map[string]any` on any path that is
re-serialized.

### 5.2 Wire format of records (pydantic `model_dump_json`) — what must match, and how exactly
- All fields always present, `None` → `null` (`artifacts: null` vs `[]` matters, `server/src/schemas.ts:162-170`).
- Field order: `_Base` (`id, ts, machine, schema_version`) then the subclass fields in declaration order (`models.py:7-52`).
- Aware datetime: `YYYY-MM-DDTHH:MM:SS[.ffffff]` + `Z` for UTC or `±HH:MM`; fraction printed with 6 digits only when microseconds ≠ 0. Naive datetime (`ts`): same without offset.
- Dates: `YYYY-MM-DD`.

What the server does with the bytes decides what must match. It does **not** store the request text: it stores
`JSON.stringify` of the zod-parsed value (`server/src/routes/ingest.ts:51-53` for ingest, `:95-98` for
refresh-meta). Separators, whitespace, `ensure_ascii` and float spelling are therefore normalised away by the server;
pydantic's field order is too for every `z.object` (zod emits schema order). What survives into the stored text, and
is then compared as a string (`--refresh-meta`'s "changed?" test, `ingest.ts:84-103`) or used in SQL string
comparisons (`server/src/routes/stats.ts:25` compares `started_at`/`ended_at` as text), is:
- **string values**, including every datetime string — spelled exactly (`…:03.123000Z`, not `…:03.123Z`);
- **`z.record` key order** — the model names in `tokens.by_model` / `tokens.subagent`, in insertion order (§5.1);
- **numeric values** (by value; `2` and `2.0` stringify the same in JS).

So the contract has two levels:

| Level | Applies to | Comparison |
|---|---|---|
| Byte-exact | fingerprint input (§5.3), every datetime/date string, every `claude -p` argv and stdin (prompts) | bytes |
| Ordered-value | request bodies (ingest, refresh-meta, tasks, notes, reviews, judgements, verdicts), outbox files | parsed as ordered JSON: same keys in the same order, same strings, numbers equal by value |
| State entries | `harvest_state.json` | same **key set** (entry order not compared: Python writes entries in a 4-thread completion order); within each entry the same fields in the same order, `mtime` equal as float64 (§5.4), `fp` equal or absent on both sides |

Wire separators, float `repr` on the wire, outbox-file separators and the state file's text layout are **not**
required to match byte-for-byte. Go still emits the obvious equivalents (compact wire JSON, `ensure_ascii=False`), but
no test asserts their bytes.

### 5.3 Fingerprint (`run.py:89-113`)
`blake2b(json.dumps([len(messages), first.isoformat(), last.isoformat(), sorted(files_written), tokens(no cost), task_id, link_method] + ([artifacts] if artifacts), sort_keys=True).encode(), digest_size=16).hexdigest()`.
- `json.dumps` defaults: separators `", "` / `": "`, `ensure_ascii=True` (`\uXXXX`, lowercase hex, surrogate pairs above U+FFFF), only `" \\ \n \r \t \b \f` and other `<0x20` escaped (`/`, `<`, `>`, `&`, 0x7f are not).
- `isoformat()` ≠ pydantic: `+00:00`, not `Z`; fraction 6 digits only when non-zero.
- `sorted(files_written)` = code-point order = Go byte order on valid UTF-8.
- `blake2b` with `digest_size=16` is a parameterised hash, not a truncation → `golang.org/x/crypto/blake2b.New(16, nil)`.
- A different fingerprint makes every open window re-summarize once after the switch (memory: the fingerprint is what keeps hourly harvest cheap).

### 5.4 mtime floats (`run.py:153`)
Bookmarks compare `mtime` with `==`. CPython computes `st_mtime = (double)sec + (double)nsec * 1e-9`
(`posixmodule.c fill_time`, same on Windows after FILETIME conversion). Go must compute
`float64(t.Unix()) + float64(t.Nanosecond())*1e-9` — not `float64(t.UnixNano())/1e9`, which differs in the last
bits — and write it with Python float repr so a rollback reads the same value.

### 5.5 Time parsing
`datetime.fromisoformat(s.replace("Z", "+00:00"))` (3.14): fractions of any length, truncated (not rounded) to
microseconds; offsets kept. Go must truncate to µs **at parse time** so `active_minutes`, intervals, isoformat and the
fingerprint see the same instants. A naive timestamp (no offset) makes Python crash comparing with aware ones (§6).

### 5.6 Strings
- Slices `[:30] [:60] [:200] [:500] [:1000]` and `read(1200)` count code points, not bytes.
- `str.strip()` strips Unicode whitespace including `\x1c–\x1f` and U+0085/U+3000 (wider than Go's `TrimSpace` in places).
- `str.splitlines()` (both parsers' `_records`) also splits on `\v \f \x1c \x1d \x1e \x85 U+2028 U+2029`. A JSONL record with a raw U+2028 inside a string (legal JSON, emitted by JS `JSON.stringify`) is split by Python into fragments that fail to parse and the record is **dropped**. Go must replicate (`pystr.SplitLines`), otherwise Go keeps messages Python drops and the payloads diverge.
- `_first_meta` (Codex) iterates a text file: universal newlines (`\n`, `\r`, `\r\n`).
- `excerpt()` opens in text mode: `\r\n` and `\r` become `\n` before the 1200-character cut; invalid UTF-8 → U+FFFD per Python's `replace` handler.
- `claude -p` stdout decoded with `errors="replace"`.

### 5.7 Paths
`posixpath`/`ntpath` `join`/`normpath` are host-independent in Python; Go `path/filepath` is host-dependent. Port
both flavours explicitly (`pypath.Posix`, `pypath.Windows`), with `ntpath.normpath` details (drive, UNC, `..` at root,
forward→back slashes). `casefold()` ≈ `strings.ToLower` for path keys (document the ß-style differences as accepted).
`link._is_path_prefix` uses the **host** flavour (`PosixPath` on the Mac: a `C:\…` key never matches; `WindowsPath`
on Win11: case-insensitive, both separators).

### 5.8 HTTP
httpx: no redirect following, 10 s default / 4 s interactive, breaker on transport errors only. Go:
`CheckRedirect: return http.ErrUseLastResponse`; classify every `client.Do` error as transport (opens the breaker);
per-phase transport timeouts as in §4.3 (no overall `context` deadline). Keep the `worklog-cli/` UA prefix.

### 5.9 Numbers
- `int(x or 0)` on token counts: ints pass; floats are **truncated** toward zero (`int(2.7) == 2`, no error); `True` → 1;
  numeric strings of an integer (`"12"`) pass; a non-integer string (`"1.5"`, `"x"`) raises (§6 D4).
- `round(cost, 6)` is correctly rounded on the exact binary value → `strconv.FormatFloat(x, 'f', 6, 64)` then `ParseFloat`; never `math.Round(x*1e6)/1e6`.
- `round(x)` (no digits) is round-half-to-even and returns an int (`digest_rhythm`, §4.13) → `math.RoundToEven`; `round(x, 1)` → `FormatFloat(x, 'f', 1, 64)`. Goldens include exact `.5` / `.25` ties.
- `isinstance(x, int | float)` accepts `bool` (`digest_rhythm` heatmap check); Go's decoded JSON booleans must be accepted as 1/0 there.
- Python keeps int vs float through arithmetic (int + int = int, anything + float = float, `/` always float), and that
  distinction is visible in prompts and `stats_json` (`60` vs `60.0`). The ordered JSON value type keeps it.
- `active_minutes` gap uses float minutes `(b − a).total_seconds() / 60 <= 30`.

### 5.10 Subprocess
Python `subprocess.run(["claude", …])` on Windows only finds `claude.exe` (CreateProcess appends `.exe` only); Go's
`exec.LookPath` also honours `PATHEXT` (`.cmd`). On timeout Python kills the child and does not wait for inherited
pipes on POSIX; after a normal exit it reads them to EOF until the deadline. Go reads its own pipes with the same two
bounds (§4.16), so a grandchild holding stdout cannot block it past the deadline. Temp cwd removed afterwards.

Newlines (`text=True`): with `input=` on Windows, `communicate` writes through a `TextIOWrapper` with `newline=None`,
so each `\n` of the prompt reaches `claude` as `\r\n`; on POSIX the input is encoded without translation. Stdout is
decoded with universal newlines on every platform (`\r\n` and `\r` → `\n`). Go replicates both (`runtime.GOOS ==
"windows"` decides the stdin translation, chosen at the call site, no build tag). The harness compares the bytes
`claude` actually received.

## 6. Intentional divergences

Python crashes (uncaught exception → traceback, exit 1, harvest aborted for every session) on some malformed inputs.
Go does not port crashes: it warns on stderr and skips the offending unit. Each row has a Go test. The parity harness
**excludes** these inputs before comparing (otherwise one bad log would abort the Python run and A1 would compare
nothing): a probe step runs the Python parsers file by file (`.venv/bin/python collector/parity/probe.py <snapshot>`, the venv's interpreter called directly,
each file in its own `try`) and moves every file that raises into `<snapshot>/excluded/` with the exception text in
`excluded.json`. Both CLIs then run on the reduced snapshot, and a separate Go-only check runs on the excluded files
and asserts one warning per file and no other effect. The excluded count is reported in the A1/A2 evidence; any
exclusion not explained by a D-row is a failure.

| # | Input | Python | Go |
|---|---|---|---|
| D1 | A log that is not valid UTF-8 (`read_text` strict, `claude_code.py:193`, `codex.py:195`), or that cannot be read or stat'd: a directory named `*.jsonl`, a dangling symlink, a file that vanishes between the listing (or the read) and the `stat` (an mtime race). This includes a Claude subagent transcript and, for Codex, a fork whose `stat` fails when its rollout's mtime is taken (`codex.py:344`; Go skips that fork and keeps the rollout) | `UnicodeDecodeError` / `OSError`, harvest aborts | warn `worklog: skipped unreadable log {path} ({err})`, skip that file |
| D2 | Codex `_first_meta` on invalid UTF-8 (`codex.py:211-221`, only `OSError` caught) | aborts | `_first_meta` decodes in TextIOWrapper's 8192-byte chunks, as Python does: exactly when a bad byte lies in a chunk read before the meta line (where Python raises), warn with the D1 text (the chunk decoder's position) and skip the file, before the `since` filter, as Python raises before it. A bad byte further on is met later: D1 when the rollout (or a fork, when its parent is read) is parsed |
| D3 | Within one session, timestamps **with** and **without** an offset mixed | `TypeError` comparing naive with aware in min/max/sort | treat the naive ones as UTC. (All-naive sessions work in Python and are ported as-is: naive stays naive, `isoformat` without offset.) |
| D4 | Token counts that `int()` rejects (`"x"`, `"1.5"`, a list), or an integer beyond int64 (a JSON literal, kept as `pyjson.BigInt`, or a float or string of one), which Python counts. The same holds for a `schema_version` beyond int64 in a server row, which pydantic accepts and Go refuses (the row fails validation). `int()` on a string also takes the Unicode Nd digits of CPython 3.14's Unicode 16 tables; Go's `unicode` tables are Unicode 17, whose new Nd block U+11DE0–U+11DE9 Go accepts and Python rejects | `ValueError`/`TypeError`, aborts (beyond int64: counted) | count 0, warn once per file (`token count {value} is not an integer; counted as 0`; accepted forms are ported exactly, §5.9) |
| D5 | Malformed `config.toml` | traceback | one line `worklog: cannot read {path}: {err}`, exit 1 |
| D6 | `--date` / `--week` / `--received` spelled in rarer ISO forms (`2026-W40-1`, `2026-283`) | accepted by `fromisoformat` / `fromisocalendar` | accept `YYYY-MM-DD` and `YYYYMMDD` only; `--date`/`--week` otherwise exit 2 (as Python does for its own rejects); `--received` see D13 |
| D7 | `claude.cmd` only on Windows PATH | `FileNotFoundError` → fallback | found via PATHEXT |
| D8 | Help / usage text | Typer/click format | Go's own text; command names and exit codes identical |
| D9 | Writing `harvest_state.json` | non-atomic `write_text` | temp file + rename (same content); on Windows a rename refused while another process briefly holds the file (Access denied / sharing or lock violation, e.g. Defender's scan) is retried for up to 2 s (Task 14 A2). `SaveState` also normalises hand-edited entries: a non-numeric `mtime` is written as `null`, keys other than `mtime`/`fp` (and a non-string `fp`) are dropped, and the file is written with mode 0644 (Python keeps such values verbatim and the file's existing mode); the skip decisions are the same (followups.md, Task 9) |
| D10 | Legacy `data/.harvest_state.json` move | supported | dropped (Q4) |
| D11 | A timestamp string `fromisoformat` rejects (`"yesterday"`, `"2026-13-01T…"`) in a message or an Artifact result | `ValueError`, aborts | drop that record (message / artifact), warn once per file |
| D12 | A `timestamp` that is truthy but not a string (number, object) | `AttributeError` on `.replace`, aborts | drop that record, warn once per file |
| D13 | `wl new --received` not a valid date | traceback **after** config/client setup, exit 1 | same order (config errors still win), one line `error: --received must look like 2026-10-02`, **exit 1** (exit code kept) |
| D14 | An outbox file whose JSON is valid but not an object (an array, a string) | `TypeError` escapes `flush`, harvest aborts | treated like a corrupt file: moved to `rejected/`, flush continues |
| D15 | A timestamp whose UTC offset has a fraction of a second (`+09:00:30.5`); real Claude/Codex logs never emit one | accepted (`timezone` with microseconds) | `pytime.FromISO` returns an error (a Go zone offset is whole seconds); the caller drops that record and warns once per file, as for D11 |
| D16 | Proxy settings of the operating system (macOS SystemConfiguration, the Windows registry / Internet Options), which `urllib.request.getproxies()` reads when no `*_proxy` variable is set | httpx uses them | not read; only the environment variables are (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, lower case first, with httpx's matching). Win11 checks for an OS proxy in Task 14 C5 |
| D17 | A log record whose shape the parser cannot handle (Task 6 sites, Claude): a `message` that is truthy but not an object; a `text` block whose `text` is present but not a string; a `tool_use` `name` that is a list/object; a file tool's `input` that is truthy but not an object; an Artifact `tool_use` `id` or a `tool_result` `tool_use_id` that is a list/object; a `message.id` that is truthy and a list/object; `usage.iterations` that is a truthy number or `true`; an iteration `model` that is truthy but not a string; a `sessionId` / `cwd` that is truthy but not a string (while none is set yet). Real logs never carry one | `AttributeError`/`TypeError`, aborts; or (iteration model, sessionId, cwd) keeps the value and harvest fails later | ignore that part (the block, the field, the iterations; an unhashable `message.id` is not ignored: its request is counted, without dedup; a non-string sessionId/cwd is skipped and a later string is taken), warn `worklog: {path}: ignored a part of a record the parser cannot read ({reason})` once per file. Codex sites (Task 7, each run through `.venv` Python): a `payload` that is truthy but not an object on a `session_meta`, `response_item`, `turn_context` or `event_msg` record (read as `{}`; other record types never call `.get` on it), the first meta's included; a `response_item` `payload.type` that is a list/object (no patch paths); a text block whose `text` is present but not a string (the block); a `turn_context` `model` that is truthy but not a string (the previous model is kept; Python keeps it, and a list raises at the next request while an int fails in harvest; the warning goes out with the next counted request); a `session_meta` `session_id` / `cwd` that is truthy but not a string (skipped: the previous value stays; Python keeps it); in `iter_sessions`, a fork whose `session_id` is a list/object (the fork is dropped), a fork whose `id` is a list/object (keyed by its path), and a rollout whose `session_id or id` is a list/object (no forks attached) |
| D18 | `config.toml` / `credentials.toml` / `local.toml` parsing beyond tomllib, and `[pricing]` / `[harvest]` value coercion | tomllib (TOML 1.0) rejects a UTF-8 BOM, a newline inside an inline table and the `\e` escape: a BOM'd `credentials.toml` is warned about and ignored (no token), a BOM'd or TOML-1.1 `config.toml` is a traceback, exit 1. `[pricing]` rates are coerced laxly (`"15"`, `true` → 15.0, 1.0) and `min_active_minutes` goes through `int()` (Unicode digits accepted). A `nan`/`inf` rate is accepted and later puts a NaN/inf cost into a request body | BurntSushi TOML 1.1 loads all three forms. A `[pricing]` rate must be a TOML number (integer or float) and finite, and a `min_active_minutes` string must hold ASCII digits (a TOML integer, float or boolean goes through `int()` as in Python): otherwise one line `invalid config.toml: …`, exit 1, as for the other config errors (plan Task 12 A7: never a NaN in a body). The text after `worklog: cannot read {path}: ` for a malformed file (D5) is BurntSushi's message, not tomllib's; only the prefix, the one line and the exit code are ported |
| D19 | A log whose combined mtime equals its key's bookmark | parsed, then skipped; its D1, D3, D11, D17 and mixed-offset warnings print on **every** run (`evidence/step_13_perf.md`) | skipped before the parse, with the same `skipped` count. Those warnings print only when the log is parsed: its first run, when it changes, and the daily rescan. Codex `firstMeta`, and so D2, still runs every run. |
| D20 | A log with no session ID, or an excluded cwd, unchanged since the last run | parsed every run | skipped before the parse until its mtime moves |
| D21 | A session whose fingerprint moved but whose summarizer input did not | re-summarized | re-sent with the cached summary (R2) |
| D22 | A session whose summarizer input moved | re-summarized every run | re-summarized after ≥60 min since its last summary, or ≥30 min since its last message; otherwise re-sent with the cached summary (R3/R4). A failed refresh keeps the cached `llm` summary (R3f). |
| D23 | A fallback summary whose log never moves again, including one from before tiering | never retried | retried on the backoff (R5, R7) |
| D24 | Weekly review, plan judge, deliverable judge | every harvest | per bucket (§5.3); yesterday's judge once per 05:00 day |
| D25 | Two harvests at once | Python: both run, state is last-write-wins (Go full mode: the lock, as in the Go column) | the second one exits on the lock: 0 when tiered, 2 when manual (§5.9) |
| D26 | The `, unassigned=N` tail of the stdout line | on every run where the GET succeeds | only on runs where `Due.Hour` |
| D27 | Extra output, and what `fallback=` counts | `fallback=` counts sends whose source is fallback | the `tiers:` stderr line and `<Home>/tiers.jsonl` (§5.7). `fallback=` counts summary attempts that fell back (R1, R3f, R5), not R6 re-sends. |

D19–D27 are copied verbatim from the tiered-harvest design, `docs/design/2026-10-20-tiered-harvest-design.md` §6, which is their source of truth; the section numbers in those rows (§5.3, §5.7, §5.9) are that design's. In those rows the Python column also stands for Go full mode, and the Go column for `wl harvest --tiered`. All of them apply to `--tiered` only, except D25, which applies to both modes. `--tiered`, `collector_state.json`, `tiers.jsonl` and `harvest.lock` are Go-only. Their tests are listed in `collector/TESTMAP.md` under "Spec §6 divergent rows".

## 7. Go module layout

```
collector/                       # own go.mod, like server/ and web/ have their own package.json
  go.mod                         # module github.com/hakupao/worklog/collector
  cmd/wl/main.go                 # os.Exit(cli.Main(os.Args[1:], rt.Default())); version via -ldflags
  internal/
    rt/          Env: Stdout/Stderr, clock, Getenv, Home, GOOS, Exe, Cwd — the single injection point; Warnf, NowLocal
    py/          compat helpers: pyjson (ordered value, Int/Float, Dumps with Default/Unicode/Indented/Sorted, Compact,
                 Equal), pytime (Instant, Date, fromisoformat, isoformat, pydantic format, mtime float, Python rounding),
                 pystr (SplitLines, Strip, Head, universal newlines, replace-decoding), pypath (Posix + Windows flavours:
                 join/normpath/parts, Path ordering, relative_to; Quote)
    config/      Load(): root discovery (env → cwd ancestors → exe-dir ancestors), config/credentials/local TOML
    tokens/      Tally (ordered), NormalizeModel, PriceFor, WithCost
    model/       Task, Session, Note (+ Artifact, Interval) with MarshalJSON matching pydantic; Task validation
    session/     RawSession, Message, Turns/StartedAt/EndedAt, ActiveIntervals/ActiveMinutes, CleanPaths, ToInt —
                 shared by the parsers, summarize and harvest (avoids a harvest ↔ parser import cycle)
    link/        Decide (auto-dir / auto-time) over link.Candidate
    claudecode/  parser, responses de-dup, artifacts, subagent logs
    codex/       parser, patches + JS literal decoder, forks, archive
    api/         Client, Outcome (ok/retry/rejected/lost/stale), IngestResult, Lookup, breaker, outbox, per-phase
                 timeouts, UA; store.go = api_store.py (Store, ErrUnavailable, ThisWeek)
    llm/         Runner interface; Claude runner (argv, stdin translation, temp cwd, timeout, pipe bounds); Generate
    summarize/   prompt + fallback
    review/      weekly review incl. DigestRhythm
    planjudge/   plan judge
    deliverable/ deliverable judge + excerpt
    harvest/     Run(), RefreshMeta(), state file, fingerprint
    cli/         commands, arg parser, exit codes, output lines; console_windows.go / console_other.go
    testkit/     test-only: golden loading, CopyCorpus (applies testdata/mtimes.json)
  testdata/
    golden/      generated by testdata/gen_golden.py from the Python implementation (committed)
    logs/        synthetic logs extracted from the Python tests (committed); logs/divergent/ = §6 inputs
    fixtures/    copies of tests/fixtures/ (tests/ is deleted at retirement)
    mtimes.json  relative path → [sec, nsec] for every corpus file (git does not keep mtimes)
  parity/        harness: stub server, fake claude, differ with its own minimal ordered-JSON decoder (independent of
                 internal/py), probe.py (§6 exclusion); archive/ after retirement
bin/                             # repo root, gitignored: wl, wl.exe — where the binary lives on each machine
```

**Host-dependent behaviour without build tags.** Everything Python does differently on Windows (`WindowsPath`
ordering and `relative_to`, CreateProcess lookup, stdin newline translation, console handling) is written as a **pure
function taking the flavour as a parameter** (`pypath.Windows` vs `pypath.Posix`, `llm.TranslateStdin(b, windows bool)`),
and the call site picks it with `rt.Env.GOOS`. No `_windows.go` / `_other.go` split for logic (the console pair in
`internal/cli` is the single exception, §4.17), so the Windows
behaviour is unit-tested on the Mac too, and again natively on `windows-latest` in CI (§9).

`bin/` at the repo root (not under `collector/`) so exe-dir-ancestor lookup finds the repo's `config.toml` exactly as
`uv run --project` did, with no `WORKLOG_ROOT` needed for the skill.

## 8. Dependencies

| Dependency | Why not stdlib |
|---|---|
| `github.com/BurntSushi/toml` | No TOML in stdlib. TOML 1.0 (quoted CJK keys, `[pricing."claude-opus-5-5:fast"]`, single-quoted literal Windows paths), pure Go, no transitive deps, decodes into `map[string]any` so unknown keys are tolerated like `raw.get` (this config decoding layer is the one place `map[string]any` is allowed; nothing decoded that way may reach a serialization path); `MetaData.Keys()` gives keys in file order, which the `[projects]` tie-break needs (§4.11). `pelletier/go-toml/v2` is the equivalent fallback. |
| `golang.org/x/crypto/blake2b` | `crypto` has no BLAKE2b with a digest-size parameter; needed for fingerprint compatibility (§5.3). |

Deliberately not used: cobra/urfave (8 commands, a ~150-line parser covers click's "options anywhere" rule; stdlib
`flag` stops at the first positional, so it cannot parse `wl new 田中 帳票修正 --project order`), an HTTP client
library, `time/tzdata` (JST is `time.FixedZone("JST", 9*3600)`; Japan has no DST, and this drops the Windows `tzdata`
dependency Python needs). Toolchain: current stable Go (≥ 1.25), pinned by `go` + `toolchain` lines in `go.mod`;
`CGO_ENABLED=0` builds.

## 9. Testing and parity strategy

Four layers, each catching what the previous cannot. Comparison levels follow §5.2: byte-exact for fingerprint
inputs, datetime strings and `claude` argv/stdin; ordered-value equality for everything else.

1. **Ported unit tests.** Every one of the 276 Python tests (`tests/*.py` at `01ecf82`, inventory in the plan) maps to
   a Go test with the same name in snake→Camel form, or is marked `N/A: Typer-specific` / `N/A: replaced by golden X`.
   The map is a committed table (`collector/TESTMAP.md`); a reviewer checks it is complete.
2. **Goldens from Python.** `collector/testdata/gen_golden.py` (run with the venv's Python, no network) imports the
   Python package and writes JSON goldens for: pyjson dumps samples (ASCII/CJK/astral/control chars/floats),
   isoformat/pydantic datetime samples, `clean_paths` and path-ordering/`relative_to` cases for both flavours,
   `active_intervals`/`active_minutes` incl. the 30-minute boundary, `with_cost` tables, link decisions (incl. the
   same-depth tie), `digest_rhythm` (ints, floats, bools, all-zero, malformed grids, `.5` ties, peak ties), both
   parsers on every file in `tests/fixtures/` and `collector/testdata/logs/` (RawSession minus `path`, with `mtime` set
   by `os.utime` to a fixed value), Session bodies, fingerprints, all four prompt builders and both judge-output
   parsers, and per-stream CLI transcripts. Go tests compare at the §5.2 level for each golden. CI re-runs the
   generator and fails on drift while both implementations exist (Q8).
3. **Parity harness on real logs** (`collector/parity`). A stub HTTP server answers the GETs from fixtures (task list,
   timeline, `review` = exists or missing, judge-input = missing or a fixture day, pending deliverables = fixture list)
   and records every request (method, path with query, body); a fake `claude` installed as `claude` / `claude.exe`
   first on `PATH` records argv + raw stdin bytes and answers a deterministic function of the prompt (summaries: a
   hash-derived string; judges: a fixed valid JSON). The §6 probe removes crash inputs first. Both CLIs run against
   the same snapshot, **each scenario on its own copy** (`cp -Rp` of `~/.claude/projects`, `~/.codex/sessions`, `~/.codex/archived_sessions`, mtimes
   preserved), each with its own `WORKLOG_ROOT` (temp `config.toml` pointing at the stub) and `WORKLOG_HOME`, `--since
   36500`. The Python side is the venv's `wl` executable called directly (`.venv/bin/wl`, `.venv\Scripts\wl.exe`) —
   never plain `uv run`, which may sync over the network. **No network on either side.** The differ compares:
   - every write as an ordered JSON value, keyed by `(path, session_id)`; masks: `ts`, note ids, `done_at` /
     `received_at` defaulting to today, temp-home paths inside stderr;
   - datetime strings inside the bodies byte-exact (they are not masked);
   - `claude` argv and stdin byte-exact;
   - `harvest_state.json` as state entries (§5.2): same key set; within each entry `mtime` equal as float64, `fp`
     equal or absent on both sides;
   - stdout per stream and the merged `2>&1` order (§4.17); stderr lines as a multiset per stream.
   Order across sessions is never compared (four summarizer threads finish in any order); per session id, repeated
   requests and parked files must keep their relative order. Every normalisation is listed in
   `collector/parity/README.md` with why it cannot hide a defect, and A3 reviews that list item by item.
4. **Hand-off tests** (the cutover in miniature):
   - *Same mtimes*: Python harvest on the snapshot → state S → Go harvest with S on the same snapshot: every session is
     skipped by the mtime equality (`run.py:153`), so this proves the state file and mtime floats are compatible, and
     nothing about fingerprints.
   - *Touched*: on a fresh copy of the snapshot, set every file's mtime to a new value (`touch`) and run Go with S.
     Every session now passes the mtime check, so non-trivial ones reach the fingerprint (trivial and excluded ones
     are skipped earlier, as in Python). Criterion: `new=0 updated=0 parked=0` and zero fake-claude calls. This is the
     test that proves fingerprint compatibility. Both scenarios run in both directions (Python→Go
     and Go→Python).
   - *Live state*: with a copy of the machine's real `~/.worklog/harvest_state.json`, logs that changed since the last
     real harvest — and sessions whose last summary fell back (bookmarked without `fp`) — are legitimate candidates for
     both implementations. Criterion: identical candidate set, identical bodies and identical resulting bookmarks, not
     zero calls.
   - *Outbox cross-replay*: files parked by Python (stub answers 503) are flushed by Go and arrive as equal ordered
     values, oldest first per session id; and the reverse. `rejected/` untouched by both.

CI (`ci.yml` triggers on pushes to `main` and on pull requests; no branch trigger is added):
- `go` job on `ubuntu-latest` **and `windows-latest`** (`go vet ./...`, `go test ./...`), plus `windows/amd64` and
  `darwin/arm64` build checks on ubuntu.
- `golden` job: `setup-uv` with CPython **3.14.4** and `uv sync --locked` (the lock's pydantic/httpx/typer), runs the
  generator, `git diff --exit-code collector/testdata`. Separate from the existing python job, which stays on 3.11.
- `parity-selftest` job: `setup-go` + the same uv setup; builds `bin/wl` and runs the harness on the corpus.
- The branch first runs CI when the plan's Task 14 opens a draft PR `go-collector → main` (after asking the user);
  before that, "green" means the local `make -C collector test vet` plus a `GOOS=windows` vet.

## 10. Migration and cutover

Principle: **per-machine** cutover. "Side by side" means the Mac runs Go while Win11 still runs Python (both writing to
production through the same contract), never two collectors on one machine sharing `~/.worklog/`.

Binary placement: `<repo>/bin/wl` (Mac) and `<repo>\bin\wl.exe` (Win11), gitignored. Config, credentials, local.toml,
state and outbox paths are unchanged. `wl` finds `config.toml` from its own directory, so the launchd job, the
scheduled task and the `/wl` skill need no `WORKLOG_ROOT` change (launchd keeps setting it anyway).

**Transition-safe installers.** Changes merged to `main` at the Mac cutover must not break Win11 if the user re-runs
an installer there before Win11's own cutover. So during the migration the installers choose by what exists:
- `scripts/install-skill.sh` / `.ps1` render a new `__WL__` placeholder in `skills/wl/SKILL.template.md` as
  `"<root>/bin/wl"` (Windows: `"<root>/bin/wl.exe"`, explicit `.exe`; Win11's Claude Code runs commands in Git Bash (Q10), where MSYS would also resolve the suffix-less `<root>/bin/wl` to `wl.exe` — the explicit form avoids relying on it)
  when that file exists, else as today's `PYTHONIOENCODING=utf-8 uv run --project "<root>" wl`; they print which.
- `scripts/schtasks-harvest.ps1` writes `"<repo>\bin\wl.exe" harvest` into the `.cmd` when `bin\wl.exe` exists, else
  today's `uv run` line, and prints which.
- The `uv` branches are removed with Python (Task 17).

Mac (`<repo>` = the main checkout `/Users/dev/Project/worklog`, never the worktree)
1. Parity A1 and hand-off tests on Mac data (hard checkpoint), run from the branch worktree.
2. User OK → merge `go-collector` into `main` and push (Win11 stays on Python; its installers still render `uv`).
3. In `<repo>`: `git pull`, `make -C collector build` → `<repo>/bin/wl`; then publish the final release
   `wl-v<version>` from `main` (`scripts/release-wl.sh`).
4. `launchctl unload`; point `~/Library/LaunchAgents/com.worklog.harvest.plist` `ProgramArguments` at `[<repo>/bin/wl, harvest]` (keep PATH, WORKLOG_ROOT, WorkingDirectory, log paths; `scripts/com.worklog.harvest.plist` carries the same change); `launchctl load`; `launchctl kickstart gui/$(id -u)/com.worklog.harvest`; read `/tmp/worklog-harvest.log` and `.err.log`.
5. Re-run `<repo>/scripts/install-skill.sh` (renders `bin/wl` since it exists).
6. Soak 7 days (Q5) with the A4 distribution check (read-only SELECT script run with `wrangler` from `<repo>/server`
   after `wrangler login`). Rollback = restore the plist line, rename `bin/wl`, re-run the skill installer; state and
   outbox are compatible both ways.

Win11 (user-executed steps, each with expected output in a checklist like `win11-onboarding.md`)
1. Preconditions: `<repo>\data\` does not exist, `%USERPROFILE%\.worklog\harvest_state.json` does (Q4), and `<repo>`'s
   `src/worklog` equals `01ecf82` (it is the Python reference for A2).
2. Parity work without touching `<repo>`'s `main` (Win11 once needed `reset --hard`; its main checkout is left alone):
   `git -C <repo> fetch origin go-collector` and `git -C <repo> worktree add <branch-dir> go-collector`.
3. `gh auth login` once; `<branch-dir>\scripts\update-wl.ps1 -Tag wl-v<version>-rc1` (Q2; `-Tag` is required). The
   script downloads to `bin\wl.exe.new`, verifies the SHA-256, renames a present `wl.exe` to `wl.exe.old` (Windows
   allows renaming a running exe, so a harvest in progress — up to the 50-minute task limit — does not block the
   update), moves the new file into place, and deletes `wl.exe.old` best-effort; each file operation is retried up to
   10 times, 30 s apart, before failing loudly. `Unblock-File` on the result.
4. Measure with `scripts\measure-wl.ps1`: `bin\wl.exe ls`, `<repo>\.venv\Scripts\wl.exe ls`, `uv run wl ls` (wall time
   and peak working set; read-only `ls` calls), next to the Mac baseline.
5. Parity A2 on a Win11 snapshot (harness and fake claude cross-built on the Mac and attached to the rc release; the
   Python side is `<repo>`'s venv).
6. Cutover after the Mac's: `git -C <repo> pull`, remove `<branch-dir>`, `<repo>\scripts\update-wl.ps1 -Tag
   wl-v<version>` (the final tag, explicitly), re-run `schtasks-harvest.ps1` (picks `bin\wl.exe`; conhost headless
   kept, Q3) and `install-skill.ps1`; the Git Bash checks of Q10.
7. Soak 7 days; troubleshooting still reads the last line of `harvest.log`.

Retiring Python (after both soaks and the retrospective, Q6, one separate commit): delete `src/worklog`, `tests/`,
`pyproject.toml`, `uv.lock`, and the python, `golden` and `parity-selftest` CI jobs; remove the installers' `uv`
branches. **Archive, not delete**, the Python-dependent tooling — `collector/testdata/gen_golden.py`,
`collector/parity/probe.py` and the harness's Python-reference scenarios — into `collector/parity/archive/` with a
README saying it needs a checkout at `01ecf82`. Goldens, corpus and fixtures stay as Go test data. Update README,
CONTRIBUTING, `docs/guide/usage.md` (`uv run wl` → `bin/wl`), `skills/wl/`, and the Win11 onboarding checklist
(historical plans and specs are left as they are).

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Fingerprint differs | after the switch, every session whose log moves (every open window, hourly) is re-summarized once; LLM cost spike, summaries churn | §5.3 goldens + the *touched* hand-off test (zero claude calls) as a hard gate. The same-mtime hand-off cannot detect it. |
| mtime float differs | every session is re-evaluated on the first Go run; with a matching fingerprint that costs only parsing, with a mismatching one see above | §5.4 golden + the *same-mtime* hand-off test |
| Datetime string or model-order drift | `--refresh-meta` rewrites rows and reports them `updated`; `routes/stats.ts:25` text comparisons shift at boundaries | byte-exact datetime comparison and ordered-value comparison in the harness |
| Prompt drift (key order, int/float, escaping, Windows CRLF) | judge/summary quality shifts silently | argv/stdin byte-compared in the harness, A2 on Windows |
| Task validation looser/stricter than pydantic | harvest exits 2 on a row Python accepts, or links against a bad row | golden rows incl. extra keys, bad status, datetime-in-date-field; port `list_tasks` tests |
| Redirect following / UA default / whole-request timeout | Access login answered as success; CF 1010; slow-but-alive responses cut off | §5.8 and §4.3 tests with an httptest server returning 302, HTML 200, and a slow streaming body |
| Windows path semantics (`ntpath`, case-folded ordering, `relative_to`, link prefix) | wrong noise filtering, duplicate choice or links on Win11 only | pure-function pypath with goldens for both flavours, `windows-latest` CI, A2 on Win11 data |
| Defender/SmartScreen flags an unsigned Go exe | scheduled harvest silently stops | download via `gh` (no Mark-of-the-Web), `Unblock-File`, A4 notices a stopped machine within a day (the dashboard already warns after 3 days) |
| Update while a harvest runs | `wl.exe` locked, update fails | rename-aside + retries in `update-wl.ps1` |
| `claude` child hangs after timeout | harvest blocks until the 50-min task limit | pipes read only until the deadline, then `waitDelay` after the kill; tests with a fake claude that forks a sleeper |
| Installer re-run on Win11 between the two cutovers | skill or task points at a missing `bin\wl.exe` | transition-safe installers (§10) |
| Two harvests at once (manual + scheduled) | duplicate summaries, state last-write-wins | pre-existing in Python; unchanged; note in docs |
| Both implementations drift during the migration window | parity no longer meaningful | freeze (Q8); CI golden-drift check |
| Weak Win11 still slow | motivation not met | Win11 measurement step; if `claude -p` dominates, that is expected (U3) |

## 12. Open questions

Q1–Q10 are decided; nothing is open.

| # | Question | Decision (2026-10-13) |
|---|---|---|
| Q10 | On Win11, does Claude Code's Bash tool run Git Bash or PowerShell? | **Git Bash.** Precondition this design relies on: MSYS bash resolves a path without suffix to the `.exe`, so `<repo>/bin/wl` runs `wl.exe`. The installer still renders the explicit `"<root>/bin/wl.exe"`, so the skill does not depend on that resolution. The Win11 cutover checklist runs both forms in Git Bash (plan Task 16). |

## 13. Size

- Python reference at `01ecf82`: ~2,860 lines of source (`src/worklog`), ~3,970 lines of tests (276 tests).
- Go estimate: ~5,200–6,200 lines of source (incl. ~900 for the `py/` compat layer), ~5,200 lines of tests,
  ~700 lines for the parity harness, probe and golden generator.
- 18 plan tasks (Tier 3). Coding ≈ 3–4 working days with parallel subagents; elapsed ≈ 3 weeks, dominated by two
  7-day soaks and the Win11 user steps.
