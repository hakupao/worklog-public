# Input polish (润色) — design

Date: 2026-10-09 · Status: draft for user review · Related: `docs/design/2026-10-08-trilingual-report-pdf-design.md` (S1 translations), `server/src/i18n/*`

## 1. Why

The user types every piece of text (plans, 今日安排, 案件, 补记, report cells) in the quickest, roughest words.
Those words then show up in the 週報, the xlsx and the PDF, in three languages. The user wants each input
rewritten into concise work language automatically, without changing what it says.

## 2. User decisions (2026-10-09)

| # | Decision |
|---|----------|
| U1 | Polish **on save, automatically**; the original is kept and one click restores it (「已润色 · 还原」). |
| U2 | Scope: **all text the user types by hand**: plans (four horizons), 今日安排 text + detail, 案件 (title, 考え方/备注), 补记 / ad-hoc items, report hand-edited cells and hand-edited digests. |
| U3 | Style: concise work language. The polished text is then shown in **all three languages** (zh / ja / en). |
| U4 | Approach **A**: polish happens in the **same Sonnet call** that already translates each saved field (`translator.ts`, triggered by `translateSoon` after a save). Not a separate pre-save call, not in the collector. |
| U5 | Rule-A audit before release: sample real inputs and check, independently, that meaning did not change. |

## 3. Goals / non-goals

Goals
- Every human-typed field listed in §5 is polished once per distinct input, in its own language, then translated.
- Inputs from every entry point are covered: the v2 web UI, `wl new / done / hold / note` (PUT /api/tasks, POST /api/notes) and the `/wl` skill (which calls `wl`).
- Restore is one click, permanent for that text, and never re-polished.
- No extra model call, no new race with the optimistic `updated_at` locks, no new D1 queries in the cron sweep.

Non-goals
- Polishing AI-generated text: session summaries written by the collector, `ai_progress` / `ai_note`, AI digests, weekly reviews. These are translate-only, as today.
- Rewriting old data. Existing rows stay as they are; an optional backfill is in §12, open question Q2.
- Changing what the CLI prints (see §9).
- Live "polish as you type" in the browser.

## 4. Key design choice: polished text lives in the translation layer, the base column keeps the raw input

The approved summary said "the polished text becomes the official content; the raw text is stored in a separate table". This spec
keeps that outcome but implements it differently, for the reasons below:

- **Base column (e.g. `tasks.title`) = what the user typed (raw).** The sweep never writes base tables.
- **`translations` row = the polished text in the source language plus zh / ja / en made from it.** Every v2 read already goes through `localize()`, which
  returns the `translations` text for the request's `X-Lang`. So polished text is what the web UI, the 週報 page, xlsx and PDF show,
  in all three languages, including the language the user typed in.

Why not overwrite the base column:
1. **Locks.** Base tables use `updated_at` as an optimistic lock (`buildGuardedUpdate`, 409 `conflict`). A background write to `title` would
   either bump `updated_at` and make the user's next save from an open drawer fail with 409, or leave it unchanged and break the
   lock's meaning. Both are bugs, and the race window is the few seconds the user is still in the drawer.
2. **Restore is free.** The raw text never left the base column, so "还原" only has to tell the translation layer to stop polishing that text.
3. **Re-saves are free.** `wl done` / `hold` GET the task (no `X-Lang`, so it receives the base = raw) and PUT it back unchanged. The base does not change,
   the translation stays fresh, and nothing is re-polished. Under `X-Lang`, `dropUnchanged()` already drops a field sent back exactly as shown (DayDrawer's
   save-on-blur), and "shown" is now the polished text.
4. No new table, so the sweep's D1 budget (48/50) is unchanged.

Consequence, accepted: readers **without** `X-Lang` see the raw text. These are the CLI (`wl ls`, `wl done` echoes), the old v1 UI, the
collector's plan-judge input (`/api/day-plans/:date/judge-input`) and the digest generation inputs. For judging and digest generation, raw text carries the same meaning. The CLI is discussed in §9.

