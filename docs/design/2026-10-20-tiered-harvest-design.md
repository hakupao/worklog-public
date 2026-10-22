# Tiered harvest for the Go collector — design

Date: 2026-10-20, revised the same day after critic review (REVISE: B1–B3, S1–S10, nits).

Status: **decided**. On 2026-10-20 the user accepted the recommendation for all of O1–O11 (§7), and accepted the S1
fix: when a refresh falls back, the cached `llm` summary is kept.

Plan: `docs/plans/2026-10-20-tiered-harvest.md`.

Base: `main` at `5ff93ac`. The Go collector is the one described in
`docs/design/2026-10-12-go-collector-design.md` (below: "the Go spec").

Implementation starts only after the **Mac part** of the A4 soak check passes.

## 1. Why

Measured on the Mac on 10/19: `bin/wl harvest` takes **17.8–20.4 s wall, 6–7 s user CPU and ~290 MB RSS** per
hourly run. Read from the code on 10/20, the time goes to three places.

**Parsing before the bookmark check.**
- `harvest.scan` calls `claudecode.IterSessions`, which stats each log for the 14-day `since` window and then calls
  `parseFile` on every log in the window.
- Only after that does `harvest.Run` compare `Bookmark.Mtime` (`internal/harvest/harvest.go`, the
  `prev.Mtime == raw.Mtime` check).
- On 10/20 the window held **97 parent logs plus their subagent transcripts: 1,140 `.jsonl` files, about 540 MB**.
  All of it is read and decoded on every run. Only 12 of the 97 parent logs had changed in the last hour.

**Re-summarizing active sessions on every run.**
- The fingerprint (Go spec §5.3) includes the message count.
- So any session that gained a turn since the last run goes to `claude -p` again (90 s timeout, 4 workers).

**Side jobs on every run** (`harvest.SideJobs`):
- the weekly review check (`GET review`; an LLM call only when the review is missing);
- the plan judge for today and yesterday (an LLM call whenever the server's fingerprint moved);
- the deliverable judge (an LLM call while anything is pending).

Moving this to every 15 min would cost about 4× the CPU and about 4× the LLM calls.

The user's goals (10/19):
- an **idle run of about 1 s with 0 LLM calls**;
- **numbers (time, tokens, files) at most 15 min old**;
- no 4× LLM cost.

## 2. User decisions

### 2.1 Decisions of 2026-10-19 (final)

| # | Decision |
|---|---|
| T1 | **One scheduler** fires every 15 min: launchd on the Mac, later schtasks on Win11. The binary decides which tiers are due from per-tier last-run records in collector state. There are not several OS jobs. |
| T2 | **15-min tier**:<br>• flush the outbox;<br>• stat first: compare each log's mtime with its bookmark and parse only the logs that changed;<br>• send the numbers for changed sessions;<br>• summarize **new** sessions;<br>• send the heartbeat. |
| T3 | **1-h tier**:<br>• re-summarize an in-progress session at most hourly, plus once when the session stops (about 30 min idle). The user picked 「每小时 + 结束时」;<br>• the plan judge for today, hourly;<br>• the deliverable judge. |
| T4 | **1-day tier**: yesterday's final plan judge, and a full 14-day rescan as a safety net. |
| T5 | **1-week tier**: the weekly review, once. Today it is checked on every run. |
| T6 | **Go-only.** The change is registered as divergences: new D-rows go into Go spec §6. Win11 stays on Python under the feature freeze and gets this only after its own Go cutover. |

### 2.2 Decisions of 2026-10-20

| # | Decision |
|---|---|
| T7 | All recommendations O1–O11 (§7) are accepted. |
| T8 | **S1 fix accepted.** When a refresh or retry of a session that already has an `llm` summary falls back, the cached `llm` summary is kept and sent. Only `tries` moves (R3f). |
| T9 | **Win11's formal release tag `wl-v0.1.0` is published before this work merges to `main`** (plan Task 6). That keeps the Win11 cutover binary free of `--tiered`. |

## 3. Goals / non-goals

### 3.1 Goals

**G1. Idle cost.** An idle tiered run means no log changed and no tier other than 15 min is due. On the Mac it must:
- make 0 `claude` calls;
- take about 1 s wall;
- use ≤0.5 s user CPU.

**G2. Freshness.** A changed session's numbers reach the server within one 15-min interval.

**G3. LLM cost.** Per session:
- 1 summary when it first appears;
- at most 1 per hour while it is active;
- 1 when it stops.

A fallback summary is retried on a backoff even if its log never moves again.

**G4. Contract kept.**
- There is no server or API change. Bodies keep the `SessionIn` shape with every field.
- `harvest_state.json` keeps its meaning. A Python rollback or a later Win11 Python→Go hand-off re-summarizes nothing
  beyond what §5.11 says.

**G5. Parity kept.** `wl harvest` without the new flag behaves exactly as at `5ff93ac`, which is identical to Python at
`01ecf82`. The parity harness and every existing hand-off scenario keep passing.

### 3.2 Non-goals

- Win11.
- Server-side summary preservation (O1-B).
- 立即收集 (O10).
- Batching.
- Changing prompts, the fingerprint, or what is summarized.
- Changing the format of `harvest_state.json`.

The web **source** is not changed. `docs/guide/usage.md` is bundled into the web app through
`import usage from "…/usage.md?raw"` (`web/src/v2/pages/UsagePage.tsx:2`). Editing it therefore changes the web build,
and the merge to `main` makes Workers Builds redeploy the site.

## 4. Today's behaviour that this design relies on

Everything here was verified in the code on 10/20.

**The state key is `agent:sessionID`.**
- The ID comes only from parsing: Claude's first non-sidechain `sessionId`, or Codex's `session_meta`.
- Stat-first therefore needs a **path → key index** (§5.4).

**A session whose combined mtime equals its bookmark is skipped *without* rewriting the bookmark.**
- This is `res.Skipped++; return` in `harvest.Run`.
- So an index that is written "with the bookmark" would never learn these files (B2).

**Bookmarks are `{mtime, fp}`.**
- `fp` is absent for:
  - trivial sessions;
  - fallback summaries;
  - pre-fingerprint bookmarks.
- A fallback is retried **only when the log's mtime next moves** (`send()`, pinned by
  `TestAFallbackSummaryIsRetriedWhenTheLogNextMoves`). So a stopped session keeps its fallback forever.
