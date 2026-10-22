# Contributing

worklog is three programs and a few scripts, each with its own dependencies and tests:

| Directory | What it is | Toolchain | Tests |
|-----------|------------|-----------|-------|
| `collector/` | The `wl` CLI | Go (version in `go.mod`), `CGO_ENABLED=0` | `go vet ./... && go test ./...` |
| `server/` | Cloudflare Worker: API, report builders, D1 | Node 24, npm | `npm run typecheck && npm test` (vitest in a local workerd) |
| `web/` | Web UI (React, Vite) | Node 24, npm | `npm run typecheck && npm test` (vitest, then re-run under several time zones) |
| `scripts/` | Node scripts and the skill installer | Node 24, bash | `node --test 'scripts/*.test.mjs'` and `bash scripts/tests/install-skill-render.sh` |

## Local development

### Collector

```bash
make -C collector build          # -> bin/wl
make -C collector test           # go test ./...
make -C collector vet            # go vet ./...
```

To run `wl` against a local Worker without touching your real setup, point it at a scratch configuration:
`WORKLOG_ROOT` selects the directory that holds `config.toml` (with `api_url = "http://127.0.0.1:8787"`), and
`WORKLOG_HOME` replaces `~/.worklog` (credentials, bookmarks, outbox).

### Worker and web UI

`server/` and `web/` each have their own `package.json`; run `npm install` in both first. `npx wrangler …` and
`npm run dev` use the local devDependencies.

```bash
# 1. A development token for the local Worker (server/.dev.vars is git-ignored)
echo 'API_TOKEN=dev-token' > server/.dev.vars

# 2. Apply the migrations to a local D1 and start the Worker on :8787 (nothing remote is touched)
cd server
npm install
npx wrangler d1 migrations apply DB --local
npm run dev

# 3. In another terminal, start Vite on :5173
cd web
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787` and adds `Authorization: Bearer ${WORKLOG_DEV_TOKEN ?? "dev-token"}`
on the Node side, so the browser never sees the token. To fill the local database:

```bash
cd web
node scripts/seed-local.mjs      # two tasks, six sessions, one note
node scripts/seed-badges.mjs     # 64 tasks and ~320 sessions over six weeks
```

Both refuse any host other than `localhost` / `127.0.0.1`. Do not run them against `wrangler dev --remote`, which
serves a local URL but writes to the remote D1.

## Running the tests

Before you push, run the suites for the parts you changed. If you change a contract between parts (an API shape, a
report field, a file the collector and the server both read), run all of them.

```bash
cd collector && go vet ./... && go test ./...

cd server && npm run typecheck && npm test

cd web && npm run typecheck && npm test

node --test 'scripts/*.test.mjs'          # from the repository root
bash scripts/tests/install-skill-render.sh
```

CI (`.github/workflows/ci.yml`) runs the same commands on every push to `main` and every pull request, and only
the jobs whose directories changed. The Go job also runs on Windows, cross-compiles for Windows and macOS, and
checks `scripts/release-wl.sh`. CI needs no secrets: the server tests run in a local workerd with D1 built from
`server/migrations/`, and `server/vitest.config.ts` generates the Cloudflare Access test keys on the spot.

## D1 migrations

A new file in `server/migrations/` has to be applied to the remote database **before** the code that needs it is
deployed:

```bash
cd server && npm run db:migrate          # wrangler d1 migrations apply DB --remote
```

`npm run deploy` does this for you. Cloudflare Workers Builds (deploy on push) does not: its build token has no D1
permission, so new code would start against the old schema.

## Commit messages

Follow the existing history (`git log --oneline -30`):

```
type(scope): short summary
```

- `type`: mostly `feat`, `fix`, `docs`, `chore`, `test`; sometimes `refactor` or `perf`.
- `scope` (optional): the area, for example `collector`, `server`, `web`, `tiered`, `now`, `led`. Two areas:
  `fix(now,settings)`.
- The summary is lower-case, imperative, one line. Add context after an em dash, for example
  `fix(lock): a lock that cannot be read or claimed is retried, then ErrLocked`.

## Pull requests

- One change per pull request. Say what behaviour changes and link the issue (`Closes #N`).
- Paste the commands you ran and their results; "tested" alone is not enough.
- Update the docs your change affects: `README.md` / `README.zh-CN.md`, `docs/guide/usage.md`,
  `docs/guide/api.md` for a route change, `THIRD_PARTY.md` for a dependency change.
- If you add a migration, say so in the description.

## Keep secrets out of the repository

These files live outside git. Never commit them or paste them into an issue or pull request:

| File | Contents |
|------|----------|
| `~/.worklog/credentials.toml` | `api_token` and the Cloudflare Access service token |
| `~/.worklog/local.toml` | This machine's `machine` name |
| `server/.dev.vars` | The local `API_TOKEN` |

The deployed `API_TOKEN` and `ANTHROPIC_API_KEY` are Worker secrets (`wrangler secret put`). `TEAM_DOMAIN` and
`POLICY_AUD` in `server/wrangler.jsonc` are public values.