## 5. Field scope

The table lists every entry in `server/src/i18n/registry.ts` SOURCES, with the polish decision for each:

| entity.field | Polish? | Condition / note |
|---|---|---|
| task.title | yes | Keep 案件 names, product / client / study names and IDs verbatim; only fix the wording around them. |
| task.project | **no** | Project name / code, not prose. Translate-only. |
| task.thinking | yes | 考え方 / 备注. |
| note.text | yes | 补记 / ad-hoc items. |
| plan_item.text | yes | All four horizons. |
| day_plan_item.text | yes | Usually copied from a plan item (raw), so it is polished independently. The same rules give the same result, and a difference is acceptable. |
| day_plan_item.detail | yes | Today's goal; the plan judge reads the raw detail (§4). |
| day_plan_item.ai_progress / ai_note | no | AI output. |
| session.summary | only when hand-edited | Polish when `b.summary_edited IS NOT NULL`; the collector's own summary is AI output. |
| weekly_review.text | no | AI output. |
| report_override.value | yes | Numbers, dates and floats keep their `identity` path (never sent to the model). |
| digest.text / digest.pdf_text | only when hand-edited | Polish when `b.edited = 1`. |

Mechanism: `Source` gains an optional `polish` member, a SQL boolean over alias `b` (e.g. `"1"`, `"b.edited = 1"`,
`"b.summary_edited IS NOT NULL"`). Absent means translate-only. `staleSql` selects it as a column `polishable` (no extra query).

## 6. Data model

One migration adds two nullable columns to `translations`. It takes the next free migration number at implementation time; the PDF composer spec also adds one, so whichever lands first takes the lower number.

```sql
ALTER TABLE translations ADD COLUMN polished_from TEXT;  -- the raw base text a polish was made from; NULL = this row is not polished
ALTER TABLE translations ADD COLUMN pinned_raw TEXT;     -- 还原: this exact raw text is shown as typed, never polished
```

Row states for a polishable field whose base text is `R`:

| State | source_text | polished_from | pinned_raw | Slot in source_lang | zh / ja / en made from |
|---|---|---|---|---|---|
| polished | R | R | ≠ R or NULL | polished text P | P |
| restored | R | NULL | R | R | R |
| stale (edited) | ≠ R | any | any | — (UI shows R until the sweep runs) | — |

- Freshness keeps today's rule: fresh while `source_text = R`. `pick()` returns `r[lang]` only when it is fresh, so a just-edited field shows its raw text for the few seconds until the sweep runs. That is the same behaviour as today's translation lag.
- `pinned_raw` is tied to one exact text. When the user later types something new, `R ≠ pinned_raw` and the new text is polished again. Restoring
  applies only to the text it was clicked on (open question Q1 asks whether a "never polish this field" switch is also wanted).

## 7. Flow

```
save (web / CLI / skill)
  └─ route writes base column (raw R), bumps updated_at as today
  └─ translateSoon(entity, id) ── waitUntil ──► runSweep(only this row)
        findStale: source_text ≠ R  → item {text: R, polishable, pinned_raw}
        identity?(R)           → write R ×3 (unchanged path)
        polishable && pinned_raw ≠ R
            → polishAndTranslate(R)  ⇒ {source, polished: P, zh, ja, en}
            → re-read base; still R? write translations(source_text=R, polished_from=R, slots from P)
        else
            → translate(R) (today's call) ⇒ write translations(source_text=R, polished_from=NULL)
cron */5 sweep: same path for anything translateSoon missed (no key, failure backoff)

read (X-Lang)
  └─ localize(): fresh row → r[lang] (P or its translation); plus `polish` meta for UI (§8)

还原 (restore)
  └─ POST /api/i18n/pin {entity, entity_id, field, pinned: true}
        sets pinned_raw = current base R, source_text = '' (forces stale) → translateSoon
        the sweep sees pinned_raw = R → translate-only → slots made from R
  └─ 恢复润色: pinned: false → pinned_raw = NULL, source_text = '' → translateSoon
```