- 10/19: 5 of 14 sessions ended with `summary_source='fallback'` after `claude -p failed`.
- 1,115 of the Mac's 1,234 bookmarks have no `fp`.

**These are never bookmarked**, so they are parsed again on every run:
- excluded-cwd sessions;
- logs without a session ID;
- rejected and lost sends. These are also re-summarized on every run.

**Codex sessions are put together inside `codex.IterSessions` only** (`codex.go:789-889`):
- the fork rollouts' tokens are added through `AddSubagent`;
- `RawSession.Mtime` is the max of the rollout's mtime and its forks' mtimes.

`codex.ParseFile` (`codex.go:769`) returns only the rollout's own tokens and its own mtime. Because the server's
`tokens = COALESCE(?17, sessions.tokens)` replaces the stored value, a record re-sent from `ParseFile` would overwrite
the forks' tokens (B1).

Two more details of the Codex loop:
- `firstMeta` reads the head of **every** rollout before any mtime filter (`codex.go:805`).
- Duplicate rollouts, the same session in both `sessions/` and `archived_sessions/`, are deduplicated by `seen[s.SessionID]`.
  That map is set only after a parse (`codex.go:878`).

**Claude** `ParseFile` merges subagent transcripts itself, and its `Mtime` is `combinedMtime`. So Claude re-parses
are already whole.

**The summarizer's input** is `summarize.Prompt(raw)`:
- each user text, cut to 500 code points;
- the last assistant text, cut to 1000;
- fixed text around them.

Token, file, link and artifact changes do not change it.

**The server** (`server/src/routes/ingest.ts`, `server/src/schemas.ts`):
- `UPSERT` sets `summary=excluded.summary` unconditionally.
- `SessionIn.summary` is a required `z.string()`, and the D1 column is `NOT NULL`.
- `summary_edited` is never touched.
- Every upsert bumps `updated_at`.
- Translations are keyed by `source_text` (`i18n/sweep.ts`), so the same text sent again queues nothing.

**The heartbeat** is sent once per run, and only after `Tasks()` succeeded. Its readers:
- `routes/meta.ts`: `hourSlots` and `last_run_at`, which feed the 首页 / 此刻 display;
- `docs/projects/2026-10-12-go-collector/evidence/a4/a4-runs.sql`: runs per JST day.

**Run order** (`cli/jobs.go`):
1. flush;
2. `Run` (GET tasks, parse, summarize, send);
3. heartbeat;
4. the stdout line (a GET of the timeline for `unassigned=`);
5. side jobs.

## 5. Design

### 5.1 Two modes

**Full mode: `wl harvest [--since N] [--claude-root …] [--codex-root …]`.**
- This is exactly today's flow. Every tier is due, logs are parsed in full, and today's summary rule applies.
- It adds two things the harness cannot see:
  - it maintains `collector_state.json` (§5.2), recording entries but never deciding from them;
  - it takes the lock (§5.9).

**Tiered mode: `wl harvest --tiered`.**
- Only the scheduler uses it.
- It runs the 15-min pass plus the jobs that are due (§5.3), checks mtimes before parsing (§5.4), and applies
  §5.5.
- `--tiered` together with `--refresh-meta` is a usage error, exit 2. `--since` still sets the window.

Rollback means taking `--tiered` out of the plist, plus the bookmark reset in §5.11.

### 5.2 Collector state: `<Home>/collector_state.json` (Go only)

`<Home>` is `cfg.Home`: `$WORKLOG_HOME`, or `~/.worklog`. The file sits next to `harvest_state.json`
(`config.StatePath`).

