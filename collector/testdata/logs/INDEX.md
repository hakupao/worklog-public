# Log corpus

Python-side test data for the Go port (plan Task 1). Every file here is input; the goldens in `../golden/` were
written from it by `../gen_golden.py`, which ran the former Python collector. Bytes are exact (`../.gitattributes`
turns off line-ending conversion: some logs carry CRLF, lone CR, raw U+2028 or invalid UTF-8 on purpose).

> `gen_golden.py`, the tools in `../tools/` and the Python collector itself were removed on 2026-10-22 (see git
> history), so the corpus, `../excerpts/`, `../mtimes.json` and the goldens are now frozen data. Adding a corpus file
> means writing its `mtimes.json` entry (and any excerpt) by hand, or restoring the tools from history.

## Conventions

- **Units.** Each `logs/<group>/<case>/` directory is one self-contained tree: one Python test, one spec §5 case or
  one §6 row. Goldens that run a parser or harvest per tree (`parsers.json` → `iter`, `sessions.json`,
  `state_after_python.json`, `fingerprint.json` → `harvest`) key by that path. Roots: claude-code = the unit;
  codex = `<unit>/sessions` when it exists (so a sibling `archived_sessions/` is found), else the unit.
- **mtimes.** `../mtimes.json` maps every `*.jsonl` under `logs/` and `../fixtures/`, keyed by its path relative to
  `collector/testdata/` (`logs/...`, `fixtures/...`), to `[sec, nsec]`. `gen_golden.py` copied the corpus to a temp
  dir and applied each entry with `os.utime(ns=sec*1e9+nsec)`; `testkit.CopyCorpus` must do the same (git keeps no
  mtimes). Values: the literal `os.utime` value when a Python test set one (`1_000_000_000`, `1_000_300_000`,
  `2_000_000_000`, nsec 0), otherwise a synthetic stamp (2026-09-25T00:00:00Z + i×3517 s, varied nsec, i = index in
  key order). The Windows-paths session and its subagent share a second and differ only in nsec. Every nsec is a multiple of 100 (NTFS keeps mtimes at 100 ns; an off-grid stamp would read back as another float on Windows); the literal stamps were already on the grid, and existing entries are kept when a corpus file is added. `gen_golden.py`
  failed when a corpus file has no entry or an entry has no file.
- **HOME.** The logs and goldens assume `HOME=/home/wl` (`gen_golden.py` set it before importing `worklog`):
  `test_parsers/test_claude_files_written_from_file_tools/s.jsonl` writes into `/home/wl/.claude/...` and
  `/home/wl/.codex/...`, which `clean_paths` drops as noise.
- **`@initial`.** A Python test that appends to a log after its first harvest (`open("a")`) is captured twice:
  `<test>/` is the tree at the end of the test, `<test>@initial/` holds the files as first written (only the ones
  that changed). Times the test moved with `_touch_later` (now + 1 h) or `time.time()` are not reproduced; the
  synthetic mtimes stand in.

## How the test logs were extracted