The base is re-read before writing, exactly as `runSweep` does today (`currentText`). If the user edited the field mid-call, the result is dropped and
the next round handles the new text. That check is the whole concurrency story: the sweep only writes `translations`, which has no user-facing lock.

## 8. API and UI

**Read.** `localize()` adds, per localized row, `_polish?: Record<field, { raw: string; pinned: boolean }>` for fields whose fresh row is
polished (`polished_from` not NULL) or restored (`pinned_raw = source_text`). It is absent otherwise, so old clients ignore it. `loadTr`
selects the two new columns; this is the same query, with no extra round trip.

**Edit.** Editing a field shows the **polished** text (what the user sees), as fields do today with the translated text. Saving:
- an unchanged value is dropped by `dropUnchanged` (now compared against the polished slot);
- a changed value becomes the new raw `R'` and is polished again. Polishing already-polished text is expected to be close to a no-op;
  if the user wants their exact words, they press 还原 after the save.

**Mark.** A small 「润」 mark sits after each polished field. Hover / focus shows 「原文：<raw>」 and a 「还原」 button. A restored field shows
「原文」 with 「恢复润色」. Components that render or edit these fields:
`v2/pages/plan/ItemDrawer.tsx`, `DayDrawer.tsx` (plan + 今日安排), `v2/pages/tasks/TaskDrawer.tsx` (title, 考え方),
`v2/ui/NotePanel.tsx` and `v2/pages/timeline/NoteDrawer.tsx` (补记), `v2/pages/timeline/SessionDrawer.tsx` (hand-edited summary),
`v2/pages/report/EditCell.tsx`, `CellDrawer.tsx`, `Digests.tsx` (report cells, digests). The mark is one shared component
(`v2/ui/PolishMark.tsx`), so each place adds a single element. List rows (timeline, plan lists) show the polished text without the mark; only drawers / edit
places carry it.

**Pin endpoint.** `POST /api/i18n/pin`, body `{entity, entity_id, field, pinned}`. Validates `entity.field` against SOURCES with
`polish` set. 404 if the row does not exist. It does **not** touch the base row or its `updated_at`. It returns the new state, and the client
refetches that entity's query once the sweep is done (re-read after ~5 s, the way `REGEN_REFETCH_MS` works for digests).

## 9. CLI

The CLI sends no `X-Lang`, so `wl ls` / echoes print the raw text. This is intended for now: the CLI is the user's own scratch view, and
mixing polished text into `wl done`'s GET→PUT round trip would turn polished text into new raw input. Open question Q3 asks whether `wl ls` should print the polished text. If yes,
it would send `X-Lang: <source>` only on read-only commands.

## 10. Prompt

There is one function, `polishAndTranslate(client, text, entity, field)`, next to `translate()`, with the same model (`MODEL`, Sonnet 5.5), the same
`effort: "low"` and the same timeouts. Structured output:

```json
{ "source": "zh|ja|en", "polished": "...", "zh": "...", "ja": "...", "en": "..." }
```