Python never reads it, and the parity differ reads only `harvest_state.json`. Writes use the same temp-file-plus-rename
as `SaveState` (D9), including the Windows retry. A missing, unreadable or unknown-`version` file reads as empty;
§5.11 gives the cost of that.

```jsonc
{
  "version": 1,
  "jobs": {                       // bucket ids (§5.3); absent = never
    "hour": "2026-10-20T14",      // the hour bucket of the last completed run (decides Due.Hour)
    "plan_today": "2026-10-20T14", "deliverables": "2026-10-20T14",
    "plan_yesterday": "2026-10-20", "rescan": "2026-10-20",
    "review": "2026-W43",         // done for this week
    "review_tried": "2026-10-20T14" // hour bucket of the last failed review attempt
  },
  "files": {                      // path index (§5.4)
    "/Users/…/abc.jsonl": { "key": "claude-code:abc…", "kind": "session", "mtime": 1760940000.123, "seen": 1760940900.0 }
  },
  "sessions": {                   // summary cache (§5.5)
    "claude-code:abc…": {
      "summary": "…", "source": "llm",   // what was last sent
      "pfp": "…",                        // digest of summarize.Prompt(raw) that summary was made from
      "cur_pfp": "…",                    // digest of summarize.Prompt(raw) at the last parse
      "at": 1760940000.0,                // when `summary` was produced (epoch s); 0 = due now (R7)
      "tried": 1760940000.0,             // last summarizer attempt (success or not)
      "tries": 0,                        // consecutive failed attempts since `at`
      "last_msg": 1760939000.0,          // session.EndedAt at the last parse, as epoch s; null if none
      "path": "/Users/…/abc.jsonl",
      "seen": 1760940900.0,              // last run that parsed or refreshed it (for pruning)
      "bm": { "mtime": 1760940000.123, "fp": "…" } // the harvest_state bookmark Go last wrote for this key
    }
  }
}
```

**Converting `last_msg` to epoch.** An aware instant converts as itself. A naive one, from an all-naive session, is read
as UTC. That is the same rule D3 uses for mixed sessions, and the value feeds only the 30-min stop test.

**The `bm` consistency check.**
- A cache entry is *valid* only while `harvest_state.json[key]` equals `entry.bm` exactly. Absent on both sides counts as
  equal.
- Go updates `bm` **every time it writes that key's bookmark, in either mode**:
  - a send;
  - R0;
  - an `fp`-equal bookmark move;
  - the R7 adoption, which writes no bookmark and therefore copies the existing one.
- If anything else wrote the bookmark, the entry is ignored and that session gets R1 once. "Anything else" includes a
  Python run after a rollback, a hand edit, and a crash between the two saves.

**Save points.**
1. Both files are saved at the end of phase 1 (parse, classify, bookmark moves, index), `harvest_state.json` first.
2. Both are saved after each send, in the same order.
3. `collector_state.json` is saved once more after the side jobs, which record their buckets.

A crash between the two saves leaves `bm` stale. That costs at most one extra summary, and a stale summary is never
sent.

A failure to save `collector_state.json` is a warning, not a crash. The run's exit code stays what
`harvest_state.json` decides, so that full mode's exit codes are unchanged. The next run then sees invalid entries and
uses R1.

### 5.3 What is due: buckets (O3)

All times are Asia/Tokyo. A job is due when the bucket of now differs from its recorded bucket.

**`Due.Hour`** is `HourBucket(now) != jobs.hour`. `jobs.hour` is recorded at the end of every run that reached the
server.

| Job | Tier | Bucket | Recorded on | Not recorded (retried next run) on |
|---|---|---|---|---|
| outbox flush, harvest pass, heartbeat | 15 min | every run | — | — |
| summary refresh and retry | per session (§5.5, O5) | — | — | — |
| `plan_today` (judges `DaysToJudge(now)[0]`) | 1 h | hour `YYYY-MM-DDTHH` | every result except `unreachable` | `unreachable` |
| `deliverables` | 1 h | hour | every result except `unreachable`, **`partial` included**: the remainder waits for the next hour | `unreachable` |
| `plan_yesterday` (judges `DaysToJudge(now)[1]`) | 1 day | JST date of `now − 5 h` (O4b) | every result except `unreachable` | `unreachable` |
| `rescan` | 1 day | same | the pass completed | server unreachable |
| `review` (previous ISO week) | 1 week | ISO week of the JST date | `stored`, `exists`, `no-data`, `rejected` | `unreachable` and `llm-failed` record `review_tried` = this hour bucket, and the review is retried only when the hour bucket differs from `review_tried`, so at most one attempt per hour. `unreachable` with no LLM call is the same. |
| any job, a **`panic`** (its `guard` caught one; the result word `ResultPanic`) | — | — | as `llm-failed`: `plan_today`, `deliverables` and `plan_yesterday` record their bucket; `review` records `review_tried` | — |

Two notes on the table:
- `llm-failed` and `bad-output` from the hourly and daily judges count as done for that bucket. A broken `claude`
  therefore costs one call per job per bucket.
