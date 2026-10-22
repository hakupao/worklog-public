# API reference

Every route the Worker (`server/src/index.ts`) serves under `/api`. The web UI and the `wl` CLI are its only
clients; there is no stability promise beyond what those two need.

## Conventions

- **Auth.** Everything except `GET /api/health` goes through `server/src/auth.ts`:
  - a `Cf-Access-Jwt-Assertion` header (added by Cloudflare Access for a browser session or a service token) is
    verified against `TEAM_DOMAIN` / `POLICY_AUD`. A JWT that does not verify is a `401`; there is no fallback;
  - otherwise `Authorization: Bearer <API_TOKEN>` is required.
  - The CLI sends the bearer token and, when configured, `CF-Access-Client-Id` / `CF-Access-Client-Secret`.
- **Language.** Routes that return user text localize it to the `X-Lang` request header (`zh` / `ja` / `en`); without
  the header the original text is returned. File downloads take `?lang=` instead (default `ja`).
- **Optimistic locking.** `PATCH` bodies carry the row's current `updated_at`. `DELETE` takes it as `?updated_at=`. A
  stale value returns `409 {"error":"conflict","current":…}`.
- **Validation errors** are `400 {"error":"invalid","issues":[…]}` unless noted.
- **Weeks** look like `2026-W39`; dates are `YYYY-MM-DD` in Tokyo time (JST).

## Meta

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness check. The only unauthenticated route. |
| GET | `/api/me` | The caller's identity: `token`, an Access user (email) or an Access service token (name). |
| GET | `/api/stats` | Row counts of tasks, sessions and notes. |
| GET | `/api/machines` | Machine names and when each last reported. |
| GET | `/api/machines/runs` | 24 hourly slots per machine: whether a harvest heartbeat arrived in each. |
| GET | `/api/requesters` | Distinct requesters (依頼元) seen so far. |
| GET / PUT | `/api/prefs` | UI settings shared by every browser. PUT replaces the whole object (last write wins). |