System prompt outline (the translate rules are today's `SYSTEM`, kept word for word, plus a polish block):
- Step 1, polish in the input's own language: rewrite into concise, plain work language (書き言葉 for ja, 书面语 for zh).
  Fix typos and broken grammar, expand obvious shorthand only when unambiguous, and keep it as short as the input or shorter.
- Never add facts, goals, numbers, reasons or politeness that are not in the input. Never drop a fact. Keep
  person / company / product / project / study names, IDs, versions, numbers, units, paths, code and URLs exactly as written.
  Keep quoted names and Markdown structure.
- If the input is already clear work language, return it unchanged.
- Step 2: translate the polished text into the other two languages under today's rules. The source slot equals `polished`.
- `Kind:` line as today (per entity / field), so a 案件 title stays a title-length noun phrase and a 今日安排 detail stays a goal.

Output checks (`TranslateFormatError` if they fail, so the existing backoff applies): all slots non-empty, and `polished` not longer than
`max(2 × input length, input length + 40)` characters, to guard against padding. The guard is a hard limit, but the rule-A audit runs first and decides whether it fits real inputs (lesson from S2c: a cap must be tested on real data).

## 11. Error handling

| Case | Behaviour |
|---|---|
| No API key | As today: nothing translated or polished; raw text shown. |
| Model / network error | As today: `writeFail` backoff (5 min → 60 min); raw text shown meanwhile. |
| Bad JSON / guard fails | `TranslateFormatError`, the same backoff. After 3 failed attempts on the same text, fall back to **translate-only** for that text, so one odd input cannot stay untranslated forever. |
| User edits mid-call | Result dropped (base re-read), next round. |
| Pin on a non-polishable field | 400. |
| Pin on a stale row | Allowed: pins the current base; the sweep then translates it unpolished. |

Polish never blocks a save, and a save never waits for polish.

## 12. Rollout and backfill

1. Migration applied to prod (`wrangler d1 migrations apply --remote`) **before** the push that reads the new columns.
2. Push → Workers Builds deploy. From then on, new saves are polished.
3. No backfill by default (Q2). If wanted later: a one-off script marks polishable rows stale (`source_text = ''`) in batches of the
   sweep size, run only after the audit passes. Cost estimate before running: the row count × about 1 Sonnet call each.

Cost: today each save already makes one Sonnet call. The polish adds output tokens (one more text slot), roughly +25–35% per call, on
short texts. That is negligible next to the $200/month API credit.

## 13. Testing

- Unit (server vitest, mocked Anthropic client as the existing i18n tests do):
  - a polishable field writes `polished_from = R` and slots from P; a non-polishable field writes as today;
  - `session.summary` is polished only when `summary_edited` is set; `digest` only when `edited = 1`;
  - unchanged re-save (`wl done` PUT of the same task) → no new model call;
  - `dropUnchanged` drops a value equal to the polished slot;
  - pin → translate-only from raw; unpin → polished again; a new edit after a pin is polished;
  - an edit during the call → result dropped;
  - guard failure ×3 → translate-only fallback;
  - `localize()` emits `_polish` meta only for polished / restored fresh rows;
  - the D1 query count of one sweep round is unchanged (assert the number of prepared statements, as the budget comment demands).
- Web vitest: `PolishMark` shows raw on hover, restore calls the endpoint and refetches; each drawer renders the mark.
- Local run (wrangler dev, local D1, a real `ANTHROPIC_API_KEY` from `.dev.vars`): type rough text in each of the §8 places and check the
  mark, the three languages and restore. Production is never written by tests.

## 14. Rule-A audit (before release)

The rewrite rate is expected to exceed 50%, so the audit is mandatory.
- Sample N = 24 real human inputs from prod, **read-only** (SELECT): 4 each from task.title, task.thinking, note.text,
  plan_item.text, day_plan_item.detail, report_override / hand-edited digest (whatever exists). Seeded random pick; seed in the evidence.
- Run `polishAndTranslate` on them (local script with the same prompt and model).
- An **independent reviewer** (a different subagent type from the writer) checks each item: meaning preserved, no added fact, no dropped
  fact, names / IDs / numbers verbatim, length guard respected, translations faithful to the polished text.
- Pass bar: 0 added facts, 0 changed names / numbers, ≥ 22/24 meaning preserved (the others "slightly vaguer", none wrong).
- Evidence: `docs/projects/2026-10-09-input-polish/evidence/step_NN_audit.md`. Failed attempts are archived under `failures/`, never deleted.

## 15. Open questions

- **Q1** Besides per-text 还原, a per-field "never polish" switch (e.g. for a 案件 title the user wants exactly as typed)? Default proposal: no; restore is enough.
- **Q2** Backfill existing rows after the audit? Default proposal: no.
- **Q3** Should `wl ls` print the polished text (read-only `X-Lang`)? Default proposal: no.
- **Q4** Should the plan judge and the digest generator read the polished text instead of the raw text? Default proposal: no (raw carries the same meaning, and judging stays independent of the polish model).