- After sleep, every changed bucket fires **once** in the next run. Missed buckets are not caught up one by one.
  launchd's `StartCalendarInterval` folds missed slots into a single run on wake (the comment in
  `scripts/com.worklog.harvest.plist`).

**About the 05:00 offset.**
- The day bucket starts at 05:00, but the judged day stays midnight to midnight. By 05:00, sessions that ran past
  midnight have stopped and received their final summary.
- The week bucket uses JST midnight on Monday. This differs from the day bucket's offset, so the review for the
  previous week can run between 00:00 and 05:00 on Monday, before a session that ran past Sunday midnight has stopped.
  This is accepted (O4b). The weekly review is built from server statistics, and a summary that arrives later does not
  change those numbers.

### 5.4 The 15-min pass: stat first, parse what changed

**The parser seam** (Claude and Codex):

```go
type Filter struct {
    Keep  func(path string, mtime float64) bool          // nil = keep all
    Empty func(path string, mtime float64)               // a kept file that yielded no session (nil = ignore)
    Skip  func(path string, mtime float64, metaID string) // codex only: a rejected rollout's meta session id, for dedupe
}
func IterSessionsFiltered(root string, since *float64, f Filter, env *rt.Env, yield func(*session.RawSession))
```

`IterSessions(root, since, env, yield)` becomes `IterSessionsFiltered(root, since, Filter{}, env, yield)`. Full mode,
`--refresh-meta` and every existing test therefore stay unchanged.

**How each parser applies it.**
- **Claude:** `Keep` runs after the `since` check, on the `combinedMtime` the parser already computes. It is also
  computed when `since` is nil and `Keep` is set.
- **Codex:** `Keep` runs after the fork mtimes are folded in, just before `parseRollout`, on exactly the value that
  `RawSession.Mtime` gets.
  - `firstMeta` still reads the head of every rollout (83 on the Mac): a stat plus a read of about 8 KB, not a parse.
    D2 warnings therefore still print on every run.
  - When `Keep` rejects a rollout, the loop marks `seen` with the rollout's meta session ID, so that an
    `archived_sessions/` duplicate is not yielded in its place. That keeps today's deduplication.
  - If the meta ID ever differed from the ID the parse would yield, the daily rescan (`Keep = nil`) restores today's
    exact behaviour.

**The tiered pass's `Keep`** returns true, meaning parse, when `path` is in the run's **refresh set** (§5.5). Otherwise
it skips the file when:

| `files[path].kind` | Skip when |
|---|---|
| `session` | `harvest_state[key].Mtime == mtime` **and the key is not in this run's refresh set**. This is today's mtime-equality check moved before the parse, and it is counted in `skipped` as today. |
| `excluded` | `files[path].mtime == mtime`. Counted in `skipped`, as today. |
| `none` (the log gave no session ID) | `files[path].mtime == mtime`. Not counted, as today. |
| absent | never skipped |

For `session` files the skip **is the same float comparison** that today's code makes after parsing. A log's session ID
never changes, so knowing the key in advance changes nothing about which sessions reach the fingerprint check. Two logs
with the same key behave as today: the one whose mtime is not in the bookmark is parsed every run.

**When the index is written.** The `files` entry is written **every time a parse confirms the key**:
- the mtime-match skip after a parse, which happens on the first tiered run and on the rescan;
- R0;
- every send, including rejected and lost ones.

That is safe because for `session` files the skip depends on the **bookmark's** mtime, not the index's. A rejected or
lost send writes no bookmark, so its file is parsed again next run when its log had moved. It is not re-summarized,
because its cache entry (new summary, `pfp`, `at`, with `bm` unchanged) is written and R2 applies. A send whose log had
**not** moved (a refresh-set send or an R7 adoption) keeps its prior entry instead, as §5.5 sets out.

`none` and `excluded` entries are written when the file is seen.

**Consequences.**
- After a Python seed or a full-mode run, the **first** tiered run parses the window once, indexes every file and saves
  the index at the end of phase 1.
- The **second** tiered run parses nothing (`Parsed == 0`).
- A Codex rollout moved into `archived_sessions/` has a new path, and moving it keeps its mtime. It is parsed once,
  matched by mtime (the same comparison as today) and indexed. After that it is stat-skipped. The `fp` is never reached.

**The daily `rescan`** runs the same pass with `Keep = nil`.
- It is the safety net against a wrong index.
- It prunes `files` entries whose path is gone or whose `mtime` is outside the window, and `sessions` entries whose
  `seen` is older than 15 days.
- `harvest_state.json` is not pruned, as Python never pruned it.

### 5.5 Summary rules (tiered mode)

**Inputs.** For every parsed, non-trivial, non-excluded session the pass computes:
- `fp`, unchanged (Go spec §5.3);
- `pfp = digest(summarize.Prompt(raw))`, with the same blake2b-16 `digest` as the fingerprint.

**When an attempt is allowed.** A summarizer attempt on a session with a valid entry is **allowed** only when
`entry.tries == 0` or `now − entry.tried ≥ backoff(tries)`. The backoff is 1 h, 2 h, 4 h, 8 h, then 24 h (O5).
R1 is always allowed.

