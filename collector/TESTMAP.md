# TESTMAP — Python tests → Go tests

> The Python collector (`src/worklog`), its tests (`tests/`), the golden generator (`testdata/gen_golden.py`), the
> corpus tools (`testdata/tools/`, including the checker for this file) and the parity harness (`parity/`) were
> removed on 2026-10-22, after both machines moved to the Go `wl` (see git history). This map is kept as the
> provenance of the Go tests: the Python file:line citations and the `.venv` notes refer to that removed code.

Every Python test (`grep -n '^def test_' tests/*.py`, 282 rows; rows 1–276 cite line numbers as at `01ecf82`, rows 277+ as at the heartbeat commit), mapped to the Go test that carries its
behaviour. *Task* is the plan's "Lands in" column (multi-task files are narrowed when the test is ported). The Go test
and Status columns are filled by the task that ports the test; Status is `ported`, `merged` (covered by another row's
Go test, named in Note) or `dropped` (Note says why, e.g. a Python-only mechanism).

| # | Python test | Task | Go test | Status | Note |
|---:|---|---|---|---|---|
| 1 | `test_api_client.py:38` `test_put_task_sends_auth_and_json` | 4 | `internal/api` `TestPutTaskSendsAuthAndJSON` | ported |  |
| 2 | `test_api_client.py:49` `test_ingest_wraps_sessions_and_returns_the_server_counts` | 4 | `internal/api` `TestIngestWrapsSessionsAndReturnsTheServerCounts` | ported |  |
| 3 | `test_api_client.py:62` `test_ingest_reports_zero_counts_when_the_body_is_unreadable` | 4 | `internal/api` `TestIngestReportsZeroCountsWhenTheBodyIsUnreadable` | ported | all 3 cases, plus null count, non-JSON body, int() coercion |
| 4 | `test_api_client.py:77` `test_a_2xx_that_is_not_json_parks_instead_of_counting_as_written` | 4 | `internal/api` `TestA2xxThatIsNotJSONParksInsteadOfCountingAsWritten` | ported | all 3 cases |
| 5 | `test_api_client.py:85` `test_ingest_parks_when_access_answers_2xx_with_its_login_page` | 4 | `internal/api` `TestIngestParksWhenAccessAnswers2xxWithItsLoginPage` | ported |  |
| 6 | `test_api_client.py:91` `test_flush_keeps_a_record_whose_reply_is_an_html_login_page` | 4 | `internal/api` `TestFlushKeepsARecordWhoseReplyIsAnHTMLLoginPage` | ported |  |
| 7 | `test_api_client.py:102` `test_ingest_reports_retry_and_parks_when_the_server_is_down` | 4 | `internal/api` `TestIngestReportsRetryAndParksWhenTheServerIsDown` | ported | also asserts the parked body |
| 8 | `test_api_client.py:108` `test_get_task_unwraps_the_detail_payload` | 4 | `internal/api` `TestGetTaskUnwrapsTheDetailPayload` | ported | the 4 s read timeout: `TestInteractiveGetSilentFor5sIsUnavailableAndOpensTheBreaker` |
| 9 | `test_api_client.py:128` `test_get_task_returns_none_on_any_failure` | 4 | `internal/api` `TestGetTaskReturnsNoneOnAnyFailure` | ported | all 6 cases |
| 10 | `test_api_client.py:133` `test_get_task_returns_none_on_network_error` | 4 | `internal/api` `TestGetTaskReturnsNoneOnNetworkError` | ported | ConnectError = server drops the connection |
| 11 | `test_api_client.py:140` `test_week_timeline_returns_the_parsed_body` | 4 | `internal/api` `TestWeekTimelineReturnsTheParsedBody` | ported |  |
| 12 | `test_api_client.py:151` `test_week_timeline_returns_none_on_any_failure` | 4 | `internal/api` `TestWeekTimelineReturnsNoneOnAnyFailure` | ported | all 3 cases |
| 13 | `test_api_client.py:156` `test_put_note_path` | 4 | `internal/api` `TestPutNotePath` | ported |  |
| 14 | `test_api_client.py:163` `test_network_error_parks_in_outbox` | 4 | `internal/api` `TestNetworkErrorParksInOutbox` | ported |  |
| 15 | `test_api_client.py:175` `test_retryable_statuses_park` | 4 | `internal/api` `TestRetryableStatusesPark` | ported | all 5 statuses, plus 408 |
| 16 | `test_api_client.py:181` `test_400_goes_to_rejected` | 4 | `internal/api` `Test400GoesToRejected` | ported |  |
| 17 | `test_api_client.py:188` `test_park_false_leaves_no_files` | 4 | `internal/api` `TestParkFalseLeavesNoFiles` | ported |  |
| 18 | `test_api_client.py:194` `test_flush_replays_in_order_and_clears` | 4 | `internal/api` `TestFlushReplaysInOrderAndClears` | ported |  |
| 19 | `test_api_client.py:218` `test_two_writes_in_one_clock_tick_get_their_own_outbox_files` | 4 | `internal/api` `TestTwoWritesInOneClockTickGetTheirOwnOutboxFiles` | ported | frozen `rt.Env.Now`; also asserts the forced-up stamps |
| 20 | `test_api_client.py:233` `test_flush_replays_in_write_order_under_a_frozen_clock` | 4 | `internal/api` `TestFlushReplaysInWriteOrderUnderAFrozenClock` | ported |  |
| 21 | `test_api_client.py:254` `test_flush_stops_at_first_retryable_failure` | 4 | `internal/api` `TestFlushStopsAtFirstRetryableFailure` | ported |  |
| 22 | `test_api_client.py:261` `test_flush_moves_rejected_aside_and_continues` | 4 | `internal/api` `TestFlushMovesRejectedAsideAndContinues` | ported |  |
| 23 | `test_api_client.py:277` `test_flush_on_missing_outbox` | 4 | `internal/api` `TestFlushOnMissingOutbox` | ported |  |
| 24 | `test_api_client.py:282` `test_a_write_that_cannot_even_be_parked_reports_lost_not_retry` | 4 | `internal/api` `TestAWriteThatCannotEvenBeParkedReportsLostNotRetry` | ported | the OSError text inside the line is Go's |
| 25 | `test_api_client.py:292` `test_a_rejected_write_that_cannot_be_parked_is_also_lost` | 4 | `internal/api` `TestARejectedWriteThatCannotBeParkedIsAlsoLost` | ported |  |
| 26 | `test_api_client.py:298` `test_ingest_reports_lost_when_parking_fails` | 4 | `internal/api` `TestIngestReportsLostWhenParkingFails` | ported |  |
| 27 | `test_api_client.py:304` `test_flush_sets_aside_corrupt_file_and_continues` | 4 | `internal/api` `TestFlushSetsAsideCorruptFileAndContinues` | ported |  |
| 28 | `test_api_client.py:329` `test_flush_warns_when_sent_file_cannot_be_removed` | 4 | `internal/api` `TestFlushWarnsWhenSentFileCannotBeRemoved` | ported | unlink failure injected through `Client.remove` |
| 29 | `test_api_client.py:352` `test_sends_explicit_user_agent` | 4 | `internal/api` `TestSendsExplicitUserAgent` | ported | `worklog-cli/<version> (go)` |
| 30 | `test_api_client.py:359` `test_list_tasks_parses_server_rows` | 4 | `internal/api` `TestListTasksParsesServerRows` | ported |  |
| 31 | `test_api_client.py:378` `test_list_tasks_returns_none_on_any_failure` | 4 | `internal/api` `TestListTasksReturnsNoneOnAnyFailure` | ported | all 6 cases, plus one bad row among good ones |
| 32 | `test_api_client.py:383` `test_list_tasks_returns_none_on_network_error` | 4 | `internal/api` `TestListTasksReturnsNoneOnNetworkError` | ported |  |
| 33 | `test_api_client.py:390` `test_create_task_returns_server_id` | 4 | `internal/api` `TestCreateTaskReturnsServerID` | ported |  |
| 34 | `test_api_client.py:399` `test_create_task_returns_none_on_failure_and_parks_nothing` | 4 | `internal/api` `TestCreateTaskReturnsNoneOnFailureAndParksNothing` | ported |  |
| 35 | `test_api_client.py:405` `test_transport_error_opens_breaker_for_rest_of_process` | 4 | `internal/api` `TestTransportErrorOpensBreakerForRestOfProcess` | ported |  |
| 36 | `test_api_client.py:418` `test_breaker_opened_by_create_task_short_circuits_list_tasks` | 4 | `internal/api` `TestBreakerOpenedByCreateTaskShortCircuitsListTasks` | ported | dropped connection instead of ReadTimeout (both TransportError) |
| 37 | `test_api_client.py:428` `test_http_status_error_does_not_open_breaker` | 4 | `internal/api` `TestHTTPStatusErrorDoesNotOpenBreaker` | ported |  |
| 38 | `test_api_client.py:436` `test_flush_returns_immediately_when_breaker_is_open` | 4 | `internal/api` `TestFlushReturnsImmediatelyWhenBreakerIsOpen` | ported |  |
| 39 | `test_api_client.py:447` `test_list_tasks_and_create_task_use_a_short_interactive_timeout` | 4 | `internal/api` `TestInteractiveGetSilentFor5sIsUnavailableAndOpensTheBreaker`, `TestCreateTaskUsesTheShortInteractiveTimeout` | ported | timeouts asserted by behaviour (a 5 s silence fails at ~4 s), not by inspecting the request |
| 40 | `test_api_client.py:467` `test_put_task_still_uses_the_client_default_timeout` | 4 | `internal/api` `TestPutTaskStillUsesTheDefaultTimeout` | ported | a 5 s silence (before headers, and inside the body) still lands |
| 41 | `test_api_client.py:479` `test_access_headers_only_when_both_configured` | 4 | `internal/api` `TestAccessHeadersOnlyWhenBothConfigured` | ported |  |
| 42 | `test_api_client.py:495` `test_put_session_meta_posts_paths_and_tokens_and_returns_the_count` | 4 | `internal/api` `TestPutSessionMetaPostsPathsAndTokensAndReturnsTheCount` | ported |  |
| 43 | `test_api_client.py:504` `test_put_session_meta_never_parks` | 4 | `internal/api` `TestPutSessionMetaNeverParks` | ported |  |
| 44 | `test_api_client.py:511` `test_put_session_meta_reports_a_refusal` | 4 | `internal/api` `TestPutSessionMetaReportsARefusal` | ported |  |
| 45 | `test_api_client.py:518` `test_session_carries_files_written` | 4 | `internal/model` `TestSessionCarriesFilesWritten` | ported |  |
| 46 | `test_api_client.py:522` `test_session_sends_tokens_as_null_when_unknown` | 4 | `internal/model` `TestSessionSendsTokensAsNullWhenUnknown` | ported |  |
| 47 | `test_api_client.py:527` `test_review_distinguishes_missing_from_unknown_route_and_login_page` | 4 | `internal/api` `TestReviewDistinguishesMissingFromUnknownRouteAndLoginPage` | ported | plus non-object 404, 500, non-object 200 |
| 48 | `test_api_client.py:538` `test_put_review_reports_stored_kept_and_rejected` | 4 | `internal/api` `TestPutReviewReportsStoredKeptAndRejected` | ported | plus truthiness of `stored`, unreadable and non-object bodies |
| 49 | `test_api_client.py:548` `test_dashboard_sends_the_inclusive_range` | 4 | `internal/api` `TestDashboardSendsTheInclusiveRange` | ported |  |
| 50 | `test_api_client.py:554` `test_session_sends_active_intervals_as_nested_iso_pairs` | 4 | `internal/model` `TestSessionSendsActiveIntervalsAsNestedISOPairs` | ported |  |
| 51 | `test_api_client.py:566` `test_deliverable_pending_asks_for_this_machine` | 4 | `internal/api` `TestDeliverablePendingAsksForThisMachine` | ported | `quote()` spelling: `TestDeliverablePendingQuotesTheMachineAsPythonDoes` |
| 52 | `test_api_client.py:574` `test_deliverable_pending_is_none_when_it_cannot_be_asked` | 4 | `internal/api` `TestDeliverablePendingIsNoneWhenItCannotBeAsked` | ported |  |
| 53 | `test_api_client.py:579` `test_post_deliverable_verdicts_returns_the_count_and_never_parks` | 4 | `internal/api` `TestPostDeliverableVerdictsReturnsTheCountAndNeverParks` | ported |  |
| 54 | `test_api_store.py:44` `test_append_session_ingests_under_the_store_machine` | 4 | `internal/api` `TestAppendSessionIngestsUnderTheStoreMachine` | ported | real `Client` against httptest instead of FakeClient |
| 55 | `test_api_store.py:53` `test_append_hands_the_ingest_outcome_back_untouched` | 4 | `internal/api` `TestAppendHandsTheIngestOutcomeBackUntouched` | ported | retry, rejected, lost |
| 56 | `test_api_store.py:60` `test_tasks_returns_the_server_rows` | 4 | `internal/api` `TestTasksReturnsTheServerRows` | ported |  |
| 57 | `test_api_store.py:66` `test_tasks_raises_when_the_api_is_unreachable` | 4 | `internal/api` `TestTasksRaisesWhenTheAPIIsUnreachable` | ported | `errors.Is(err, ErrUnavailable)` |
| 58 | `test_api_store.py:72` `test_unassigned_this_week_reads_the_current_tokyo_week_timeline` | 4 | `internal/api` `TestUnassignedThisWeekReadsTheCurrentTokyoWeekTimeline` | ported | `now` injected; Sunday 20:00 UTC = Monday in Tokyo; `TestThisWeek` |
| 59 | `test_api_store.py:83` `test_unassigned_this_week_is_none_when_the_call_gives_no_number` | 4 | `internal/api` `TestUnassignedThisWeekIsNoneWhenTheCallGivesNoNumber` | ported | all 3 cases, plus 3.0, null, a list |
| 60 | `test_cli.py:105` `test_the_cli_exposes_exactly_the_kept_commands` | 10 | `internal/cli` `TestTheCLIExposesExactlyTheKeptCommands` | ported | Typer's `get_command(app).commands` → the command table; `TestCommandTableMatchesSpec` also pins `plan judge` |
| 61 | `test_cli.py:109` `test_help_lists_every_kept_command` | 10 | `internal/cli` `TestHelpListsEveryKeptCommand` | ported | |
| 62 | `test_cli.py:117` `test_the_retired_commands_are_no_longer_invocable` | 10 | `internal/cli` `TestTheRetiredCommandsAreNoLongerInvocable` | ported | |
| 63 | `test_cli.py:126` `test_every_command_requires_an_api_url_and_token` | 10 | `internal/cli` `TestEveryCommandRequiresAnAPIURLAndToken` | ported | all 6 commands, plus `review` and `plan judge` |
| 64 | `test_cli.py:136` `test_new_posts_the_case_and_prints_the_id_the_server_allocated` | 10 | `internal/cli` `TestNewPostsTheCaseAndPrintsTheIDTheServerAllocated` | ported | |
| 65 | `test_cli.py:148` `test_new_defaults_received_at_to_today` | 10 | `internal/cli` `TestNewDefaultsReceivedAtToToday` | ported | asserts the local date (`date.today()`), not Tokyo's |
| 66 | `test_cli.py:154` `test_new_keeps_an_unknown_requester_as_typed_and_warns` | 10 | `internal/cli` `TestNewKeepsAnUnknownRequesterAsTypedAndWarns` | ported | |
| 67 | `test_cli.py:162` `test_new_resolves_each_of_several_requesters` | 10 | `internal/cli` `TestNewResolvesEachOfSeveralRequesters` | ported | |
| 68 | `test_cli.py:170` `test_new_exits_1_when_the_server_cannot_be_reached` | 10 | `internal/cli` `TestNewExits1WhenTheServerCannotBeReached` | ported | |
| 69 | `test_cli.py:185` `test_note_puts_a_note_carrying_the_text_minutes_and_case` | 10 | `internal/cli` `TestNotePutsANoteCarryingTheTextMinutesAndCase` | ported | |
| 70 | `test_cli.py:199` `test_note_with_a_dash_records_no_case_and_touches_no_task` | 10 | `internal/cli` `TestNoteWithADashRecordsNoCaseAndTouchesNoTask` | ported | |
| 71 | `test_cli.py:206` `test_note_appends_the_text_to_the_case_thinking` | 10 | `internal/cli` `TestNoteAppendsTheTextToTheCaseThinking` | ported | |
| 72 | `test_cli.py:224` `test_note_appends_on_a_new_line_below_what_is_already_there` | 10 | `internal/cli` `TestNoteAppendsOnANewLineBelowWhatIsAlreadyThere` | ported | |
| 73 | `test_cli.py:230` `test_note_skips_the_thinking_update_when_the_case_cannot_be_read` | 10 | `internal/cli` `TestNoteSkipsTheThinkingUpdateWhenTheCaseCannotBeRead` | ported | |
| 74 | `test_cli.py:240` `test_note_rejected_by_the_server_exits_1_and_says_it_will_not_be_resent` | 10 | `internal/cli` `TestNoteRejectedByTheServerExits1AndSaysItWillNotBeResent` | ported | |
| 75 | `test_cli.py:252` `test_a_failed_thinking_update_parks_nothing_and_does_not_fail_the_note` | 10 | `internal/cli` `TestAFailedThinkingUpdateParksNothingAndDoesNotFailTheNote` | ported | |
| 76 | `test_cli.py:276` `test_new_does_not_blame_the_network_for_a_refused_create` | 10 | `internal/cli` `TestNewDoesNotBlameTheNetworkForARefusedCreate` | ported | |
| 77 | `test_cli.py:285` `test_note_reports_a_write_it_could_not_even_park` | 10 | `internal/cli` `TestNoteReportsAWriteItCouldNotEvenPark` | ported | |
| 78 | `test_cli.py:299` `test_note_id_carries_a_random_tail_so_ids_are_unique` | 10 | `internal/cli` `TestNoteIDCarriesARandomTailSoIDsAreUnique` | ported | |
| 79 | `test_cli.py:305` `test_two_notes_in_the_same_second_do_not_collide` | 10 | `internal/cli` `TestTwoNotesInTheSameSecondDoNotCollide` | ported | |
| 80 | `test_cli.py:317` `test_note_parks_in_the_outbox_when_the_server_is_unreachable` | 10 | `internal/cli` `TestNoteParksInTheOutboxWhenTheServerIsUnreachable` | ported | |
| 81 | `test_cli.py:329` `test_note_refuses_an_unknown_case_while_the_server_is_reachable` | 10 | `internal/cli` `TestNoteRefusesAnUnknownCaseWhileTheServerIsReachable` | ported | |
| 82 | `test_cli.py:341` `test_done_reads_the_case_from_the_server_and_writes_it_back` | 10 | `internal/cli` `TestDoneReadsTheCaseFromTheServerAndWritesItBack` | ported | `--hours 2` sends 2.0 (equal by value) |
| 83 | `test_cli.py:359` `test_done_appends_to_the_deliverables_already_on_the_server` | 10 | `internal/cli` `TestDoneAppendsToTheDeliverablesAlreadyOnTheServer` | ported | |
| 84 | `test_cli.py:365` `test_done_without_hours_leaves_the_recorded_hours_alone` | 10 | `internal/cli` `TestDoneWithoutHoursLeavesTheRecordedHoursAlone` | ported | |
| 85 | `test_cli.py:371` `test_done_refuses_negative_hours_before_touching_the_server` | 10 | `internal/cli` `TestDoneRefusesNegativeHoursBeforeTouchingTheServer` | ported | also with no config.toml: checked before the config (exit 2) |
| 86 | `test_cli.py:382` `test_done_accepts_zero_hours_as_an_override` | 10 | `internal/cli` `TestDoneAcceptsZeroHoursAsAnOverride` | ported | |
| 87 | `test_cli.py:388` `test_hold_writes_the_case_back_on_hold` | 10 | `internal/cli` `TestHoldWritesTheCaseBackOnHold` | ported | |
| 88 | `test_cli.py:402` `test_an_unknown_case_exits_1_without_writing` | 10 | `internal/cli` `TestAnUnknownCaseExits1WithoutWriting` | ported | |
| 89 | `test_cli.py:411` `test_an_unreachable_server_exits_1_without_writing` | 10 | `internal/cli` `TestAnUnreachableServerExits1WithoutWriting` | ported | |
| 90 | `test_cli.py:421` `test_a_failed_write_back_exits_1_and_queues_nothing` | 10 | `internal/cli` `TestAFailedWriteBackExits1AndQueuesNothing` | ported | |
| 91 | `test_cli.py:446` `test_ls_shows_open_and_hold_cases_from_the_server` | 10 | `internal/cli` `TestLsShowsOpenAndHoldCasesFromTheServer` | ported | |
| 92 | `test_cli.py:457` `test_ls_all_includes_the_done_cases` | 10 | `internal/cli` `TestLsAllIncludesTheDoneCases` | ported | |
| 93 | `test_cli.py:464` `test_ls_exits_1_when_the_cases_cannot_be_read` | 10 | `internal/cli` `TestLsExits1WhenTheCasesCannotBeRead` | ported | |
| 94 | `test_cli_api.py:102` `test_the_client_gets_the_url_token_and_outbox_from_config` | 10 | `internal/cli` `TestTheClientGetsTheURLTokenAndOutboxFromConfig` | ported | Python inspected FakeClient's constructor args; Go observes them: the request reaches api_url with `Bearer tok` (and the `worklog-cli/<ver> (go)` UA), a parked note lands in `{WORKLOG_HOME}/outbox` |
| 95 | `test_cli_api.py:111` `test_access_service_token_credentials_reach_the_client` | 10 | `internal/cli` `TestAccessServiceTokenCredentialsReachTheClient` | ported | asserted as the CF-Access-Client-Id/Secret request headers |
| 96 | `test_cli_api.py:126` `test_harvest_writes_through_an_api_store` | 10 | `internal/cli` `TestCLITranscripts/harvest` | merged | N/A as written (isinstance(store, ApiStore) is Python object identity); the transcript replay proves harvest writes through the real client: POST /api/ingest/sessions with the store's machine, bodies ordered-value |
| 97 | `test_cli_api.py:140` `test_harvest_flushes_the_outbox_before_collecting` | 10 | `internal/cli` `TestHarvestFlushesTheOutboxBeforeCollecting` | ported | |
| 98 | `test_cli_api.py:147` `test_harvest_reports_what_the_outbox_flush_did` | 10 | `internal/cli` `TestHarvestReportsWhatTheOutboxFlushDid` | ported | |
| 99 | `test_cli_api.py:155` `test_harvest_stays_quiet_about_an_empty_outbox` | 10 | `internal/cli` `TestHarvestStaysQuietAboutAnEmptyOutbox` | ported | |
| 100 | `test_cli_api.py:162` `test_harvest_prints_counts_and_the_week_unassigned_tail` | 10 | `internal/cli` `TestHarvestPrintsCountsAndTheWeekUnassignedTail` | ported | |
| 101 | `test_cli_api.py:175` `test_harvest_omits_the_unassigned_tail_when_the_week_cannot_be_read` | 10 | `internal/cli` `TestHarvestOmitsTheUnassignedTailWhenTheWeekCannotBeRead` | ported | |
| 102 | `test_cli_api.py:183` `test_harvest_exits_2_when_the_server_tasks_cannot_be_read` | 10 | `internal/cli` `TestHarvestExits2WhenTheServerTasksCannotBeRead` | ported | |
| 103 | `test_cli_api.py:191` `test_harvest_reports_refused_sessions_and_leaves_them_unbookmarked` | 10 | `internal/cli` `TestHarvestReportsRefusedSessionsAndLeavesThemUnbookmarked` | ported | real client against a stub; fake claude answers "s" |
| 104 | `test_cli_api.py:260` `test_harvest_line_keeps_its_everyday_shape_when_nothing_went_wrong` | 10 | `internal/cli` `TestHarvestLineKeepsItsEverydayShapeWhenNothingWentWrong` | ported | |
| 105 | `test_cli_api.py:268` `test_harvest_files_only_refreshes_paths_without_collecting` | 10 | `internal/cli` `TestHarvestFilesOnlyRefreshesPathsWithoutCollecting` | ported | the window given is observed (a 30-day-old log: --since 20 sends 0, --since 90 sends 1) instead of a spy on since_days |
| 106 | `test_cli_api.py:288` `test_harvest_refresh_meta_is_the_same_command_under_its_new_name` | 10 | `internal/cli` `TestHarvestRefreshMetaIsTheSameCommandUnderItsNewName` | ported | |
| 107 | `test_cli_api.py:306` `test_harvest_files_only_defaults_to_every_log` | 10 | `internal/cli` `TestHarvestFilesOnlyDefaultsToEveryLog` | ported | observed with a log a year older than the clock |
| 108 | `test_cli_api.py:322` `test_plain_harvest_still_defaults_to_14_days` | 10 | `internal/cli` `TestPlainHarvestStillDefaultsTo14Days` | ported | observed with a log 13 vs 15 days old |
| 109 | `test_cli_api.py:338` `test_harvest_files_only_says_the_server_was_unreachable` | 10 | `internal/cli` `TestHarvestFilesOnlySaysTheServerWasUnreachable` | ported | |
| 110 | `test_cli_api.py:349` `test_harvest_files_only_says_the_server_refused` | 10 | `internal/cli` `TestHarvestFilesOnlySaysTheServerRefused` | ported | |
| 111 | `test_cli_api.py:360` `test_harvest_output_is_unchanged_when_the_review_step_fails` | 10 | `internal/cli` `TestHarvestOutputIsUnchangedWhenTheReviewStepFails` | ported | run_review raising → a claude that panics on the review prompt; the same recover in harvest.SideJobs |
| 112 | `test_cli_api.py:369` `test_harvest_asks_the_plan_judge_about_today_and_yesterday` | 10 | `internal/cli` `TestHarvestAsksThePlanJudgeAboutTodayAndYesterday` | ported | |
| 113 | `test_cli_api.py:377` `test_a_plan_judge_crash_does_not_fail_harvest` | 10 | `internal/cli` `TestAPlanJudgeCrashDoesNotFailHarvest` | ported | run_judge raising → a claude that panics on the judge prompt |
| 114 | `test_cli_api.py:389` `test_harvest_asks_for_this_machines_pending_deliverables` | 10 | `internal/cli` `TestHarvestAsksForThisMachinesPendingDeliverables` | ported | |
| 115 | `test_cli_api.py:397` `test_a_deliverable_judge_crash_does_not_fail_harvest` | 10 | `internal/cli` `TestADeliverableJudgeCrashDoesNotFailHarvest` | ported | run_judge raising → a claude that panics on the deliverable prompt |
| 116 | `test_cli_api.py:410` `test_wl_plan_judge_forces_the_given_day` | 10 | `internal/cli` `TestWlPlanJudgeForcesTheGivenDay` | ported | |
| 117 | `test_cli_api.py:419` `test_wl_plan_judge_rejects_a_bad_date` | 10 | `internal/cli` `TestWlPlanJudgeRejectsABadDate` | ported | |
| 118 | `test_cli_api.py:424` `test_wl_review_forces_a_week` | 10 | `internal/cli` `TestWlReviewForcesAWeek` | ported | fake claude answers "ok"; asserts `review: 2026-W39 stored` and the POST /api/reviews week |
| 119 | `test_cli_api.py:434` `test_wl_review_rejects_an_impossible_week` | 10 | `internal/cli` `TestWlReviewRejectsAnImpossibleWeek` | ported | all 3 weeks; no request made |
| 120 | `test_codex_archive.py:14` `test_archived_rollout_is_harvested` | 7 | `internal/codex` `TestArchivedRolloutIsHarvested` | ported | |
| 121 | `test_codex_archive.py:23` `test_rollout_in_both_places_is_yielded_once` | 7 | `internal/codex` `TestRolloutInBothPlacesIsYieldedOnce` | ported | also `TestSessionsWinOverArchived`, `TestMissingRootStillReadsArchivedSessions` |
| 122 | `test_codex_fork.py:8` `test_forked_subagent_rollout_is_skipped` | 7 | `internal/codex` `TestForkedSubagentRolloutIsSkipped` | ported | |
| 123 | `test_codex_fork.py:12` `test_normal_rollout_still_parses` | 7 | `internal/codex` `TestNormalRolloutStillParses` | ported | |
| 124 | `test_codex_fork.py:17` `test_iter_sessions_yields_only_the_parent` | 7 | `internal/codex` `TestIterSessionsYieldsOnlyTheParent` | ported | |
| 125 | `test_codex_fork.py:29` `test_fork_flag_in_a_later_meta_does_not_skip` | 7 | `internal/codex` `TestForkFlagInALaterMetaDoesNotSkip` | ported | |
| 126 | `test_config_api.py:4` `test_defaults_without_api` | 3 | `internal/config` `TestDefaultsWithoutAPI` | ported | |
| 127 | `test_config_api.py:13` `test_reads_api_url_and_token` | 3 | `internal/config` `TestReadsAPIURLAndToken` | ported | |
| 128 | `test_config_api.py:24` `test_token_in_config_toml_is_ignored` | 3 | `internal/config` `TestTokenInConfigTomlIsIgnored` | ported | |
| 129 | `test_config_api.py:30` `test_malformed_credentials_are_ignored_with_warning` | 3 | `internal/config` `TestMalformedCredentialsAreIgnoredWithWarning` | ported | |
| 130 | `test_config_api.py:41` `test_local_toml_overrides_machine` | 3 | `internal/config` `TestLocalTomlOverridesMachine` | ported | |
| 131 | `test_config_api.py:50` `test_without_local_toml_machine_comes_from_config` | 3 | `internal/config` `TestWithoutLocalTomlMachineComesFromConfig` | ported | |
| 132 | `test_config_api.py:56` `test_malformed_local_toml_is_ignored_with_warning` | 3 | `internal/config` `TestMalformedLocalTomlIsIgnoredWithWarning` | ported | |
| 133 | `test_config_api.py:66` `test_empty_machine_in_local_toml_is_ignored` | 3 | `internal/config` `TestEmptyMachineInLocalTomlIsIgnored` | ported | |
| 134 | `test_config_api.py:75` `test_reads_access_service_token` | 3 | `internal/config` `TestReadsAccessServiceToken` | ported | |
| 135 | `test_config_api.py:86` `test_access_service_token_defaults_to_none` | 3 | `internal/config` `TestAccessServiceTokenDefaultsToNone` | ported | |
| 136 | `test_config_api.py:93` `test_find_root_falls_back_to_package_repo_root` | 3 | `internal/config` `TestFindRootFallsBackToExeDirAncestor` | ported | package-repo-root fallback becomes exe-dir ancestors (spec §9) |
| 137 | `test_config_api.py:103` `test_find_root_prefers_cwd_ancestor_over_package_root` | 3 | `internal/config` `TestFindRootPrefersCwdAncestorOverExeDir` | ported | package-repo-root fallback becomes exe-dir ancestors (spec §9) |
| 138 | `test_deliverable_judge.py:32` `test_excerpt_reads_the_opening_text_and_skips_binaries_and_missing_files` | 8 | `internal/deliverable` `TestExcerptReadsTheOpeningTextAndSkipsBinariesAndMissingFiles` | ported | plus a directory; golden `TestExcerptGolden` (CRLF, invalid UTF-8, astral, `.DOCX`) |
| 139 | `test_deliverable_judge.py:41` `test_prompt_carries_ids_paths_tasks_excerpts_and_the_lean` | 8 | `internal/deliverable` `TestPromptCarriesIDsPathsTasksExcerptsAndTheLean` | ported | |
| 140 | `test_deliverable_judge.py:49` `test_parse_maps_ids_back_to_paths_and_drops_bad_rows` | 8 | `internal/deliverable` `TestParseMapsIDsBackToPathsAndDropsBadRows` | ported | golden `TestParseOutputGolden` (11 cases) |
| 141 | `test_deliverable_judge.py:66` `test_run_posts_one_batch_per_page_up_to_the_cap` | 8 | `internal/deliverable` `TestRunPostsOneBatchPerPageUpToTheCap` | ported | |
| 142 | `test_deliverable_judge.py:76` `test_run_until_none_left_and_stops_when_nothing_new_is_stored` | 8 | `internal/deliverable` `TestRunUntilNoneLeftAndStopsWhenNothingNewIsStored` | ported | batches −1 = None |
| 143 | `test_deliverable_judge.py:88` `test_run_reports_what_went_wrong` | 8 | `internal/deliverable` `TestRunReportsWhatWentWrong` | ported | golden `TestRunGolden` (9 runs: client calls, argv, stdin, timeout) |
| 144 | `test_deliverable_judge.py:115` `test_a_file_the_model_left_out_gets_the_unsure_verdict_instead_of_coming_back_every_harvest` | 8 | `internal/deliverable` `TestAFileTheModelLeftOutGetsTheUnsureVerdictInsteadOfComingBackEveryHarvest` | ported | |
| 145 | `test_deliverable_judge.py:123` `test_parse_keeps_the_good_objects_when_one_breaks_the_json` | 8 | `internal/deliverable` `TestParseKeepsTheGoodObjectsWhenOneBreaksTheJSON` | ported | |
| 146 | `test_deliverable_judge.py:129` `test_parse_takes_a_bare_number_for_its_file_id` | 8 | `internal/deliverable` `TestParseTakesABareNumberForItsFileID` | ported | |
| 147 | `test_harvest_fallback.py:51` `test_result_counts_fallback_summaries` | 8, 10 | `internal/harvest` `TestAFallbackSummaryIsRetriedWhenTheLogNextMoves` | merged | summarize side (Task 8): `internal/summarize` `TestEveryFailedCallFallsBack`; the count is harvest.Run's (Task 9 test asserts Fallback == 2); end to end in `internal/cli` `TestCLITranscripts/harvest_claude_fails` (`fallback=2`) |
| 148 | `test_harvest_fallback.py:60` `test_cli_prints_fallback_count` | 8, 10 | `internal/cli` `TestCLIPrintsFallbackCount` | ported | summarize side (Task 8): `internal/summarize` `TestEveryFailedCallFallsBack`; `fallback=` counts end to end in `TestCLITranscripts/harvest_claude_fails` |
| 149 | `test_harvest_run.py:80` `test_harvest_end_to_end_creates_sessions` | 9 | `internal/harvest` `TestHarvestEndToEndCreatesSessions` | ported |  |
| 150 | `test_harvest_run.py:100` `test_harvest_is_idempotent_on_second_run` | 9 | `internal/harvest` `TestHarvestIsIdempotentOnSecondRun` | ported |  |
| 151 | `test_harvest_run.py:141` `test_an_idle_session_whose_log_only_grew_metadata_is_not_summarized_again` | 9 | `internal/harvest` `TestAnIdleSessionWhoseLogOnlyGrewMetadataIsNotSummarizedAgain` | ported |  |
| 152 | `test_harvest_run.py:164` `test_a_session_that_gained_a_real_turn_is_summarized_again` | 9 | `internal/harvest` `TestASessionThatGainedARealTurnIsSummarizedAgain` | ported |  |
| 153 | `test_harvest_run.py:190` `test_a_subagent_that_finished_later_is_enough_to_summarize_again` | 9 | `internal/harvest` `TestASubagentThatFinishedLaterIsEnoughToSummarizeAgain` | ported |  |
| 154 | `test_harvest_run.py:213` `test_a_case_created_after_the_first_harvest_gets_the_idle_session_re_sent` | 9 | `internal/harvest` `TestACaseCreatedAfterTheFirstHarvestGetsTheIdleSessionReSent` | ported |  |
| 155 | `test_harvest_run.py:239` `test_a_fallback_summary_is_retried_when_the_log_next_moves` | 9 | `internal/harvest` `TestAFallbackSummaryIsRetriedWhenTheLogNextMoves` | ported |  |
| 156 | `test_harvest_run.py:263` `test_a_pre_fingerprint_bookmark_is_honored_and_upgraded` | 9 | `internal/harvest` `TestAPreFingerprintBookmarkIsHonoredAndUpgraded` | ported |  |
| 157 | `test_harvest_run.py:293` `test_harvest_skips_excluded_cwd` | 9 | `internal/harvest` `TestHarvestSkipsExcludedCwd` | ported | also asserts the excluded session is not bookmarked |
| 158 | `test_harvest_run.py:307` `test_harvest_counts_new_and_updated_from_the_store_result` | 9 | `internal/harvest` `TestHarvestCountsNewAndUpdatedFromTheStoreResult` | ported |  |
| 159 | `test_harvest_run.py:321` `test_harvest_counts_parked_appends` | 9 | `internal/harvest` `TestHarvestCountsParkedAppends` | ported |  |
| 160 | `test_harvest_run.py:333` `test_a_refused_session_is_counted_and_never_bookmarked` | 9 | `internal/harvest` `TestARefusedSessionIsCountedAndNeverBookmarked` | ported | asserts the full stderr line with the outbox path |
| 161 | `test_harvest_run.py:354` `test_a_session_that_could_not_be_parked_is_counted_and_never_bookmarked` | 9 | `internal/harvest` `TestASessionThatCouldNotBeParkedIsCountedAndNeverBookmarked` | ported |  |
| 162 | `test_harvest_run.py:366` `test_a_parked_session_is_still_bookmarked` | 9 | `internal/harvest` `TestAParkedSessionIsStillBookmarked` | ported |  |
| 163 | `test_harvest_run.py:378` `test_harvest_does_not_read_sessions_from_the_store` | 9 | `internal/harvest` `TestHarvestDoesNotReadSessionsFromTheStore` | ported | the Go `Store` interface has no session read at all (compile-time) |
| 164 | `test_harvest_run.py:388` `test_harvest_raises_without_parsing_logs_when_the_api_is_unreachable` | 9 | `internal/harvest` `TestHarvestRaisesWithoutParsingLogsWhenTheAPIIsUnreachable` | ported | returns `api.ErrUnavailable` (errors.Is); also no warning, i.e. no log was read |
| 165 | `test_harvest_run.py:412` `test_harvest_moves_the_state_file_out_of_the_repo_once` | 9 | `internal/harvest` `TestD10LegacyStateFileIsIgnored` | dropped | N/A under spec §6 D10 / Q4: the legacy `data/.harvest_state.json` move is dropped; the replacement test asserts a legacy file is neither read nor moved |
| 166 | `test_harvest_run.py:434` `test_harvest_keeps_the_new_state_file_when_an_old_one_still_exists` | 9 | `internal/harvest` `TestD10LegacyStateFileIsIgnored` | dropped | N/A under spec §6 D10 / Q4: the legacy `data/.harvest_state.json` move is dropped; the replacement test asserts a legacy file is neither read nor moved |
| 167 | `test_harvest_run.py:452` `test_since_filters_old_files` | 9 | `internal/harvest` `TestSinceFiltersOldFiles` | ported | also through `Run` with `--since 1` |
| 168 | `test_harvest_run.py:468` `test_trivial_session_skipped_without_summarizing` | 9 | `internal/harvest` `TestTrivialSessionSkippedWithoutSummarizing` | ported | also asserts the mtime-only bookmark |
| 169 | `test_harvest_run.py:501` `test_harvest_sends_files_written` | 9 | `internal/harvest` `TestHarvestSendsFilesWritten` | ported |  |
| 170 | `test_harvest_run.py:513` `test_harvest_sends_active_intervals` | 9 | `internal/harvest` `TestHarvestSendsActiveIntervals` | ported | also asserts `[]`, not null, for the list fields |
| 171 | `test_harvest_run.py:535` `test_refresh_meta_ignores_bookmarks_and_sends_only_derived_fields` | 9 | `internal/harvest` `TestRefreshMetaIgnoresBookmarksAndSendsOnlyDerivedFields` | ported |  |
| 172 | `test_harvest_run.py:567` `test_refresh_meta_reports_a_request_that_did_not_land` | 9 | `internal/harvest` `TestRefreshMetaReportsARequestThatDidNotLand` | ported |  |
| 173 | `test_harvest_run.py:574` `test_refresh_meta_honours_excluded_cwds` | 9 | `internal/harvest` `TestRefreshMetaHonoursExcludedCwds` | ported |  |
| 174 | `test_harvest_run.py:584` `test_refresh_meta_looks_at_every_log_by_default` | 9 | `internal/harvest` `TestRefreshMetaLooksAtEveryLogByDefault` | ported |  |
| 175 | `test_harvest_run.py:596` `test_harvest_sends_tokens_priced_from_config` | 9 | `internal/harvest` `TestHarvestSendsTokensPricedFromConfig` | ported |  |
| 176 | `test_harvest_run.py:635` `test_a_publish_alone_re_sends_the_session_with_its_artifacts` | 9 | `internal/harvest` `TestAPublishAloneReSendsTheSessionWithItsArtifacts` | ported |  |
| 177 | `test_harvest_run.py:656` `test_a_session_without_artifacts_keeps_its_pre_artifacts_fingerprint` | 9 | `internal/harvest` `TestASessionWithoutArtifactsKeepsItsPreArtifactsFingerprint` | ported |  |
| 178 | `test_harvest_summarize.py:10` `test_prompts_ask_for_30_chars_and_outcomes_only` | 8 | `internal/summarize` `TestPromptsAskFor30CharsAndOutcomesOnly` | ported | |
| 179 | `test_harvest_summarize.py:16` `test_llm_summary_is_cut_to_limit` | 8 | `internal/summarize` `TestLLMSummaryIsCutToLimit` | ported | golden `TestSummarizeOutputsGolden` (24 cases), `TestSummarizeHarvestPromptsGolden` (every corpus prompt) |
| 180 | `test_harvest_summarize.py:24` `test_fallback_is_first_30_chars` | 8 | `internal/summarize` `TestFallbackIsFirst30Chars` | ported | |
| 181 | `test_harvest_summarize.py:31` `test_prompts_ask_for_plain_words` | 8 | `internal/summarize` `TestPromptsAskForPlainWords` | ported | |
| 182 | `test_link.py:37` `test_dir_match_single_open_task_returns_auto_dir` | 5 | `internal/link` `TestDirMatchSingleOpenTaskReturnsAutoDir` | ported | |
| 183 | `test_link.py:44` `test_dir_match_respects_received_date` | 5 | `internal/link` `TestDirMatchRespectsReceivedDate` | ported | |
| 184 | `test_link.py:55` `test_known_dir_but_ambiguous_does_not_fall_back_to_time` | 5 | `internal/link` `TestKnownDirButAmbiguousDoesNotFallBackToTime` | ported | |
| 185 | `test_link.py:66` `test_session_before_task_received_is_not_linked_by_dir` | 5 | `internal/link` `TestSessionBeforeTaskReceivedIsNotLinkedByDir` | ported | |
| 186 | `test_link.py:73` `test_time_match_when_no_dir_or_project_unknown` | 5 | `internal/link` `TestTimeMatchWhenNoDirOrProjectUnknown` | ported | |
| 187 | `test_link.py:79` `test_no_match_returns_none` | 5 | `internal/link` `TestNoMatchReturnsNone` | ported | |
| 188 | `test_parsers.py:18` `test_claude_parse` | 6 | `internal/claudecode` `TestClaudeParse` | ported | |
| 189 | `test_parsers.py:27` `test_claude_skips_sidechain_and_tool_result_and_empty` | 6 | `internal/claudecode` `TestClaudeSkipsSidechainAndToolResultAndEmpty` | ported | |
| 190 | `test_parsers.py:34` `test_claude_missing_file_returns_none` | 6 | `internal/claudecode` `TestClaudeMissingFileReturnsNone` | ported | |
| 191 | `test_parsers.py:38` `test_claude_iter_sessions` | 6 | `internal/claudecode` `TestClaudeIterSessions` | ported | |
| 192 | `test_parsers.py:43` `test_codex_parse` | 7 | `internal/codex` `TestCodexParse` | ported | |
| 193 | `test_parsers.py:52` `test_codex_skips_environment_context_and_agents_md` | 7 | `internal/codex` `TestCodexSkipsEnvironmentContextAndAgentsMD` | ported | |
| 194 | `test_parsers.py:59` `test_codex_missing_meta_returns_none` | 7 | `internal/codex` `TestCodexMissingMetaReturnsNone` | ported | |
| 195 | `test_parsers.py:65` `test_codex_missing_file_returns_none` | 7 | `internal/codex` `TestCodexMissingFileReturnsNone` | ported | |
| 196 | `test_parsers.py:69` `test_codex_iter_sessions_missing_root_yields_nothing` | 7 | `internal/codex` `TestCodexIterSessionsMissingRootYieldsNothing` | ported | |
| 197 | `test_parsers.py:74` `test_claude_iter_sessions_finds_fixture` | 6 | `internal/claudecode` `TestClaudeIterSessionsFindsFixture` | ported | |
| 198 | `test_parsers.py:85` `test_codex_iter_sessions_finds_fixture` | 7 | `internal/codex` `TestCodexIterSessionsFindsFixture` | ported | |
| 199 | `test_parsers.py:112` `test_claude_files_written_from_file_tools` | 6 | `internal/claudecode` `TestClaudeFilesWrittenFromFileTools` | ported | HOME = `/home/wl` |
| 200 | `test_parsers.py:139` `test_claude_fixture_without_file_tools_has_no_files` | 6 | `internal/claudecode` `TestClaudeFixtureWithoutFileToolsHasNoFiles` | ported | |
| 201 | `test_parsers.py:147` `test_codex_files_written_from_apply_patch` | 7 | `internal/codex` `TestCodexFilesWrittenFromApplyPatch` | ported | header rules: `TestPatchHeaders`, `TestPatchStartRules` |
| 202 | `test_parsers.py:184` `test_codex_escaped_windows_path_keeps_its_backslashes` | 7 | `internal/codex` `TestCodexEscapedWindowsPathKeepsItsBackslashes` | ported | |
| 203 | `test_parsers.py:197` `test_codex_escaped_quote_in_path_does_not_swallow_the_patch` | 7 | `internal/codex` `TestCodexEscapedQuoteInPathDoesNotSwallowThePatch` | ported | |
| 204 | `test_parsers.py:207` `test_codex_ignores_a_header_mentioned_mid_line_in_code` | 7 | `internal/codex` `TestCodexIgnoresAHeaderMentionedMidLineInCode` | ported | |
| 205 | `test_parsers.py:235` `test_codex_bare_windows_paths_are_kept_intact` | 7 | `internal/codex` `TestCodexBareWindowsPathsAreKeptIntact` | ported | |
| 206 | `test_parsers.py:246` `test_codex_decodes_unicode_escapes_in_the_literal` | 7 | `internal/codex` `TestCodexDecodesUnicodeEscapesInTheLiteral` | ported | JS-literal edge cases from `.venv` Python: `TestDecodeJSLiteralMatchesPython` (60 cases), `TestHexIntIsPythonsIntBase16` |
| 207 | `test_parsers.py:251` `test_codex_a_header_inside_added_text_is_not_a_file` | 7 | `internal/codex` `TestCodexAHeaderInsideAddedTextIsNotAFile` | ported | |
| 208 | `test_parsers.py:261` `test_codex_patch_bound_to_a_variable_first` | 7 | `internal/codex` `TestCodexPatchBoundToAVariableFirst` | ported | |
| 209 | `test_parsers.py:269` `test_noise_is_matched_after_normalising` | 5 | `internal/session` `TestNoiseIsMatchedAfterNormalising` | ported | home = the goldens' HOME `/home/wl` |
| 210 | `test_parsers.py:281` `test_claude_subagent_transcripts_feed_the_parent_session` | 6 | `internal/claudecode` `TestClaudeSubagentTranscriptsFeedTheParentSession` | ported | |
| 211 | `test_parsers.py:309` `test_claude_a_newer_subagent_log_moves_the_session_mtime` | 6 | `internal/claudecode` `TestClaudeANewerSubagentLogMovesTheSessionMtime` | ported | |
| 212 | `test_parsers.py:333` `test_clean_paths_normalises_absolute_paths_and_drops_worktree_copies` | 5 | `internal/session` `TestCleanPathsNormalisesAbsolutePathsAndDropsWorktreeCopies` | ported | |
| 213 | `test_parsers.py:345` `test_codex_heredoc_patch_is_read_without_decoding` | 7 | `internal/codex` `TestCodexHeredocPatchIsReadWithoutDecoding` | ported | |
| 214 | `test_parsers.py:354` `test_codex_function_call_argv_lists_are_searched` | 7 | `internal/codex` `TestCodexFunctionCallArgvListsAreSearched` | ported | |
| 215 | `test_parsers.py:373` `test_active_intervals_splits_on_gaps_over_thirty_minutes` | 5 | `internal/session` `TestActiveIntervalsSplitsOnGapsOverThirtyMinutes` | ported | |
| 216 | `test_parsers.py:388` `test_active_intervals_keeps_a_cluster_that_crosses_midnight_whole` | 5 | `internal/session` `TestActiveIntervalsKeepsAClusterThatCrossesMidnightWhole` | ported | |
| 217 | `test_parsers.py:396` `test_active_intervals_single_message_and_empty` | 5 | `internal/session` `TestActiveIntervalsSingleMessageAndEmpty` | ported | |
| 218 | `test_parsers.py:405` `test_active_intervals_orders_unsorted_messages` | 5 | `internal/session` `TestActiveIntervalsOrdersUnsortedMessages` | ported | |
| 219 | `test_parsers.py:433` `test_claude_artifacts_keep_publishes_only` | 6 | `internal/claudecode` `TestClaudeArtifactsKeepPublishesOnly` | ported | |
| 220 | `test_parsers.py:471` `test_claude_artifacts_from_subagents_and_an_older_publish_read_later` | 6 | `internal/claudecode` `TestClaudeArtifactsFromSubagentsAndAnOlderPublishReadLater` | ported | |
| 221 | `test_parsers.py:497` `test_claude_and_codex_sessions_without_publishes_have_no_artifacts` | 6 | `internal/claudecode` `TestClaudeSessionsWithoutPublishesHaveNoArtifacts` | ported | Claude half; Codex half (Task 7): `internal/codex` `TestCodexSessionsWithoutPublishesHaveNoArtifacts` |
| 222 | `test_plan_judge.py:37` `test_days_to_judge_is_today_then_yesterday_in_tokyo` | 8 | `internal/planjudge` `TestDaysToJudgeIsTodayThenYesterdayInTokyo` | ported | |
| 223 | `test_plan_judge.py:42` `test_prompt_carries_items_sessions_and_the_rules` | 8 | `internal/planjudge` `TestPromptCarriesItemsSessionsAndTheRules` | ported | |
| 224 | `test_plan_judge.py:48` `test_prompt_judges_against_the_days_detail_not_the_title` | 8 | `internal/planjudge` `TestPromptJudgesAgainstTheDaysDetailNotTheTitle` | ported | |
| 225 | `test_plan_judge.py:55` `test_parse_strips_fences_and_prose_and_validates` | 8 | `internal/planjudge` `TestParseStripsFencesAndProseAndValidates` | ported | golden `TestParseOutputGolden` (15 cases) |
| 226 | `test_plan_judge.py:60` `test_parse_drops_unknown_items_and_bad_rows_but_keeps_good_ones` | 8 | `internal/planjudge` `TestParseDropsUnknownItemsAndBadRowsButKeepsGoodOnes` | ported | |
| 227 | `test_plan_judge.py:71` `test_parse_tolerates_unhashable_id_and_status` | 8 | `internal/planjudge` `TestParseToleratesUnhashableIDAndStatus` | ported | |
| 228 | `test_plan_judge.py:78` `test_parse_fills_missing_optional_fields_and_truncates` | 8 | `internal/planjudge` `TestParseFillsMissingOptionalFieldsAndTruncates` | ported | |
| 229 | `test_plan_judge.py:83` `test_stores_a_judgement_with_the_input_fingerprint` | 8 | `internal/planjudge` `TestStoresAJudgementWithTheInputFingerprint` | ported | golden `TestRunGolden` (11 runs) |
| 230 | `test_plan_judge.py:91` `test_skips_when_nothing_changed_unless_forced` | 8 | `internal/planjudge` `TestSkipsWhenNothingChangedUnlessForced` | ported | |
| 231 | `test_plan_judge.py:98` `test_no_plan_no_items_and_unreachable` | 8 | `internal/planjudge` `TestNoPlanNoItemsAndUnreachable` | ported | |
| 232 | `test_plan_judge.py:104` `test_llm_failure_and_bad_output_write_nothing` | 8 | `internal/planjudge` `TestLLMFailureAndBadOutputWriteNothing` | ported | |
| 233 | `test_plan_judge.py:111` `test_server_outcomes_pass_through` | 8 | `internal/planjudge` `TestServerOutcomesPassThrough` | ported | |
| 234 | `test_plan_judge.py:117` `test_runner_exception_is_llm_failed` | 8 | `internal/planjudge` `TestRunnerExceptionIsLLMFailed` | ported | input shapes Python raises on: `TestInputShapesPythonRaisesOnPanicWithItsMessage` |
| 235 | `test_review.py:10` `test_previous_week_is_the_tokyo_iso_week_before_this_one` | 8 | `internal/review` `TestPreviousWeekIsTheTokyoISOWeekBeforeThisOne` | ported | |
| 236 | `test_review.py:17` `test_week_bounds_round_trips` | 8 | `internal/review` `TestWeekBoundsRoundTrips` | ported | plus fromisocalendar range checks and D6 spellings |
| 237 | `test_review.py:21` `test_prompt_carries_stats_and_last_review_but_no_transcripts` | 8 | `internal/review` `TestPromptCarriesStatsAndLastReviewButNoTranscripts` | ported | golden `TestRunGolden` review_build_prompt |
| 238 | `test_review.py:56` `test_skips_a_week_that_already_has_a_review` | 8 | `internal/review` `TestSkipsAWeekThatAlreadyHasAReview` | ported | |
| 239 | `test_review.py:62` `test_generates_and_stores_with_the_stats_it_used` | 8 | `internal/review` `TestGeneratesAndStoresWithTheStatsItUsed` | ported | golden `TestRunGolden` (13 runs; stats_json and stdin byte-for-byte) |
| 240 | `test_review.py:71` `test_hint_params_are_dropped_before_the_prompt_and_stats_json` | 8 | `internal/review` `TestHintParamsAreDroppedBeforeThePromptAndStatsJSON` | ported | |
| 241 | `test_review.py:89` `test_force_regenerates_an_existing_week` | 8 | `internal/review` `TestForceRegeneratesAnExistingWeek` | ported | with the server keeping the old review (stored=false) |
| 242 | `test_review.py:95` `test_an_empty_week_is_not_reviewed` | 8 | `internal/review` `TestAnEmptyWeekIsNotReviewed` | ported | |
| 243 | `test_review.py:100` `test_failures_are_reported_not_raised` | 8 | `internal/review` `TestFailuresAreReportedNotRaised` | ported | |
| 244 | `test_review.py:122` `test_digest_labels_hours_weekdays_and_dates_and_drops_the_matrix` | 8 | `internal/review` `TestDigestLabelsHoursWeekdaysAndDatesAndDropsTheMatrix` | ported | golden `TestDigestRhythmGolden` (14 cases, indent=1 text byte-for-byte) |
| 245 | `test_review.py:140` `test_digest_work_ranges_merge_consecutive_hours_only` | 8 | `internal/review` `TestDigestWorkRangesMergeConsecutiveHoursOnly` | ported | |
| 246 | `test_review.py:145` `test_digest_survives_a_missing_or_malformed_heatmap` | 8 | `internal/review` `TestDigestSurvivesAMissingOrMalformedHeatmap` | ported | |
| 247 | `test_review.py:151` `test_run_review_sends_the_digest_instead_of_the_heatmap_in_prompt_and_stats_json` | 8 | `internal/review` `TestRunReviewSendsTheDigestInsteadOfTheHeatmapInPromptAndStatsJSON` | ported | |
| 248 | `test_review.py:167` `test_instruction_pins_how_to_talk_about_time_of_day` | 8 | `internal/review` `TestInstructionPinsHowToTalkAboutTimeOfDay` | ported | |
| 249 | `test_tokens.py:36` `test_normalize_model_strips_date_and_bracket_suffixes` | 5 | `internal/tokens` `TestNormalizeModelGolden` | ported | all 4 parametrized cases are in `golden/tokens.json` |
| 250 | `test_tokens.py:40` `test_price_for_matches_the_id_exactly_once_suffixes_are_stripped` | 5 | `internal/tokens` `TestPriceForMatchesTheIDExactlyOnceSuffixesAreStripped` | ported | |
| 251 | `test_tokens.py:52` `test_an_unlisted_claude_model_makes_the_cost_partial` | 5 | `internal/tokens` `TestAnUnlistedClaudeModelMakesTheCostPartial` | ported | |
| 252 | `test_tokens.py:59` `test_fast_mode_only_matches_a_fast_price` | 5 | `internal/tokens` `TestFastModeOnlyMatchesAFastPrice` | ported | |
| 253 | `test_tokens.py:66` `test_pricing_table_is_the_one_in_the_plan` | 5 | `internal/tokens` `TestPricingTableIsTheOneInThePlan` | ported | also asserts `config.toml` [pricing] == `config.example.toml` |
| 254 | `test_tokens.py:90` `test_with_cost_prices_every_billed_field_but_not_reasoning` | 5 | `internal/tokens` `TestWithCostPricesEveryBilledFieldButNotReasoning` | ported | |
| 255 | `test_tokens.py:99` `test_with_cost_is_partial_with_an_unpriced_model_and_null_when_nothing_is_priced` | 5 | `internal/tokens` `TestWithCostIsPartialWithAnUnpricedModelAndNullWhenNothingIsPriced` | ported | |
| 256 | `test_tokens.py:110` `test_with_cost_prices_codex_cached_input_and_cache_writes` | 5 | `internal/tokens` `TestWithCostPricesCodexCachedInputAndCacheWrites` | ported | |
| 257 | `test_tokens.py:118` `test_with_cost_of_nothing` | 5 | `internal/tokens` `TestWithCostOfNothing` | ported | |
| 258 | `test_tokens.py:126` `test_with_cost_is_partial_when_a_price_leaves_a_used_field_out` | 5 | `internal/tokens` `TestWithCostIsPartialWhenAPriceLeavesAUsedFieldOut` | ported | |
| 259 | `test_tokens.py:160` `test_claude_counts_a_response_once_however_many_records_repeat_its_id` | 6 | `internal/claudecode` `TestClaudeCountsAResponseOnceHoweverManyRecordsRepeatItsID` | ported | first position kept: `TestResponsesKeepTheirFirstPositionAndNoIDCountsLast` |
| 260 | `test_tokens.py:170` `test_claude_takes_the_last_record_of_a_response_streamed_into_a_subagent_log` | 6 | `internal/claudecode` `TestClaudeTakesTheLastRecordOfAResponseStreamedIntoASubagentLog` | ported | |
| 261 | `test_tokens.py:182` `test_claude_a_resumed_subagent_replaying_an_earlier_snapshot_does_not_undo_the_final_count` | 6 | `internal/claudecode` `TestClaudeAResumedSubagentReplayingAnEarlierSnapshotDoesNotUndoTheFinalCount` | ported | (mtime, name) order: `TestSubagentLogsAreReadInMtimeThenNameOrder` |
| 262 | `test_tokens.py:201` `test_claude_splits_cache_writes_into_5m_and_1h` | 6 | `internal/claudecode` `TestClaudeSplitsCacheWritesInto5mAnd1h` | ported | |
| 263 | `test_tokens.py:214` `test_claude_inline_sidechain_and_subagent_logs_are_subagent_usage` | 6 | `internal/claudecode` `TestClaudeInlineSidechainAndSubagentLogsAreSubagentUsage` | ported | |
| 264 | `test_tokens.py:231` `test_claude_workflow_subagents_count_for_mtime_and_files_written` | 6 | `internal/claudecode` `TestClaudeWorkflowSubagentsCountForMtimeAndFilesWritten` | ported | |
| 265 | `test_tokens.py:244` `test_claude_advisor_iterations_are_counted_on_their_own_model` | 6 | `internal/claudecode` `TestClaudeAdvisorIterationsAreCountedOnTheirOwnModel` | ported | |
| 266 | `test_tokens.py:266` `test_fast_mode_cache_usage_has_no_price_so_the_cost_is_partial` | 6 | `internal/claudecode` `TestFastModeCacheUsageHasNoPriceSoTheCostIsPartial` | ported | `tokens.WithCost` with `golden/tokens.json` pricing_example |
| 267 | `test_tokens.py:273` `test_claude_fast_mode_is_its_own_model_and_synthetic_turns_are_skipped` | 6 | `internal/claudecode` `TestClaudeFastModeIsItsOwnModelAndSyntheticTurnsAreSkipped` | ported | |
| 268 | `test_tokens.py:285` `test_claude_tokens_do_not_change_text_or_turns` | 6 | `internal/claudecode` `TestClaudeTokensDoNotChangeTextOrTurns` | ported | |
| 269 | `test_tokens.py:339` `test_codex_counts_each_request_under_its_model_with_uncached_input` | 7 | `internal/codex` `TestCodexCountsEachRequestUnderItsModelWithUncachedInput` | ported | re-emission is dict equality: `TestRepeatedTotalsCompareLikePythonDicts` |
| 270 | `test_tokens.py:350` `test_codex_counter_restart_does_not_lose_the_first_run` | 7 | `internal/codex` `TestCodexCounterRestartDoesNotLoseTheFirstRun` | ported | |
| 271 | `test_tokens.py:359` `test_codex_uncached_input_never_goes_negative` | 7 | `internal/codex` `TestCodexUncachedInputNeverGoesNegative` | ported | |
| 272 | `test_tokens.py:365` `test_codex_without_token_counts_is_unknown_not_zero` | 7 | `internal/codex` `TestCodexWithoutTokenCountsIsUnknownNotZero` | ported | |
| 273 | `test_tokens.py:384` `test_codex_fork_usage_is_the_parent_sessions_subagent_usage` | 7 | `internal/codex` `TestCodexForkUsageIsTheParentSessionsSubagentUsage` | ported | fork order: `TestForksAttachInPathOrder` |
| 274 | `test_tokens.py:404` `test_codex_fork_counts_once_when_archived_and_still_in_sessions` | 7 | `internal/codex` `TestCodexForkCountsOnceWhenArchivedAndStillInSessions` | ported | |
| 275 | `test_tokens.py:412` `test_codex_fork_mtime_is_the_parents` | 7 | `internal/codex` `TestCodexForkMtimeIsTheParents` | ported | |
| 276 | `test_tokens.py:424` `test_claude_iter_sessions_never_parses_a_workflow_transcript_as_a_session` | 6 | `internal/claudecode` `TestClaudeIterSessionsNeverParsesAWorkflowTranscriptAsASession` | ported | `parseFile` seam stands in for monkeypatch |
| 277 | `test_api_client.py:592` `test_heartbeat_posts_machine_and_counts` | 2 | `internal/api` `TestHeartbeatPostsMachineAndCounts` | ported |  |
| 278 | `test_api_client.py:600` `test_heartbeat_is_never_parked` | 2 | `internal/api` `TestHeartbeatIsNeverParked` | ported |  |
| 279 | `test_cli_api.py:447` `test_harvest_sends_one_heartbeat_after_collecting` | 2 | `internal/cli` `TestCLITranscripts/harvest` | merged | the transcript replay asserts the one `POST /api/ingest/heartbeat` (machine, new, updated) after the ingest, in request order |
| 280 | `test_cli_api.py:455` `test_harvest_warns_but_succeeds_when_the_heartbeat_fails` | 2 | `internal/cli` `TestCLITranscripts/harvest_heartbeat_refused` | merged | exit 0 and `worklog: heartbeat not sent (retry)` on stderr |
| 281 | `test_cli_api.py:463` `test_harvest_sends_no_heartbeat_when_the_server_tasks_cannot_be_read` | 2 | `internal/cli` `TestCLITranscripts/harvest_unreachable` | merged | exit 2 before the beat: the transcript's request list has no heartbeat |
| 282 | `test_cli_api.py:470` `test_harvest_refresh_meta_sends_no_heartbeat` | 2 | `internal/cli` `TestCLITranscripts/harvest_refresh_meta` | merged | `--refresh-meta` returns before the beat: the transcript's request list has no heartbeat |