## Tasks (案件) and notes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/tasks` | Task list. `?status=open,hold` filters by status. |
| GET | `/api/tasks/totals` | Every task's total minutes and the last day anything happened on it. |
| POST | `/api/tasks` | Create a task. The server allocates the id from the received date (`T20260918-01`). |
| GET | `/api/tasks/:id` | Task detail: linked sessions and notes, total minutes, auto-detected deliverables (`auto_deliverables`). |
| PUT | `/api/tasks/:id` | Replace the whole row, no version check (the CLI's write-back). |
| PATCH | `/api/tasks/:id` | Partial update with the `updated_at` lock. |
| DELETE | `/api/tasks/:id?updated_at=…` | Delete a task. Never cascades, see below. |
| POST | `/api/notes` | Create a note. |
| PUT | `/api/notes/:id` | Replace a note. |
| PATCH | `/api/notes/:id` | Partial update with the `updated_at` lock. |
| DELETE | `/api/notes/:id?updated_at=…` | Delete a note. |
| PUT | `/api/deliverable-verdicts` | Mark one auto-detected deliverable out (×) or in (＋): `{key, kind, verdict}`. The user's verdict wins over the model's and the rules'. |
| POST | `/api/i18n/pin` | Undo or restore input polishing for one field: `{entity, entity_id, field, pinned}`. Only the translation layer changes; the row and its `updated_at` are untouched. |

`DELETE /api/tasks/:id` answers:

- `204`, no body: deleted. The task's hand-edited report cells (`report_overrides`) are removed with it, because task
  ids are reused.
- `409 {"error":"linked","sessions":N,"notes":M,"plans":P}`: sessions, notes, plan items or day-plan items still
  point at the task. Unlink them first.
- `409 {"error":"conflict","current":…}`: `updated_at` is stale.
- `404`: no such task.

## Sessions and the timeline

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/sessions?unlinked=1` | Visible sessions with no task (or whose task no longer exists), across all weeks. Only `unlinked=1` is supported. |
| PATCH | `/api/sessions/:id` | Edit the summary, minutes, hidden flag or linked task. A link made by hand is never overwritten by the collector. |
| GET | `/api/weeks/:week/timeline` | One week's timeline. `?include_hidden=1` includes hidden sessions. |

## Collector ingest

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ingest/sessions` | Batch upload of harvested sessions, including published Artifacts. |
| POST | `/api/ingest/session-meta` | `wl harvest --refresh-meta`: update files written, token usage and cost of existing sessions. |
| POST | `/api/ingest/session-files` | Older form of `session-meta` (files written only), kept for collectors that have not been updated. |
| POST | `/api/ingest/heartbeat` | One per successful harvest run: `{machine, new, updated}`. |
| GET | `/api/ingest/deliverables/pending?machine=&limit=` | Files this machine's sessions wrote that the rules could not decide and nobody has judged yet (at most 200). |
| POST | `/api/ingest/deliverables/verdicts` | The collector's model verdicts. Existing verdicts are not overwritten. |

## Plans (计划 / 今日安排)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/plan-items` | Active plan items. `?status=closed` lists the latest 100 closed ones instead. |
| POST | `/api/plan-items` | Create a plan item (may link several tasks). |
| PATCH | `/api/plan-items/:id` | Update a plan item with the `updated_at` lock. |
| GET | `/api/day-plans/:date` | The day plan and its items, with the model's verdicts. `404` when the day has no plan. |
| POST | `/api/day-plans/:date/start` | Start the day: draft it from the daily items in effect and the unfinished items of the latest earlier plan. `409` if it exists. |
| POST | `/api/day-plans/:date/items` | Add an item to a day plan. |
| PATCH | `/api/day-plan-items/:id` | Update a day-plan item with the `updated_at` lock. |
| DELETE | `/api/day-plan-items/:id?updated_at=…` | Delete a day-plan item. |
| GET | `/api/day-plans/:date/judge-input` | Input and fingerprint for the collector's plan judge (`wl plan judge`). |
| POST | `/api/day-plans/:date/judgement` | Store the model's verdicts. Rejected when the fingerprint no longer matches the current input. |

## Statistics and weekly review

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard?from=&to=` | Dashboard figures and rule-based hints for a date range. |
| GET | `/api/stats/sessions?from=&to=` | Per-session rows for the statistics views. Both parameters are required. |
| GET | `/api/reviews?limit=` | The latest weekly AI reviews (default 8, at most 52). |
| GET | `/api/reviews/:week` | One week's review. `404` when there is none. |
| POST | `/api/reviews` | Store a review written by `wl review`. Without `force`, an existing review is kept. |

## Weekly report (週報)

`:template` is always `weekly`; the old names `agency` and `site` are aliases of it.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/reports/:week/:template` | Report preview: every sheet, plus a warning about unlinked sessions. |
| PUT | `/api/reports/:week/:template/cells` | Save hand-edited cell values. |
| DELETE | `/api/reports/:week/:template/cells` | Drop hand edits and return to the computed values. |
| GET | `/api/reports/:week/:template/xlsx?lang=` | Single-week workbook `<week>-<lang>.xlsx`. |
| GET | `/api/reports/range/bounds` | `{first, last}`: the report week of the earliest visible session or note (`null` if none) and the current report week. |
| GET | `/api/reports/range/xlsx?from=&to=&lang=` | Cross-week workbook `<from>_<to>-<lang>.xlsx`, at most 52 weeks, without hand-edited cells. `400` with `invalid week`, `from after to`, `too many weeks` or `invalid lang`. Marks every week in the range as downloaded. |
| GET | `/api/report-downloads?week=` | When the week's report was downloaded. |
| GET | `/api/reports/:week/pdf?lang=` | One A4 page `<week>-<lang>.pdf`, rendered by Browser Run; ignores hand-edited cells. `503` with `Retry-After` while the browser is busy. |
| GET / PUT | `/api/reports/:week/pdf/compose` | The PDF composition (which tasks get their own row, which go to その他 or are hidden, and their order). GET falls back to the latest earlier week; PUT uses the `updated_at` lock. |
| POST | `/api/reports/:week/pdf/compose/generate` | Write the trilingual PDF text from the composition in one model call (about 20–40 s, 3-minute lock). |
| PUT | `/api/reports/:week/pdf/compose/text` | Hand-edit one language; the other two are re-translated before the response. `409` while generating. |
| POST | `/api/reports/:week/pdf/preview?lang=` | HTML of a draft composition's PDF, without calling Browser Run. |
| PATCH | `/api/reports/:week/digests/:day` | Hand-edit a digest (`:day` is a date or `week`; `week` also takes `oneliner`), or `{"regenerate":true}` to hand it back. The response's `auto: false` means it was only marked for regeneration. |
| GET | `/api/reports/:week/digest-inputs` | For `scripts/digests-local.mjs`: each workday's and the week's input, fingerprint and state, plus prompts, JSON schema, length caps and task names in three languages. |
| PUT | `/api/reports/:week/digests/:day/generated` | Write back a locally generated digest and its translations (optionally `oneliner`, or `oneliner_only`). `409 stale` if the input changed, `409 edited` if hand-edited meanwhile, `404 no_input` if there is nothing to digest. |