**The rules:**

| # | Condition | Action | LLM |
|---|---|---|---|
| R0 | `fp == bookmark.fp` **and the key is not in this run's refresh set** | Move the bookmark (as today). Update `cur_pfp`, `last_msg`, `seen`, `bm`. | 0 |
| R1 | No **valid** entry. Covers a new session, the first tiered run after an upgrade, and a failed `bm` check. | Summarize, then send.<br>• Result `llm`: entry with `tries = 0`.<br>• Result fallback: entry `source = "fallback"`, `tries = 1`, `at = tried = now`. | 1 |
| R2 | Valid entry, `pfp == entry.pfp`, `source == "llm"` | Send the cached summary; only the numbers changed. | 0 |
| R3 | Valid entry, `source == "llm"`, `pfp != entry.pfp`, an attempt is allowed, **and** `now − at ≥ 60 min` (hourly) or `now − last_msg ≥ 30 min` (stopped, O2) | Summarize, then send. On success the entry is updated and `tries = 0`. | 1 |
| R3f | R3, but the attempt fell back (T8) | **Keep and send the cached `llm` summary**, `tries++`, `tried = now`. The entry stays stale and is retried on the backoff. | (1) |
| R4 | Valid entry, `source == "llm"`, `pfp != entry.pfp`, R3 not due | Send the cached summary. It is now stale (`cur_pfp != pfp`). | 0 |
| R5 | Valid entry, `source == "fallback"`, attempt allowed | Summarize. On `llm`, the entry becomes `llm` with `tries = 0`. On fallback, `tries++`, `tried = now`, and the new fallback text is sent. | 1 |
| R6 | Valid entry, `source == "fallback"`, attempt not allowed | Send the cached fallback summary. | 0 |
| R7 | **Adoption.** The pass parsed the session; its bookmark matched by mtime and has no `fp`; the key is not already in this run's refresh set; the session is non-trivial and not excluded; there is no valid entry. This is a fallback from before tiering, such as the 10/19 five. | Create an entry: `source = "fallback"`, the summary = today's fallback text, `tries = 0`, `at = 0`, `bm` = the existing bookmark. R5 then applies in the same run. | 1 |

**Why R7 cannot misfire.** It runs in every pass that parses: the first tiered run and every rescan. A non-trivial
session with an `fp`-less bookmark arises only in two ways:
- from a fallback;
- from a pre-fingerprint bookmark, written before 9/30 and therefore outside the 14-day window.

**The refresh set** is built **before the scan**, from the state alone. It holds every valid entry where an attempt is
allowed and one of these holds:
- the entry is `llm`, stale, and R3 is due;
- the entry is `fallback`.

Each entry's path comes from the `files` index: the path whose `files[path].key == key`, falling back to `entry.path`.
If no such file exists any more, the entry is left alone and the next rescan finds the session.
An entry whose log is older than the run's `since` window (by the larger of the log's mtime and the bookmark's
combined mtime) is left out too: the parsers check `since` before `Keep`, so it would never be offered; the prune or the
rescan deals with it.
A refresh-set key whose session the pass finds excluded or trivial (a config change) has its entry dropped, so it
leaves the refresh set instead of being parsed on every run until the 15-day prune.

The refresh set's paths are passed to `Keep`, so a refreshed session is **produced by the same parser pass, with the same
fork and subagent merge**, as any other session (B1). A key in the refresh set **bypasses** two shortcuts:
- the phase-1 mtime-match skip (`harvest.go:180-183`);
- R0.

It goes straight to R3, R3f or R5. So even when its mtime and `fp` both equal the bookmark, the record is **still
sent**, because its summary changed. This is how a stopped session gets its final summary, and how a
fallback is repaired, while its log never moves.

**Bookmarks** follow today's rules:
- a fallback result is bookmarked without `fp`;
- R3f keeps `fp`, because what was sent is an `llm` summary;
- rejected and lost sends are never bookmarked.

**A failed send whose log had not moved** (its bookmark's mtime already equals the log's: a refresh-set send or an R7
adoption) would be stat-skipped from then on, so its cache entry must stay due:
- **lost**: the entry is left exactly as it was before the run, and the next due run retries it;
- **rejected**: the prior entry is kept, with `tries++` and `tried = now`, so the refresh set retries it on the
  backoff (1 h, 2 h, 4 h, 8 h, then 24 h). The entry stays stale or a fallback, so `tiered-rollback` (§5.11) still
  sees it (final-review ruling, 2026-10-21).

A failed send whose log moved caches the new summary with `bm` unchanged, and the re-parse re-sends it (R2, §5.4).

An `fp`-less bookmark makes later mtime moves reach the table, and R6 keeps those LLM-free.

**Full mode** does not use the table. It summarizes exactly as today. It writes and refreshes entries (summary, source,
`pfp`, `cur_pfp`, `at`, `tried`, `last_msg`, `seen`, `bm`) on every bookmark write, so that a later tiered run never
sends an older summary than the server holds.