The 80 `logs/test_*/` units (69 tests, 11 of them also as `@initial`) were captured, not retyped: `pytest` ran `tests/` at `01ecf82` with `HOME=/home/wl`
and a plugin that, after each test, copied every `*.jsonl` under its `tmp_path` (relative paths kept) and the first
written version of any file that changed later. The plugin and the builders were in `../tools/` (removed; see git
history; each file's docstring had its command line):
- `capture_logs.py` — the pytest plugin that captured `logs/test_*/`;
- `make_synthetic.py` — writes `logs/spec5/` and `logs/divergent/`;
- `make_excerpts_and_mtimes.py` — writes `../excerpts/` and `../mtimes.json`.
Re-running all three over this tree reproduced it byte for byte.

`grep -n "write_text\|\.jsonl" tests/*.py` also hits these files, which write no log: `test_api_client.py` (outbox
files), `test_cli.py` and `test_config_api.py` and `test_cli_api.py:84-113,201-207` (config / credentials / local
TOML), `test_deliverable_judge.py:34,43` (excerpt inputs; `../excerpts/` covers excerpts), `test_link.py:18` (a
`Path("dummy.jsonl")` that is never read). `test_cli_api.py`'s other harvest tests and `test_harvest_fallback.py:60`
run on empty roots.

## Logs built by the Python tests

### `tests/test_cli_api.py`

| Test | Files (under `logs/test_cli_api/<test>/`) |
|---|---|
| `test_cli_api.py:191` `test_harvest_reports_refused_sessions_and_leaves_them_unbookmarked` | `claude/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |

### `tests/test_codex_archive.py`

| Test | Files (under `logs/test_codex_archive/<test>/`) |
|---|---|
| `test_codex_archive.py:14` `test_archived_rollout_is_harvested` | `archived_sessions/rollout-a.jsonl` |
| `test_codex_archive.py:23` `test_rollout_in_both_places_is_yielded_once` | `archived_sessions/rollout-a.jsonl`<br>`sessions/2026/09/15/rollout-a.jsonl` |

### `tests/test_codex_fork.py`

| Test | Files (under `logs/test_codex_fork/<test>/`) |
|---|---|
| `test_codex_fork.py:29` `test_fork_flag_in_a_later_meta_does_not_skip` | `r.jsonl` |
| `test_codex_fork.py:17` `test_iter_sessions_yields_only_the_parent` | `2026/09/11/rollout-fork.jsonl`<br>`2026/09/11/rollout-parent.jsonl` |

### `tests/test_harvest_fallback.py`

| Test | Files (under `logs/test_harvest_fallback/<test>/`) |
|---|---|
| `test_harvest_fallback.py:51` `test_result_counts_fallback_summaries` | `claude/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex/2026/09/18/rollout-x.jsonl` |

### `tests/test_harvest_run.py`

| Test | Files (under `logs/test_harvest_run/<test>/`) |
|---|---|
| `test_harvest_run.py:213` `test_a_case_created_after_the_first_harvest_gets_the_idle_session_re_sent` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:213` `test_a_case_created_after_the_first_harvest_gets_the_idle_session_re_sent@initial` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_harvest_run.py:239` `test_a_fallback_summary_is_retried_when_the_log_next_moves` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:239` `test_a_fallback_summary_is_retried_when_the_log_next_moves@initial` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_harvest_run.py:366` `test_a_parked_session_is_still_bookmarked` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:263` `test_a_pre_fingerprint_bookmark_is_honored_and_upgraded` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:263` `test_a_pre_fingerprint_bookmark_is_honored_and_upgraded@initial` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_harvest_run.py:635` `test_a_publish_alone_re_sends_the_session_with_its_artifacts` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:635` `test_a_publish_alone_re_sends_the_session_with_its_artifacts@initial` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_harvest_run.py:333` `test_a_refused_session_is_counted_and_never_bookmarked` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:354` `test_a_session_that_could_not_be_parked_is_counted_and_never_bookmarked` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:164` `test_a_session_that_gained_a_real_turn_is_summarized_again` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:164` `test_a_session_that_gained_a_real_turn_is_summarized_again@initial` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_harvest_run.py:190` `test_a_subagent_that_finished_later_is_enough_to_summarize_again` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/agent-a1.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:141` `test_an_idle_session_whose_log_only_grew_metadata_is_not_summarized_again` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:141` `test_an_idle_session_whose_log_only_grew_metadata_is_not_summarized_again@initial` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_harvest_run.py:307` `test_harvest_counts_new_and_updated_from_the_store_result` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:321` `test_harvest_counts_parked_appends` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:378` `test_harvest_does_not_read_sessions_from_the_store` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:80` `test_harvest_end_to_end_creates_sessions` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:100` `test_harvest_is_idempotent_on_second_run` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:434` `test_harvest_keeps_the_new_state_file_when_an_old_one_still_exists` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:412` `test_harvest_moves_the_state_file_out_of_the_repo_once` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:388` `test_harvest_raises_without_parsing_logs_when_the_api_is_unreachable` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:513` `test_harvest_sends_active_intervals` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:501` `test_harvest_sends_files_written` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:501` `test_harvest_sends_files_written@initial` | `codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:596` `test_harvest_sends_tokens_priced_from_config` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:596` `test_harvest_sends_tokens_priced_from_config@initial` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_harvest_run.py:293` `test_harvest_skips_excluded_cwd` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:574` `test_refresh_meta_honours_excluded_cwds` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:574` `test_refresh_meta_honours_excluded_cwds@initial` | `codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:535` `test_refresh_meta_ignores_bookmarks_and_sends_only_derived_fields` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:535` `test_refresh_meta_ignores_bookmarks_and_sends_only_derived_fields@initial` | `codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:584` `test_refresh_meta_looks_at_every_log_by_default` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:567` `test_refresh_meta_reports_a_request_that_did_not_land` | `claude_projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:567` `test_refresh_meta_reports_a_request_that_did_not_land@initial` | `codex_sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_harvest_run.py:452` `test_since_filters_old_files` | `projects/-work-proj-a/old.jsonl` |
| `test_harvest_run.py:468` `test_trivial_session_skipped_without_summarizing` | `projects/-work-x/s.jsonl` |

### `tests/test_parsers.py`

| Test | Files (under `logs/test_parsers/<test>/`) |
|---|---|
| `test_parsers.py:309` `test_claude_a_newer_subagent_log_moves_the_session_mtime` | `-work-proj/cc-files.jsonl`<br>`-work-proj/cc-files/subagents/agent-a1.jsonl` |
| `test_parsers.py:471` `test_claude_artifacts_from_subagents_and_an_older_publish_read_later` | `-work-proj/cc-art.jsonl`<br>`-work-proj/cc-art/subagents/agent-a1.jsonl` |
| `test_parsers.py:433` `test_claude_artifacts_keep_publishes_only` | `s.jsonl` |
| `test_parsers.py:112` `test_claude_files_written_from_file_tools` | `s.jsonl` |
| `test_parsers.py:74` `test_claude_iter_sessions_finds_fixture` | `projects/-work-proj-a/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_parsers.py:281` `test_claude_subagent_transcripts_feed_the_parent_session` | `-work-proj/cc-files.jsonl`<br>`-work-proj/cc-files/subagents/agent-a1.jsonl` |
| `test_parsers.py:251` `test_codex_a_header_inside_added_text_is_not_a_file` | `rollout.jsonl` |
| `test_parsers.py:235` `test_codex_bare_windows_paths_are_kept_intact` | `rollout.jsonl` |
| `test_parsers.py:246` `test_codex_decodes_unicode_escapes_in_the_literal` | `rollout.jsonl` |
| `test_parsers.py:197` `test_codex_escaped_quote_in_path_does_not_swallow_the_patch` | `rollout.jsonl` |
| `test_parsers.py:184` `test_codex_escaped_windows_path_keeps_its_backslashes` | `rollout.jsonl` |
| `test_parsers.py:147` `test_codex_files_written_from_apply_patch` | `rollout.jsonl` |
| `test_parsers.py:354` `test_codex_function_call_argv_lists_are_searched` | `rollout.jsonl` |
| `test_parsers.py:345` `test_codex_heredoc_patch_is_read_without_decoding` | `rollout.jsonl` |
| `test_parsers.py:207` `test_codex_ignores_a_header_mentioned_mid_line_in_code` | `rollout.jsonl` |
| `test_parsers.py:85` `test_codex_iter_sessions_finds_fixture` | `sessions/2026/09/18/rollout-2026-09-18T09-00-00-11112222.jsonl` |
| `test_parsers.py:59` `test_codex_missing_meta_returns_none` | `rollout-empty.jsonl` |
| `test_parsers.py:261` `test_codex_patch_bound_to_a_variable_first` | `rollout.jsonl` |

### `tests/test_tokens.py`

| Test | Files (under `logs/test_tokens/<test>/`) |
|---|---|
| `test_tokens.py:182` `test_claude_a_resumed_subagent_replaying_an_earlier_snapshot_does_not_undo_the_final_count` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`proj/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/agent-a.jsonl`<br>`proj/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/agent-b.jsonl` |
| `test_tokens.py:244` `test_claude_advisor_iterations_are_counted_on_their_own_model` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_tokens.py:160` `test_claude_counts_a_response_once_however_many_records_repeat_its_id` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_tokens.py:273` `test_claude_fast_mode_is_its_own_model_and_synthetic_turns_are_skipped` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_tokens.py:214` `test_claude_inline_sidechain_and_subagent_logs_are_subagent_usage` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`proj/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/agent-a1.jsonl`<br>`proj/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/workflows/wf_1/agent-a2.jsonl` |
| `test_tokens.py:424` `test_claude_iter_sessions_never_parses_a_workflow_transcript_as_a_session` | `projects/proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`projects/proj/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/workflows/wf_1/agent-a.jsonl` |
| `test_tokens.py:201` `test_claude_splits_cache_writes_into_5m_and_1h` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_tokens.py:170` `test_claude_takes_the_last_record_of_a_response_streamed_into_a_subagent_log` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`proj/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/agent-a.jsonl` |
| `test_tokens.py:285` `test_claude_tokens_do_not_change_text_or_turns` | `b/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl` |
| `test_tokens.py:231` `test_claude_workflow_subagents_count_for_mtime_and_files_written` | `proj/abcd1234-ef56-7890-ab12-cd34ef567890.jsonl`<br>`proj/abcd1234-ef56-7890-ab12-cd34ef567890/subagents/workflows/wf_1/agent-a.jsonl` |
| `test_tokens.py:350` `test_codex_counter_restart_does_not_lose_the_first_run` | `r.jsonl` |
| `test_tokens.py:339` `test_codex_counts_each_request_under_its_model_with_uncached_input` | `r.jsonl` |
| `test_tokens.py:404` `test_codex_fork_counts_once_when_archived_and_still_in_sessions` | `archived_sessions/rollout-fork-a.jsonl`<br>`sessions/2026/09/18/rollout-fork-a.jsonl`<br>`sessions/2026/09/18/rollout-parent.jsonl` |
| `test_tokens.py:412` `test_codex_fork_mtime_is_the_parents` | `sessions/2026/09/18/rollout-fork-a.jsonl`<br>`sessions/2026/09/18/rollout-parent.jsonl` |
| `test_tokens.py:384` `test_codex_fork_usage_is_the_parent_sessions_subagent_usage` | `sessions/2026/09/18/rollout-fork-a.jsonl`<br>`sessions/2026/09/18/rollout-fork-b.jsonl`<br>`sessions/2026/09/18/rollout-memory.jsonl`<br>`sessions/2026/09/18/rollout-parent.jsonl` |
| `test_tokens.py:359` `test_codex_uncached_input_never_goes_negative` | `r.jsonl` |
| `test_tokens.py:365` `test_codex_without_token_counts_is_unknown_not_zero` | `r.jsonl` |

## Spec §5 cases the Python tests miss (`logs/spec5/`)

| Unit | Files | Covers |
|---|---|---|
| `spec5/text_separators` | `-work-text/sep00001-….jsonl` | Raw U+2028, U+2029, U+0085, `\x1c`, `\v`/`\f` inside JSON strings: `str.splitlines()` splits the line and the record is dropped. The same characters `\u`-escaped stay one line and reach `text`. A line padded with U+3000/U+00A0/space/tab is `strip()`ped and kept. |
| | `sessions/…/rollout-u2028-meta.jsonl` | Codex: raw U+2028 inside the first `session_meta`. `_first_meta` (universal newlines) reads it; `_records` (`splitlines`) drops it, so no session. |
| | `sessions/…/rollout-u2028-body.jsonl` | Codex messages with raw U+2028/U+2029 are dropped, the others kept. |
| `spec5/crlf` | `claude/-work-crlf/…`, `claude/-work-cr/…`, `sessions/…/rollout-crlf.jsonl`, `rollout-cr.jsonl` | CRLF and lone-CR line endings, both parsers. |
| | `sessions/…/rollout-cr-fork.jsonl` | A fork whose lines end in lone CR: `_first_meta` must still find its `session_meta` and attach its tokens to `rollout-cr`. |
| `spec5/timestamps` | `-work-time/time0001…` | 7 fraction digits (truncated, `.9999999` → `.999999`), 1 digit, none. |
| | `time0002…` | `+09:00` offsets, a session crossing JST midnight, an Artifact published with `+09:00`. |
| | `time0003…` | All-naive session (naive stays naive), naive Artifact time. |
| | `time0004…`, `time0005…` | Equal instants spelled `Z` and `+09:00`: `min`/`max`/`sorted` keep the first one met; two Artifacts at the same instant keep file order. |
| | `sessions/…/rollout-time.jsonl` | Codex: 7 digits, `+09:00`, `-05:30`, `.000000Z`. |
| `spec5/gaps` | `-work-gap/gap00001…` | Gaps of exactly 30 min (same interval) and 30 min + 1 µs (new interval). |
| `spec5/unicode` | `-work-案件😀/uni00001…` | CJK and emoji in prompt, cwd, written paths (absolute and relative) and directory name; astral characters (𠮷, 😀) in an Artifact title and id. |
| | `sessions/…/rollout-unicode.jsonl` | Codex: CJK cwd and an emoji path through an `exec` patch. |
| `spec5/windows` | `C--Users-Me-Proj/win00001…` (+ `subagents/agent-w1.jsonl`) | Claude log from Windows: `C:\…`, `\\server\share\…`, mixed separators, `..` at the drive root, `..` climbing back, relative `sub\x` and `sub/x`, `Report.md` vs `report.md` (case-only), AppData Temp and `.claude\worktrees` noise, `D:relative.md`, `\rooted.md`, `//server/share/x.md` (POSIX flavour), a duplicate, a subagent writing `OUT\A.md`. On the Mac the cwd `C:\Users\Me\Proj` equals the `[projects]` key as one POSIX component, so the link is `none` (project WinProj has no task). |
| | `--server-share-proj/win00002…` | UNC cwd with a relative write and `..\..` climbing above the share. |
| `spec5/usage` | `-work-usage/use00001…` | `speed:"fast"` with cache reads and a 5m/1h split; `iterations` with an advisor (named, unnamed → message model, a non-dict entry); fast + iterations (reasoning to `<model>:fast`); counts as integral float `5.0`, non-integral float `2.7`, numeric strings `"12"` and `" 7 "`, `true`, `null`; a repeated id with equal output (later record wins, first slot kept); a response without id (counted last); an unpriced model. |
| | `sessions/…/rollout-usage.jsonl` | Codex `token_count` with float, string and bool counts. |
| `spec5/codex_exec` | `sessions/…/rollout-exec.jsonl` | `exec` scripts: `\u{1F600}`, an escaped quote, a `\uD83D\uDE00` pair, `\x41`, invalid `\u{ZZ}`, a lone `\uD83D` (→ U+FFFD), a backslash-newline continuation, a template literal, a single-quoted literal. |
| `spec5/projects_tie` | `-work-tie-sub/tie00001…` | cwd `/work/tie/sub` under two `[projects]` keys of equal depth (`/work/tie` = TieFirst, `/work/tie/` = TieSecond, in that order): the first key wins (`sessions.json`: `T-TIE1`, auto-dir). `link.json` has the reversed order too. |
| `spec5/filters` | `-work-scratch/…`, `-work-hook/…`, `-work-trivial/…` (2) | Harvest filters: excluded cwd (never bookmarked), hook prompt (bookmarked without fp), one turn under 3 min (`09:02:59`, trivial) and exactly 3 min (sent). |

## Spec §6 divergent inputs (`logs/divergent/`)

What Python raises at each step is in `../golden/divergent.json` (generated, not hand-written).

| Row | File | Python |
|---|---|---|
| D1 | `D1/-work-div/div00001….jsonl` — bytes `\xff\xfe` inside a string | `UnicodeDecodeError` in `read_text` (parse_file, iter_sessions, harvest) |
| D2 | `D2/sessions/2026/09/18/rollout-d2.jsonl` — `session_meta` first, `\xc3\x28` on line 3 | `UnicodeDecodeError` escapes `_first_meta` in `codex.iter_sessions` (only `OSError` is caught) |
| D3 | `D3/-work-div/div00003….jsonl` — `Z`, naive and `+09:00` timestamps in one session | parses; `TypeError` comparing naive and aware in harvest (`started_at`) |
| D4 | `D4/-work-div/div00004….jsonl` — `"input_tokens": "1.5"` | `ValueError` from `int("1.5")` in parse_file |
| D11 | `D11/-work-div/div00011….jsonl` — `"timestamp": "yesterday"` | `ValueError` from `fromisoformat` in parse_file |
| D12 | `D12/-work-div/div00012….jsonl` — `"timestamp": 1789722000` | `AttributeError` (`int` has no `replace`) in parse_file |

D5, D6, D13 are Go unit tests (Tasks 3, 10); D7–D10 are covered in Tasks 8 and 9; D14 (an outbox file that is valid
JSON but not an object) is not a log: Task 4 and the harness's `outbox-cross` scenario cover it, and
`cli_transcripts.json` → `harvest_outbox_non_object` records Python's exit code. See TESTMAP's notes.