## Notes

### Spec §6 divergent rows → where each is tested

| Row | Input | Covered by |
|---|---|---|
| D1 | log not valid UTF-8 | `testdata/logs/divergent/D1/` (Python: `UnicodeDecodeError`, `golden/divergent.json`); Go parser tests, Tasks 6/7; Task 6: `internal/claudecode` `TestD1InvalidUTF8IsSkippedWithOneWarning` (warning text carries Python's decode message); `internal/logparse` `TestUTF8ErrorTextIsPythons` (moved from claudecode, Task 7 fix round 1); Task 7: `internal/codex` `TestD1InvalidUTF8IsSkippedWithOneWarning`, `TestD1InAForkLog`, golden `TestParsersGoldenFiles` |
| D2 | Codex `_first_meta` on invalid UTF-8 | `testdata/logs/divergent/D2/` (`UnicodeDecodeError` from `codex.iter_sessions`); Task 7: `internal/codex` `TestD2BadBytesBeforeTheMetaIsReadSkipTheFileWithOneWarning`, `TestFirstMetaDecodesInPythonsChunks` (Python's 8192-byte chunks), golden `TestParsersGoldenIter` (one warning in every `since` variant) |
| D3 | naive and aware timestamps mixed | `testdata/logs/divergent/D3/` (parses; `TypeError` in harvest); Tasks 5/6; Task 6: `internal/claudecode` `TestD3MixedOffsetsWarnOnceAndParseUnchanged`; Task 7: `internal/codex` `TestD3MixedOffsetsWarnOnceAndParseUnchanged` |
| D4 | token count `int()` rejects | `testdata/logs/divergent/D4/` (`ValueError`); `golden/tokens.json` → `to_int` lists accepted and rejected forms; Tasks 5/6; Task 6: `internal/claudecode` `TestD4BadTokenCountIsZeroWithOneWarning`; Task 7: `internal/codex` `TestD4BadTokenCountIsZeroWithOneWarning`, `TestD4InAForkNamesTheFork`; beyond int64 (Task 12 A1): `internal/claudecode` and `internal/codex` `TestBigIntegersKeepTheRecord`, `internal/session` `TestToIntBigInt`, `internal/model` `TestDecodeTaskLax` (schema_version) |
| D5 | malformed `config.toml` | `internal/config` `TestMalformedConfigIsOneLine` (`golden/config.json` → `malformed` records Python's `TOMLDecodeError`) |
| D6 | rarer ISO date/week forms | Tasks 3 (`pytime.ParseDate`) and 10; `golden/datetime.json` → `dates` records what Python accepts; Task 10: `internal/cli` `TestD6OnlyTheCommonISOFormsAreAccepted` (`--date`/`--week` exit 2, `--received` exit 1 via D13), `TestCLITranscripts/plan_judge_compact_date` (YYYYMMDD accepted, as Python). Related, not yet a D-row: int/float options take ASCII digits only (followups.md, Task 10) |
| D7 | `claude.cmd` only on Windows PATH | Task 8: `internal/llm` `TestD7ClaudeCmdIsFoundViaPATHEXT` (runs on the Windows CI runner; skipped elsewhere) |
| D8 | help / usage text | Task 10; `golden/cli_transcripts.json` keeps only the exit code (`unknown_command`, `done_negative_hours`): `internal/cli` `TestCLITranscripts` (exit 2, stderr non-empty, no request), `TestUsageErrorsExit2BeforeTheConfigIsRead` (23 click usage errors, exit 2), `TestHelpIsPrintedAndExits0WithoutTheConfig` |
| D9 | `harvest_state.json` written atomically | Task 9: `internal/harvest` `TestD9SaveStateIsAtomic` (replaced by rename: a hard link to the old file keeps the old content, no temp file left), `TestD9FailedSaveKeepsTheOldState` |
| D10 | legacy `data/.harvest_state.json` move dropped | Task 9: `internal/harvest` `TestD10LegacyStateFileIsIgnored` (rows 165/166 dropped) |
| D11 | timestamp `fromisoformat` rejects | `testdata/logs/divergent/D11/` (`ValueError`); Task 6: `internal/claudecode` `TestD11AndD12DropTheRecordWithOneWarning`, `TestArtifactWithAnUnreadableTimestampIsDropped`; Task 7: `internal/codex` `TestD11AndD12DropTheRecordWithOneWarning` |
| D12 | timestamp truthy but not a string | `testdata/logs/divergent/D12/` (`AttributeError`); Task 6: `internal/claudecode` `TestD11AndD12DropTheRecordWithOneWarning`, `TestBadTimestampsWarnOncePerFileAndFalsyOnesAreSilent`; Task 7: `internal/codex` `TestD11AndD12DropTheRecordWithOneWarning` |
| D13 | `wl new --received` not a date | Task 10; `golden/cli_transcripts.json` → `new_bad_received` (exit 1, last traceback line): `internal/cli` `TestCLITranscripts/new_bad_received` (exit 1, the one line, no request), `TestD13ReceivedIsCheckedAfterConfigAndClient` (after the requester warnings; config/credentials errors win; empty = today) |
| D14 | outbox file valid JSON but not an object | Task 4 and the harness's `outbox-cross` scenario; `golden/cli_transcripts.json` → `harvest_outbox_non_object` (Python: `TypeError`, exit 1); Task 10: `internal/cli` `TestCLITranscripts/harvest_outbox_non_object` (the file moves to `rejected/` unchanged, `outbox: sent=2 remaining=0`, the harvest then runs as `harvest_flushes_outbox`, exit 0) |
| D15 | UTC offset with a fraction of a second | Task 2 `pytime` `TestFromISOEdges` (FromISO errors); the drop + warning in Task 6 with D11: `internal/claudecode` `TestBadTimestampsWarnOncePerFileAndFalsyOnesAreSilent`; Task 7: `internal/codex` `TestD11AndD12DropTheRecordWithOneWarning` (its D15 case) |
| D16 | OS proxy settings not read (env vars are) | Task 4 `internal/api` `TestEnvProxyMatchesHTTPX` (env side, against httpx); OS side checked on Win11 in Task 14 C5 |
| D17 | record shape the parser cannot handle (catch-all) | Task 6: `internal/claudecode` `TestD17ShapesWarnOncePerFileAndAreOtherwiseIgnored` (11 shapes, each confirmed against `.venv` Python), `TestD17InASubagentLogNamesThatLog`; Task 7 (Codex sites): `internal/codex` `TestD17ShapesWarnOncePerFileAndAreOtherwiseIgnored` (10 shapes), `TestD17IterSites` (4 iter_sessions sites), each confirmed against `.venv` Python |
| D18 | TOML 1.1 forms tomllib rejects; `[pricing]` / `min_active_minutes` coercion | Task 12: `internal/config` `TestD18TOMLAndCoercion` (BOM, inline-table newline and `\e` load; `"15"`, `true` rates and Unicode-digit `min_active_minutes` are errors), `TestNonFinitePricingIsAnError` (A7: nan/inf rates, exit-1 config error) |
| D19 | (tiered) a log whose combined mtime equals its bookmark is skipped before the parse; its warnings print only when it is parsed | Tiered plan Task 2: `internal/claudecode` and `internal/codex` `TestKeepFalseNeverParses`, `TestKeepReceivesTheCombinedMtimeThatRawSessionCarries`, `TestAKeepRejectedLogPrintsNoParseWarning`, `TestIterSessionsFilteredZeroFilterYieldsExactlyIterSessions`; `internal/codex` `TestCodexSkippedRolloutStillDedupesItsArchivedCopy`, `TestSkipNamesTheMetaIDBySessionIDOrID`; Task 3a–3c: `internal/harvest` `TestStatSkipComparesTheBookmarkNotTheIndex`, `TestSecondTieredRunOnAnUnchangedCorpusParsesNothingAndCallsNothing`, `TestPythonSeedThenTieredThenTieredParsesNothing`, `TestRescanIgnoresTheIndexPrunesAndRotatesTheLog`; Task 5: parity `handoff-tiered` case 1 (second run `parsed=0`) |
| D20 | (tiered) a log with no session id, or an excluded cwd, is skipped before the parse until its mtime moves | Tiered plan Task 2: `internal/claudecode` and `internal/codex` `TestEmptyIsCalledForAKeptLogThatYieldsNoSession`; `internal/codex` `TestASeenArchivedCopyIsReportedToEmpty`; Task 3c: `internal/harvest` `TestNoneAndExcludedFilesAreSkippedUntilTheyChange` |
| D21 | (tiered) fingerprint moved, summarizer input did not: re-sent with the cached summary (R2) | Tiered plan Task 3a: `internal/harvest` `TestR2TokensOnlyChangeIsResentWithTheCachedSummaryAndNoCall`, `TestR0UnchangedFingerprintOnlyMovesTheBookmark` |
| D22 | (tiered) summarizer input moved: refreshed after ≥60 min or ≥30 min stopped (R3), re-sent before (R4), a failed refresh keeps the llm summary (R3f) | Tiered plan Task 3b: `internal/harvest` `TestR3ActiveSessionIsRefreshedOnlyAfter60Minutes`, `TestR3StoppedSessionIsRefreshedOnceFromTheRefreshSetWithoutALogChange`, `TestR4StaleSummaryIsResentUntilRefreshDue`, `TestR3fFailedRefreshKeepsAndSendsTheCachedLlmSummary`, `TestRefreshQueueReparseEqualsThePassRecord`; Task 5: `measure-tiered.sh` A3 (3 changed logs, 0 calls, previous summaries) |
| D23 | (tiered) a fallback whose log never moves again is retried on the backoff (R5), one from before tiering adopted (R7) | Tiered plan Task 3b: `internal/harvest` `TestR5FallbackIsRetriedOnBackoffWithoutAnyMtimeChange`, `TestR6FallbackWithinBackoffIsResentWithoutACall`, `TestR7PreTieringFallbackBookmarkIsAdoptedAndRetriedOnce`, `TestTrivialFpLessBookmarkIsNotAdopted`, `TestR1FallbackStartsTriesAtOne`; Task 5: parity `handoff-tiered` case 1 (one call per fp-less fallback of the Python seed) |
| D24 | (tiered) review, plan judge and deliverable judge run per bucket | Tiered plan Task 4: `internal/harvest` `TestBucketsAreJST`, `TestDueJobsAfterSleepFiresEachChangedBucketOnce`, `TestRecordTable`, `TestRecordRulesPerResult`, `TestReviewLlmFailedRetriesAtTheNextHourNotTheNextRun`, `TestSideJobsAllDuePrintsTodaysLinesInTodaysOrder`, `TestSideJobsRunOnlyTheDueJobs`; `internal/cli` `TestTwoSeparateTieredProcessesInOneHourJudgeThePlanOnce` |
| D25 | (both modes) two harvests at once: the second exits on the lock, 0 tiered, 2 manual | Tiered plan Task 4: `internal/harvest` `TestLockHeldByALivePidIsRespected`, `TestLockOfADeadPidOrOlderThan60MinIsReplaced`, `TestStaleLockRaceOnlyOneWinner`, `TestAcquireOtherErrorIsReturnedWithANoopRelease`, `TestPidAlive`; `internal/cli` `TestHarvestWhileLockedExits0TieredAnd2ManualWithoutHeartbeat`, `TestLockIsTakenBeforeTheOutboxFlush`, `TestLockIsReleasedWhenHarvestPanics`, `TestAcquireOtherErrorWarnsAndContinues` |
| D26 | (tiered) `, unassigned=N` only when `Due.Hour` | Tiered plan Task 4: `internal/cli` `TestHarvestTieredSkipsTheTimelineGetWhenNoHourChanged` |
| D27 | (tiered) the `tiers:` stderr line, `tiers.jsonl`, and `fallback=` counting attempts that fell back | Tiered plan Task 3c/4: `internal/harvest` `TestTiersCountersSplitNewBootstrapReusedRefreshedFailedAdopted`, `TestFallbackCountIsAttemptsThatFellBackNotReSends`, `TestTieredFallbackCountIsAttemptOutcomeFullModeUnchanged`, `TestDecisionLogHasOneLinePerSessionDecision`; `internal/cli` `TestHarvestTieredPrintsTheTiersLine`; Task 5: parity README normalisation 19 (the line is removed before pairing; `handoff-tiered` case 1 reads it) |