**Reuse is exact or bounded.**
- R2 reuses a summary made from the **same** input.
- Only R3f, R4 and R6 leave the server with a summary older than the log:
  - R4 lags at most 60 min plus one run for an active session;
  - after a stop, R4 lags at most 30 min plus one run;
  - R3f lags on the backoff.

Audit S1 checks this.

### 5.6 Side jobs by tier

`harvest.SideJobs` gains `due Due` and `record func(job, result string)`: it passes each job's result word, and
`Record` maps the word to the bucket written per §5.3.
- In full mode every job is due. Order and stderr lines are exactly today's (Go Review Focus #11), and the buckets are
  recorded.
- In tiered mode only the due jobs run. They run in today's order (review, plan today, plan yesterday, deliverables),
  each wrapped in `guard`, and each records its bucket per §5.3.
- `collector_state.json` is saved after the side jobs.

### 5.7 Output, decision log, heartbeat

**stdout** keeps today's shape exactly:

```
new=… updated=… parked=… skipped=… fallback=…[ rejected=…][ lost=…][, unassigned=…]
```

In tiered mode `fallback=` counts **summarizer attempts that fell back in this run**: R1, R3f and R5 results.
- It is counted at the summary-attempt outcome, not in `send()`. R3f counts even though it sends an `llm` summary.
- Cached fallback re-sends (R6) are not counted.
- Full mode is unchanged: it still counts in `send()` (`harvest.go:267-268`), where the two counts coincide.

**stderr, tiered mode only.** One line, printed **after the side jobs**, because `jobs=` needs their results. This is plan run-order step 9:

```
tiers: due=15m[,1h][,day][,week] parsed=P new=N bootstrap=B reused=R refreshed=F failed=X adopted=A jobs=<job>:<result>,…
```

| Field | Counts |
|---|---|
| `new` | R1 for a session without a bookmark |
| `bootstrap` | R1 for a session that has one: an empty or invalid cache, a one-off cost after the upgrade |
| `reused` | sends of a cached summary that made no LLM call: R2, R4 and R6 (controller ruling, 2026-10-21), counted when the send is accepted or parked, not when it is rejected or lost |
| `refreshed` | successful R3 and R5 |
| `failed` | R3f and fallback R5 results |
| `adopted` | R7 |
| `jobs` | one entry per side job that ran, with its result word (`unchanged`, `stored`, `llm-failed`, …) |

**`<Home>/tiers.jsonl` (Go only, tiered mode).** One JSON line per session decision:

```
{"ts", "key", "rule", "source", "pfp", "cur_pfp", "at"}
```

There is also one line per side-job result. The file is rotated at the daily rescan, which keeps 8 days. It is what the
S1 audit and the acceptance measures read.

**Heartbeat.** It is sent on every run that reached the server, which makes about 96 rows per day per machine.
`hourSlots` and `last_run_at` need no change. The heartbeat's `updated` count now includes numbers-only re-sends. A4
runs/day reads about 96 after the cutover (O9).

**`unassigned=`.** It is fetched only when `Due.Hour` (O6).

### 5.8 Idle run budget

| Step | Cost |
|---|---|
| lock + flush | `stat` of `outbox/` |
| `GET /api/tasks` | 1 round trip |
| stat walk | about 2,800 Claude files listed, about 1,140 stat'd in the window; 83 Codex head reads |
| refresh-set scan | in memory |
| `POST heartbeat` | 1 round trip |

The first lever for G1 is O6's deferred `Tasks()`. It is used only if the measured idle wall time is above 1.5 s.

### 5.9 Lock (O7)

Both modes create `<Home>/harvest.lock` with `O_EXCL`. The file holds the pid and the start time.

**A held lock is stale, and is replaced, when either:**
- the pid is no longer alive (`kill(pid, 0)` / `OpenProcess`);
- it is older than 60 min, which guards against pid reuse.

**When the lock is held and not stale:**
- tiered mode prints `worklog: another harvest is running (pid N since T, lock <path>); skipped`, exits 0, and sends no
  heartbeat;
- a manual run prints the same line and exits 2.

**A held lock that cannot be read or claimed** (on Windows, a sharing violation: Go opens files without
`FILE_SHARE_DELETE`, so a contender reading the lock makes the stale claim's rename fail) is retried a bounded number of
times, then treated as held: `ErrLocked`, with `holder unreadable` when no holder was read (final-review ruling,
2026-10-21).

**Any other `Acquire` error**, which is only an error creating the lock (a permission problem, a missing directory):
warn and run **without** the lock. Full mode's exit code must not change because of the lock.

**Ordering.** The lock is taken **before the outbox flush**, so that two runs never replay the same outbox. It is
released by `defer` on every path, panics included.

Why add a lock now: at 4× the cadence, a manual run that overlaps an hourly run spending minutes in `claude -p` is
realistic. Today two runs at once are a known risk only (Go spec §11).

### 5.10 Schedulers

**Mac (plan Task 6).**
- `ProgramArguments`: `[<repo>/bin/wl, harvest, --tiered]`.
- `StartCalendarInterval`: four dicts, `Minute` 0, 15, 30 and 45.
- The change goes into the live plist and into `scripts/com.worklog.harvest.plist`.

**Win11.** Not in this plan (O8). After its Go cutover and soak, a separate runbook adds a `-Tiered` switch to
`schtasks-harvest.ps1`, refused unless `bin\wl.exe` exists. With the switch:
- the trigger repeats every 15 min;
- the `.cmd` gets `--tiered`;
- `ExecutionTimeLimit` is 14 min;
- `MultipleInstances` is `IgnoreNew`.

### 5.11 Rollback and hand-off

**Tiered → full, or → Python (rollback).**
- Neither full mode nor Python ever refreshes a summary whose log stopped moving. Without a reset, every session that
  is stale at the switch would keep its older summary. That covers R3f, R4 and R6 entries: `cur_pfp != pfp`, or
  `source = "fallback"`.
- The rollback therefore runs `go -C collector run ./parity/tools/tiered-rollback <Home>` once (plan Task 5). The repo
  root has no `go.mod`, so the tool is run from `collector/`. The tool:
  - rewrites each such key's bookmark in `harvest_state.json` to `{mtime: 0}`, with no `fp`;
  - leaves every other entry untouched;
  - prints the count.
- The next full-mode or Python run re-summarizes exactly those sessions, once.

**Python → Go, Win11 later.** Every cache entry is invalid or missing, so R1 applies once to each session whose `fp`
moved, plus R7 to each fallback. That is today's cost plus the fallback repairs.

## 6. New divergences (to be appended to the Go spec §6 as D19–D27)

All rows apply to `--tiered` only, except D25, which applies to both modes. Each row gets a Go test, listed in
`collector/TESTMAP.md` under "Spec §6 divergent rows".

| # | Input | Python (and Go full mode) | Go `--tiered` |
|---|---|---|---|
| D19 | A log whose combined mtime equals its key's bookmark | parsed, then skipped; its D1, D3, D11, D17 and mixed-offset warnings print on **every** run (`evidence/step_13_perf.md`) | skipped before the parse, with the same `skipped` count. Those warnings print only when the log is parsed: its first run, when it changes, and the daily rescan. Codex `firstMeta`, and so D2, still runs every run. |
| D20 | A log with no session ID, or an excluded cwd, unchanged since the last run | parsed every run | skipped before the parse until its mtime moves |
| D21 | A session whose fingerprint moved but whose summarizer input did not | re-summarized | re-sent with the cached summary (R2) |
| D22 | A session whose summarizer input moved | re-summarized every run | re-summarized after ≥60 min since its last summary, or ≥30 min since its last message; otherwise re-sent with the cached summary (R3/R4). A failed refresh keeps the cached `llm` summary (R3f). |
| D23 | A fallback summary whose log never moves again, including one from before tiering | never retried | retried on the backoff (R5, R7) |
| D24 | Weekly review, plan judge, deliverable judge | every harvest | per bucket (§5.3); yesterday's judge once per 05:00 day |
| D25 | Two harvests at once | Python: both run, state is last-write-wins (Go full mode: the lock, as in the Go column) | the second one exits on the lock: 0 when tiered, 2 when manual (§5.9) |
| D26 | The `, unassigned=N` tail of the stdout line | on every run where the GET succeeds | only on runs where `Due.Hour` |
| D27 | Extra output, and what `fallback=` counts | `fallback=` counts sends whose source is fallback | the `tiers:` stderr line and `<Home>/tiers.jsonl` (§5.7). `fallback=` counts summary attempts that fell back (R1, R3f, R5), not R6 re-sends. |

`--tiered`, `collector_state.json`, `tiers.jsonl` and `harvest.lock` are Go-only.

## 7. Decisions on the open points

All recommendations were accepted on 2026-10-20 (T7). Each entry records the alternatives for the record.

**O1. Summary home: A, a separate `collector_state.json` (§5.2).** Two alternatives were rejected.

- **A′, the fields inside `harvest_state.json`.** Rejected because:
  - D9's `SaveState` drops unknown keys;
  - the differ compares every field of every entry;
  - the file is the Python hand-off contract.
- **B, the server keeps the summary when it is omitted.** Rejected because:
  - the INSERT branch still needs a non-NULL summary, so a wrong guess about whether the row exists means a 400, then
    `rejected/`, then retries forever;
  - the server would have to deploy first;
  - it breaks Go spec U2;
  - the fallback retry needs collector-side state anyway.

**O2. "Stopped" means the last text message (`EndedAt`) was ≥30 min ago.** This is the same gap as `gapMinutes`, and it
is immune to metadata appends.
- Caveat: a tool-only stretch of ≥30 min with no text looks "stopped". That costs one extra refresh, and
  `active_intervals` accepts the same blind spot.
- The alternatives were log mtime idle (fooled by metadata appends and background subagents) and an explicit end
  record (neither agent writes one reliably).

**O3. Buckets** for hour, 05:00 day and ISO week. After sleep, each bucket fires once. Elapsed-time scheduling was
rejected because it drifts off the hour slots.

**O4. Manual `wl harvest` = full mode; the scheduler passes `--tiered`.** A tiered default with a `--full` opt-in was
rejected because:
- the harness passes the same argv to both sides;
- the `/wl` skill's 「作業ログを収集する」 means "collect everything now".

**O4b. The day bucket starts at 05:00 JST.** The judged day stays midnight to midnight. The week bucket keeps Monday
00:00 (§5.3, an accepted inconsistency).

**O5. The clock and the backoff.**
- "At most hourly" uses a per-session clock, `now − at ≥ 60 min`, not a global hour.
- Failed attempts back off: 1 h, 2 h, 4 h, 8 h, then 24 h, within the 14-day window.
- Without a bound, a session that always fails would cost 336 calls over 14 days.

**O6. Network calls.**
- `GET /api/tasks` stays on every run, which keeps "unreachable → exit 2, no heartbeat".
- `unassigned=` is fetched only when `Due.Hour`.
- `Tasks()` is deferred only if idle wall time is measured above 1.5 s.

**O7. Lock: yes (D25, §5.9).**

**O8. Win11 schtasks: not in this plan.** After Win11's Go cutover and soak:
1. measure an idle `--tiered` run on Win11;
2. pick 15 or 30 min;
3. then write `-Tiered`.

**O9. Heartbeat.** Its payload is unchanged and it is sent on every run. Documented: runs/day is about 96, and `updated`
includes numbers-only re-sends.

**O10. 立即收集: a non-goal.** The later hook: the 15-min pass polls a server flag (one GET), and when the flag is set,
it runs full mode once.

**O11. Plan edits after the final judge are accepted as unjudged.** An edit to yesterday's plan after its 05:00 final
judge is not judged automatically. `wl plan judge --date YYYY-MM-DD` is the manual path.
- Until Win11's own cutover, Win11's Python still judges today and yesterday hourly. The server keeps the latest
  judgement either way.

## 8. Expected LLM calls, and acceptance targets

| Situation | `claude -p` calls |
|---|---|
| Idle 15-min run: no log moved, no bucket changed, nothing allowed in the refresh set | **0** |
| 15-min run, *k* sessions changed, none new, stopped or due | **0** (R2/R4) |
| A new session | 1 |
| An active session over *h* hours | ≤ 1 + ⌈*h*⌉ + 1, against about 4*h* at 15 min with today's rule |
| Hour bucket | the R3/R5 attempts allowed; ≤1 plan judge, only if the server fingerprint moved; deliverable batches while pending |
| Day bucket | 1 `plan_yesterday` run, ≤1 call; the rescan adds 0 unless something was missed |
| Week bucket | ≤1 review attempt per hour until `stored`, `exists`, `no-data` or `rejected`. `exists` is expected when Win11's Python generated the review first. |
| First tiered run after upgrade | one-off: `bootstrap` (≤ sessions whose `fp` moved in that run) + `adopted` (= the `fp`-less non-trivial bookmarks in the window) |

The plan measures each row through the counting runner (Go tests), the `tiers:` line and `tiers.jsonl` (production).

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The index skips a log it should parse | its numbers, or a new session, are missing until the rescan | the `session` skip is today's bookmark-mtime comparison; daily `Keep = nil` rescan; tests B2 and the Codex dedupe |
| The refresh re-parse differs from the pass record | fork tokens or the mtime are overwritten on the server | refreshes go through the same `IterSessionsFiltered` pass (B1); a test proves body and bookmark identical for Codex forks and Claude subagents |
| The cache is out of sync with the server | an older summary is sent | the `bm` check; `harvest_state.json` is saved first; the foreign-bookmark test |
| A summary up to 60 min stale on an active session | 此刻 / timeline show an earlier summary | bounded by R3; audit S1 measures the lag |
| A refresh failure while `claude` is down | the summary stays stale for longer | R3f keeps the `llm` text; backoff; `failed=` on the `tiers:` line |
| An upsert every 15 min bumps `updated_at` | a web edit on an **active** session's drawer is more likely to get a 409 | re-sends happen only when `fp` moved; a stopped session is re-sent once. Accept and watch. |
| A rollback leaves stale summaries | old summaries persist under Python or full mode | the `tiered-rollback` reset (§5.11) |
| A long hourly run holds the lock | a 15-min pass is skipped | the buckets catch up; the stale lock is detected by pid liveness and a 60 min age |
| Full-mode drift | parity breaks silently | full mode keeps today's decisions; local selftest plus Mac-snapshot parity are gates, because CI minutes are exhausted for October (memory `ci-actions-quota`) |
| The first run after wake | 20 s or more, several LLM calls | each bucket fires once; this is no worse than today's hourly run |
| A4-style comparisons | about 96 runs/day misread as an anomaly | O9 note in the A4 SQL header and here |
| Win11 picks up tiered code | not wanted before its cutover | T9: `wl-v0.1.0` is tagged before the merge; tiered mode needs an explicit flag that no Win11 script passes |
